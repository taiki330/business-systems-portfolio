/**
 * スプレッドシート・シート解決（大本DBマスタ同期用）
 */

/**
 * @param {string} spreadsheetId
 * @param {number} sheetId タブの gid（数値）
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function MasterDb_getSheetById(spreadsheetId, sheetId) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === sheetId) {
      return sheets[i];
    }
  }
  throw new Error('Sheet with ID ' + sheetId + ' not found in Spreadsheet ' + spreadsheetId);
}

/**
 * 職人進捗管理ブックの「現場一覧」を解決する。
 * シート名が優先。無ければフォールバックで gid を使用。
 *
 * @param {string} workerSpreadsheetId
 * @param {string} [sheetName] 例: 現場一覧
 * @param {number} sheetIdFallback gid
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function MasterDb_getWorkerProgressSheet(workerSpreadsheetId, sheetName, sheetIdFallback) {
  const ss = SpreadsheetApp.openById(workerSpreadsheetId);
  if (sheetName && String(sheetName).trim()) {
    const named = ss.getSheetByName(String(sheetName).trim());
    if (named) {
      return named;
    }
  }
  return MasterDb_getSheetById(workerSpreadsheetId, sheetIdFallback);
}
