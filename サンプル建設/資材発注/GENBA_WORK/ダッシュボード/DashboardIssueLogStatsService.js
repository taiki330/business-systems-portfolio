/**
 * 是正報告「指摘ログ」の現場別集計（読取専用）
 * データ源: 是正報告専用スプレッドシート / 指摘ログ
 */
var DashboardIssueLogStatsService = (function() {
  var ISSUE_LOG_SOURCE = {
    SPREADSHEET_ID: 'SAMPLE_ID_020',
    SHEET_NAME: '指摘ログ'
  };

  var COL_SITE_NAME = '現場名';
  var COL_KIND = '区分';
  var COL_REPORTED_AT = '報告日時';

  var EXPECTED_HEADERS = [
    'ログID', '案件ID', '明細ID', '報告日時', '現場名', '会社名', '施工班', '巡回者',
    '区分', '指摘項目ID', '指摘項目', '自由記述', '報告区分', '作成日時'
  ];

  /**
   * 区分を集計用バケットに正規化（旧「良好」→ notice）
   * @return {'immediate'|'correction'|'notice'|'other'}
   */
  function normalizeKindBucket(kind) {
    var k = (kind === null || kind === undefined) ? '' : kind.toString().trim();
    if (k === '即報告') return 'immediate';
    if (k === '是正') return 'correction';
    if (k === '注意' || k === '良好') return 'notice';
    return 'other';
  }

  function buildHeaderIndex(headers) {
    var index = {};
    headers.forEach(function(h, i) {
      var key = (h || '').toString().trim();
      if (key) index[key] = i;
    });
    return index;
  }

  function toReportDateIso(value) {
    if (value === null || value === undefined || value === '') return null;
    var iso = DataService.formatDateISO(value);
    if (iso) return iso;
    var parsed = new Date(value.toString().trim());
    if (!isNaN(parsed.getTime())) {
      return DataService.formatDateISO(parsed);
    }
    return null;
  }

  function readIssueLogRows() {
    var ss;
    try {
      ss = SpreadsheetApp.openById(ISSUE_LOG_SOURCE.SPREADSHEET_ID);
    } catch (e) {
      Logger.log('DashboardIssueLogStatsService: スプレッドシートを開けません: ' + e);
      return { headers: [], headerIndex: {}, rows: [] };
    }

    var sheet = ss.getSheetByName(ISSUE_LOG_SOURCE.SHEET_NAME);
    if (!sheet) {
      Logger.log('DashboardIssueLogStatsService: シートが見つかりません: ' + ISSUE_LOG_SOURCE.SHEET_NAME);
      return { headers: [], headerIndex: {}, rows: [] };
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) {
      Logger.log('DashboardIssueLogStatsService: 指摘ログにデータ行がありません');
      return { headers: [], headerIndex: {}, rows: [] };
    }

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
      return (h || '').toString().trim();
    });
    var headerIndex = buildHeaderIndex(headers);

    EXPECTED_HEADERS.forEach(function(name) {
      if (headerIndex[name] === undefined) {
        Logger.log('DashboardIssueLogStatsService: 想定列がありません: ' + name);
      }
    });

    var rows = sheet.getRange(2, 1, lastRow, lastCol).getValues();
    return { headers: headers, headerIndex: headerIndex, rows: rows };
  }

  function cellValue(row, headerIndex, columnName) {
    var idx = headerIndex[columnName];
    if (idx === undefined) return '';
    var val = row[idx];
    if (val === null || val === undefined) return '';
    return val.toString().trim();
  }

  function ensureSite(statsMap, siteKey, displayName) {
    if (!statsMap[siteKey]) {
      statsMap[siteKey] = {
        siteKey: siteKey,
        displayName: displayName,
        immediate: 0,
        correction: 0,
        notice: 0,
        total: 0,
        lastReportDate: null
      };
    } else if (!statsMap[siteKey].displayName && displayName) {
      statsMap[siteKey].displayName = displayName;
    }
    return statsMap[siteKey];
  }

  function updateLastReportDate(site, dateVal) {
    var iso = toReportDateIso(dateVal);
    if (!iso) return;
    if (!site.lastReportDate || iso > site.lastReportDate) {
      site.lastReportDate = iso;
    }
  }

  function aggregateBySite() {
    var data = readIssueLogRows();
    if (!data.rows.length) return [];

    if (data.headerIndex[COL_SITE_NAME] === undefined) {
      Logger.log('DashboardIssueLogStatsService: 現場名列がないため集計できません');
      return [];
    }
    if (data.headerIndex[COL_KIND] === undefined) {
      Logger.log('DashboardIssueLogStatsService: 区分列がないため件数集計をスキップします');
    }

    var statsMap = {};
    var otherKindCount = 0;
    var skippedEmptySite = 0;

    data.rows.forEach(function(row) {
      var displayName = cellValue(row, data.headerIndex, COL_SITE_NAME);
      if (!displayName) {
        skippedEmptySite += 1;
        return;
      }

      var siteKey = DataService.normalizeSiteNameKey(displayName);
      if (!siteKey) {
        skippedEmptySite += 1;
        return;
      }

      var site = ensureSite(statsMap, siteKey, displayName);
      var kindBucket = normalizeKindBucket(cellValue(row, data.headerIndex, COL_KIND));

      if (kindBucket === 'immediate') site.immediate += 1;
      else if (kindBucket === 'correction') site.correction += 1;
      else if (kindBucket === 'notice') site.notice += 1;
      else otherKindCount += 1;

      site.total = site.immediate + site.correction + site.notice;

      if (data.headerIndex[COL_REPORTED_AT] !== undefined) {
        updateLastReportDate(site, row[data.headerIndex[COL_REPORTED_AT]]);
      }
    });

    if (skippedEmptySite > 0) {
      Logger.log('DashboardIssueLogStatsService: 現場名空の行をスキップ: ' + skippedEmptySite + ' 件');
    }
    if (otherKindCount > 0) {
      Logger.log('DashboardIssueLogStatsService: 未対応区分の行（合計に含めず）: ' + otherKindCount + ' 件');
    }

    var result = Object.keys(statsMap).map(function(key) {
      return statsMap[key];
    });

    result.sort(function(a, b) {
      return (a.displayName || '').localeCompare(b.displayName || '', 'ja');
    });

    return result;
  }

  return {
    aggregateBySite: aggregateBySite
  };
})();

/**
 * GASエディタから直接実行: 指摘ログ現場別集計を Logger に出力
 */
function debugDashboardIssueLogStats() {
  var result = DashboardIssueLogStatsService.aggregateBySite();
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * GASエディタから直接実行: 指摘ログ現場別集計を確認用シートに出力
 */
function debugWriteDashboardIssueLogStatsSheet() {
  var DEBUG_SHEET_NAME = '指摘ログ集計_DEBUG';
  var OUTPUT_HEADERS = ['現場名', '即報告', '是正', '注意', '合計', '最終報告日'];

  var result = DashboardIssueLogStatsService.aggregateBySite();

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
      item.immediate,
      item.correction,
      item.notice,
      item.total,
      item.lastReportDate || ''
    ]);
  });

  sheet.getRange(1, 1, rows.length, OUTPUT_HEADERS.length).setValues(rows);
  sheet.setFrozenRows(1);

  Logger.log('debugWriteDashboardIssueLogStatsSheet: 出力件数 ' + result.length + ' 件（シート: ' + DEBUG_SHEET_NAME + '）');
  return result.length;
}
