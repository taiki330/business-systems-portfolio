/**
 * Webアプリ用コントローラー。
 * Google FormsをGAS Webアプリに置き換えるためのサーバーサイド処理。
 * フォーム送信後、PhaseHandlerパイプラインでデータベース更新・自動計算・ダッシュボード更新を行う。
 */

// ========================================
// エントリポイント
// ========================================

/**
 * WebアプリのHTMLを返す。
 */
function doGet() {
  var bootstrap = {
    sites: getActiveSites(),
    formStructure: getWebAppFormStructure(),
    preStartChecklist: getPreStartChecklistBootstrap(),
    companySuggestions: getCompanySuggestions(),
    businessCategories: getWebAppBusinessCategories()
  };

  var template = HtmlService.createTemplateFromFile('webapp_index');
  template.bootstrap = JSON.stringify(bootstrap);
  return template
    .evaluate()
    .setTitle('現場管理報告フォーム')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 稼働現場リストから現場名一覧を取得する。
 * @return {Array<string>} 現場名の配列
 */
function getActiveSites() {
  var config = getConfig();
  var ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(config.MASTER_SHEET_NAME);
  if (!sheet) return [];

  var values = sheet.getRange(config.MASTER_RANGE).getValues();
  var sites = [];
  for (var i = 0; i < values.length; i++) {
    var name = values[i][0];
    if (name && name.toString().trim() !== '') {
      sites.push(name.toString().trim());
    }
  }
  return sites;
}

/**
 * 背景色が赤系かどうかを判定する。
 * @param {string} hexColor 16進カラーコード（例: '#ff0000'）
 * @return {boolean} 赤系ならtrue
 */
function isRedBackground(hexColor) {
  if (!hexColor || hexColor === '#ffffff' || hexColor === '') return false;
  var hex = hexColor.replace('#', '');
  if (hex.length !== 6) return false;
  var r = parseInt(hex.substring(0, 2), 16);
  var g = parseInt(hex.substring(2, 4), 16);
  var b = parseInt(hex.substring(4, 6), 16);
  // Rが200以上、かつG・Bが各100以下 → 赤系と判定
  return r >= 200 && g <= 100 && b <= 100;
}

/**
 * 外部スプレッドシートから元請け・一次・二次の候補会社名を取得する。
 * @return {Object} { contractors: string[], subcontractors: string[] }
 */
function getCompanySuggestions() {
  var config = getConfig();
  var source = config.COMPANY_SOURCE;
  var contractorSet = {};
  var subcontractorSet = {};

  try {
    var ss = SpreadsheetApp.openById(source.SPREADSHEET_ID);

    for (var s = 0; s < source.SHEET_NAMES.length; s++) {
      var sheet = ss.getSheetByName(source.SHEET_NAMES[s]);
      if (!sheet) continue;

      var lastRow = sheet.getLastRow();
      if (lastRow < 2) continue;

      var dataRows = lastRow - 1;

      // C列（発注）とN列（施工班）の値を取得
      var contractorValues = sheet.getRange(2, source.CONTRACTOR_COLUMN, dataRows, 1).getValues();
      var subcontractorValues = sheet.getRange(2, source.SUBCONTRACTOR_COLUMN, dataRows, 1).getValues();

      // 背景色を取得（C列とN列それぞれ）
      var contractorBgs = sheet.getRange(2, source.CONTRACTOR_COLUMN, dataRows, 1).getBackgrounds();
      var subcontractorBgs = sheet.getRange(2, source.SUBCONTRACTOR_COLUMN, dataRows, 1).getBackgrounds();

      for (var i = 0; i < dataRows; i++) {
        // 元請け・一次候補（C列）
        var cRaw = contractorValues[i][0];
        if (cRaw !== null && cRaw !== undefined && cRaw !== '') {
          var cName = cRaw.toString().replace(/[\s\u00A0\u3000]+/g, ' ').trim();
          if (cName.length > 0 && !isRedBackground(contractorBgs[i][0])) {
            contractorSet[cName] = true;
          }
        }

        // 二次候補（N列）
        var sRaw = subcontractorValues[i][0];
        if (sRaw !== null && sRaw !== undefined && sRaw !== '') {
          var sName = sRaw.toString().replace(/[\s\u00A0\u3000]+/g, ' ').trim();
          if (sName.length > 0 && !isRedBackground(subcontractorBgs[i][0])) {
            subcontractorSet[sName] = true;
          }
        }
      }
    }
  } catch (e) {
    Logger.log('getCompanySuggestions エラー: ' + e.toString());
    return { contractors: [], subcontractors: [] };
  }

  var contractors = Object.keys(contractorSet).sort();
  var subcontractors = Object.keys(subcontractorSet).sort();

  Logger.log('getCompanySuggestions: contractors=' + contractors.length + ', subcontractors=' + subcontractors.length);
  return { contractors: contractors, subcontractors: subcontractors };
}

// ========================================
// フォーム送信処理
// ========================================

/**
 * Webフォームからの送信を処理する。
 * 1. Base64ファイルを直接Driveに保存
 * 2. namedValuesを構築
 * 3. シートに転記（フォームの回答1 + フェーズ別）
 * 4. PhaseHandlerパイプライン（DB詳細書き込み・自動計算・アイコン更新）
 *
 * @param {Object} payload { answers: {title: value}, files: [{fieldTitle, data, fileName, mimeType}] }
 * @return {Object} { success: boolean, message: string, warnings: Array<string> }
 */
function submitWebForm(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { success: false, message: 'サーバーが混雑しています。しばらく待ってから再送信してください。' };
  }

  // 結果収集オブジェクト
  var pipeline = { steps: [], warnings: [] };

  try {
    var answers = payload.answers || {};
    var files = payload.files || [];
    var phaseName = answers[CONFIG.PHASE_INDICATOR_KEY] || '';

    if (!phaseName) {
      return { success: false, message: '業務カテゴリが選択されていません。' };
    }

    // --- 現場名を取得 ---
    var config = getConfig();
    var existingSite = answers[config.EXISTING_SITE_FIELD] || '';
    var newSite = answers[config.NEW_SITE_FIELD] || '';
    var siteName = '';
    if (existingSite && existingSite !== '新規現場を入力') {
      siteName = existingSite.toString().trim();
    } else if (newSite) {
      siteName = newSite.toString().trim();
    }

    // --- 1. ファイルをDriveに直接保存（またはフォルダのみ確保） ---
    var siteFolderUrl = '';
    var uploadFolderId = '';
    var expectsFileUpload = payload.expectsFileUpload === true || files.length > 0;

    if (expectsFileUpload) {
      if (files.length > 0) {
        try {
          siteFolderUrl = saveWebUploadFiles(answers, files, phaseName) || '';
          if (!siteFolderUrl) {
            throw new Error('ファイルの保存先フォルダを確保できませんでした。');
          }
          pipeline.steps.push({ name: 'ファイル保存', ok: true, detail: files.length + '件' });
        } catch (err) {
          var driveMsg = String(err.message || err);
          pipeline.steps.push({ name: 'ファイル保存', ok: false, detail: driveMsg });
          Logger.log('submitWebForm: Drive保存失敗のためシート転記をスキップ: ' + driveMsg);
          return {
            success: false,
            message: driveMsg,
            driveError: { code: 'DRIVE_SAVE_FAILED', detail: driveMsg },
            warnings: pipeline.warnings,
            steps: pipeline.steps
          };
        }
      } else if (payload.sessionId) {
        try {
          uploadFolderId = prepareUploadFolder(answers, phaseName);
          if (!uploadFolderId) {
            throw new Error('アップロード先フォルダの確保に失敗しました。');
          }
          siteFolderUrl = DriveApp.getFolderById(uploadFolderId).getUrl();
          pipeline.steps.push({ name: 'アップロードフォルダ確保', ok: true });
        } catch (err) {
          var folderMsg = String(err.message || err);
          pipeline.steps.push({ name: 'アップロードフォルダ確保', ok: false, detail: folderMsg });
          Logger.log('submitWebForm: フォルダ確保失敗のためシート転記をスキップ: ' + folderMsg);
          return {
            success: false,
            message: folderMsg,
            driveError: { code: 'DRIVE_FOLDER_PREPARE_FAILED', detail: folderMsg },
            warnings: pipeline.warnings,
            steps: pipeline.steps
          };
        }
      }
    }

    // --- 2. namedValuesを構築（既存handler互換） ---
    var namedValues = buildNamedValues(answers);
    pipeline.steps.push({ name: 'namedValues構築', ok: true });

    // --- 3. 「フォームの回答 1」シートに転記（失敗時は DB 反映まで行かない） ---
    var response1Ok = false;
    try {
      writeToResponseSheet(namedValues);
      response1Ok = true;
      pipeline.steps.push({ name: 'フォームの回答1転記', ok: true });
    } catch (err) {
      pipeline.steps.push({ name: 'フォームの回答1転記', ok: false, detail: err.toString() });
      pipeline.warnings.push('フォームの回答1転記に失敗: ' + err.toString());
    }

    // --- 3b. フェーズ別シートに転記 ---
    var phaseSheetOk = false;
    try {
      separateSheetByBusiness_Web(namedValues, phaseName);
      phaseSheetOk = true;
      pipeline.steps.push({ name: 'フェーズ別シート転記', ok: true });
    } catch (err) {
      pipeline.steps.push({ name: 'フェーズ別シート転記', ok: false, detail: err.toString() });
      pipeline.warnings.push('フェーズ別シート転記に失敗: ' + err.toString());
    }

    SpreadsheetApp.flush();

    // 回答・フェーズ別の転記が成功したあとだけデータベースへ進む
    if (!response1Ok || !phaseSheetOk) {
      Logger.log('submitWebForm: シート転記失敗のためデータベース更新をスキップ');
      return {
        success: false,
        message:
          'スプレッドシート（「フォームの回答 1」またはフェーズ別シート）への転記に失敗しました。' +
          (siteName ? 'データベースへは反映していません。' : '') +
          '内容を確認のうえ再送信してください。',
        warnings: pipeline.warnings,
        steps: pipeline.steps
      };
    }

    // --- 4. PhaseHandlerパイプライン（DB詳細書き込み・自動計算・アイコン更新） ---
    var handlerResult = null;
    if (siteName) {
      var newSiteFlow = isNewSiteFlow_(existingSite, newSite);
      handlerResult = PhaseHandler.process(siteName, phaseName, namedValues, {
        skipDashboardUi: newSiteFlow
      });
      // PhaseHandlerの結果をマージ
      pipeline.steps = pipeline.steps.concat(handlerResult.steps);
      pipeline.warnings = pipeline.warnings.concat(handlerResult.warnings);
      if (!handlerResult.success) {
        pipeline.warnings.push('データベースへの保存に失敗しました（PhaseHandler）');
      }

      // --- 5. DriveフォルダURLを報告シートに書き込み（画像添付時のみ）---
      if (handlerResult.success && siteFolderUrl) {
        try {
          writeFolderUrlToReportSheet(phaseName, siteFolderUrl);
          pipeline.steps.push({ name: 'フォルダURL書き込み', ok: true, detail: siteFolderUrl });
        } catch (urlErr) {
          pipeline.warnings.push('フォルダURL書き込みに失敗: ' + urlErr.toString());
          pipeline.steps.push({ name: 'フォルダURL書き込み', ok: false, detail: urlErr.toString() });
        }
      }
    } else {
      pipeline.warnings.push('現場名が空のため、データベース更新をスキップしました');
    }

    // --- 結果判定（データベース経路の失敗は success: false） ---
    var hasCriticalFailure = false;
    if (siteName && (!handlerResult || !handlerResult.success)) {
      hasCriticalFailure = true;
    }
    for (var s = 0; s < pipeline.steps.length; s++) {
      var st = pipeline.steps[s];
      if (!st.ok && (st.name === 'DB書き込み' || st.name === 'DB行検索' || st.name === 'フェーズ設定取得')) {
        hasCriticalFailure = true;
        break;
      }
    }
    var hasWarnings = pipeline.warnings.length > 0;

    Logger.log('submitWebForm 完了: steps=' + pipeline.steps.length +
      ', warnings=' + pipeline.warnings.length +
      (hasWarnings ? ' [' + pipeline.warnings.join('; ') + ']' : ''));

    if (hasCriticalFailure) {
      return {
        success: false,
        message: siteName
          ? 'データベースへの保存に失敗しました。しばらくしてから再送信するか、管理者に連絡してください。'
          : 'データの保存中にエラーが発生しました。管理者に連絡してください。',
        warnings: pipeline.warnings,
        steps: pipeline.steps
      };
    }

    return {
      success: true,
      message: hasWarnings ? '送信完了（一部注意事項あり）' : '送信が完了しました。',
      warnings: pipeline.warnings,
      uploadFolderId: uploadFolderId,
      steps: pipeline.steps
    };

  } catch (err) {
    Logger.log('submitWebForm 致命的エラー: ' + err.toString());
    return { success: false, message: 'エラーが発生しました: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * チャンク単位で写真をDriveに保存する。
 * クライアントのPhase 2から繰り返し呼び出される。
 * @param {Object} payload { folderId: string, files: [{data, fileName, mimeType}] }
 * @return {Object} { success: boolean, uploaded: number }
 */
function uploadFileChunk(payload) {
  var folderId = payload.folderId || '';
  var files = payload.files || [];
  if (!folderId) return { success: false, message: 'folderIdが指定されていません' };
  if (files.length === 0) return { success: true, uploaded: 0 };

  var uploaded = DriveService.saveBase64FilesToFolder(files, folderId, '');
  return { success: true, uploaded: uploaded };
}

// ========================================
// 内部関数
// ========================================

/**
 * 「新規現場を入力」で送っているか（表記ゆれを吸収）
 */
function isNewSiteFlow_(existingSite, newSite) {
  var ex = String(existingSite || '')
    .replace(/^[\s\u3000]+|[\s\u3000]+$/g, '')
    .trim();
  var nw = String(newSite || '').trim();
  return ex === '新規現場を入力' && nw !== '';
}

/**
 * フォーム回答をnamedValues形式に変換する。
 * 既存のPhaseRouter/Handlerが期待する { 'タイトル': ['値'] } 形式。
 * @param {Object} answers { 'タイトル': '値' } のフラットなオブジェクト
 * @return {Object} { 'タイトル': ['値'] }
 */
function buildNamedValues(answers) {
  var namedValues = {};
  var keys = Object.keys(answers);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = answers[key];
    // 配列でラップする（既存handlerがvalue[0]でアクセスするため）
    namedValues[key] = Array.isArray(value) ? value : [value.toString()];
  }
  // タイムスタンプを追加
  namedValues['タイムスタンプ'] = [new Date().toString()];
  return namedValues;
}

/**
 * WebアップロードファイルをDriveの正しいフォルダに直接保存する。
 * 新規現場の場合は仮フォルダに振り分け、既存現場は正式フォルダに保存。
 */
function saveWebUploadFiles(answers, files, phaseName) {
  var config = getConfig();
  var existingSite = answers[config.EXISTING_SITE_FIELD] || '';
  var newSite = answers[config.NEW_SITE_FIELD] || '';

  var isNewSite = false;
  var siteName = '';
  if (existingSite && existingSite !== '新規現場を入力') {
    siteName = existingSite;
  } else if (newSite) {
    siteName = newSite;
    isNewSite = true;
  }

  if (!siteName) {
    throw new Error('現場名が指定されていません。');
  }

  var buildingName = answers['棟名'] || '';

  // config.jsのFORMS配列からフェーズ情報を取得
  var phaseConfig = getPhaseConfig(phaseName);
  if (!phaseConfig) {
    throw new Error('不明な業務カテゴリです: ' + phaseName);
  }
  var mapping = { phase: phaseConfig.phase, subFolder: phaseConfig.subFolder };

  // 新規現場 かつ 仮フォルダ対象のフェーズ
  var tempFolderIds = config.TEMP_FOLDER_IDS || {};
  if (isNewSite && tempFolderIds[phaseName]) {
    var tempFolder = DriveApp.getFolderById(tempFolderIds[phaseName]);
    var siteFolder = getOrCreateFolder_(tempFolder, siteName);

    // 該当フェーズのサブフォルダにファイル保存
    var targetFolder = getOrCreateFolder_(siteFolder, mapping.subFolder);
    var saveResult = DriveService.saveBase64Files(files, targetFolder, siteName, buildingName);
    return saveResult.folderUrl || '';
  }

  // 既存現場 または 仮フォルダ対象外のフェーズ
  var folderContext = DriveService.resolvePhaseFolder(siteName, mapping.phase, mapping.subFolder);
  if (!folderContext || !folderContext.targetFolder) {
    throw new Error('保存先フォルダを確保できませんでした。');
  }
  var saveResult = DriveService.saveBase64Files(files, folderContext.targetFolder, siteName, buildingName);
  if (!saveResult || !saveResult.folderUrl) {
    throw new Error('ファイルの保存に失敗しました。');
  }
  return saveResult.folderUrl;
}

/**
 * アップロード先のDateフォルダを確保し、フォルダIDを返す（ファイル保存なし）。
 * 2フェーズ送信のPhase 1で呼び出し、フォルダIDをCacheServiceに保存して
 * Phase 2（uploadFileChunk）からファイルを追加保存できるようにする。
 * @param {Object} answers フォーム回答オブジェクト
 * @param {string} phaseName 業務カテゴリ名
 * @return {string} 確保したDriveフォルダのID（失敗時は空文字）
 */
function prepareUploadFolder(answers, phaseName) {
  var config = getConfig();
  var existingSite = answers[config.EXISTING_SITE_FIELD] || '';
  var newSite = answers[config.NEW_SITE_FIELD] || '';
  var isNewSite = false;
  var siteName = '';
  if (existingSite && existingSite !== '新規現場を入力') {
    siteName = existingSite;
  } else if (newSite) {
    siteName = newSite;
    isNewSite = true;
  }
  if (!siteName) {
    throw new Error('現場名が指定されていません。');
  }

  var buildingName = answers['棟名'] || '';
  var phaseConfig = getPhaseConfig(phaseName);
  if (!phaseConfig) {
    throw new Error('不明な業務カテゴリです: ' + phaseName);
  }
  var mapping = { phase: phaseConfig.phase, subFolder: phaseConfig.subFolder };

  var targetFolder = null;
  var tempFolderIds = config.TEMP_FOLDER_IDS || {};
  if (isNewSite && tempFolderIds[phaseName]) {
    var tempFolder = DriveApp.getFolderById(tempFolderIds[phaseName]);
    var siteFolder = getOrCreateFolder_(tempFolder, siteName);
    targetFolder = getOrCreateFolder_(siteFolder, mapping.subFolder);
  } else {
    var folderContext = DriveService.resolvePhaseFolder(siteName, mapping.phase, mapping.subFolder);
    if (!folderContext || !folderContext.targetFolder) {
      throw new Error('保存先フォルダを確保できませんでした。');
    }
    targetFolder = folderContext.targetFolder;
  }
  if (!targetFolder) {
    throw new Error('アップロード先フォルダを確保できませんでした。');
  }

  // 棟名フォルダの解決（DriveServiceのresolveBuildingFolderと同等）
  var skipBuildingNames = ['', '（現場名に含む）', '該当なし'];
  var buildingFolder = (skipBuildingNames.indexOf(buildingName) === -1)
    ? getOrCreateFolder_(targetFolder, buildingName)
    : targetFolder;

  var dateFolder = DriveService.createDateFolder(buildingFolder);
  return dateFolder.getId();
}

/**
 * Web送信用のフェーズ別シート転記処理。
 * 既存のseparateSheetByBusiness_Fixedと同じロジックだが、
 * e.range.getSheet()を使わずnamedValuesのみで動作する。
 */
var SCAFFOLDING_STAY_SHEET_HEADERS = ['開始時間', '終了時間', '滞在時間', '超過時間', '超過理由'];

/**
 * シート1行目に不足ヘッダーを末尾追加する。
 * @param {Sheet} sheet
 * @param {Array<string>} headersToEnsure
 * @return {Array<string>} 更新後の全ヘッダー
 */
function appendMissingSheetHeaders_(sheet, headersToEnsure) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    return headersToEnsure.slice();
  }

  var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(h) { return (h || '').toString().trim(); });

  headersToEnsure.forEach(function(header) {
    if (existing.indexOf(header) === -1) {
      lastCol++;
      sheet.getRange(1, lastCol).setValue(header);
      existing.push(header);
    }
  });

  return existing;
}

