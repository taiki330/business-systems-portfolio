/**
 * 一斉在庫登録（初期在庫の確定・サーバーサイド）
 * ------------------------------------------------------------------
 * 目的（要件18.4「初期在庫の確定」）:
 *   棚卸しで数えた現在庫数を、医院ごとに一括で確定（上書き）する。
 *   マスタ生成後、稼働直前に各医院の実在庫を入れる用途。
 *
 * 対象:
 *   数量管理の商品のみ（発注トリガー管理は在庫数を持たないため対象外）。
 *
 * 同時登録の安全設計（GAS仕様を踏まえた対処）:
 *   - 医院の全スタッフが手分けして同時に保存することを想定。
 *   - クライアントは「入力した行だけ」を送る。サーバーはその行の現在庫セルだけを
 *     ピンポイントで上書きする（空欄の行・他人が入れた行には触れない）。
 *   - LockService で保存を直列化し、ロック区間は最小限（数えた行の書き込み＋履歴のみ）。
 *   - ロック解放の直前に SpreadsheetApp.flush() で書き込みを確定させ、
 *     次の保存が確実に最新を読むようにする（lost update／古い読み取りの防止）。
 *   - 冪等トークンで、通信失敗後の再送による二重適用を防止（上書きなので再送自体は無害）。
 *
 * 依存:
 *   master.js  … INVENTORY_SHEET_NAME
 *   usage.js   … getInventorySheetOrThrow / inventoryHeaderIndex / getOrCreateSheet / appendRows
 *   order.js   … numOrZero
 *   stock.js   … getMasterInfoMap（カテゴリ表示用）
 *   migration.js … CLINICS
 */

var BULK_STOCK_HISTORY_SHEET = '在庫確定履歴';
var BULK_STOCK_HISTORY_HEADERS = ['日時', '医院ID', '商品ID', '品名', '変更前', '変更後', 'トークン'];

/**
 * 標準カメラで開いた1商品の現在庫を高速に返す（PV棚卸し用・読み取り専用）。
 * 全在庫表を取得せず、商品ID列から対象行だけを探す。
 * @param {string} clinic
 * @param {string} productId
 * @return {{found:boolean, name:string, mode:string, stock:(number|null)}}
 */
function getSingleBulkStockInfo(clinic, productId) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  productId = toStr(productId);
  if (productId === '') throw new Error('商品IDがありません。');

  var sheet = getInventorySheetOrThrow();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { found: false, clinic: clinic, productId: productId };
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = inventoryHeaderIndex(headers);
  var matches = sheet.getRange(2, idx.productId + 1, lastRow - 1, 1)
    .createTextFinder(productId).matchEntireCell(true).findAll();
  for (var i = 0; i < matches.length; i++) {
    var rowNo = matches[i].getRow();
    var row = sheet.getRange(rowNo, 1, 1, lastCol).getValues()[0];
    if (toStr(row[idx.clinic]) !== clinic) continue;
    return {
      found: true,
      clinic: clinic,
      productId: productId,
      name: toStr(row[idx.name]),
      mode: toStr(row[idx.mode]),
      stock: numOrZero(row[idx.stock])
    };
  }
  return { found: false, clinic: clinic, productId: productId };
}

/**
 * 一斉在庫登録の対象一覧（その医院の数量管理商品）を返す。
 * @param {string} clinic
 * @return {{clinic:string, items:Array<{productId,name,category,stock,registeredToday,registeredAt}>}}
 */
function getBulkStockList(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);

  var masterMap = getMasterInfoMap(); // productId -> {category, supplier, name, ...}
  var invSheet = getInventorySheetOrThrow();
  var lastRow = invSheet.getLastRow();
  if (lastRow < 2) return { clinic: clinic, items: [] };

  var values = invSheet.getRange(1, 1, lastRow, invSheet.getLastColumn()).getValues();
  var idx = inventoryHeaderIndex(values[0]);
  var todayMap = getTodayBulkStockMap_(clinic);

  var items = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (toStr(row[idx.clinic]) !== clinic) continue;
    if (toStr(row[idx.mode]) !== '数量管理') continue; // 数量管理のみ
    var pid = toStr(row[idx.productId]);
    if (pid === '') continue;
    var m = masterMap[pid] || {};
    items.push({
      productId: pid,
      name: toStr(row[idx.name]) || m.name || '',
      category: m.category || '',
      stock: numOrZero(row[idx.stock]),
      registeredToday: !!todayMap[pid],
      registeredAt: todayMap[pid] || ''
    });
  }
  return { clinic: clinic, items: items };
}

