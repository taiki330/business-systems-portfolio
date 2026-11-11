/** 高速表示用の派生シート。正本は「発注管理」「医院別在庫」「商品マスタ」。 */
var OPEN_ORDER_VIEW_SHEET = '未入荷一覧';
var OPEN_ORDER_VIEW_HEADERS = [
  '発注ID', '医院ID', '商品ID', '品名', '管理方式', '使用期限管理',
  '発注数量', '入荷済み数量', '残り数量', '発注日', '発注先', '状態', '更新日時'
];
var EXPIRY_VIEW_SHEET = '使用期限アラート一覧';
var EXPIRY_VIEW_HEADERS = ['医院ID', '商品ID', '品名', '現在庫', '使用期限', '更新日時'];
var EXPIRY_VIEW_CACHE_PREFIX = 'expiryViewV1:';

/** 未入荷一覧を読む。初期生成はGASエディタから明示的に実行する。 */
function getOpenOrderView_(clinic) {
  requireReadModelReady_(OPEN_ORDER_VIEW_SHEET, OPEN_ORDER_VIEW_HEADERS, clinic);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(OPEN_ORDER_VIEW_SHEET);
  if (sheet.getLastRow() < 2) return [];
  var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, OPEN_ORDER_VIEW_HEADERS.length).getValues();
  return vals.filter(function (row) { return toStr(row[1]) === clinic; }).map(function (row) {
    return {
      orderId: toStr(row[0]), productId: toStr(row[2]), name: toStr(row[3]),
      mode: toStr(row[4]), expiryManaged: toStr(row[5]) === '要',
      orderedQty: numOrZero(row[6]), receivedQty: numOrZero(row[7]),
      remainingQty: numOrZero(row[8]), orderDate: formatReadModelDate_(row[9]), supplier: toStr(row[10]), status: toStr(row[11])
    };
  });
}

/** 使用期限アラート一覧を読む。日数と状態は今日の日付から計算し直す。 */
function getExpiryAlertView_(clinic, thresholdDays) {
  var cache = CacheService.getScriptCache();
  var cacheKey = EXPIRY_VIEW_CACHE_PREFIX + (clinic || 'ALL') + ':' + thresholdDays;
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (ignore) {}
  }
  requireReadModelReady_(EXPIRY_VIEW_SHEET, EXPIRY_VIEW_HEADERS, clinic);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EXPIRY_VIEW_SHEET);
  if (sheet.getLastRow() < 2) return [];
  var today = startOfDay(new Date());
  var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, EXPIRY_VIEW_HEADERS.length).getValues();
  var items = [];
  vals.forEach(function (row) {
    if (clinic && toStr(row[0]) !== clinic) return;
    var expiry = row[4];
    if (!(expiry instanceof Date) || isNaN(expiry.getTime())) return;
    var daysLeft = Math.round((startOfDay(expiry).getTime() - today.getTime()) / 86400000);
    if (daysLeft > thresholdDays) return;
    items.push({
      clinic: toStr(row[0]), productId: toStr(row[1]), name: toStr(row[2]),
      stock: numOrZero(row[3]), expiry: formatReadModelDate_(expiry), daysLeft: daysLeft,
      status: daysLeft < 0 ? '期限切れ' : 'まもなく期限'
    });
  });
  items.sort(function (a, b) { return a.daysLeft - b.daysLeft; });
  try { cache.put(cacheKey, JSON.stringify(items), 120); } catch (ignorePut) {}
  return items;
}

/** 指定医院の未入荷一覧を正本から作り直す。発注・入荷・取消後に呼ぶ。 */
function refreshOpenOrderViewForClinic_(clinic) {
  var rows = buildOpenOrderRowsForClinic_(clinic);
  replaceReadModelClinicRows_(OPEN_ORDER_VIEW_SHEET, OPEN_ORDER_VIEW_HEADERS, clinic, 1, rows);
  markReadModelClinicReady_(OPEN_ORDER_VIEW_SHEET, clinic);
}

