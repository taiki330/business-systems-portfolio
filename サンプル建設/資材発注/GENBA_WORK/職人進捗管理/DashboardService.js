/**
 * Writes progress percentages to an external dashboard spreadsheet.
 */
const DashboardService = (() => {
  let cachedSheet = null;

  const getDashboardSheet = () => {
    const dash = APP_CONFIG.dashboard;
    if (!dash || dash.enabled !== true) {
      return null;
    }
    if (!String(dash.spreadsheetId || '').trim()) {
      Logger.log('DashboardService: APP_CONFIG.dashboard.spreadsheetId が未設定のためスキップします。');
      return null;
    }
    if (cachedSheet) return cachedSheet;
    const ss = SpreadsheetApp.openById(String(dash.spreadsheetId).trim());
    const gid = dash.sheetGid;
    const sheets = ss.getSheets();
    if (gid !== null && gid !== undefined && gid !== '') {
      const gidNum = Number(gid);
      if (!Number.isNaN(gidNum)) {
        for (let i = 0; i < sheets.length; i++) {
          if (sheets[i].getSheetId() === gidNum) {
            cachedSheet = sheets[i];
            return cachedSheet;
          }
        }
      }
    }
    cachedSheet = sheets[0];
    return cachedSheet;
  };

  const findSiteRow = (values, siteName) => {
    const target = UtilitiesEx.normalizeSiteName(siteName);
    if (!target) return -1;
    for (let i = 0; i < values.length; i++) {
      if (UtilitiesEx.normalizeSiteName(String(values[i][0] || '')) === target) {
        return i;
      }
    }
    return -1;
  };

  const toDateKey = date => {
    const m = date.getMonth() + 1;
    const d = date.getDate();
    return `${m}/${d}`;
  };

  const findDateColumn = (headerRow, date) => {
    const target = toDateKey(date);
    for (let i = 0; i < headerRow.length; i++) {
      const cell = headerRow[i];
      if (cell instanceof Date) {
        if (toDateKey(cell) === target) return i;
      } else {
        if (String(cell || '').trim() === target) return i;
      }
    }
    return -1;
  };

  const formatCellValue = (assemblyPct, dismantlingPct) => {
    const validAsm = typeof assemblyPct === 'number' && !isNaN(assemblyPct);
    const validDsm = typeof dismantlingPct === 'number' && !isNaN(dismantlingPct);
    if (validAsm && validDsm) {
      return `組:${assemblyPct}%/解:${dismantlingPct}%`;
    }
    if (validAsm) return `${assemblyPct}%`;
    if (validDsm) return `${dismantlingPct}%`;
    return '';
  };

  const updateProgress = (siteName, assemblyPct, dismantlingPct, date) => {
    const dash = APP_CONFIG.dashboard;
    if (!dash || dash.enabled !== true) {
      return { success: false, reason: 'dashboard_not_configured' };
    }
    const sheet = getDashboardSheet();
    if (!sheet) {
      return { success: false, reason: 'dashboard_not_configured' };
    }
    const values = sheet.getDataRange().getValues();
    if (!values.length) {
      Logger.log('Dashboard: sheet is empty');
      return { success: false, reason: 'empty_sheet' };
    }

    const headerRow = values[0];
    const siteRowIndex = findSiteRow(values, siteName);
    if (siteRowIndex < 0) {
      Logger.log('Dashboard: site not found: ' + siteName);
      return { success: false, reason: 'site_not_found' };
    }

    const progressRowIndex = siteRowIndex + 1;
    if (progressRowIndex >= values.length) {
      Logger.log('Dashboard: no progress row below site: ' + siteName);
      return { success: false, reason: 'no_progress_row' };
    }

    const dateColIndex = findDateColumn(headerRow, date || new Date());
    if (dateColIndex < 0) {
      Logger.log('Dashboard: date column not found for ' + toDateKey(date || new Date()));
      return { success: false, reason: 'date_not_found' };
    }

    const cellValue = formatCellValue(assemblyPct, dismantlingPct);
    if (!cellValue) {
      return { success: false, reason: 'no_value' };
    }

    sheet.getRange(progressRowIndex + 1, dateColIndex + 1).setValue(cellValue);
    return { success: true };
  };

  return {
    updateProgress
  };
})();
