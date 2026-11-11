/**
 * 発注候補確認・発注登録・入荷登録（サーバーサイド）
 * ------------------------------------------------------------------
 * 目的（要件定義書 10.7 / 10.8 / 10.9 / 16章）:
 *   - 発注候補の一覧表示（usage.js が登録した候補 ＋ 未登録だが基準以下の商品）
 *   - 発注登録（医院別在庫の発注済み未入荷数量へ加算。現在庫は変えない）
 *   - 入荷登録（現在庫へ加算、未入荷数量を減算、状態更新。一部入荷・発注なし直接入荷に対応）
 *   - 発注キャンセル（未入荷分の未入荷数量を戻す）
 *
 * 依存:
 *   master.js  … MASTER_SHEET_NAME / INVENTORY_SHEET_NAME
 *   usage.js   … ORDER_CANDIDATE_SHEET / ORDER_CANDIDATE_HEADERS / 各定数・toStr 等
 *   migration.js … CLINICS
 *
 * 状態遷移（発注管理シート・要件16.1）:
 *   発注済み → 一部入荷 → 入荷済み
 *   発注済み／一部入荷 → キャンセル
 */

var ORDER_SHEET = '発注管理';
var ORDER_HEADERS = [
  '発注ID', '医院ID', '商品ID', '品名', '発注数量', '入荷済み数量',
  '発注日', '発注先', '登録者', '登録日時', '状態', '登録経路',
  'キャンセル理由', 'キャンセル日時', '登録トークン'
];
var ORDER_STATUS_ORDERED = '発注済み';
var ORDER_STATUS_PARTIAL = '一部入荷';
var ORDER_STATUS_RECEIVED = '入荷済み';
var ORDER_STATUS_CANCELED = 'キャンセル';

var RECEIPT_HISTORY_SHEET = '入荷履歴';
var RECEIPT_HISTORY_HEADERS = [
  '入荷ID', '発注ID', '医院ID', '商品ID', '品名', '入荷数量', '入荷日',
  '登録者', '登録日時', '登録前在庫', '登録後在庫', '取消フラグ', '取消理由'
];

var ORDER_CANDIDATE_STATUS_ORDERED = '発注済み'; // 発注候補シート側の状態（候補が発注登録済みであることを示す）
var RECEIVING_CACHE_PREFIX = 'receivingDataV3:';


/**
 * 発注候補一覧を返す（要件10.7）。
 * 発注候補シートの未発注エントリに加え、まだ候補化されていないが
 * 「現在庫＋未入荷数量が発注基準以下」の数量管理商品もライブで拾う（取りこぼし防止）。
 * @param {string} clinic
 * @return {{clinic:string, candidates:Array}}
 */
