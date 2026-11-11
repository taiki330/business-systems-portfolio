/**
 * 使用期限管理・アラート（サーバーサイド）
 * ------------------------------------------------------------------
 * 方針（簡易版）:
 *   ロット別の在庫管理は行わない。商品マスタで「使用期限管理＝要」とした商品のみ、
 *   医院別在庫に「直近の使用期限（一番早い期限）」を1つだけ保持する。
 *   入荷のたびに、既存の期限より早い日付が入力された場合のみ上書きする
 *   （applyReceiptToInventory 内で処理。第22章・要件定義書参照）。
 *
 * アラート方式:
 *   MVPでは画面表示のみ（自動メール等は行わない）。
 *   使用期限の1年前（365日前）から「まもなく期限」として通知する。
 */

var DEFAULT_EXPIRY_ALERT_DAYS = 365;
var EXPIRY_MANAGED_CACHE_KEY = 'expiryManagedMapV1';

/**
 * 使用期限が近い（または過ぎている）商品の一覧を、全医院横断で返す。
 * 対象は「使用期限管理＝要」の商品かつ、使用期限が設定されている医院別在庫のみ。
 * @param {number} [thresholdDays] 何日以内を「まもなく期限」とするか（既定365日＝1年前）
 * @param {string} [clinic] 医院コード。指定時はその医院だけを返す
 * @return {{items:Array, thresholdDays:number}}
 */
function getExpiryAlerts(thresholdDays, clinic) {
  thresholdDays = Number(thresholdDays);
  if (!thresholdDays || thresholdDays <= 0) thresholdDays = DEFAULT_EXPIRY_ALERT_DAYS;
  clinic = toStr(clinic);
  if (clinic && CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);

  return { items: getExpiryAlertView_(clinic, thresholdDays), thresholdDays: thresholdDays };
}

/**
 * 使用期限を手動で修正する（ロットを使い切って次のロットの期限に更新したい場合等）。
 * 空文字を渡すと期限をクリアする。
 * @param {string} clinic
 * @param {string} productId
 * @param {string} dateStr 'YYYY-MM-DD' 形式、またはクリアする場合は ''
 */
function updateExpiryDate(clinic, productId, dateStr) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  productId = toStr(productId);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var invSheet = getInventorySheetOrThrow();
    var invValues = invSheet.getRange(1, 1, invSheet.getLastRow(), invSheet.getLastColumn()).getValues();
    var invIdx = inventoryHeaderIndex(invValues[0]);
    if (invIdx.expiry < 0) throw new Error('医院別在庫に「使用期限」列がありません。②を再実行してください。');

    var ri = -1;
    for (var r = 1; r < invValues.length; r++) {
      if (toStr(invValues[r][invIdx.clinic]) === clinic && toStr(invValues[r][invIdx.productId]) === productId) { ri = r; break; }
    }
    if (ri < 0) throw new Error('医院別在庫に商品が見つかりません（' + clinic + ' / ' + productId + '）。');

    if (toStr(dateStr) === '') {
      invSheet.getRange(ri + 1, invIdx.expiry + 1).clearContent();
      safeRefreshExpiryViewForClinic_(clinic);
      return { cleared: true };
    }
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) throw new Error('日付の形式が正しくありません。');
    invSheet.getRange(ri + 1, invIdx.expiry + 1).setValue(d);
    safeRefreshExpiryViewForClinic_(clinic);
    return { cleared: false, expiry: d };
  } finally {
    lock.releaseLock();
  }
}

/** 商品マスタから「使用期限管理＝要」の商品IDだけを true で持つマップを作る */
function getExpiryManagedMap() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(EXPIRY_MANAGED_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (ignore) {}
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var header = values[0];
  var idId = header.indexOf('商品ID');
  var idFlag = header.indexOf('使用期限管理');
  if (idFlag < 0) return map; // 旧シート（列未生成）
  for (var r = 1; r < values.length; r++) {
    var pid = toStr(values[r][idId]);
    if (pid === '') continue;
    if (toStr(values[r][idFlag]) === EXPIRY_MANAGED_YES) map[pid] = true;
  }
  // 商品の「期限管理 要/不要」は在庫数と違って頻繁に変わらないため5分だけ再利用する。
  cache.put(EXPIRY_MANAGED_CACHE_KEY, JSON.stringify(map), 300);
  return map;
}

/** 管理方式設定で期限管理の要/不要を変更した直後にキャッシュを破棄する。 */
function clearExpiryManagedCache_() {
  CacheService.getScriptCache().remove(EXPIRY_MANAGED_CACHE_KEY);
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
