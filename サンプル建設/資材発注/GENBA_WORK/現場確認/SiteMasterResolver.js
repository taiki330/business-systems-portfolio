/**
 * 稼働現場リスト（A:C）から Drive 保存用の現場情報を解決する。
 */
var SiteMasterResolver = (function() {
  var CACHE_KEY = 'site_master_rows_for_drive_kakunin_v1';
  var CACHE_TTL_SEC = 300;

  var CODES = Object.freeze({
    NOT_IN_MASTER: 'SITE_NOT_IN_MASTER',
    MASTER_ACCESS_DENIED: 'SITE_MASTER_ACCESS_DENIED',
    MASTER_READ_FAILED: 'SITE_MASTER_READ_FAILED'
  });

  function isAccessDeniedMessage_(message) {
    var msg = String(message || '').toLowerCase();
    return msg.indexOf('permission') !== -1 || msg.indexOf('access') !== -1;
  }

  function buildMasterReadFailure_(e, config) {
    var exceptionMessage = String((e && e.message) || e || '');
    var code = isAccessDeniedMessage_(exceptionMessage)
      ? CODES.MASTER_ACCESS_DENIED
      : CODES.MASTER_READ_FAILED;
    Logger.log(
      'SiteMasterResolver reject code=%s spreadsheetId=%s masterSheetName=%s exceptionMessage=%s',
      code,
      config.SPREADSHEET_ID || '',
      config.MASTER_SHEET_NAME || '',
      exceptionMessage
    );
    return {
      ok: false,
      code: code,
      message: '稼働現場リストを読み取れませんでした。管理者に連絡してください。',
      reason: 'master_read_exception',
      exceptionMessage: exceptionMessage,
      spreadsheetId: String(config.SPREADSHEET_ID || ''),
      masterSheetName: String(config.MASTER_SHEET_NAME || '')
    };
  }

  function getActiveSiteRowsForDrive_() {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (ignore) {}
    }

    var config = getConfig();
    var ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(config.MASTER_SHEET_NAME);
    if (!sheet) return [];

    var range = config.MASTER_RANGE || 'A2:C';
    var values = sheet.getRange(range).getValues();

    var colName = config.MASTER_COL_SITE_NAME != null ? config.MASTER_COL_SITE_NAME : 0;
    var colId = config.MASTER_COL_SITE_ID != null ? config.MASTER_COL_SITE_ID : 1;
    var colDrive = config.MASTER_COL_DRIVE_FOLDER_ID != null ? config.MASTER_COL_DRIVE_FOLDER_ID : 2;

    var rows = [];
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var siteName = String(row[colName] || '').trim();
      if (!siteName) continue;
      rows.push({
        siteName: siteName,
        siteId: String(row[colId] || '').trim(),
        driveFolderId: String(row[colDrive] || '').trim(),
        normKey: SiteNameUtils.normalizeSiteName(siteName)
      });
    }

    try {
      cache.put(CACHE_KEY, JSON.stringify(rows), CACHE_TTL_SEC);
    } catch (ignore) {}

    return rows;
  }

  /**
   * @param {string} siteName
   * @returns {{ ok: boolean, siteName?: string, siteId?: string, driveFolderId?: string, code?: string, message?: string, reason?: string, exceptionMessage?: string, spreadsheetId?: string, masterSheetName?: string }}
   */
  function resolveSiteForDrive(siteName) {
    var config = getConfig();
    var input = String(siteName || '').trim();
    if (!input) {
      return {
        ok: false,
        code: CODES.NOT_IN_MASTER,
        message: '稼働現場リストに登録されていません。管理者に連絡してください。'
      };
    }

    var rows;
    try {
      rows = getActiveSiteRowsForDrive_();
    } catch (e) {
      return buildMasterReadFailure_(e, config);
    }

    var normInput = SiteNameUtils.normalizeSiteName(input);
    var matches = rows.filter(function(r) {
      return r.normKey === normInput;
    });

    if (!matches.length) {
      Logger.log(
        'SiteMasterResolver reject code=%s siteName=%s siteId=%s driveFolderId=%s reason=no_master_row',
        CODES.NOT_IN_MASTER,
        input,
        '',
        ''
      );
      return {
        ok: false,
        code: CODES.NOT_IN_MASTER,
        message: '稼働現場リストに登録されていません。管理者に連絡してください。',
        reason: 'no_master_row'
      };
    }

    var picked = matches[0];
    for (var j = 0; j < matches.length; j++) {
      if (matches[j].driveFolderId) {
        picked = matches[j];
        break;
      }
    }

    return {
      ok: true,
      siteName: picked.siteName,
      siteId: picked.siteId,
      driveFolderId: picked.driveFolderId
    };
  }

  return {
    CODES: CODES,
    getActiveSiteRowsForDrive_: getActiveSiteRowsForDrive_,
    resolveSiteForDrive: resolveSiteForDrive
  };
})();