function separateSheetByBusiness_Web(namedValues, phaseName) {
  if (!namedValues || !phaseName) {
    throw new Error('回答データまたはフェーズ名がありません');
  }

  var config = getConfig();
  var ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
  var phaseConfig = config.FORMS.find(function(f) { return f.phaseIndicatorValue === phaseName; });
  var targetSheetName = phaseConfig ? phaseConfig.name : phaseName;

  var targetSheet = ss.getSheetByName(targetSheetName);
  var headers;

  if (targetSheet && targetSheet.getLastColumn() > 0) {
    // 既存シートのヘッダーを読み取る
    headers = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0]
      .map(function(h) { return h.toString().trim(); });
  } else {
    // シートがなければ PHASE_QUESTIONS から作成
    var requiredQuestions = PHASE_QUESTIONS[phaseName];
    if (!requiredQuestions) {
      Logger.log('separateSheetByBusiness_Web: ' + phaseName + 'の質問項目が定義されていません');
      throw new Error('フェーズ「' + phaseName + '」のシート用質問定義（PHASE_QUESTIONS）がありません');
    }
    if (!targetSheet) {
      targetSheet = ss.insertSheet(targetSheetName);
    }
    targetSheet.appendRow(requiredQuestions);
    targetSheet.getRange(1, 1, 1, requiredQuestions.length)
      .setBackground('#1a237e')
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setFontFamily('Meiryo');
    targetSheet.setFrozenRows(1);
    headers = requiredQuestions;
  }

  if (phaseName === '足場工区点検') {
    headers = appendMissingSheetHeaders_(targetSheet, SCAFFOLDING_STAY_SHEET_HEADERS);
  }

  // ヘッダーに対応するデータ行を作成
  var newRow = [];
  for (var j = 0; j < headers.length; j++) {
    var header = headers[j];
    var values = namedValues[header];
    if (values && values.length > 0) {
      var foundValue = '';
      for (var k = 0; k < values.length; k++) {
        if (values[k] && values[k].toString().trim() !== '') {
          foundValue = values[k];
          break;
        }
      }
      newRow.push(foundValue);
    } else {
      newRow.push('');
    }
  }

  targetSheet.appendRow(newRow);

  // 縞模様
  var lastRow = targetSheet.getLastRow();
  if (lastRow > 1 && lastRow % 2 === 0) {
    targetSheet.getRange(lastRow, 1, 1, targetSheet.getLastColumn()).setBackground('#f8f9fa');
  }

  Logger.log('separateSheetByBusiness_Web: ' + targetSheetName + 'シートにデータを追加しました');
}

