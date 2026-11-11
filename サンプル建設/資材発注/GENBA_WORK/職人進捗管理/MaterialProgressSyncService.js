/**
 * 職人進捗管理の終業前報告を、資材管理の3つの進捗節目へ連携する。
 * 組立100%→組立完了、解体1%以上→解体開始、解体100%→解体完了。
 */
const MaterialProgressSyncService = (() => {
  const PROP_URL = 'MATERIAL_SUPABASE_URL';
  const PROP_ANON_KEY = 'MATERIAL_SUPABASE_ANON_KEY';
  const PROP_SYNC_SECRET = 'MATERIAL_PROGRESS_SYNC_SECRET';
  const QUEUE_SHEET_NAME = '資材管理進捗連携キュー';
  const QUEUE_HEADERS = ['イベントID', '送信内容JSON', '状態', '試行回数', '最終エラー', '作成日時', '更新日時'];

  const parsePercent_ = value => {
    const text = String(value == null ? '' : value).replace('%', '').trim();
    if (!text) return null;
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return Math.max(0, Math.min(100, number > 0 && number <= 1 ? number * 100 : number));
  };

  const parseZones_ = value => {
    if (Array.isArray(value)) return value;
    const text = String(value || '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  };

  const extractProgress_ = values => {
    const directAssembly = parsePercent_(values['組立進捗率']);
    const directDismantle = parsePercent_(values['解体進捗率']);
    const zones = parseZones_(
      values['進捗状況(各工区)'] || values['進捗状況（各工区）'] || values['進捗状況(各工区）']
    );
    const zoneAssembly = [];
    const zoneDismantle = [];
    zones.forEach(zone => {
      const pct = parsePercent_(zone && (zone['進捗'] ?? zone.progress));
      if (pct == null) return;
      const workType = String((zone && (zone['作業種別'] ?? zone.workType)) || '').trim();
      (workType === '解体' ? zoneDismantle : zoneAssembly).push(pct);
    });
    return {
      assembly: directAssembly != null
        ? directAssembly
        : (zoneAssembly.length ? Math.min.apply(null, zoneAssembly) : null),
      dismantle: directDismantle != null
        ? directDismantle
        : (zoneDismantle.length ? Math.min.apply(null, zoneDismantle) : null)
    };
  };

  const formatDate_ = value => {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd');
  };

  const buildEvents_ = (siteCode, siteName, occurredOn, progress, source) => {
    const code = String(siteCode || '').trim().toUpperCase();
    const name = String(siteName || '').trim();
    if (!/^SITE-\d+$/.test(code) || !name || !occurredOn) return [];
    const kinds = [];
    if (progress.assembly != null && progress.assembly >= 100) kinds.push('assembly_completed');
    if (progress.dismantle != null && progress.dismantle > 0) kinds.push('dismantle_started');
    if (progress.dismantle != null && progress.dismantle >= 100) kinds.push('dismantle_completed');
    return kinds.map(kind => ({
      p_external_event_id: ['worker-progress', code, kind].join(':'),
      p_external_site_code: code,
      p_site_name: name,
      p_kind: kind,
      p_occurred_on: occurredOn,
      p_payload: {
        source: source,
        assembly_percent: progress.assembly,
        dismantle_percent: progress.dismantle
      }
    }));
  };

  const getWorkbook_ = () => SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);

  const ensureQueueSheet_ = () => {
    const ss = getWorkbook_();
    let sheet = ss.getSheetByName(QUEUE_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(QUEUE_SHEET_NAME);
      sheet.getRange(1, 1, 1, QUEUE_HEADERS.length).setValues([QUEUE_HEADERS]);
      sheet.hideSheet();
    }
    return sheet;
  };

  const enqueue_ = event => {
    const sheet = ensureQueueSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      if (ids.some(row => String(row[0]) === event.p_external_event_id)) return false;
    }
    const now = new Date();
    sheet.appendRow([event.p_external_event_id, JSON.stringify(event), 'pending', 0, '', now, now]);
    return true;
  };

  const captureReport = (payload, site, submittedAt) => {
    if (String(payload && payload.reportType || '').trim() !== '終業前報告') return 0;
    const values = {};
    (payload.answers || []).forEach(answer => {
      if (answer && answer.label) values[String(answer.label).trim()] = answer.value;
    });
    const progress = extractProgress_(values);
    const events = buildEvents_(
      site && (site.id || site.siteId),
      site && (site.name || site.siteName),
      formatDate_(submittedAt),
      progress,
      'GENBA_WORK/職人進捗管理/終業前報告'
    );
    let added = 0;
    events.forEach(event => { if (enqueue_(event)) added += 1; });
    return added;
  };

  const settings_ = () => {
    const props = PropertiesService.getScriptProperties();
    const settings = {
      url: String(props.getProperty(PROP_URL) || '').replace(/\/$/, ''),
      anonKey: String(props.getProperty(PROP_ANON_KEY) || ''),
      secret: String(props.getProperty(PROP_SYNC_SECRET) || '')
    };
    if (!settings.url || !settings.anonKey || !settings.secret) {
      throw new Error('MATERIAL_PROGRESS_SYNC_NOT_CONFIGURED');
    }
    return settings;
  };

  const send_ = event => {
    const settings = settings_();
    const response = UrlFetchApp.fetch(settings.url + '/rest/v1/rpc/sync_site_progress_from_gas', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: settings.anonKey, Authorization: 'Bearer ' + settings.anonKey },
      payload: JSON.stringify(Object.assign({ p_sync_secret: settings.secret }, event)),
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    const text = response.getContentText();
    if (status < 200 || status >= 300) throw new Error('HTTP ' + status + ': ' + text);
    const parsed = text ? JSON.parse(text) : {};
    if (parsed.ok === false) throw new Error(parsed.code || 'sync_failed');
    return parsed;
  };

  const flushQueue = () => {
    const sheet = ensureQueueSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { sent: 0, failed: 0 };
    const rows = sheet.getRange(2, 1, lastRow - 1, QUEUE_HEADERS.length).getValues();
    let sent = 0;
    let failed = 0;
    rows.forEach((row, index) => {
      if (String(row[2]) !== 'pending') return;
      const sheetRow = index + 2;
      try {
        send_(JSON.parse(String(row[1])));
        sheet.getRange(sheetRow, 3).setValue('sent');
        sheet.getRange(sheetRow, 5).setValue('');
        sent += 1;
      } catch (error) {
        sheet.getRange(sheetRow, 4).setValue(Number(row[3] || 0) + 1);
        sheet.getRange(sheetRow, 5).setValue(error.message || String(error));
        failed += 1;
      }
      sheet.getRange(sheetRow, 7).setValue(new Date());
    });
    return { sent, failed };
  };

  const findLogSheet_ = () => {
    const ss = getWorkbook_();
    const target = APP_CONFIG.getLogSheetName('終業前報告');
    if (typeof target === 'number') {
      const byId = ss.getSheets().find(sheet => sheet.getSheetId() === target);
      if (byId) return byId;
    }
    return ss.getSheetByName(String(target))
      || ss.getSheetByName('終業前報告')
      || ss.getSheetByName('Log_終業前報告');
  };

  const syncExisting = () => {
    const sheet = findLogSheet_();
    if (!sheet || sheet.getLastRow() < 2) return { queued: 0, skipped: 0 };
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(value => String(value || '').trim());
    const col = names => {
      for (let i = 0; i < names.length; i += 1) {
        const index = headers.indexOf(names[i]);
        if (index >= 0) return index;
      }
      return -1;
    };
    const indexes = {
      date: col(['送信日時', 'Timestamp', 'タイムスタンプ']),
      code: col(['現場ID', 'SiteId']),
      name: col(['工事現場名', '現場名', 'SiteName']),
      assembly: col(['組立進捗率']),
      dismantle: col(['解体進捗率']),
      zones: col(['進捗状況(各工区)', '進捗状況（各工区）'])
    };
    if (indexes.date < 0 || indexes.code < 0 || indexes.name < 0) {
      throw new Error('終業前報告の必須列（送信日時・現場ID・工事現場名）が見つかりません。');
    }

    const milestones = {};
    let skipped = 0;
    values.slice(1).forEach(row => {
      const code = String(row[indexes.code] || '').trim().toUpperCase();
      const name = String(row[indexes.name] || '').trim();
      const occurredOn = formatDate_(row[indexes.date]);
      if (!/^SITE-\d+$/.test(code) || !name || !occurredOn) { skipped += 1; return; }
      const input = {};
      if (indexes.assembly >= 0) input['組立進捗率'] = row[indexes.assembly];
      if (indexes.dismantle >= 0) input['解体進捗率'] = row[indexes.dismantle];
      if (indexes.zones >= 0) input['進捗状況(各工区)'] = row[indexes.zones];
      const events = buildEvents_(code, name, occurredOn, extractProgress_(input), 'GENBA_WORK/職人進捗管理/既存移行');
      events.forEach(event => {
        const key = event.p_external_event_id;
        if (!milestones[key] || event.p_occurred_on < milestones[key].p_occurred_on) milestones[key] = event;
      });
    });
    let queued = 0;
    Object.keys(milestones).sort().forEach(key => { if (enqueue_(milestones[key])) queued += 1; });
    return { queued, skipped };
  };

  const ensureTrigger_ = () => {
    const handler = 'flushWorkerMaterialProgressSyncQueue';
    const exists = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === handler);
    if (!exists) ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();
  };

  const setup = () => {
    settings_();
    ensureQueueSheet_();
    ensureTrigger_();
    const backfill = syncExisting();
    const delivery = flushQueue();
    return { ok: true, backfill, delivery };
  };

  return { captureReport, flushQueue, syncExisting, setup };
})();

function setupWorkerMaterialProgressSync() {
  return MaterialProgressSyncService.setup();
}

function flushWorkerMaterialProgressSyncQueue() {
  return MaterialProgressSyncService.flushQueue();
}

function syncExistingWorkerProgressToMaterialSystem() {
  const backfill = MaterialProgressSyncService.syncExisting();
  const delivery = MaterialProgressSyncService.flushQueue();
  return { backfill, delivery };
}

