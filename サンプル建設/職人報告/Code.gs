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

// --- Sync Sites Logic ---
const SOURCE_SS_ID = 'SAMPLE_ID_010';
const SOURCE_SHEET_ID = 16994545;
const TARGET_SS_ID = 'SAMPLE_ID_011';
const TARGET_SHEET_ID = 1304971549;
const SOURCE_COLUMN = 2;

function syncSites() {
  const sourceSs = SpreadsheetApp.openById(SOURCE_SS_ID);
  const sourceSheet = sourceSs.getSheetById(SOURCE_SHEET_ID);
  if (!sourceSheet) throw new Error(`SOURCE_SHEET_ID (${SOURCE_SHEET_ID}) が見つかりません。`);

  const records = fetchSourceValues(sourceSheet);
  const targetSs = SpreadsheetApp.openById(TARGET_SS_ID);
  const targetSheet = targetSs.getSheetById(TARGET_SHEET_ID);
  if (!targetSheet) throw new Error(`TARGET_SHEET_ID (${TARGET_SHEET_ID}) が見つかりません。`);

  overwriteTarget(targetSheet, records);
}

function fetchSourceValues(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, SOURCE_COLUMN, lastRow - 1, 1).getValues();
  return values.filter(row => row[0] !== '');
}

function overwriteTarget(sheet, values) {
  const lastRow = sheet.getLastRow();
  if (lastRow >= 3) sheet.getRange(3, 1, lastRow - 2, 1).clearContent();
  if (!values || values.length === 0) return;
  sheet.getRange(3, 1, values.length, 1).setValues(values);
}

// --- Web App Handlers ---

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('職人報告フォーム')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * フォームの設定とマスタデータを取得
 */
function getFormInitialData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // フォーム定義の取得
  const configSheet = ss.getSheetByName('Config_Forms');
  const configValues = configSheet.getDataRange().getValues();
  const headers = configValues[0];
  const formConfig = configValues.slice(1).map(row => {
    let obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });

  // 現場マスタの取得
  const sitesSheet = ss.getSheetByName('Master_Sites');
  const sites = sitesSheet.getDataRange().getValues().slice(1).map(row => ({
    id: row[0],
    name: row[1]
  })).filter(s => s.id && s.name);

  // 作業員マスタの取得
  const workersSheet = ss.getSheetByName('Master_Workers');
  const workers = workersSheet.getDataRange().getValues().slice(1).map(row => ({
    id: row[0],
    name: row[1],
    siteId: row[2]
  })).filter(w => w.id && w.name);

  return {
    formConfig: formConfig,
    sites: sites,
    workers: workers
  };
}

/**
 * 報告の提出
 */
function submitReport(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('DB_Report_Log');
  
  // ['Timestamp', 'SiteId', 'SiteName', 'ReporterId', 'ReporterName', 'ReportType', 'AnswersJSON', 'ImagesJSON', 'DriveFolderId', 'MetaJSON']
  const row = [
    new Date(),
    data.siteId,
    data.siteName,
    data.workerId,
    data.workerName,
    data.reportType,
    JSON.stringify(data.answers),
    JSON.stringify(data.images || []),
    '', // DriveFolderId (拡張用)
    JSON.stringify({
      userAgent: data.userAgent,
      version: '1.0'
    })
  ];
  
  logSheet.appendRow(row);
  return { success: true };
}