/**
 * 今日の在庫確定履歴を商品IDごとに返す。
 * 履歴件数による打ち切りは行わず、Date型・文字列型の日時を両方扱う。
 */
function getTodayBulkStockMap_(clinic) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BULK_STOCK_HISTORY_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return {};
  assertSheetHeaders_(sheet, BULK_STOCK_HISTORY_HEADERS);
  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(2, 1, lastRow - 1, BULK_STOCK_HISTORY_HEADERS.length).getValues();
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var result = {};
  for (var i = values.length - 1; i >= 0; i--) {
    var d = bulkStockHistoryDate_(values[i][0]);
    if (!d) continue;
    if (Utilities.formatDate(d, tz, 'yyyy-MM-dd') !== today) continue;
    if (toStr(values[i][1]) !== clinic) continue;
    var pid = toStr(values[i][2]);
    if (pid && !result[pid]) result[pid] = Utilities.formatDate(d, tz, 'HH:mm');
  }
  return result;
}

/** 一斉在庫登録画面の自動更新用に、本日の商品別登録時刻だけを返す。 */
function getTodayBulkStockStatus(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  return getTodayBulkStockMap_(clinic);
}

/** シート履歴の日時をDateへ統一する。過去データが文字列で保存されていても除外しない。 */
function bulkStockHistoryDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === 'number' && isFinite(value)) {
    // Google Sheetsの日付シリアル値（1899-12-30起点）にも対応する。
    var serialDate = new Date(Math.round((value - 25569) * 86400000));
    if (!isNaN(serialDate.getTime())) return serialDate;
  }
  var text = toStr(value);
  if (!text) return null;
  var parsed = new Date(text.replace(/年|月/g, '/').replace(/日/g, ''));
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 数えた実数で現在庫を一括確定（上書き）する。入力のあった商品だけ更新する。
 * @param {string} clinic
 * @param {Array<{productId:string, count:(number|string)}>} changes 入力した行のみ
 * @param {string} token 冪等トークン
 * @return {{saved:number, duplicated:boolean}}
 */
