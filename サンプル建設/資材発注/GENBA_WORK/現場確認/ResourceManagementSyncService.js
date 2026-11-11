/**
 * 資材管理システム（Supabase）への現場進捗連携。
 * 設定値はコードに書かず Script Properties に保存する。
 */
var ResourceManagementSyncService = (function() {
  var PROP_URL = 'MATERIAL_SUPABASE_URL';
  var PROP_ANON_KEY = 'MATERIAL_SUPABASE_ANON_KEY';
  var PROP_SYNC_SECRET = 'MATERIAL_PROGRESS_SYNC_SECRET';
  var QUEUE_SHEET_NAME = '資材管理連携キュー';
  var QUEUE_HEADERS = ['イベントID', '送信内容JSON', '状態', '試行回数', '最終エラー', '作成日時', '更新日時'];

  var TYPE_TO_KIND = {
    '組立終了': 'assembly_completed',
    '解体開始': 'dismantle_started',
    '解体終了': 'dismantle_completed'
  };

  function setup() {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty(PROP_URL) || !props.getProperty(PROP_ANON_KEY) || !props.getProperty(PROP_SYNC_SECRET)) {
      throw new Error('スクリプトプロパティに MATERIAL_SUPABASE_URL・MATERIAL_SUPABASE_ANON_KEY・MATERIAL_PROGRESS_SYNC_SECRET を設定してください。');
    }
    ensureRetryTrigger_();
    ensureQueueSheet_();
    syncSites();
    syncExisting();
    return '資材管理連携を設定しました。以後は自動送信されます。';
  }

  function onProgressRecorded(payload) {
    try {
      var events = buildEvents_(payload);
      events.forEach(function(event) { sendOrQueue_(event); });
    } catch (error) {
      Logger.log('[資材管理連携] 進捗連携の準備に失敗: ' + error.stack);
    }
  }

  function buildEvents_(payload) {
    var siteName = String(payload.siteName || '').trim();
    var siteCode = resolveSiteCode_(siteName);
    if (!siteCode) {
      Logger.log('[資材管理連携] 現場IDが見つからないため送信を保留: ' + siteName);
      return [];
    }

    var result = [];
    (payload.progressItems || []).forEach(function(item) {
      var kind = TYPE_TO_KIND[item.type];
      if (!kind) return;
      if ((kind === 'assembly_completed' || kind === 'dismantle_completed') && !isWholeSiteCompleted_(siteName, kind)) return;

      var occurredOn = formatDate_(payload.reportDate || new Date());
      result.push({
        p_external_event_id: [siteCode, kind, occurredOn].join(':'),
        p_external_site_code: siteCode,
        p_site_name: siteName,
        p_kind: kind,
        p_occurred_on: occurredOn,
        p_payload: {
          source: 'GENBA_WORK/現場確認',
          zone_name: String(payload.zoneName || ''),
          original_type: item.type,
          completion: Number(item.completion || 0)
        }
      });
    });
    return result;
  }

  function resolveSiteCode_(siteName) {
    var config = getConfig();
    var sheet = SheetService.getMasterSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return '';
    var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    var target = SiteNameUtils.normalizeSiteName(siteName);
    for (var i = 0; i < values.length; i++) {
      if (SiteNameUtils.normalizeSiteName(values[i][config.MASTER_COL_SITE_NAME]) === target) {
        return String(values[i][config.MASTER_COL_SITE_ID] || '').trim();
      }
    }
    return '';
  }

  function isWholeSiteCompleted_(siteName, kind) {
    var header = kind === 'assembly_completed' ? '組立終了実績日' : '解体終了実績日';
    var data = SheetService.getDashboardData();
    var target = SiteNameUtils.normalizeSiteName(siteName);
    var rows = data.rows.filter(function(row) {
      return SiteNameUtils.normalizeSiteName(row['現場名']) === target;
    });
    var children = rows.filter(function(row) { return String(row['工区名'] || '').trim() !== ''; });
    var targets = children.length ? children : rows.filter(function(row) { return String(row['工区名'] || '').trim() === ''; });
    return targets.length > 0 && targets.every(function(row) { return Boolean(row[header]); });
  }

  function sendOrQueue_(event) {
    try {
      send_(event);
    } catch (error) {
      enqueue_(event, error.message || String(error));
      Logger.log('[資材管理連携] 送信失敗。自動再送キューへ保存: ' + error);
    }
  }

  function send_(event) {
    var props = PropertiesService.getScriptProperties();
    var url = props.getProperty(PROP_URL);
    var anonKey = props.getProperty(PROP_ANON_KEY);
    var secret = props.getProperty(PROP_SYNC_SECRET);
    if (!url || !anonKey || !secret) throw new Error('資材管理連携が未設定です。setupResourceManagementSync を一度実行してください。');

    // 進捗より先に現場マスタを同期する。新規 SITE-xxx でも初回送信から紐付けできる。
    sendSiteBatch_([{
      code: event.p_external_site_code,
      name: event.p_site_name
    }]);

    var body = Object.assign({ p_sync_secret: secret }, event);
    var response = UrlFetchApp.fetch(url + '/rest/v1/rpc/sync_site_progress_from_gas', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: anonKey, Authorization: 'Bearer ' + anonKey },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    var text = response.getContentText();
    if (status < 200 || status >= 300) throw new Error('HTTP ' + status + ': ' + text);
    var parsed = text ? JSON.parse(text) : {};
    if (parsed.ok === false) throw new Error(parsed.code || 'sync_failed');
    return parsed;
  }

  /** 稼働現場リストにある有効な SITE-xxx を資材管理の現場マスタへ一括同期する。 */
  function syncSites() {
    var config = getConfig();
    var sheet = SheetService.getMasterSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: true, created: 0, updated: 0, matched: 0, conflicts: 0, skipped: 0 };

    var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    var byCode = {};
    values.forEach(function(row) {
      var name = String(row[config.MASTER_COL_SITE_NAME] || '').trim();
      var code = String(row[config.MASTER_COL_SITE_ID] || '').trim().toUpperCase();
      if (!/^SITE-\d+$/.test(code) || !name) return;
      byCode[code] = { code: code, name: name };
    });

    var sites = Object.keys(byCode).sort().map(function(code) { return byCode[code]; });
    if (!sites.length) return { ok: true, created: 0, updated: 0, matched: 0, conflicts: 0, skipped: 0 };
    return sendSiteBatch_(sites);
  }

  function sendSiteBatch_(sites) {
    var props = PropertiesService.getScriptProperties();
    var url = props.getProperty(PROP_URL);
    var anonKey = props.getProperty(PROP_ANON_KEY);
    var secret = props.getProperty(PROP_SYNC_SECRET);
    if (!url || !anonKey || !secret) throw new Error('資材管理連携が未設定です。setupResourceManagementSync を一度実行してください。');

    var response = UrlFetchApp.fetch(url + '/rest/v1/rpc/sync_site_master_from_gas', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: anonKey, Authorization: 'Bearer ' + anonKey },
      payload: JSON.stringify({ p_sync_secret: secret, p_sites: sites }),
      muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    var text = response.getContentText();
    if (status < 200 || status >= 300) throw new Error('現場マスタ同期 HTTP ' + status + ': ' + text);
    var parsed = text ? JSON.parse(text) : {};
    if (parsed.ok === false) throw new Error(parsed.code || 'site_master_sync_failed');
    if (Number(parsed.conflicts || 0) > 0) {
      Logger.log('[資材管理連携] 同名現場が複数あるため自動照合できない現場: ' + parsed.conflicts + '件');
    }
    return parsed;
  }

  function ensureQueueSheet_() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(QUEUE_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(QUEUE_SHEET_NAME);
      sheet.getRange(1, 1, 1, QUEUE_HEADERS.length).setValues([QUEUE_HEADERS]);
      sheet.hideSheet();
    }
    return sheet;
  }

  function enqueue_(event, errorMessage) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var sheet = ensureQueueSheet_();
      var eventId = event.p_external_event_id;
      var lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < ids.length; i++) if (ids[i][0] === eventId) return;
      }
      var now = new Date();
      sheet.appendRow([eventId, JSON.stringify(event), 'pending', 0, errorMessage, now, now]);
    } finally {
      lock.releaseLock();
    }
  }

  function flushQueue() {
    try {
      syncSites();
    } catch (syncError) {
      Logger.log('[資材管理連携] 現場マスタの定期同期に失敗: ' + (syncError.stack || syncError));
    }

    var sheet = ensureQueueSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var rows = sheet.getRange(2, 1, lastRow - 1, QUEUE_HEADERS.length).getValues();
    rows.forEach(function(row, index) {
      if (row[2] !== 'pending') return;
      var sheetRow = index + 2;
      try {
        send_(JSON.parse(row[1]));
        sheet.getRange(sheetRow, 3).setValue('sent');
        sheet.getRange(sheetRow, 5).setValue('');
      } catch (error) {
        sheet.getRange(sheetRow, 4).setValue(Number(row[3] || 0) + 1);
        sheet.getRange(sheetRow, 5).setValue(error.message || String(error));
      }
      sheet.getRange(sheetRow, 7).setValue(new Date());
    });
  }

  /** 初回導入時に、既存の3進捗を現場単位で取り込む。イベントIDで重複しない。 */
  function syncExisting() {
    var rows = SheetService.getDashboardData().rows;
    var siteNames = {};
    rows.forEach(function(row) {
      var name = String(row['現場名'] || '').trim();
      if (name) siteNames[name] = true;
    });

    Object.keys(siteNames).forEach(function(siteName) {
      var siteRows = rows.filter(function(row) {
        return SiteNameUtils.normalizeSiteName(row['現場名']) === SiteNameUtils.normalizeSiteName(siteName);
      });
      var children = siteRows.filter(function(row) { return String(row['工区名'] || '').trim() !== ''; });
      var targets = children.length ? children : siteRows.filter(function(row) { return String(row['工区名'] || '').trim() === ''; });
      var siteCode = resolveSiteCode_(siteName);
      if (!siteCode || !targets.length) return;

      var definitions = [
        { header: '組立終了実績日', kind: 'assembly_completed', requireAll: true },
        { header: '解体開始実績日', kind: 'dismantle_started', requireAll: false },
        { header: '解体終了実績日', kind: 'dismantle_completed', requireAll: true }
      ];
      definitions.forEach(function(definition) {
        var dates = targets.map(function(row) { return row[definition.header]; }).filter(Boolean);
        if (!dates.length || (definition.requireAll && dates.length !== targets.length)) return;
        dates.sort(function(a, b) { return new Date(a).getTime() - new Date(b).getTime(); });
        var selectedDate = definition.kind === 'dismantle_started' ? dates[0] : dates[dates.length - 1];
        var occurredOn = formatDate_(selectedDate);
        sendOrQueue_({
          p_external_event_id: [siteCode, definition.kind, occurredOn].join(':'),
          p_external_site_code: siteCode,
          p_site_name: siteName,
          p_kind: definition.kind,
          p_occurred_on: occurredOn,
          p_payload: { source: 'GENBA_WORK/現場確認', backfill: true }
        });
      });
    });
  }

  function ensureRetryTrigger_() {
    var handler = 'flushResourceManagementSyncQueue';
    var exists = ScriptApp.getProjectTriggers().some(function(trigger) { return trigger.getHandlerFunction() === handler; });
    if (!exists) ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();
  }

  function formatDate_(value) {
    return Utilities.formatDate(new Date(value), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd');
  }

  return {
    setup: setup,
    onProgressRecorded: onProgressRecorded,
    flushQueue: flushQueue,
    syncExisting: syncExisting,
    syncSites: syncSites
  };
})();

/** スクリプトプロパティを設定後、初回だけGASエディタから実行する。 */
function setupResourceManagementSync() {
  return ResourceManagementSyncService.setup();
}

/** 5分ごとの自動再送トリガーから呼ばれる。 */
function flushResourceManagementSyncQueue() {
  ResourceManagementSyncService.flushQueue();
}

/** 必要時に既存データの再走査を手動実行できる（重複登録はされない）。 */
function syncExistingProgressToResourceManagement() {
  ResourceManagementSyncService.syncExisting();
}

/** 必要なときに現場マスタだけを手動同期する。通常は5分ごとに自動実行される。 */
function syncSitesToResourceManagement() {
  return ResourceManagementSyncService.syncSites();
}