/**
 * 「フォームの回答 1」シートにWeb送信データを書き込む。
 * ヘッダー行を読み取り、対応するnamedValuesの値をマッピングして追記する。
 */
function writeToResponseSheet(namedValues) {
  var config = getConfig();
  var ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('フォームの回答 1');
  if (!sheet) {
    Logger.log('writeToResponseSheet: 「フォームの回答 1」シートが見つかりません');
    throw new Error('「フォームの回答 1」シートが見つかりません');
  }

  // ヘッダー行を取得
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('「フォームの回答 1」にヘッダー行がありません');
  }
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // ヘッダーに対応する値を構築
  var newRow = [];
  for (var i = 0; i < headers.length; i++) {
    var header = headers[i].toString().trim();
    var values = namedValues[header];
    if (values && values.length > 0) {
      var foundValue = '';
      for (var k = 0; k < values.length; k++) {
        if (values[k] && values[k].toString().trim() !== '') {
          foundValue = values[k];
          break;
        }
      }
      newRow.push(foundValue);
    } else {
      newRow.push('');
    }
  }

  sheet.appendRow(newRow);
  Logger.log('writeToResponseSheet: フォームの回答 1 にデータを追加しました');
}

// ========================================
// ダッシュボード B列チェックマーク更新
// ========================================