function getOrderCandidates(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);

  var invSheet = getInventorySheetOrThrow();
  var invLastRow = invSheet.getLastRow();
  var invLastCol = invSheet.getLastColumn();
  var invValues = invLastRow >= 2 ? invSheet.getRange(1, 1, invLastRow, invLastCol).getValues() : [[]];
  var invIdx = inventoryHeaderIndex(invValues[0] || []);

  var masterMap = getMasterSupplierMap(); // productId -> {supplier, standardQty}

  var SEP = '\u0001';
  var candMap = {}; // key(clinic+productId) -> candidate object

  // ① 発注候補シートの「未発注」エントリ
  var candSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ORDER_CANDIDATE_SHEET);
  if (candSheet && candSheet.getLastRow() >= 2) {
    assertSheetHeaders_(candSheet, ORDER_CANDIDATE_HEADERS);
    var cVals = candSheet.getRange(2, 1, candSheet.getLastRow() - 1, ORDER_CANDIDATE_HEADERS.length).getValues();
    var cIdx = candidateHeaderIndex(ORDER_CANDIDATE_HEADERS);
    cVals.forEach(function (row) {
      if (toStr(row[cIdx.clinic]) !== clinic) return;
      if (toStr(row[cIdx.status]) !== ORDER_CANDIDATE_STATUS_OPEN) return;
      var pid = toStr(row[cIdx.productId]);
      if (pid === '') return;
      candMap[clinic + SEP + pid] = {
        productId: pid,
        name: toStr(row[cIdx.name]),
        reason: toStr(row[cIdx.reason]),
        trigger: toStr(row[cIdx.trigger])
      };
    });
  }

  // ② 医院別在庫をライブ集計：数量管理商品で基準以下のもの（①で拾えていない分の補完）
  for (var r = 1; r < invValues.length; r++) {
    var row = invValues[r];
    if (toStr(row[invIdx.clinic]) !== clinic) continue;
    var pid2 = toStr(row[invIdx.productId]);
    if (pid2 === '') continue;
    if (toStr(row[invIdx.mode]) !== '数量管理') continue;
    var stock = Number(row[invIdx.stock]);
    if (isNaN(stock)) stock = 0;
    if (!isBelowThreshold(row, invIdx, stock)) continue;

    var key = clinic + SEP + pid2;
    if (!candMap[key]) {
      candMap[key] = { productId: pid2, name: toStr(row[invIdx.name]), reason: CANDIDATE_REASON_THRESHOLD, trigger: '' };
    }
    candMap[key].stock = stock;
    candMap[key].openQty = numOrZero(row[invIdx.openQty]);
    candMap[key].kijun = toStr(row[invIdx.kijun]);
  }

  // 発注候補シートに無かった分（トリガー由来のみ等）にも在庫情報を補完
  for (var r2 = 1; r2 < invValues.length; r2++) {
    var row2 = invValues[r2];
    if (toStr(row2[invIdx.clinic]) !== clinic) continue;
    var pid3 = toStr(row2[invIdx.productId]);
    var key3 = clinic + SEP + pid3;
    if (!candMap[key3]) continue;
    var c = candMap[key3];
    if (c.stock === undefined) {
      c.name = c.name || toStr(row2[invIdx.name]);
      c.mode = toStr(row2[invIdx.mode]);
      if (c.mode === '数量管理') {
        c.stock = numOrZero(row2[invIdx.stock]);
        c.openQty = numOrZero(row2[invIdx.openQty]);
        c.kijun = toStr(row2[invIdx.kijun]);
      }
    }
  }

  var candidates = Object.keys(candMap).map(function (k) {
    var c = candMap[k];
    var m = masterMap[c.productId] || {};
    c.supplier = m.supplier || '';
    c.standardQty = m.standardQty || '';
    return c;
  });

  return { clinic: clinic, candidates: candidates };
}

/**
 * 発注登録（要件10.8）。現在庫は変えず、医院別在庫の未入荷数量へ加算する。
 * 該当する発注候補（未発注）があれば「発注済み」に更新する。
 *
 * 冪等性：token（クライアント生成の1回の登録操作ごとに一意な値）を発注管理シートに
 * 記録し、同じ token が既にあれば処理済みとして何もしない
 * （通信失敗後の再送・多重タップによる発注の二重登録を防止。usage.js の処理IDと同じ考え方）。
 *
 * 発注先は商品マスタの値で固定する（医院側では選べない・送られてきても使わない）。
 * 発注先を変えるときは商品マスタ管理画面で直す。
 *
 * @param {string} clinic
 * @param {Array<{productId:string, qty:number}>} items
 * @param {string} registrant
 * @param {string} [token] 冪等トークン。省略時は防止できないため必ず渡すこと
 * @return {{orderIds:Array<string>, count:number, duplicated:boolean}}
 */
