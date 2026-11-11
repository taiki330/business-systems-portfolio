/**
 * 巡回・点検の指摘件数集計（読取専用）
 * データ源: 稼働現場巡回 / 足場工区点検 フェーズ別シート
 */
var PatrolIssueStatsService = (function() {
  var COL_EXISTING_SITE = '既存現場から入力';
  var COL_NEW_SITE = '新規現場を入力';
  var COL_PATROL_DATE = '① 点検実施日';
  var COL_SCAFFOLD_ISSUE = '⑧ 指摘事項の資料作成';
  var COL_PATROL_ISSUE_11 = '⑪ 裏面に是正内容・注意事項が記載されているか';
  var COL_PATROL_ISSUE_13 = '⑬ 安全書類・名簿確認';

  function getSheetName(phaseNum) {
    return CONFIG.PHASE_SHEET_NAMES[phaseNum] || '';
  }

  function buildHeaderIndex(headers) {
    var index = {};
    headers.forEach(function(h, i) {
      var key = (h || '').toString().trim();
      if (key) index[key] = i;
    });
    return index;
  }

  function readSheetData(sheetName) {
    if (!sheetName) {
      return { headers: [], headerIndex: {}, rows: [] };
    }

    var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log('PatrolIssueStatsService: シートが見つかりません: ' + sheetName);
      return { headers: [], headerIndex: {}, rows: [] };
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) {
      return { headers: [], headerIndex: {}, rows: [] };
    }

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
      return (h || '').toString().trim();
    });
    var rows = sheet.getRange(2, 1, lastRow, lastCol).getValues();

    return {
      headers: headers,
      headerIndex: buildHeaderIndex(headers),
      rows: rows
    };
  }

  function cellValue(row, headerIndex, columnName) {
    var idx = headerIndex[columnName];
    if (idx === undefined) return '';
    var val = row[idx];
    if (val === null || val === undefined) return '';
    return val.toString().trim();
  }

  function resolveSiteName(row, headerIndex) {
    var existingSite = cellValue(row, headerIndex, COL_EXISTING_SITE);
    var newSite = cellValue(row, headerIndex, COL_NEW_SITE);
    if (existingSite && existingSite !== '新規現場を入力') {
      return existingSite;
    }
    return newSite;
  }

  function ensureSite(statsMap, siteKey, displayName) {
    if (!statsMap[siteKey]) {
      statsMap[siteKey] = {
        siteKey: siteKey,
        displayName: displayName,
        patrolCount: 0,
        issueCount: 0,
        lastPatrolDate: null
      };
    } else if (!statsMap[siteKey].displayName && displayName) {
      statsMap[siteKey].displayName = displayName;
    }
    return statsMap[siteKey];
  }

  function warnMissingColumn(sheetName, columnName, headerIndex) {
    if (headerIndex[columnName] === undefined) {
      Logger.log('PatrolIssueStatsService: 列がありません [' + sheetName + '] ' + columnName);
    }
  }

  function updateLastPatrolDate(site, dateVal) {
    var iso = DataService.formatDateISO(dateVal);
    if (!iso) return;
    if (!site.lastPatrolDate || iso > site.lastPatrolDate) {
      site.lastPatrolDate = iso;
    }
  }

  function processPatrolSheet(statsMap) {
    var sheetName = getSheetName(6);
    var data = readSheetData(sheetName);
    if (!data.rows.length) return;

    warnMissingColumn(sheetName, COL_PATROL_DATE, data.headerIndex);
    warnMissingColumn(sheetName, COL_PATROL_ISSUE_11, data.headerIndex);
    warnMissingColumn(sheetName, COL_PATROL_ISSUE_13, data.headerIndex);

    data.rows.forEach(function(row) {
      var displayName = resolveSiteName(row, data.headerIndex);
      if (!displayName) return;

      var siteKey = DataService.normalizeSiteNameKey(displayName);
      if (!siteKey) return;

      var site = ensureSite(statsMap, siteKey, displayName);
      site.patrolCount += 1;

      if (data.headerIndex[COL_PATROL_DATE] !== undefined) {
        updateLastPatrolDate(site, row[data.headerIndex[COL_PATROL_DATE]]);
      }

      if (cellValue(row, data.headerIndex, COL_PATROL_ISSUE_11) === 'あり') {
        site.issueCount += 1;
      }
      if (cellValue(row, data.headerIndex, COL_PATROL_ISSUE_13) === '不備あり') {
        site.issueCount += 1;
      }
    });
  }

  function processScaffoldSheet(statsMap) {
    var sheetName = getSheetName(5);
    var data = readSheetData(sheetName);
    if (!data.rows.length) return;

    warnMissingColumn(sheetName, COL_SCAFFOLD_ISSUE, data.headerIndex);

    data.rows.forEach(function(row) {
      var displayName = resolveSiteName(row, data.headerIndex);
      if (!displayName) return;

      var siteKey = DataService.normalizeSiteNameKey(displayName);
      if (!siteKey) return;

      var site = ensureSite(statsMap, siteKey, displayName);

      if (cellValue(row, data.headerIndex, COL_SCAFFOLD_ISSUE) === 'あり') {
        site.issueCount += 1;
      }
    });
  }

  function aggregatePatrolIssueStats() {
    var statsMap = {};
    processPatrolSheet(statsMap);
    processScaffoldSheet(statsMap);

    var result = Object.keys(statsMap).map(function(key) {
      return statsMap[key];
    });

    result.sort(function(a, b) {
      return (a.displayName || '').localeCompare(b.displayName || '', 'ja');
    });

    return result;
  }

  return {
    aggregatePatrolIssueStats: aggregatePatrolIssueStats
  };
})();

/**
 * GASエディタから直接実行: 巡回指摘集計結果を Logger に出力
 */
function debugPatrolIssueStats() {
  var result = PatrolIssueStatsService.aggregatePatrolIssueStats();
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * GASエディタから直接実行: 集計結果を確認用シートに出力
 */
function debugWritePatrolIssueStatsSheet() {
  var DEBUG_SHEET_NAME = '巡回指摘集計_DEBUG';
  var OUTPUT_HEADERS = ['現場名', '巡回回数', '指摘・注意記載件数', '最終巡回日'];

  var result = PatrolIssueStatsService.aggregatePatrolIssueStats();

  var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DEBUG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DEBUG_SHEET_NAME);
  } else {
    sheet.clear();
  }

  var rows = [OUTPUT_HEADERS];
  result.forEach(function(item) {
    rows.push([
      item.displayName || '',
      item.patrolCount,
      item.issueCount,
      item.lastPatrolDate || ''
    ]);
  });

  sheet.getRange(1, 1, rows.length, OUTPUT_HEADERS.length).setValues(rows);
  sheet.setFrozenRows(1);

  Logger.log('debugWritePatrolIssueStatsSheet: 出力件数 ' + result.length + ' 件（シート: ' + DEBUG_SHEET_NAME + '）');
  return result.length;
}