/**
 * フォーム送信後にデータベースの最終報告日を更新し、
 * ダッシュボードUIシートのB列（進捗アイコン）を更新する。
 *
 * @param {string} siteName 現場名
 * @param {string} phaseName フェーズ名（例: '現場調査', '仮設計画打合わせ'）
 */
function updateDashboardCheckmarks(siteName, phaseName) {
  if (!siteName || !phaseName) {
    Logger.log('updateDashboardCheckmarks: siteName or phaseName is empty');
    return;
  }

  var config = getConfig();
  var ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);

  // config.jsのFORMS配列からフェーズ情報を取得
  var phaseConf = getPhaseConfig(phaseName);
  if (!phaseConf) {
    Logger.log('updateDashboardCheckmarks: 不明なフェーズ: ' + phaseName);
    return;
  }
  var reportHeader = phaseConf.reportHeader;

  // --- 1. データベースシートの最終報告日を更新 ---
  var dbSheet = ss.getSheetByName(config.DASHBOARD_DATA_SHEET_NAME);
  if (!dbSheet) {
    Logger.log('updateDashboardCheckmarks: データベースシートが見つかりません');
    return;
  }

  var dbLastRow = dbSheet.getLastRow();
  var dbHeaders;
  if (dbLastRow < 1) {
    // ヘッダーすらない場合はDASHBOARD_HEADERSで初期化
    dbSheet.appendRow(config.DASHBOARD_HEADERS);
    dbHeaders = config.DASHBOARD_HEADERS;
    dbLastRow = 1;
  } else {
    dbHeaders = dbSheet.getRange(1, 1, 1, dbSheet.getLastColumn()).getValues()[0]
      .map(function(h) { return h.toString().trim(); });
  }

  var siteNameColIdx = dbHeaders.indexOf('現場名');
  var zoneNameColIdx = dbHeaders.indexOf('工区名');
  var reportColIdx = dbHeaders.indexOf(reportHeader);

  if (siteNameColIdx === -1 || reportColIdx === -1) {
    Logger.log('updateDashboardCheckmarks: 必要なヘッダーが見つかりません (現場名:' + siteNameColIdx + ', ' + reportHeader + ':' + reportColIdx + ')');
    return;
  }

  // 現場名が一致する親行（工区名が空の行）を検索
  var targetDbRow = -1;
  if (dbLastRow >= 2) {
    var dbData = dbSheet.getRange(2, 1, dbLastRow, dbHeaders.length).getValues();
    for (var i = 0; i < dbData.length; i++) {
      var rowSiteName = (dbData[i][siteNameColIdx] || '').toString().trim();
      var rowZoneName = zoneNameColIdx >= 0 ? (dbData[i][zoneNameColIdx] || '').toString().trim() : '';
      if (rowSiteName === siteName && rowZoneName === '') {
        targetDbRow = i + 2;
        break;
      }
    }
  }

  if (targetDbRow === -1) {
    // 親行が見つからない場合: 新規行を追加
    var newRow = new Array(dbHeaders.length).fill('');
    newRow[siteNameColIdx] = siteName;
    if (zoneNameColIdx >= 0) newRow[zoneNameColIdx] = '';
    newRow[reportColIdx] = new Date();
    // 最終更新日時
    var updateTimeIdx = dbHeaders.indexOf('最終更新日時');
    if (updateTimeIdx >= 0) newRow[updateTimeIdx] = new Date();
    var updateByIdx = dbHeaders.indexOf('最終更新者');
    if (updateByIdx >= 0) {
      try { newRow[updateByIdx] = Session.getActiveUser().getEmail() || 'WebApp'; } catch (e) { newRow[updateByIdx] = 'WebApp'; }
    }
    dbSheet.appendRow(newRow);
    targetDbRow = dbSheet.getLastRow();
    Logger.log('updateDashboardCheckmarks: 新規行を追加: row=' + targetDbRow);
  } else {
    // 既存行の報告日セルを更新
    dbSheet.getRange(targetDbRow, reportColIdx + 1).setValue(new Date());
    // 最終更新日時も更新
    var updateTimeIdx = dbHeaders.indexOf('最終更新日時');
    if (updateTimeIdx >= 0) dbSheet.getRange(targetDbRow, updateTimeIdx + 1).setValue(new Date());
    var updateByIdx = dbHeaders.indexOf('最終更新者');
    if (updateByIdx >= 0) {
      try { dbSheet.getRange(targetDbRow, updateByIdx + 1).setValue(Session.getActiveUser().getEmail() || 'WebApp'); } catch (e) { /* ignore */ }
    }
    Logger.log('updateDashboardCheckmarks: DB更新完了: row=' + targetDbRow + ', header=' + reportHeader);
  }

  SpreadsheetApp.flush();

  // --- 2. 全7フェーズの最終報告日を読み直してアイコン文字列を生成 ---
  var updatedRowData = dbSheet.getRange(targetDbRow, 1, 1, dbHeaders.length).getValues()[0];

  var allReportHeaders = getAllReportHeaders();
  var defaultIcons = getAllDefaultIcons();

  var iconParts = [];
  for (var p = 0; p < allReportHeaders.length; p++) {
    var colIdx = dbHeaders.indexOf(allReportHeaders[p]);
    var hasDate = colIdx >= 0 && updatedRowData[colIdx] !== '' && updatedRowData[colIdx] !== null && updatedRowData[colIdx] !== undefined;
    iconParts.push(hasDate ? '✅' : defaultIcons[p]);
  }
  var iconString = iconParts.join(' ');

  // --- 3. ダッシュボードUIシートのB列を更新 ---
  var uiSheet = ss.getSheetByName(config.DASHBOARD_UI_SHEET_NAME);
  if (!uiSheet) {
    Logger.log('updateDashboardCheckmarks: ダッシュボードUIシートが見つかりません');
    return;
  }

  var uiLastRow = uiSheet.getLastRow();
  if (uiLastRow < 2) {
    Logger.log('updateDashboardCheckmarks: ダッシュボードUIにデータがありません');
    return;
  }

  // A列の表示値と数式を取得して現場名の行を特定（最終行まで含める）
  var uiAValues = uiSheet.getRange(2, 1, uiLastRow, 1).getValues();
  var uiAFormulas = uiSheet.getRange(2, 1, uiLastRow, 1).getFormulas();

  var targetUiRow = -1;
  for (var i = 0; i < uiAValues.length; i++) {
    var cellValue = (uiAValues[i][0] || '').toString().trim();
    var cellFormula = (uiAFormulas[i][0] || '').toString();

    // 子行（工区）はスキップ
    if (cellValue.indexOf('▸') !== -1) continue;

    // HYPERLINK式の場合: =HYPERLINK("url", "現場名") から現場名を抽出
    if (cellFormula) {
      var match = cellFormula.match(/HYPERLINK\s*\(\s*"[^"]*"\s*,\s*"([^"]*)"\s*\)/i);
      if (match && match[1].trim() === siteName) {
        targetUiRow = i + 2;
        break;
      }
    }

    // プレーンテキストの場合
    if (cellValue === siteName) {
      targetUiRow = i + 2;
      break;
    }
  }

  if (targetUiRow === -1) {
    Logger.log('updateDashboardCheckmarks: ダッシュボードUIに現場 "' + siteName + '" が見つかりません');
    return;
  }

  // B列にアイコン文字列をセット（マージセルは保持される）
  var bCell = uiSheet.getRange(targetUiRow, 2);
  bCell.setValue(iconString);
  bCell.setFontSize(16);
  bCell.setHorizontalAlignment('center');
  bCell.setVerticalAlignment('middle');

  Logger.log('updateDashboardCheckmarks: UI B列更新完了: row=' + targetUiRow + ', icons=' + iconString);
}

