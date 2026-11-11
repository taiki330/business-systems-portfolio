/**
 * Thin wrapper around Spreadsheet operations.
 */
const SheetRepository = (() => {
  const cache = {};

  const getSpreadsheet = () => {
    if (cache.__spreadsheet) {
      return cache.__spreadsheet;
    }
    const configuredId =
      (APP_CONFIG.spreadsheetId && APP_CONFIG.spreadsheetId.trim()) ||
      (PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();

    // APP_CONFIG / スクリプトプロパティに ID があるときは常にそれを使う。
    // getActiveSpreadsheet を先にすると、エディタで別ブックを開いたとき誤ったブックに書く。
    let spreadsheet = null;
    if (configuredId) {
      spreadsheet = SpreadsheetApp.openById(configuredId);
    } else {
      try {
        spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      } catch (_error) {
        spreadsheet = null;
      }
    }
    if (!spreadsheet) {
      throw new Error(
        'Spreadsheet ID is not configured. Set APP_CONFIG.spreadsheetId or script property "SPREADSHEET_ID".'
      );
    }
    cache.__spreadsheet = spreadsheet;
    return spreadsheet;
  };

  const getSheetById = id => {
    const ss = getSpreadsheet();
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() == id) {
        return sheets[i];
      }
    }
    return null;
  };

  const getSheet = identifier => {
    if (!cache[identifier]) {
      let sheet = null;
      if (typeof identifier === 'number' || /^\d+$/.test(identifier)) {
        sheet = getSheetById(identifier);
      } else {
        sheet = getSpreadsheet().getSheetByName(identifier);
      }

      if (!sheet) {
        throw new Error(`Sheet "${identifier}" is not found.`);
      }
      cache[identifier] = sheet;
    }
    return cache[identifier];
  };

  const ensureSheet = identifier => {
    const ss = getSpreadsheet();
    let sheet = null;
    
    if (typeof identifier === 'number' || /^\d+$/.test(identifier)) {
      sheet = getSheetById(identifier);
    } else {
      sheet = ss.getSheetByName(identifier);
    }

    if (!sheet) {
      if (typeof identifier === 'number' || /^\d+$/.test(identifier)) {
        throw new Error(
          `Sheet with ID "${identifier}" not found. Cannot auto-create by ID. ` +
            'スプレッドシートをコピーした直後はタブのGIDが変わるため、AppConfig.getLogSheetName の数値をブック内の正しいGIDに合わせるか、' +
            'APP_CONFIG.logSheetFallbackByType にタブ名を設定してください。'
        );
      }
      sheet = ss.insertSheet(identifier);
      cache[identifier] = sheet;
    }
    return sheet;
  };

  const readTable = sheetName => {
    const sheet = getSheet(sheetName);
    const values = sheet.getDataRange().getValues();
    if (!values.length) {
      return { headers: [], rows: [] };
    }
    const [headers, ...rows] = values;
    const normalizedRows = rows
      .map(row => row.map(value => (value === '' ? '' : value)))
      .filter(row => row.some(cell => cell !== ''))
      .map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          if (!header) return;
          obj[String(header).trim()] = row[index];
        });
        return obj;
      });
    return { headers, rows: normalizedRows };
  };

  const writeTable = (sheetName, headers, rows) => {
    const sheet = getSheet(sheetName);
    sheet.clearContents();
    const matrix = [headers, ...rows.map(row => headers.map(header => row[header] ?? ''))];
    sheet.getRange(1, 1, matrix.length, headers.length).setValues(matrix);
  };

  const appendRow = (sheetName, rowValues) => {
    const sheet = getSheet(sheetName);
    sheet.appendRow(rowValues);
  };

  /** タブを新規作成せず名前だけ解決する（報告ログの GID ずれ時フォールバック用） */
  const getSheetByNameIfExists = name => {
    const n = String(name || '').trim();
    if (!n) return null;
    return getSpreadsheet().getSheetByName(n) || null;
  };

  const getSettingsMap = () => {
    const { rows } = readTable(APP_CONFIG.sheetNames.settings);
    return rows.reduce((acc, row) => {
      const key = row.Key || row.key;
      if (key) {
        acc[String(key)] = row.Value ?? row.value ?? '';
      }
      return acc;
    }, {});
  };

  const upsertSettings = updates => {
    const settingsSheet = getSheet(APP_CONFIG.sheetNames.settings);
    const values = settingsSheet.getDataRange().getValues();
    if (!values.length) {
      settingsSheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
    }
    const map = getSettingsMap();
    Object.keys(updates).forEach(key => {
      map[key] = updates[key];
    });
    const rows = Object.keys(map).map(key => ({
      Key: key,
      Value: map[key]
    }));
    writeTable(APP_CONFIG.sheetNames.settings, ['Key', 'Value'], rows);
  };

  return {
    getSheet,
    ensureSheet,
    getSheetByNameIfExists,
    readTable,
    writeTable,
    appendRow,
    getSettingsMap,
    upsertSettings
  };
})();