function registerOrders(clinic, items, registrant, token) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  items = (items || []).filter(function (it) { return toStr(it.productId) !== '' && Number(it.qty) > 0; });
  if (!items.length) return { orderIds: [], count: 0, duplicated: false };
  token = toStr(token);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (token !== '' && isOrderTokenUsed(token)) {
      return { orderIds: [], count: 0, duplicated: true };
    }

    var invSheet = getInventorySheetOrThrow();
    var invLastRow = invSheet.getLastRow();
    var invLastCol = invSheet.getLastColumn();
    var invValues = invSheet.getRange(1, 1, invLastRow, invLastCol).getValues();
    var invIdx = inventoryHeaderIndex(invValues[0]);

    var rowOf = {};
    for (var r = 1; r < invValues.length; r++) {
      if (toStr(invValues[r][invIdx.clinic]) !== clinic) continue;
      rowOf[toStr(invValues[r][invIdx.productId])] = r;
    }

    var orderSheet = getOrCreateSheet(ORDER_SHEET, ORDER_HEADERS);
    // 発注先は商品マスタ由来で固定する（画面から送られてきた値は使わない）
    var masterMap = getMasterSupplierMap();
    var now = new Date();
    var orderRows = [];
    var orderIds = [];
    var touchedRows = {}; // 実際に未入荷数量を変えた行だけを控える（書き戻し対象）

    items.forEach(function (it) {
      var pid = toStr(it.productId);
      var qty = Number(it.qty);
      var ri = rowOf[pid];
      if (ri === undefined) {
        throw new Error('医院別在庫に商品が見つかりません（' + clinic + ' / ' + pid + '）。');
      }
      var row = invValues[ri];
      var name = toStr(row[invIdx.name]);
      var orderId = 'O' + now.getTime() + '-' + (orderIds.length + 1);
      orderIds.push(orderId);

      orderRows.push([
        orderId, clinic, pid, name, qty, 0,
        now, toStr((masterMap[pid] || {}).supplier), registrant, now, ORDER_STATUS_ORDERED, toStr(it.reason || ''),
        '', '', token
      ]);

      // 未入荷数量へ加算（現在庫は変えない）
      var curOpen = numOrZero(row[invIdx.openQty]);
      row[invIdx.openQty] = curOpen + qty;
      row[invIdx.updatedAt] = now;
      touchedRows[ri] = true;
    });

    // 医院別在庫を書き戻し（発注した商品の行だけ）。
    // ここで医院の全商品を書き直すと、1医院数百件の規模では書き込みが数百〜千回に膨らみ、
    // その間ずっとスクリプトロックを占有して他医院の使用登録がタイムアウトする。
    Object.keys(touchedRows).forEach(function (riKey) {
      var ri = Number(riKey);
      invSheet.getRange(ri + 1, invIdx.openQty + 1).setValue(invValues[ri][invIdx.openQty]);
      invSheet.getRange(ri + 1, invIdx.updatedAt + 1).setValue(invValues[ri][invIdx.updatedAt]);
    });

    appendRows(orderSheet, orderRows);

    // 対応する発注候補（未発注）を「発注済み」に更新
    markCandidatesOrdered(clinic, items.map(function (it) { return toStr(it.productId); }));

    safeRefreshOpenOrderViewForClinic_(clinic);
    clearReceivingCache_(clinic);
    return { orderIds: orderIds, count: orderRows.length, duplicated: false };
  } finally {
    lock.releaseLock();
  }
}

/** 発注管理シートに同じ登録トークンが既に存在するか（二重送信チェック） */
function isOrderTokenUsed(token) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ORDER_SHEET);
  if (!sheet) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  assertSheetHeaders_(sheet, ORDER_HEADERS);
  var idx = orderHeaderIndex();
  var col = sheet.getRange(2, idx.token + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (toStr(col[i][0]) === token) return true;
  }
  return false;
}

/** 発注候補シートの該当行（医院＋商品・未発注）を「発注済み」に更新する */
function markCandidatesOrdered(clinic, productIds) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ORDER_CANDIDATE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return;
  assertSheetHeaders_(sheet, ORDER_CANDIDATE_HEADERS);
  var idx = candidateHeaderIndex(ORDER_CANDIDATE_HEADERS);
  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(2, 1, lastRow - 1, ORDER_CANDIDATE_HEADERS.length).getValues();
  var pidSet = {};
  productIds.forEach(function (p) { pidSet[p] = true; });

  var changed = false;
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (toStr(row[idx.clinic]) === clinic &&
        pidSet[toStr(row[idx.productId])] &&
        toStr(row[idx.status]) === ORDER_CANDIDATE_STATUS_OPEN) {
      row[idx.status] = ORDER_CANDIDATE_STATUS_ORDERED;
      changed = true;
    }
  }
  if (changed) {
    sheet.getRange(2, 1, values.length, ORDER_CANDIDATE_HEADERS.length).setValues(values);
  }
}