/**
 * テスト用: 指定の現場・フェーズでチェックマーク更新をテストする。
 * GASエディタから手動実行して動作確認に使用。
 */
function testCheckmarks() {
  updateDashboardCheckmarks('テスト現場名', '現場調査');
}

// ============================================================
// 稼働現場リスト → ダッシュボード 工期自動反映
// ============================================================

/**
 * 日付を M/d 形式にフォーマットする。値がなければ '-' を返す。
 */
function formatScheduleDate(val) {
  if (!val) return '-';
  var d = new Date(val);
  if (isNaN(d.getTime())) return '-';
  return (d.getMonth() + 1) + '/' + d.getDate();
}

/**
 * 値を Date オブジェクトに変換する。無効な場合は null を返す。
 */
function parseScheduleDate(val) {
  if (!val) return null;
  var d = new Date(val);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * ダッシュボードのガントチャート領域にバー（背景色）を描画する。
 * @param {Sheet} sheet - ダッシュボードシート
 * @param {number} row - 描画する行番号
 * @param {Date} startDate - 開始日
 * @param {Date} endDate - 終了日
 * @param {string} color - 背景色
 * @param {Date} timelineStart - タイムラインの開始日（C1の日付）
 */
function drawScheduleBar(sheet, row, startDate, endDate, color, timelineStart) {
  if (!startDate || !endDate) return;
  var DAY_IN_MS = 1000 * 60 * 60 * 24;

  var start = new Date(startDate);
  var end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  var tStart = new Date(timelineStart);
  tStart.setHours(0, 0, 0, 0);

  // タイムライン範囲外チェック
  if (end < tStart) return;

  // 描画範囲をタイムライン内にクランプ
  var drawStart = start < tStart ? tStart : start;
  var drawEnd = end;

  var diffStart = Math.floor((drawStart - tStart) / DAY_IN_MS);
  var diffEnd = Math.floor((drawEnd - tStart) / DAY_IN_MS);

  var colStart = 3 + diffStart; // C列 = 3
  var numCols = diffEnd - diffStart + 1;

  if (numCols > 0 && colStart >= 3) {
    sheet.getRange(row, colStart, 1, numCols).setBackground(color);
  }
}

/**
 * 稼働現場リストの工期データ（E-H列）をダッシュボードの情報行に反映する。
 * 各現場の親行+1（情報行）A列に「組立: M/d ~ M/d \n 解体: M/d ~ M/d」をセットする。
 */
function syncSchedulesToDashboard() {
  var config = getConfig();
  var ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);

  // --- 稼働現場リストから工期データ取得 ---
  var masterSheet = ss.getSheetByName(config.MASTER_SHEET_NAME);
  if (!masterSheet) {
    Logger.log('syncSchedulesToDashboard: 稼働現場リストが見つかりません');
    return;
  }

  var masterLastRow = masterSheet.getLastRow();
  if (masterLastRow < 2) {
    Logger.log('syncSchedulesToDashboard: 稼働現場リストにデータがありません');
    return;
  }

  // A列=現場名, E列=組立開始, F列=組立終了, G列=解体開始, H列=解体終了
  var masterNames = masterSheet.getRange(2, 1, masterLastRow - 1, 1).getValues();
  var masterSchedules = masterSheet.getRange(2, 5, masterLastRow - 1, 4).getValues();

  // 現場名 → 工期データ のマップを作成
  var scheduleMap = {};
  for (var m = 0; m < masterNames.length; m++) {
    var name = (masterNames[m][0] || '').toString().trim();
    if (!name) continue;
    var assemblyStart  = masterSchedules[m][0];
    var assemblyEnd    = masterSchedules[m][1];
    var dismantleStart = masterSchedules[m][2];
    var dismantleEnd   = masterSchedules[m][3];

    var text = '組立: ' + formatScheduleDate(assemblyStart) + ' ~ ' + formatScheduleDate(assemblyEnd) + '\n' +
               '解体: ' + formatScheduleDate(dismantleStart) + ' ~ ' + formatScheduleDate(dismantleEnd);
    scheduleMap[name] = {
      text: text,
      assemblyStart: parseScheduleDate(assemblyStart),
      assemblyEnd: parseScheduleDate(assemblyEnd),
      dismantleStart: parseScheduleDate(dismantleStart),
      dismantleEnd: parseScheduleDate(dismantleEnd)
    };
  }

  // --- ダッシュボードの情報行を更新 ---
  var uiSheet = ss.getSheetByName(config.DASHBOARD_UI_SHEET_NAME);
  if (!uiSheet) {
    Logger.log('syncSchedulesToDashboard: ダッシュボードが見つかりません');
    return;
  }

  var uiLastRow = uiSheet.getLastRow();
  if (uiLastRow < 2) {
    Logger.log('syncSchedulesToDashboard: ダッシュボードにデータがありません');
    return;
  }

  var uiAValues = uiSheet.getRange(2, 1, uiLastRow - 1, 1).getValues();
  var uiAFormulas = uiSheet.getRange(2, 1, uiLastRow - 1, 1).getFormulas();

  // タイムライン開始日を取得（C1セル）
  var timelineStart = parseScheduleDate(uiSheet.getRange(1, 3).getValue());
  var lastCol = uiSheet.getLastColumn();

  var updatedCount = 0;

  for (var i = 0; i < uiAValues.length; i++) {
    var cellValue = (uiAValues[i][0] || '').toString().trim();
    var cellFormula = (uiAFormulas[i][0] || '').toString();

    // 子行（工区）はスキップ
    if (cellValue.indexOf('▸') !== -1) continue;

    // 現場名を特定（HYPERLINK式 or プレーンテキスト）
    var resolvedName = null;
    if (cellFormula) {
      var match = cellFormula.match(/HYPERLINK\s*\(\s*"[^"]*"\s*,\s*"([^"]*)"\s*\)/i);
      if (match) resolvedName = match[1].trim();
    }
    if (!resolvedName && cellValue) {
      resolvedName = cellValue;
    }

    if (!resolvedName || !scheduleMap[resolvedName]) continue;

    var schedule = scheduleMap[resolvedName];
    var parentRow = i + 2; // シート行番号

    // 親行の次の行（情報行）に工期テキストをセット
    var infoRowIndex = parentRow + 1;
    if (infoRowIndex > uiLastRow) continue;

    var infoCell = uiSheet.getRange(infoRowIndex, 1);
    infoCell.setValue(schedule.text);
    infoCell.setFontSize(8);
    infoCell.setWrap(true);
    infoCell.setBackground('#e8f0fe');

    // ガントチャート: 親行のC列以降の背景をクリアしてからバーを描画
    if (timelineStart && lastCol >= 3) {
      uiSheet.getRange(parentRow, 3, 1, lastCol - 2).setBackground(null);

      // 組立: 薄い青
      if (schedule.assemblyStart) {
        var aEnd = schedule.assemblyEnd || schedule.assemblyStart;
        drawScheduleBar(uiSheet, parentRow, schedule.assemblyStart, aEnd, '#a4c2f4', timelineStart);
      }
      // 解体: 薄い緑
      if (schedule.dismantleStart) {
        var dEnd = schedule.dismantleEnd || schedule.dismantleStart;
        drawScheduleBar(uiSheet, parentRow, schedule.dismantleStart, dEnd, '#93c47d', timelineStart);
      }
    }

    updatedCount++;
  }

  Logger.log('syncSchedulesToDashboard: ' + updatedCount + ' 件の工期・ガントバーを更新しました');
}

/**
 * 稼働現場リストのE-H列が編集されたら工期を自動反映する。
 * インストーラブルトリガー用。
 */
function onScheduleEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var config = getConfig();

  if (sheet.getName() !== config.MASTER_SHEET_NAME) return;

  var col = e.range.getColumn();
  // E列(5)〜H列(8) の編集のみ反応
  if (col < 5 || col > 8) return;

  syncSchedulesToDashboard();
}