/** 指定医院の期限一覧を正本から作り直す。期限設定変更・入荷後に呼ぶ。 */
function refreshExpiryViewForClinic_(clinic) {
  var rows = buildExpiryRowsForClinic_(clinic);
  replaceReadModelClinicRows_(EXPIRY_VIEW_SHEET, EXPIRY_VIEW_HEADERS, clinic, 0, rows);
  markReadModelClinicReady_(EXPIRY_VIEW_SHEET, clinic);
  clearExpiryViewCache_();
}

function safeRefreshOpenOrderViewForClinic_(clinic) {
  try { refreshOpenOrderViewForClinic_(clinic); }
  catch (e) { console.error('未入荷一覧の同期に失敗: ' + clinic + ' / ' + e.message); }
}

function safeRefreshExpiryViewForClinic_(clinic) {
  try { refreshExpiryViewForClinic_(clinic); }
  catch (e) { console.error('使用期限アラート一覧の同期に失敗: ' + clinic + ' / ' + e.message); }
}

function safeRebuildExpiryViewAll_() {
  try { rebuildExpiryViewAll_(); }
  catch (e) { console.error('使用期限アラート一覧の全再構築に失敗: ' + e.message); }
}

function rebuildOpenOrderViewAll_() {
  var rows = [];
  CLINICS.forEach(function (clinic) { rows = rows.concat(buildOpenOrderRowsForClinic_(clinic)); });
  replaceReadModelAll_(OPEN_ORDER_VIEW_SHEET, OPEN_ORDER_VIEW_HEADERS, rows);
  CLINICS.forEach(function (clinic) { markReadModelClinicReady_(OPEN_ORDER_VIEW_SHEET, clinic); });
}

function rebuildExpiryViewAll_() {
  clearExpiryManagedCache_();
  var rows = [];
  CLINICS.forEach(function (clinic) { rows = rows.concat(buildExpiryRowsForClinic_(clinic)); });
  replaceReadModelAll_(EXPIRY_VIEW_SHEET, EXPIRY_VIEW_HEADERS, rows);
  CLINICS.forEach(function (clinic) { markReadModelClinicReady_(EXPIRY_VIEW_SHEET, clinic); });
  clearExpiryViewCache_();
}

function clearExpiryViewCache_() {
  var cache = CacheService.getScriptCache();
  cache.remove(EXPIRY_VIEW_CACHE_PREFIX + 'ALL:' + DEFAULT_EXPIRY_ALERT_DAYS);
  CLINICS.forEach(function (clinic) {
    cache.remove(EXPIRY_VIEW_CACHE_PREFIX + clinic + ':' + DEFAULT_EXPIRY_ALERT_DAYS);
  });
}

/** google.script.run で安全に返せる日付文字列へ変換する。 */
function formatReadModelDate_(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return toStr(value);
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
}

/** 毎日の保守と、管理者による手動復旧に使う。 */
function rebuildReadModelsDaily() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    rebuildOpenOrderViewAll_();
    rebuildExpiryViewAll_();
    return { openOrders: countReadModelRows_(OPEN_ORDER_VIEW_SHEET), expiryAlerts: countReadModelRows_(EXPIRY_VIEW_SHEET) };
  } finally {
    lock.releaseLock();
  }
}

/** 1日1回、午前3時台に派生シートを正本から再構築するトリガーを登録する。 */
function installReadModelMaintenanceTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'rebuildReadModelsDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rebuildReadModelsDaily').timeBased().everyDays(1).atHour(3).create();
  PropertiesService.getScriptProperties().setProperty('READ_MODEL_TRIGGER_INSTALLED', '1');
  var result = rebuildReadModelsDaily();
  Logger.log('高速表示用シートの初期設定が完了しました。未入荷一覧: ' + result.openOrders +
    '件 / 使用期限アラート一覧: ' + result.expiryAlerts + '件 / 日次再構築: 午前3時台');
  return result;
}