/**
 * 未入荷（発注済み／一部入荷）の発注一覧を返す（入荷登録画面用）。
 * @param {string} clinic
 * @return {{clinic:string, orders:Array}}
 */
function getOpenOrders(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  return { clinic: clinic, orders: getOpenOrderView_(clinic) };
}

/**
 * 入荷画面の初期表示データをまとめて返す。
 * 発注一覧と直接入荷商品を別々に取得すると医院別在庫・商品マスタを2回ずつ読むため、
 * 1回の通信、各シート1回の読み込みに集約する。
 * @param {string} clinic
 * @return {{clinic:string,orders:Array,products:Array}}
 */
function getReceivingData(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);

  var cache = CacheService.getScriptCache();
  var cached = cache.get(RECEIVING_CACHE_PREFIX + clinic);
  if (cached) {
    try { return JSON.parse(cached); } catch (ignore) {}
  }

  // 初期設定前は大きな在庫シートを読む前に、すぐ管理者向けエラーを返す。
  var orders = getOpenOrderView_(clinic);
  var clinicData = getClinicInventoryValues_(clinic);
  var invValues = clinicData.values;
  var invIdx = clinicData.idx;
  var expiryManaged = getExpiryManagedMap();
  var products = [];
  for (var r = 1; r < invValues.length; r++) {
    var invRow = invValues[r];
    if (toStr(invRow[invIdx.clinic]) !== clinic) continue;
    var pid = toStr(invRow[invIdx.productId]);
    var mode = toStr(invRow[invIdx.mode]);
    if (mode === '数量管理') {
      products.push({
        productId: pid,
        name: toStr(invRow[invIdx.name]),
        stock: numOrZero(invRow[invIdx.stock]),
        expiryManaged: !!expiryManaged[pid]
      });
    }
  }

  var result = { clinic: clinic, orders: orders, products: products };
  try { cache.put(RECEIVING_CACHE_PREFIX + clinic, JSON.stringify(result), 120); } catch (ignorePut) {}
  return result;
}

function clearReceivingCache_(clinic) {
  CacheService.getScriptCache().remove(RECEIVING_CACHE_PREFIX + clinic);
}

/** 医院内の 商品ID → 管理方式 マップを作る */
function getProductModeMap(clinic) {
  var invSheet = getInventorySheetOrThrow();
  var invValues = invSheet.getRange(1, 1, invSheet.getLastRow(), invSheet.getLastColumn()).getValues();
  var invIdx = inventoryHeaderIndex(invValues[0]);
  var map = {};
  for (var r = 1; r < invValues.length; r++) {
    if (toStr(invValues[r][invIdx.clinic]) !== clinic) continue;
    map[toStr(invValues[r][invIdx.productId])] = toStr(invValues[r][invIdx.mode]);
  }
  return map;
}

/**
 * 入荷登録（要件10.9）。
 *   - 数量管理商品：現在庫へ加算、未入荷数量を減算、発注状態を更新する。
 *   - 発注トリガー管理商品：現在庫の概念を持たないため在庫operationは行わず、
 *     発注状態を「入荷済み」に更新するのみ（Codexレビュー指摘への対応）。
 * @param {string} clinic
 * @param {string} orderId
 * @param {number} qty 今回の入荷数量（発注トリガー管理商品では無視される）
 * @param {string} registrant
 */