/**
 * 報告シートの最終行（直前に追加された回答行）の
 * 「【重要】記録・アップロード」列にDriveフォルダURLを書き込む。
 * セルが空の場合のみ書き込む（Googleフォーム経由でファイルURLが入っている場合はスキップ）。
 * @param {string} phaseName フェーズ名（例: '現場調査'）
 * @param {string} folderUrl 書き込むDriveフォルダURL
 */
function writeFolderUrlToReportSheet(phaseName, folderUrl) {
  if (!phaseName || !folderUrl) return;

  var config = getConfig();
  var ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);

  // フェーズ名 = シート名
  var reportSheet = ss.getSheetByName(phaseName);
  if (!reportSheet) {
    Logger.log('writeFolderUrlToReportSheet: シートが見つかりません: ' + phaseName);
    return;
  }

  var lastRow = reportSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('writeFolderUrlToReportSheet: データ行がありません: ' + phaseName);
    return;
  }

  // ヘッダー行から「【重要】記録・アップロード」列を検索
  var lastCol = reportSheet.getLastColumn();
  var headers = reportSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var TARGET_HEADER = '【重要】記録・アップロード';
  var targetColIdx = -1;
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].toString().trim() === TARGET_HEADER) {
      targetColIdx = i;
      break;
    }
  }

  if (targetColIdx < 0) {
    Logger.log('writeFolderUrlToReportSheet: 列が見つかりません: ' + TARGET_HEADER);
    return;
  }

  // 最終行の対象セルが空の場合のみ書き込む
  var targetCell = reportSheet.getRange(lastRow, targetColIdx + 1);
  var existingValue = (targetCell.getValue() || '').toString().trim();
  if (existingValue) {
    Logger.log('writeFolderUrlToReportSheet: 既に値があるためスキップ: ' + phaseName + ' row=' + lastRow);
    return;
  }

  targetCell.setValue(folderUrl);
  Logger.log('writeFolderUrlToReportSheet: URLを書き込みました: ' + phaseName + ' row=' + lastRow + ' → ' + folderUrl);
}