function buildOpenOrderRowsForClinic_(clinic) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var orderSheet = ss.getSheetByName(ORDER_SHEET);
  if (!orderSheet || orderSheet.getLastRow() < 2) return [];
  assertSheetHeaders_(orderSheet, ORDER_HEADERS);
  var idx = orderHeaderIndex();
  var vals = orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, ORDER_HEADERS.length).getValues();
  var clinicData = getClinicInventoryValues_(clinic);
  var modeOf = {};
  for (var r = 1; r < clinicData.values.length; r++) {
    var invRow = clinicData.values[r];
    modeOf[toStr(invRow[clinicData.idx.productId])] = toStr(invRow[clinicData.idx.mode]);
  }
  var managed = getExpiryManagedMap();
  var now = new Date();
  var rows = [];
  vals.forEach(function (row) {
    if (toStr(row[idx.clinic]) !== clinic) return;
    var status = toStr(row[idx.status]);
    if (status !== ORDER_STATUS_ORDERED && status !== ORDER_STATUS_PARTIAL) return;
    var pid = toStr(row[idx.productId]);
    var ordered = numOrZero(row[idx.qty]);
    var received = numOrZero(row[idx.receivedQty]);
    rows.push([
      toStr(row[idx.orderId]), clinic, pid, toStr(row[idx.name]), modeOf[pid] || '', managed[pid] ? '要' : '不要',
      ordered, received, ordered - received, row[idx.orderDate], toStr(row[idx.supplier]), status, now
    ]);
  });
  return rows;
}

function buildExpiryRowsForClinic_(clinic) {
  var data = getClinicInventoryValues_(clinic);
  var managed = getExpiryManagedMap();
  var today = startOfDay(new Date());
  var now = new Date();
  var rows = [];
  for (var r = 1; r < data.values.length; r++) {
    var row = data.values[r];
    var pid = toStr(row[data.idx.productId]);
    if (!managed[pid]) continue;
    var expiry = row[data.idx.expiry];
    if (!(expiry instanceof Date) || isNaN(expiry.getTime())) continue;
    var daysLeft = Math.round((startOfDay(expiry).getTime() - today.getTime()) / 86400000);
    if (daysLeft > DEFAULT_EXPIRY_ALERT_DAYS) continue;
    rows.push([clinic, pid, toStr(row[data.idx.name]), numOrZero(row[data.idx.stock]), expiry, now]);
  }
  return rows;
}

function requireReadModelReady_(name, headers, clinic) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  var ready = !!sheet;
  if (sheet) assertSheetHeaders_(sheet, headers);
  if (ready && clinic) {
    ready = PropertiesService.getScriptProperties().getProperty(readModelClinicKey_(name, clinic)) === '1';
  }
  if (!ready) {
    throw new Error('高速表示用シートの初期設定が完了していません。管理者がApps Scriptで「installReadModelMaintenanceTrigger」を1回実行してください。');
  }
}

function markReadModelClinicReady_(name, clinic) {
  PropertiesService.getScriptProperties().setProperty(readModelClinicKey_(name, clinic), '1');
}

function readModelClinicKey_(name, clinic) {
  return 'READ_MODEL_READY_' + name + '_' + clinic;
}

function replaceReadModelClinicRows_(name, headers, clinic, clinicCol, newRows) {
  var sheet = getOrCreateSheet(name, headers);
  var keep = [];
  if (sheet.getLastRow() >= 2) {
    var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    keep = vals.filter(function (row) { return toStr(row[clinicCol]) !== clinic; });
  }
  replaceReadModelAll_(name, headers, keep.concat(newRows));
}

function replaceReadModelAll_(name, headers, rows) {
  var sheet = getOrCreateSheet(name, headers);
  var oldRows = Math.max(0, sheet.getLastRow() - 1);
  if (oldRows) sheet.getRange(2, 1, oldRows, headers.length).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function countReadModelRows_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  return sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
}