function registerReceipt(clinic, orderId, qty, registrant, expiryDateStr) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  orderId = toStr(orderId);
  qty = Number(qty);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var orderSheet = getOrCreateSheet(ORDER_SHEET, ORDER_HEADERS);
    var oLastRow = orderSheet.getLastRow();
    if (oLastRow < 2) throw new Error('発注データがありません。');
    var oIdx = orderHeaderIndex();
    var oValues = orderSheet.getRange(2, 1, oLastRow - 1, ORDER_HEADERS.length).getValues();

    var oRi = -1;
    for (var i = 0; i < oValues.length; i++) {
      if (toStr(oValues[i][oIdx.orderId]) === orderId && toStr(oValues[i][oIdx.clinic]) === clinic) { oRi = i; break; }
    }
    if (oRi < 0) throw new Error('発注が見つかりません（' + orderId + '）。');
    var oRow = oValues[oRi];
    var status = toStr(oRow[oIdx.status]);
    if (status !== ORDER_STATUS_ORDERED && status !== ORDER_STATUS_PARTIAL) {
      throw new Error('この発注は入荷登録できない状態です（' + status + '）。');
    }
    var ordered = Number(oRow[oIdx.qty]) || 0;
    var alreadyReceived = Number(oRow[oIdx.receivedQty]) || 0;
    var remaining = ordered - alreadyReceived;
    var pid = toStr(oRow[oIdx.productId]);
    var name = toStr(oRow[oIdx.name]);

    var mode = (getProductModeMap(clinic))[pid] || '';
    var result;

    if (mode === '発注トリガー管理') {
      // 現在庫を持たないため在庫操作はせず、発注を一括で「入荷済み」にする。
      // 入荷履歴には記録するが、登録前後在庫は「対象外」とする。
      var now1 = new Date();
      var receiptSheet1 = getOrCreateSheet(RECEIPT_HISTORY_SHEET, RECEIPT_HISTORY_HEADERS);
      var receiptId1 = 'R' + now1.getTime();
      appendRows(receiptSheet1, [[
        receiptId1, orderId, clinic, pid, name,
        remaining, now1, registrant, now1, '対象外', '対象外', '', ''
      ]]);
      result = { receiptId: receiptId1, name: name, before: '対象外', after: '対象外' };
      qty = remaining; // 発注トリガー管理は数量入力を無視し、残数を一括完了させる
    } else {
      qty = Number(qty);
      if (!(qty > 0)) throw new Error('入荷数量を正しく入力してください。');
      if (qty > remaining) {
        throw new Error('入荷数量が未入荷数量（' + remaining + '）を超えています。');
      }
      result = applyReceiptToInventory(clinic, pid, name, qty, orderId, registrant, expiryDateStr);
    }

    // 発注管理を更新
    var newReceived = alreadyReceived + qty;
    var newStatus = (newReceived >= ordered) ? ORDER_STATUS_RECEIVED : ORDER_STATUS_PARTIAL;
    orderSheet.getRange(oRi + 2, oIdx.receivedQty + 1).setValue(newReceived);
    orderSheet.getRange(oRi + 2, oIdx.status + 1).setValue(newStatus);

    result.orderStatus = newStatus;
    result.remainingAfter = ordered - newReceived;
    safeRefreshOpenOrderViewForClinic_(clinic);
    clearReceivingCache_(clinic);
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 発注なし直接入荷（要件10.9・急遽購入等の例外対応）。
 * 発注管理には紐づけず、医院別在庫と入荷履歴のみ更新する。
 */
function registerDirectReceipt(clinic, productId, qty, registrant, expiryDateStr) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  productId = toStr(productId);
  qty = Number(qty);
  if (productId === '' || !(qty > 0)) throw new Error('商品と数量を正しく入力してください。');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var invSheet = getInventorySheetOrThrow();
    var invValues = invSheet.getRange(1, 1, invSheet.getLastRow(), invSheet.getLastColumn()).getValues();
    var invIdx = inventoryHeaderIndex(invValues[0]);
    var name = '';
    for (var r = 1; r < invValues.length; r++) {
      if (toStr(invValues[r][invIdx.clinic]) === clinic && toStr(invValues[r][invIdx.productId]) === productId) {
        name = toStr(invValues[r][invIdx.name]); break;
      }
    }
    return applyReceiptToInventory(clinic, productId, name, qty, '', registrant, expiryDateStr);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 医院別在庫へ入荷を反映し、入荷履歴を記録する共通処理。
 * （registerReceipt / registerDirectReceipt の共通部分。呼び出し元でロック済みの前提）
 */