function saveBulkStock(clinic, changes, token) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  changes = (changes || []).filter(function (c) { return toStr(c.productId) !== ''; });
  if (!changes.length) return { saved: 0, duplicated: false };
  token = toStr(token);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // 取得できなければ例外→クライアントで再送（データは壊れない）
  try {
    if (token !== '' && isBulkStockTokenUsed_(token)) {
      return { saved: 0, duplicated: true };
    }

    var invSheet = getInventorySheetOrThrow();
    var iCols = invSheet.getLastColumn();
    var iLast = invSheet.getLastRow();
    var vals = invSheet.getRange(1, 1, iLast, iCols).getValues();
    var idx = inventoryHeaderIndex(vals[0]);

    // この医院の 商品ID -> 行index（values内）
    var rowOf = {};
    for (var r = 1; r < vals.length; r++) {
      if (toStr(vals[r][idx.clinic]) !== clinic) continue;
      rowOf[toStr(vals[r][idx.productId])] = r;
    }

    // ① 先に全件バリデーション（1件でも不正なら何も書かずに中断＝部分更新を防ぐ）
    var toApply = [];
    changes.forEach(function (ch) {
      var pid = toStr(ch.productId);
      var ri = rowOf[pid];
      if (ri === undefined) throw new Error('医院別在庫に商品が見つかりません（' + clinic + ' / ' + pid + '）。');
      if (toStr(vals[ri][idx.mode]) !== '数量管理') throw new Error('数量管理以外は一斉登録の対象外です（' + pid + '）。');
      var count = Number(ch.count);
      if (isNaN(count) || count < 0) throw new Error('在庫数は0以上の数値で入力してください（' + pid + '）。');
      toApply.push({ ri: ri, pid: pid, count: count, before: numOrZero(vals[ri][idx.stock]), name: toStr(vals[ri][idx.name]) });
    });

    // ② 入力した行だけをメモリ上で書き換え、現在庫数・最終更新日時の2列を
    //    それぞれ1回の setValues でまとめ書きする。
    //    棚卸しは数百件をまとめて保存する画面なので、1行ずつ書くと書き込みが
    //    千回単位になり、その間ロックを握って他医院の登録を止めてしまう。
    //    入力の無かった行は読み取った値をそのまま書き戻すため内容は変わらない。
    var now = new Date();
    var historyRows = [];
    toApply.forEach(function (a) {
      vals[a.ri][idx.stock] = a.count;
      vals[a.ri][idx.updatedAt] = now;
      historyRows.push([now, clinic, a.pid, a.name, a.before, a.count, token]);
    });
    writeSheetColumn_(invSheet, vals, idx.stock);      // usage.js
    writeSheetColumn_(invSheet, vals, idx.updatedAt);
    safeRefreshExpiryViewForClinic_(clinic);
    if (historyRows.length) {
      appendRows(getOrCreateSheet(BULK_STOCK_HISTORY_SHEET, BULK_STOCK_HISTORY_HEADERS), historyRows);
    }

    // ③ ロック解放前に書き込みを確定（次の保存が最新を読むように）
    SpreadsheetApp.flush();

    return { saved: toApply.length, duplicated: false };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 標準カメラから1商品の現在庫だけを高速に確定する（PV棚卸し用）。
 * 全在庫表を読まず、商品ID列で候補行を検索して対象セルだけ更新する。
 * @param {string} clinic
 * @param {string} productId
 * @param {number|string} count
 * @param {string} token 冪等トークン
 * @return {{saved:number, duplicated:boolean}}
 */
function saveSingleBulkStock(clinic, productId, count, token) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  productId = toStr(productId);
  token = toStr(token);
  count = Number(count);
  if (productId === '') throw new Error('商品IDがありません。');
  if (!Number.isInteger(count) || count < 0) throw new Error('在庫数は0以上の整数で入力してください。');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (token !== '' && isBulkStockTokenUsed_(token)) {
      return { saved: 0, duplicated: true };
    }

    var sheet = getInventorySheetOrThrow();
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2) throw new Error('医院別在庫に商品が見つかりません（' + clinic + ' / ' + productId + '）。');
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var idx = inventoryHeaderIndex(headers);
    var matches = sheet.getRange(2, idx.productId + 1, lastRow - 1, 1)
      .createTextFinder(productId).matchEntireCell(true).findAll();
    var rowNo = 0;
    for (var i = 0; i < matches.length; i++) {
      var candidateRow = matches[i].getRow();
      if (toStr(sheet.getRange(candidateRow, idx.clinic + 1).getValue()) === clinic) {
        rowNo = candidateRow;
        break;
      }
    }
    if (!rowNo) throw new Error('医院別在庫に商品が見つかりません（' + clinic + ' / ' + productId + '）。');

    var mode = toStr(sheet.getRange(rowNo, idx.mode + 1).getValue());
    if (mode !== '数量管理') throw new Error('数量管理以外は一斉登録の対象外です（' + productId + '）。');
    var before = numOrZero(sheet.getRange(rowNo, idx.stock + 1).getValue());
    var name = toStr(sheet.getRange(rowNo, idx.name + 1).getValue());
    var now = new Date();
    sheet.getRange(rowNo, idx.stock + 1).setValue(count);
    sheet.getRange(rowNo, idx.updatedAt + 1).setValue(now);
    appendRows(getOrCreateSheet(BULK_STOCK_HISTORY_SHEET, BULK_STOCK_HISTORY_HEADERS),
      [[now, clinic, productId, name, before, count, token]]);
    SpreadsheetApp.flush();
    return { saved: 1, duplicated: false };
  } finally {
    lock.releaseLock();
  }
}

/** 在庫確定履歴に同じトークンが既にあるか（二重適用防止）。 */
function isBulkStockTokenUsed_(token) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BULK_STOCK_HISTORY_SHEET);
  if (!sheet) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  assertSheetHeaders_(sheet, BULK_STOCK_HISTORY_HEADERS);
  var tokenCol = BULK_STOCK_HISTORY_HEADERS.indexOf('トークン') + 1;
  return sheet.getRange(2, tokenCol, lastRow - 1, 1)
    .createTextFinder(token).matchEntireCell(true).findNext() !== null;
}
