/**
 * Webアプリ用コントローラー。
 * Google FormsをGAS Webアプリに置き換えるためのサーバーサイド処理。
 * 既存のPhaseRouter / Phase1-7 Handlerをそのまま流用する。
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
    formStructure: WEBAPP_FORM_STRUCTURE
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

// ========================================
// フォーム送信処理
// ========================================

/**
 * Webフォームからの送信を処理する。
 * 1. Base64ファイルを直接Driveに保存
 * 2. namedValuesを構築
 * 3. フェーズ別シートに転記
 * 4. 既存PhaseRouterに委譲
 * 5. ダッシュボード更新
 *
 * @param {Object} payload { answers: {title: value}, files: [{fieldTitle, data, fileName, mimeType}], phaseName: string }
 * @return {Object} { success: boolean, message: string }
 */
function submitWebForm(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { success: false, message: 'サーバーが混雑しています。しばらく待ってから再送信してください。' };
  }

  try {
    var answers = payload.answers || {};
    var files = payload.files || [];
    var phaseName = answers['実施する業務を選択してください'] || '';

    if (!phaseName) {
      return { success: false, message: '業務カテゴリが選択されていません。' };
    }

    // --- 1. ファイルをDriveに直接保存 ---
    if (files.length > 0) {
      saveWebUploadFiles(answers, files, phaseName);
    } else {
      Logger.log(
        'submitWebForm: files.length=0 のため Drive へ写真は保存しません（アップロード項目にファイルが無い）。 scriptId=' +
          ScriptApp.getScriptId()
      );
    }

    // --- 2. namedValuesを構築（既存handler互換） ---
    var namedValues = buildNamedValues(answers);

    // --- 3. フェーズ別シートに転記 ---
    try {
      separateSheetByBusiness_Web(namedValues, phaseName);
    } catch (err) {
      Logger.log('Webシート転記エラー: ' + err.toString());
    }

    // --- 4. 既存PhaseRouterに委譲 ---
    var fakeEvent = { namedValues: namedValues };
    try {
      PhaseRouter.handleSubmit(fakeEvent);
    } catch (err) {
      Logger.log('Web業務処理エラー: ' + err.toString());
    }

    SpreadsheetApp.flush();

    // --- 5. ダッシュボード更新 ---
    try {
      DashboardUIService.refreshDashboardData();
    } catch (err) {
      Logger.log('Webダッシュボード更新エラー: ' + err.toString());
    }

    return { success: true, message: '送信が完了しました。' };
  } catch (err) {
    Logger.log('submitWebForm エラー: ' + err.toString());
    return { success: false, message: 'エラーが発生しました: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ========================================
// 内部関数
// ========================================

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
 * フェーズごとのサブフォルダマッピングを使用。
 */
function saveWebUploadFiles(answers, files, phaseName) {
  var config = getConfig();
  var existingSite = answers[config.EXISTING_SITE_FIELD] || '';
  var newSite = answers[config.NEW_SITE_FIELD] || '';

  var siteName = '';
  if (existingSite && existingSite !== '新規現場を入力') {
    siteName = existingSite;
  } else if (newSite) {
    siteName = newSite;
  }

  if (!siteName) {
    Logger.log('saveWebUploadFiles: siteName not found, skipping file save');
    return;
  }

  // フェーズ番号とサブフォルダ名のマッピング
  var phaseMap = {
    '現場調査': { phase: 1, subFolder: '01_現調' },
    '仮設計画打合わせ': { phase: 2, subFolder: '02_仮設計画' },
    '送り出し教育': { phase: 3, subFolder: '03_送り出し教育' },
    '解体前教育': { phase: 4, subFolder: '04_解体前教育' },
    '足場工区点検': { phase: 5, subFolder: '05_点検' },
    '稼働現場巡回': { phase: 6, subFolder: '06_巡回' },
    '安全衛生協議会': { phase: 7, subFolder: '07_衛生協議会' }
  };

  var mapping = phaseMap[phaseName];
  if (!mapping) {
    Logger.log('saveWebUploadFiles: Unknown phase: ' + phaseName);
    return;
  }

  // 「新規現場を入力」時は本番側に手作りしたバケット（WEB_UPLOAD_STAGING_BUCKET_IDS）へ繋ぐ
  var isNewSiteFlow =
    String(existingSite).trim() === '新規現場を入力' && String(newSite).trim() !== '';

  var bucketId =
    config.WEB_UPLOAD_STAGING_BUCKET_IDS && config.WEB_UPLOAD_STAGING_BUCKET_IDS[mapping.phase]
      ? String(config.WEB_UPLOAD_STAGING_BUCKET_IDS[mapping.phase]).trim()
      : '';

  var folderContext = isNewSiteFlow
    ? DriveService.resolveWebStagingFolder(siteName, mapping.phase, mapping.subFolder)
    : DriveService.resolvePhaseFolder(siteName, mapping.phase, mapping.subFolder);

  Logger.log(
    'saveWebUploadFiles: scriptId=%s phase=%s isNewSiteFlow=%s bucketId(空なら仮置き等へフォールバック)=%s target=%s fileCount=%s',
    ScriptApp.getScriptId(),
    mapping.phase,
    isNewSiteFlow,
    bucketId || '(未設定)',
    folderContext && folderContext.targetFolder ? folderContext.targetFolder.getUrl() : 'null',
    files.length
  );

  if (folderContext && folderContext.targetFolder) {
    DriveService.saveBase64Files(files, folderContext.targetFolder, siteName);
  }
}

/**
 * Web送信用のフェーズ別シート転記処理。
 * 既存のseparateSheetByBusiness_Fixedと同じロジックだが、
 * e.range.getSheet()を使わずnamedValuesのみで動作する。
 */
function separateSheetByBusiness_Web(namedValues, phaseName) {
  if (!namedValues || !phaseName) return;

  var requiredQuestions = PHASE_QUESTIONS[phaseName];
  if (!requiredQuestions) {
    Logger.log('separateSheetByBusiness_Web: ' + phaseName + 'の質問項目が定義されていません');
    return;
  }

  var config = getConfig();
  var ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
  var phaseConfig = config.FORMS.find(function(f) { return f.phaseIndicatorValue === phaseName; });
  var targetSheetName = phaseConfig ? phaseConfig.name : phaseName;

  var targetSheet = ss.getSheetByName(targetSheetName);
  if (!targetSheet) {
    targetSheet = ss.insertSheet(targetSheetName);
    targetSheet.appendRow(requiredQuestions);
    var lastCol = requiredQuestions.length;
    targetSheet.getRange(1, 1, 1, lastCol)
      .setBackground('#1a237e')
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setFontFamily('Meiryo');
    targetSheet.setFrozenRows(1);
  }

  // データ行を作成
  var newRow = [];
  for (var j = 0; j < requiredQuestions.length; j++) {
    var questionTitle = requiredQuestions[j];
    var values = namedValues[questionTitle];
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