function applyReceiptToInventory(clinic, productId, name, qty, orderId, registrant, expiryDateStr) {
  var invSheet = getInventorySheetOrThrow();
  var invLastRow = invSheet.getLastRow();
  var invLastCol = invSheet.getLastColumn();
  var invValues = invSheet.getRange(1, 1, invLastRow, invLastCol).getValues();
  var invIdx = inventoryHeaderIndex(invValues[0]);

  var ri = -1;
  for (var r = 1; r < invValues.length; r++) {
    if (toStr(invValues[r][invIdx.clinic]) === clinic && toStr(invValues[r][invIdx.productId]) === productId) { ri = r; break; }
  }
  if (ri < 0) throw new Error('医院別在庫に商品が見つかりません（' + clinic + ' / ' + productId + '）。');

  var row = invValues[ri];
  if (toStr(row[invIdx.mode]) !== '数量管理') {
    throw new Error('発注トリガー管理商品は現在庫を持たないため、入荷登録の対象外です（' + productId + '）。');
  }
  var before = numOrZero(row[invIdx.stock]);
  var after = before + qty;
  var now = new Date();

  invSheet.getRange(ri + 1, invIdx.stock + 1).setValue(after);
  if (orderId) {
    var curOpen = numOrZero(row[invIdx.openQty]);
    invSheet.getRange(ri + 1, invIdx.openQty + 1).setValue(Math.max(0, curOpen - qty));
  }
  invSheet.getRange(ri + 1, invIdx.updatedAt + 1).setValue(now);

  // 使用期限（対象商品のみ）：ロット別管理は行わず、常に「一番近い期限」を保持する
  // （新しい期限のほうが早ければ更新し、遅ければ既存の値を残す。第22章の簡易方式）
  if (invIdx.expiry >= 0 && expiryDateStr) {
    var newDate = new Date(expiryDateStr);
    if (!isNaN(newDate.getTime())) {
      var curExpiry = row[invIdx.expiry];
      var shouldUpdate = true;
      if (curExpiry instanceof Date && !isNaN(curExpiry.getTime())) {
        shouldUpdate = newDate.getTime() < curExpiry.getTime();
      }
      if (shouldUpdate) {
        invSheet.getRange(ri + 1, invIdx.expiry + 1).setValue(newDate);
      }
    }
  }

  var receiptSheet = getOrCreateSheet(RECEIPT_HISTORY_SHEET, RECEIPT_HISTORY_HEADERS);
  var receiptId = 'R' + now.getTime();
  appendRows(receiptSheet, [[
    receiptId, orderId || '', clinic, productId, name || toStr(row[invIdx.name]),
    qty, now, registrant, now, before, after, '', ''
  ]]);

  safeRefreshExpiryViewForClinic_(clinic);
  clearReceivingCache_(clinic);
  return { receiptId: receiptId, name: name || toStr(row[invIdx.name]), before: before, after: after };
}

/**
 * 発注キャンセル（要件16章）。未入荷分だけ医院別在庫の未入荷数量を戻す。
 */
function cancelOrder(clinic, orderId, reason, registrant) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  orderId = toStr(orderId);
  reason = toStr(reason);
  if (orderId === '') throw new Error('発注IDがありません。');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var orderSheet = getOrCreateSheet(ORDER_SHEET, ORDER_HEADERS);
    var oLastRow = orderSheet.getLastRow();
    if (oLastRow < 2) throw new Error('発注データがありません。');
    var oIdx = orderHeaderIndex();
    var oValues = orderSheet.getRange(2, 1, oLastRow - 1, ORDER_HEADERS.length).getValues();

    var oRi = -1;
    for (var i = 0; i < oValues.length; i++) {
      if (toStr(oValues[i][oIdx.orderId]) === orderId && toStr(oValues[i][oIdx.clinic]) === clinic) { oRi = i; break; }
    }
    if (oRi < 0) throw new Error('発注が見つかりません（' + orderId + '）。');
    var oRow = oValues[oRi];
    var status = toStr(oRow[oIdx.status]);
    if (status !== ORDER_STATUS_ORDERED && status !== ORDER_STATUS_PARTIAL) {
      throw new Error('この発注はキャンセルできない状態です（' + status + '）。');
    }
    var ordered = Number(oRow[oIdx.qty]) || 0;
    var received = Number(oRow[oIdx.receivedQty]) || 0;
    var remaining = ordered - received;
    var pid = toStr(oRow[oIdx.productId]);
    var now = new Date();

    // 医院別在庫の未入荷数量から、未入荷分だけ戻す
    var invSheet = getInventorySheetOrThrow();
    var invValues = invSheet.getRange(1, 1, invSheet.getLastRow(), invSheet.getLastColumn()).getValues();
    var invIdx = inventoryHeaderIndex(invValues[0]);
    for (var r = 1; r < invValues.length; r++) {
      if (toStr(invValues[r][invIdx.clinic]) === clinic && toStr(invValues[r][invIdx.productId]) === pid) {
        var curOpen = numOrZero(invValues[r][invIdx.openQty]);
        invSheet.getRange(r + 1, invIdx.openQty + 1).setValue(Math.max(0, curOpen - remaining));
        invSheet.getRange(r + 1, invIdx.updatedAt + 1).setValue(now);
        break;
      }
    }

    orderSheet.getRange(oRi + 2, oIdx.status + 1).setValue(ORDER_STATUS_CANCELED);
    orderSheet.getRange(oRi + 2, oIdx.cancelReason + 1).setValue(reason);
    orderSheet.getRange(oRi + 2, oIdx.cancelAt + 1).setValue(now);

    safeRefreshOpenOrderViewForClinic_(clinic);
    clearReceivingCache_(clinic);
    return { canceled: true, restoredOpenQty: remaining };
  } finally {
    lock.releaseLock();
  }
}

