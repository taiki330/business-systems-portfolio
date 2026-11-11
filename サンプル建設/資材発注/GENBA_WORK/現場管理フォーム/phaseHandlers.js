/**
 * フェーズ別データ処理パイプライン。
 * フォーム送信時に呼び出され、フェーズ固有のデータ抽出・自動計算・DB書き込み・
 * ログ追記・ダッシュボードアイコン更新を行う。
 *
 * 依存: config.js（getConfig, getPhaseConfig, getAllReportHeaders, getAllDefaultIcons）
 */
var PhaseHandler = (function() {

  // ========================================
  // 定数
  // ========================================
  var ICON_COMPLETED = '✅';
  var ICON_SEPARATOR = ' ';
  var DASHBOARD_ICON_FONT_SIZE = 16;
  var LOG_DATE_FORMAT = 'yyyy-MM-dd';
  var TIMESTAMP_FORMAT = 'yyyy-MM-dd HH:mm:ss';
  var HYPERLINK_SKIP_PREFIX = '▸';
  var SCAFFOLDING_STAY_THRESHOLD_MINUTES = 120; // 2時間

  /**
   * データベースシートの1行目を CONFIG.DASHBOARD_HEADERS に合わせて末尾列を拡張する。
   * @param {Sheet} dbSheet
   */
  function ensureDbHeaders(dbSheet) {
    var configHeaders = getConfig().DASHBOARD_HEADERS;
    var lastCol = dbSheet.getLastColumn();
    if (lastCol < 1) {
      dbSheet.getRange(1, 1, 1, configHeaders.length).setValues([configHeaders]);
      return;
    }
    if (lastCol >= configHeaders.length) return;
    var newHeaders = configHeaders.slice(lastCol);
    if (!newHeaders.length) return;
    dbSheet.getRange(1, lastCol + 1, 1, newHeaders.length).setValues([newHeaders]);
  }

  /**
   * "HH:mm" 形式の時刻文字列を分に変換する。
   * @param {string} timeStr
   * @return {number|null}
   */
  function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    var parts = String(timeStr).trim().split(':');
    if (parts.length < 2) return null;
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes)) return null;
    return hours * 60 + minutes;
  }

  /**
   * 分を「X時間Y分」形式に変換する。
   * @param {number} totalMinutes
   * @return {string}
   */
  function formatMinutesJapanese(totalMinutes) {
    var safe = Math.max(0, Math.floor(totalMinutes));
    var hours = Math.floor(safe / 60);
    var minutes = safe % 60;
    return hours + '時間' + minutes + '分';
  }

  /**
   * 足場工区点検の滞在時間・超過時間を算出する。
   * @param {string} startTime
   * @param {string} endTime
   * @return {{ stayMinutes: number, stayLabel: string, overtimeMinutes: number, overtimeLabel: string }|null}
   */
  function calcScaffoldingStayDuration(startTime, endTime) {
    var startMinutes = parseTimeToMinutes(startTime);
    var endMinutes = parseTimeToMinutes(endTime);
    if (startMinutes === null || endMinutes === null) return null;
    if (endMinutes < startMinutes) return null;

    var stayMinutes = endMinutes - startMinutes;
    var overtimeMinutes = Math.max(0, stayMinutes - SCAFFOLDING_STAY_THRESHOLD_MINUTES);
    return {
      stayMinutes: stayMinutes,
      stayLabel: formatMinutesJapanese(stayMinutes),
      overtimeMinutes: overtimeMinutes,
      overtimeLabel: formatMinutesJapanese(overtimeMinutes)
    };
  }

  /**
   * 足場工区点検の滞在時間フィールドを検証・抽出する。
   * @param {Object} namedValues
   * @return {Object} DB列名→値
   */
  function extractScaffoldingStayFields(namedValues) {
    var startTime = getNamedValue(namedValues, '開始時間');
    var endTime = getNamedValue(namedValues, '終了時間');
    var reason = getNamedValue(namedValues, '超過理由');

    if (!startTime || !endTime) {
      throw new Error('開始時間と終了時間を入力してください');
    }

    var duration = calcScaffoldingStayDuration(startTime, endTime);
    if (!duration) {
      throw new Error('終了時間は開始時間以降に設定してください');
    }

    if (duration.overtimeMinutes > 0 && !reason) {
      throw new Error('滞在が2時間を超える場合、超過理由は必須です');
    }

    return {
      '足場工区点検開始時間': startTime,
      '足場工区点検終了時間': endTime,
      '足場工区点検滞在時間': duration.stayLabel,
      '足場工区点検超過時間': duration.overtimeLabel,
      '足場工区点検超過理由': reason
    };
  }

  // ========================================
  // 内部ヘルパー
  // ========================================

  /**
   * namedValues から安全に値を取得する。
   * @param {Object} namedValues { 'フィールド名': ['値'] }
   * @param {string} key フィールド名
   * @return {string} 値（存在しなければ空文字）
   */
  function getNamedValue(namedValues, key) {
    if (!namedValues || !namedValues[key] || !namedValues[key][0]) {
      return '';
    }
    return namedValues[key][0].toString().trim();
  }

  /**
   * namedValues 内の '備考' フィールドをすべて収集し結合する。
   * （Web App の回答オブジェクトではキーが重複しない場合があるため、
   *   キーが '備考' に一致するものを探す）
   * @param {Object} namedValues
   * @return {string} 結合結果
   */
  function collectBikouFields(namedValues) {
    if (!namedValues) return '';
    var values = [];
    var keys = Object.keys(namedValues);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === '備考') {
        var val = getNamedValue(namedValues, keys[i]);
        if (val) {
          values.push(val);
        }
      }
    }
    return values.join(' / ');
  }

  /**
   * DASHBOARD_HEADERS 配列からヘッダー名のインデックス（0始まり）を返す。
   * @param {string} headerName
   * @return {number} インデックス（見つからなければ -1）
   */
  function getColumnIndex(headerName) {
    var headers = getConfig().DASHBOARD_HEADERS;
    for (var i = 0; i < headers.length; i++) {
      if (headers[i] === headerName) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 文字列を Date に変換する。無効な場合は null を返す。
   * @param {string|Date} value
   * @return {Date|null}
   */
  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date && !isNaN(value.getTime())) return value;
    var date = new Date(value);
    if (isNaN(date.getTime())) return null;
    return date;
  }

  // ========================================
  // フェーズ別データ抽出
  // ========================================

  /**
   * フェーズごとの固有データを namedValues から抽出する。
   * @param {string} phaseName フェーズ名
   * @param {Object} namedValues
   * @return {Object} { headerName: value, ... } DB列名→値のマッピング
   */
  function extractPhaseData(phaseName, namedValues) {
    var data = {};

    switch (phaseName) {
      case '現場調査':
        // Phase 1: 担当者・メモ
        data['現場調査担当者'] = getNamedValue(namedValues, '担当者名');
        var caution = getNamedValue(namedValues, '⑯ 要注意事項');
        var comment = getNamedValue(namedValues, ' 施工案・コメント'); // 先頭スペースに注意
        var memoParts = [];
        if (caution) memoParts.push(caution);
        if (comment) memoParts.push(comment);
        data['現場調査メモ'] = memoParts.join(' / ');
        break;

      case '仮設計画打合わせ':
        // Phase 2: 着工予定日
        var constructionDateStr = getNamedValue(namedValues, '③ 着工日');
        var constructionDate = parseDate(constructionDateStr);
        if (constructionDate) {
          data['着工予定日'] = constructionDate;
        }
        break;

      case '現場着工前に必ずやるべき事':
        // DBには最終報告日のみ（process 共通処理）。詳細は業務別シートへ
        break;

      case '送り出し教育':
        // Phase 3: 備考
        data['送り出し教育備考'] = collectBikouFields(namedValues);
        break;

      case '解体前教育':
        // Phase 4: 解体開始予定日 + メモ
        var demolitionDateStr = getNamedValue(namedValues, '③ 着工日');
        var demolitionDate = parseDate(demolitionDateStr);
        if (demolitionDate) {
          data['解体開始予定日'] = demolitionDate;
        }
        data['解体前教育メモ'] = getNamedValue(namedValues, '⑨ 注意・重要ポイント');
        break;

      case '足場工区点検':
        // Phase 5: 結果・メモ・滞在時間
        data['足場工区点検結果'] = getNamedValue(namedValues, '⑬ 当日までの進捗状況（全体）');
        data['足場工区点検メモ'] = collectBikouFields(namedValues);
        var stayFields = extractScaffoldingStayFields(namedValues);
        Object.keys(stayFields).forEach(function(key) {
          data[key] = stayFields[key];
        });
        break;

      case '稼働現場巡回':
        // Phase 6: 結果・メモ
        data['現場巡回結果'] = getNamedValue(namedValues, '⑭ 当日までの進捗状況（全体）');
        data['現場巡回メモ'] = collectBikouFields(namedValues);
        break;

      case '安全衛生協議会':
        // Phase 8: テーマ・メモ
        data['安全衛生協議会テーマ'] = getNamedValue(namedValues, '⑧ その他、伝達事項');
        data['安全衛生協議会メモ'] = collectBikouFields(namedValues);
        break;

      case '現場完工報告書':
        // DBには最終報告日のみ（process 共通処理）。詳細は業務別シートへ
        break;

      default:
        // 未知のフェーズ: 空のまま返す
        break;
    }

    return data;
  }

  // ========================================
  // DB操作
  // ========================================

  /**
   * データベースシートで現場名が一致し工区名が空の行（親行）を検索する。
   * 見つからなければ新規行を末尾に追加する。
   * @param {Sheet} dbSheet データベースシート
   * @param {string} siteName 現場名
   * @return {number} 行番号（1始まり）
   */
  function findOrCreateDbRow(dbSheet, siteName) {
    var siteNameColIdx = getColumnIndex('現場名');
    var sectionColIdx = getColumnIndex('工区名');
    var lastRow = dbSheet.getLastRow();

    // データがある場合は一括読み取りで検索（セル1つずつ読むより高速）
    if (lastRow >= 2) {
      var data = dbSheet.getRange(2, 1, lastRow, dbSheet.getLastColumn()).getValues();
      for (var i = 0; i < data.length; i++) {
        var rowSiteName = (data[i][siteNameColIdx] || '').toString().trim();
        var rowSection = (data[i][sectionColIdx] || '').toString().trim();
        if (rowSiteName === siteName && rowSection === '') {
          return i + 2; // シート行番号に変換
        }
      }
    }

    // 見つからなければ新規行を追加
    var newRow = lastRow + 1;
    dbSheet.getRange(newRow, siteNameColIdx + 1).setValue(siteName);
    return newRow;
  }

  /**
   * DB行に列データを一括書き込みする。
   * @param {Sheet} dbSheet
   * @param {number} row 行番号（1始まり）
   * @param {Object} columnData { headerName: value, ... }
   * @return {Array<string>} 書き込んだ列名の配列
   */
  function writeColumnsToDb(dbSheet, row, columnData) {
    var writtenColumns = [];
    var keys = Object.keys(columnData);
    for (var i = 0; i < keys.length; i++) {
      var headerName = keys[i];
      var colIdx = getColumnIndex(headerName);
      if (colIdx < 0) continue; // 未知のヘッダーはスキップ
      var value = columnData[headerName];
      dbSheet.getRange(row, colIdx + 1).setValue(value);
      writtenColumns.push(headerName);
    }
    return writtenColumns;
  }

  /**
   * 全報告日ログ列に報告を追記する。
   * 既存のJSON配列に新規エントリを追加する。
   * @param {Sheet} dbSheet
   * @param {number} row
   * @param {string} phaseName
   * @param {string} reportDate
   * @param {string} reporter 報告者名
   */
  function appendReportLog(dbSheet, row, phaseName, reportDate, reporter) {
    var logColIdx = getColumnIndex('全報告日ログ');
    if (logColIdx < 0) return;

    var existingValue = dbSheet.getRange(row, logColIdx + 1).getValue();
    var logArray = [];

    if (existingValue) {
      try {
        logArray = JSON.parse(existingValue);
      } catch (e) {
        // パースに失敗した場合は新規配列として開始
        logArray = [];
      }
    }

    logArray.push({
      phase: phaseName,
      date: reportDate,
      reporter: reporter || 'WebApp'
    });

    var jsonStr = JSON.stringify(logArray);
    var lastErr = null;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        dbSheet.getRange(row, logColIdx + 1).setValue(jsonStr);
        return;
      } catch (e) {
        lastErr = e;
        Utilities.sleep(200 + attempt * 150);
      }
    }
    throw lastErr || new Error('全報告日ログの書き込みに失敗しました');
  }

  // ========================================
  // ダッシュボードアイコン更新
  // ========================================

  /**
   * DB行の7つの報告日列を読み取り、アイコン文字列を生成する。
   * @param {Sheet} dbSheet
   * @param {number} row
   * @return {string} アイコン文字列（例: '✅ ✅ ③ ④ ⑤ ⑥ ⑦'）
   */
  function buildIconString(dbSheet, row) {
    var reportHeaders = getAllReportHeaders();
    var defaultIcons = getAllDefaultIcons();

    // DB行を一括読み取り
    var rowData = dbSheet.getRange(row, 1, 1, dbSheet.getLastColumn()).getValues()[0];
    var icons = [];

    for (var i = 0; i < reportHeaders.length; i++) {
      var colIdx = getColumnIndex(reportHeaders[i]);
      if (colIdx < 0) {
        icons.push(defaultIcons[i]);
        continue;
      }
      var value = rowData[colIdx];
      var hasDate = value !== '' && value !== null && value !== undefined;
      icons.push(hasDate ? ICON_COMPLETED : defaultIcons[i]);
    }

    return icons.join(ICON_SEPARATOR);
  }

  /**
   * ダッシュボードUIシートの該当現場行のB列にアイコン文字列を設定する。
   * A列はHYPERLINK数式またはプレーンテキストで現場名が入っている。
   * '▸' を含む行（工区行）はスキップする。
   * @param {Spreadsheet} spreadsheet
   * @param {string} siteName
   * @param {string} iconString
   * @return {boolean} 更新成功したか
   */
  function updateDashboardIcons(spreadsheet, siteName, iconString) {
    var config = getConfig();
    var uiSheet = spreadsheet.getSheetByName(config.DASHBOARD_UI_SHEET_NAME);
    if (!uiSheet) return false;

    var lastRow = uiSheet.getLastRow();
    if (lastRow < 2) return false;

    // A列の値と数式を一括読み取り（2行目〜最終行。最終行を除外しない）
    var uiAValues = uiSheet.getRange(2, 1, lastRow, 1).getValues();
    var uiAFormulas = uiSheet.getRange(2, 1, lastRow, 1).getFormulas();

    for (var i = 0; i < uiAValues.length; i++) {
      var cellValue = (uiAValues[i][0] || '').toString().trim();
      var cellFormula = (uiAFormulas[i][0] || '').toString();

      // 工区行はスキップ
      if (cellValue.indexOf(HYPERLINK_SKIP_PREFIX) !== -1) continue;

      // HYPERLINK数式の場合: =HYPERLINK("url", "現場名") から現場名を抽出
      var resolvedName = null;
      if (cellFormula) {
        var match = cellFormula.match(/HYPERLINK\s*\(\s*"[^"]*"\s*,\s*"([^"]*)"\s*\)/i);
        if (match) resolvedName = match[1].trim();
      }
      if (!resolvedName) resolvedName = cellValue;

      if (resolvedName === siteName) {
        var targetRow = i + 2;
        var cellB = uiSheet.getRange(targetRow, 2);
        cellB.setValue(iconString);
        cellB.setFontSize(DASHBOARD_ICON_FONT_SIZE);
        cellB.setHorizontalAlignment('center');
        cellB.setVerticalAlignment('middle');
        return true;
      }
    }

    return false;
  }

  // ========================================
  // メインパイプライン
  // ========================================

  /**
   * フェーズデータ処理のメインエントリーポイント。
   * @param {string} siteName 現場名
   * @param {string} phaseName フェーズ名（例: '現場調査'）
   * @param {Object} namedValues { 'フィールド名': ['値'] }
   * @param {Object} [options] skipDashboardUi: true のときダッシュボードUI（一覧に行が無い新規現場など）へのアイコン反映をスキップし警告も出さない
   * @return {Object} { success, steps, warnings }
   */
  function process(siteName, phaseName, namedValues, options) {
    options = options || {};
    var steps = [];
    var warnings = [];
    var config = getConfig();
    var now = new Date();
    var timezone = Session.getScriptTimeZone();
    var todayStr = Utilities.formatDate(now, timezone, LOG_DATE_FORMAT);
    var timestampStr = Utilities.formatDate(now, timezone, TIMESTAMP_FORMAT);

    // ステップ1: フェーズ設定を取得
    var phaseConfig = getPhaseConfig(phaseName);
    if (!phaseConfig) {
      steps.push({ name: 'フェーズ設定取得', ok: false, detail: 'フェーズ "' + phaseName + '" が見つかりません' });
      return { success: false, steps: steps, warnings: warnings };
    }
    steps.push({ name: 'フェーズ設定取得', ok: true, detail: phaseName + ' (Phase ' + phaseConfig.phase + ')' });

    // ステップ2: フェーズ固有データを抽出
    var phaseData;
    try {
      phaseData = extractPhaseData(phaseName, namedValues);
    } catch (extractErr) {
      steps.push({
        name: 'データ抽出',
        ok: false,
        detail: extractErr.message || extractErr.toString()
      });
      warnings.push(extractErr.message || extractErr.toString());
      return { success: false, steps: steps, warnings: warnings };
    }
    var extractedKeys = Object.keys(phaseData);
    steps.push({ name: 'データ抽出', ok: true, detail: extractedKeys.length + '項目抽出: ' + extractedKeys.join(', ') });

    // ステップ3: DB行を検索または作成
    var spreadsheet = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    var dbSheet = spreadsheet.getSheetByName(config.DASHBOARD_DATA_SHEET_NAME);
    if (!dbSheet) {
      steps.push({ name: 'DB行検索', ok: false, detail: 'データベースシート "' + config.DASHBOARD_DATA_SHEET_NAME + '" が見つかりません' });
      return { success: false, steps: steps, warnings: warnings };
    }

    ensureDbHeaders(dbSheet);

    var dbRow;
    try {
      dbRow = findOrCreateDbRow(dbSheet, siteName);
    } catch (rowErr) {
      steps.push({ name: 'DB行検索', ok: false, detail: rowErr.message || rowErr.toString() });
      return { success: false, steps: steps, warnings: warnings };
    }
    steps.push({ name: 'DB行検索', ok: true, detail: '行 ' + dbRow });

    // ステップ4: DB行にデータを書き込み
    // 報告日を追加
    phaseData[phaseConfig.reportHeader] = now;
    // 共通フィールド
    phaseData['最終更新日時'] = now;
    try {
      phaseData['最終更新者'] = Session.getActiveUser().getEmail() || 'WebApp';
    } catch (e) {
      phaseData['最終更新者'] = 'WebApp';
    }

    var writtenColumns;
    try {
      writtenColumns = writeColumnsToDb(dbSheet, dbRow, phaseData);
    } catch (writeErr) {
      steps.push({
        name: 'DB書き込み',
        ok: false,
        detail: writeErr.message || writeErr.toString()
      });
      warnings.push('データベースへの書き込みに失敗しました: ' + (writeErr.message || writeErr.toString()));
      return { success: false, steps: steps, warnings: warnings };
    }
    steps.push({ name: 'DB書き込み', ok: true, detail: writtenColumns.length + '列更新: ' + writtenColumns.join(', ') });

    // ステップ6: 報告ログ追記
    try {
      var reporter = getNamedValue(namedValues, '提出者氏名') || 'WebApp';
      appendReportLog(dbSheet, dbRow, phaseName, todayStr, reporter);
      steps.push({ name: 'ログ追記', ok: true, detail: phaseName + ' / ' + todayStr + ' / ' + reporter });
    } catch (logError) {
      warnings.push('報告ログ追記に失敗: ' + logError.message);
      steps.push({ name: 'ログ追記', ok: false, detail: logError.message });
    }

    // ステップ7: ダッシュボードアイコン更新（新規現場でUIに行がまだ無い場合はスキップ可）
    if (options.skipDashboardUi) {
      steps.push({
        name: 'アイコン更新',
        ok: true,
        detail: '新規現場のためダッシュボードUI反映はスキップ（データベースへの書き込みは完了）'
      });
    } else {
      try {
        var iconString = buildIconString(dbSheet, dbRow);
        var iconUpdated = updateDashboardIcons(spreadsheet, siteName, iconString);
        if (iconUpdated) {
          steps.push({ name: 'アイコン更新', ok: true, detail: iconString });
        } else {
          warnings.push('ダッシュボードUIシートに現場 "' + siteName + '" が見つかりませんでした');
          steps.push({ name: 'アイコン更新', ok: false, detail: '現場がダッシュボードに見つかりません' });
        }
      } catch (iconError) {
        warnings.push('アイコン更新に失敗: ' + iconError.message);
        steps.push({ name: 'アイコン更新', ok: false, detail: iconError.message });
      }
    }

    return { success: true, steps: steps, warnings: warnings };
  }

  // ========================================
  // 公開API
  // ========================================
  return {
    process: process
  };

})();