/**
 * onScheduleEdit のインストーラブルトリガーを設定する。
 * GASエディタから一度だけ手動実行する。
 */
function installScheduleSyncTrigger() {
  var config = getConfig();
  var ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);

  // 既存の同名トリガーを削除（重複防止）
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onScheduleEdit') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('onScheduleEdit')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log('installScheduleSyncTrigger: onScheduleEdit トリガーを設定しました');
}

/**
 * 仮置きフォルダ名の先頭に「_」を付けてDrive上で名前順ソート時に先頭に表示させる。
 * GASエディタから一度だけ手動実行する。
 */
function setupTempFolderLabels() {
  var config = getConfig();
  var tempFolderIds = config.TEMP_FOLDER_IDS || {};
  var labelMap = {
    '現場調査': '_現場調査（仮置き）',
    '仮設計画打合わせ': '_仮設計画（仮置き）'
  };

  var keys = Object.keys(tempFolderIds);
  for (var i = 0; i < keys.length; i++) {
    var phaseName = keys[i];
    var folderId = tempFolderIds[phaseName];
    var newName = labelMap[phaseName] || ('_' + phaseName + '（仮置き）');
    try {
      var folder = DriveApp.getFolderById(folderId);
      var currentName = folder.getName();
      if (currentName !== newName) {
        folder.setName(newName);
        Logger.log('フォルダ名変更: "' + currentName + '" → "' + newName + '"');
      } else {
        Logger.log('設定済み: ' + newName);
      }
    } catch (e) {
      Logger.log('エラー (' + phaseName + '): ' + e.toString());
    }
  }
}
