/**
 * Spreadsheet initialization helpers for debugging / setup.
 * Run `setupSpreadsheetForApp()` once from the Apps Script editor.
 */
function setupSpreadsheetForApp() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('アクティブなスプレッドシートを取得できません。');
  }
  const results = [];
  results.push(ensureSheetWithHeaders(spreadsheet, '回答', ['Timestamp', 'Site', 'Worker', 'ReportType', 'PayloadJSON'], []));
  results.push(
    ensureSheetWithHeaders(
      spreadsheet,
      'Config_Settings',
      ['Key', 'Value'],
      [
        ['settings_passcode', '1234'],
        ['form_version', '1'],
        ['form_updated_at', new Date().toISOString()]
      ]
    )
  );
  results.push(
    ensureSheetWithHeaders(
      spreadsheet,
      'Config_Forms',
      ['報告種別', '項目ID', '項目名', '入力タイプ', '必須', '選択肢', '順番', 'プレースホルダ', '補足'],
      [
        ['朝礼', 'example-1', '今日の予定', 'text', 'TRUE', '', 1, '例：○○工事', ''],
        ['朝礼', 'example-2', '注意事項', 'textarea', 'FALSE', '', 2, '', '']
      ]
    )
  );
  results.push(
    ensureSheetWithHeaders(
      spreadsheet,
      'Master_Sites',
      ['現場ID', '現場名', 'DriveフォルダID', 'ステータス'],
      [['SITE-001', '本社ビル改修', '', 'active']]
    )
  );
  results.push(
    ensureSheetWithHeaders(
      spreadsheet,
      'Master_Workers',
      ['WorkerId', 'WorkerName', 'SiteId', 'Position', 'Status'],
      [['W-001', '山田 太郎', 'SITE-001', '職長', 'active']]
    )
  );
  results.push(
    ensureSheetWithHeaders(
      spreadsheet,
      'DB_Report_Log',
      ['Timestamp', 'SiteId', 'SiteName', 'ReporterId', 'ReporterName', 'ReportType', 'AnswersJSON', 'ImagesJSON', 'DriveFolderId', 'MetaJSON'],
      []
    )
  );
  Logger.log('Spreadsheet setup results:\n%s', results.join('\n'));
}

function ensureSheetWithHeaders(spreadsheet, sheetName, headers, rows) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  let created = false;
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    created = true;
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (rows && rows.length) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
  }
  return `${sheetName}: ${created ? 'created' : 'exists'} / headers ensured`;
}