/** 直接入荷画面用：医院の商品一覧（数量管理のみ）を返す */
function getProductsForDirectReceipt(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  var invSheet = getInventorySheetOrThrow();
  var invValues = invSheet.getRange(1, 1, invSheet.getLastRow(), invSheet.getLastColumn()).getValues();
  var invIdx = inventoryHeaderIndex(invValues[0]);
  var expiryManaged = getExpiryManagedMap();
  var products = [];
  for (var r = 1; r < invValues.length; r++) {
    var row = invValues[r];
    if (toStr(row[invIdx.clinic]) !== clinic) continue;
    if (toStr(row[invIdx.mode]) !== '数量管理') continue;
    var pid = toStr(row[invIdx.productId]);
    products.push({
      productId: pid, name: toStr(row[invIdx.name]), stock: numOrZero(row[invIdx.stock]),
      expiryManaged: !!expiryManaged[pid]
    });
  }
  return { clinic: clinic, products: products };
}


// ===== ヘルパー =====

function orderHeaderIndex() {
  return {
    orderId: headerFind(ORDER_HEADERS, '発注ID'),
    clinic: headerFind(ORDER_HEADERS, '医院ID'),
    productId: headerFind(ORDER_HEADERS, '商品ID'),
    name: headerFind(ORDER_HEADERS, '品名'),
    qty: headerFind(ORDER_HEADERS, '発注数量'),
    receivedQty: headerFind(ORDER_HEADERS, '入荷済み数量'),
    orderDate: headerFind(ORDER_HEADERS, '発注日'),
    supplier: headerFind(ORDER_HEADERS, '発注先'),
    status: headerFind(ORDER_HEADERS, '状態'),
    cancelReason: headerFind(ORDER_HEADERS, 'キャンセル理由'),
    cancelAt: headerFind(ORDER_HEADERS, 'キャンセル日時'),
    token: headerFind(ORDER_HEADERS, '登録トークン')
  };
}

function headerFind(headers, label) {
  var i = headers.indexOf(label);
  if (i < 0) throw new Error('列「' + label + '」が見つかりません。');
  return i;
}

/** 商品マスタから 商品ID -> {supplier, standardQty} のマップを作る */
function getMasterSupplierMap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var header = values[0];
  var idId = header.indexOf('商品ID');
  var idSupplier = masterSupplierIndex_(header); // 発注先（統合前は旧「メーカー」列）
  var idQty = header.indexOf('標準発注数量');
  for (var r = 1; r < values.length; r++) {
    var pid = toStr(values[r][idId]);
    if (pid === '') continue;
    map[pid] = {
      supplier: idSupplier >= 0 ? toStr(values[r][idSupplier]) : '',
      standardQty: idQty >= 0 ? toStr(values[r][idQty]) : ''
    };
  }
  return map;
}

function numOrZero(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}
