/**
 * 資材移動（院間の貸し借り・サーバーサイド）
 * ------------------------------------------------------------------
 * 目的:
 *   ある医院の在庫を別の医院へ移す（貸し借り）。端末のカメラでQR写真を撮影し、
 *   移動元（自院）から移動先（他院）へ、数量管理の資材を数量分だけ動かす。
 *
 * ルール（確定仕様）:
 *   - 対象は「数量管理」の資材のみ（発注トリガー管理・未設定は対象外）。
 *   - 移動元の在庫が不足していれば移動しない（エラーで停止）。
 *   - 移動先にその資材の在庫行が無ければ新規作成して受け入れる（管理方式＝数量管理、
 *     発注基準数は空欄＝各院で後設定）。
 *   - 移動元 −n／移動先 +n を更新し、移動ログに記録する。
 *   - 二重送信防止トークンで、同じ操作の重複実行を弾く。
 *   - 使用期限は引き継がない（v1）。
 *
 * 依存:
 *   master.js  … INVENTORY_SHEET_NAME
 *   usage.js   … getInventorySheetOrThrow / inventoryHeaderIndex
 *   additem.js … buildRowByIndex_
 *   order.js   … numOrZero
 *   migration.js … CLINICS
 */

var TRANSFER_LOG_SHEET = '資材移動ログ';
var TRANSFER_LOG_HEADERS = ['日時', '移動元', '移動先', '商品ID', '品名', '数量', '担当者', 'トークン'];

/**
 * 資材を移動する。
 * @param {string} fromClinic 移動元（自院）
 * @param {string} toClinic   移動先
 * @param {string} productId  商品ID
 * @param {(number|string)} qtyIn 移動数量（正の整数）
 * @param {string} operator   担当者名（任意）
 * @param {string} token      二重送信防止トークン
 * @return {Object} 結果（duplicated/transferred など）
 */
function transferStock(fromClinic, toClinic, productId, qtyIn, operator, token) {
  if (CLINICS.indexOf(fromClinic) < 0) throw new Error('不明な移動元医院: ' + fromClinic);
  if (CLINICS.indexOf(toClinic) < 0) throw new Error('移動先の医院を選んでください。');
  if (fromClinic === toClinic) throw new Error('移動元と移動先が同じです。別の医院を選んでください。');

  productId = toStr(productId);
  if (productId === '') throw new Error('資材が特定できません（QRを読み取ってください）。');

  var qty = Number(qtyIn);
  if (isNaN(qty) || qty <= 0 || Math.floor(qty) !== qty) {
    throw new Error('移動数量は1以上の整数で入力してください。');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 二重送信防止：同じトークンが記録済みなら何もしない
    if (token && isTransferTokenUsed_(token)) {
      return { duplicated: true, message: 'この移動は送信済みです（二重送信を防止しました）。' };
    }

    var invSheet = getInventorySheetOrThrow();
    var iCols = invSheet.getLastColumn();
    var iLast = invSheet.getLastRow();
    var vals = invSheet.getRange(1, 1, iLast, iCols).getValues();
    var idx = inventoryHeaderIndex(vals[0]);

    // 移動元・移動先の行を探す
    var srcRow = -1, dstRow = -1, name = '';
    for (var r = 1; r < vals.length; r++) {
      if (toStr(vals[r][idx.productId]) !== productId) continue;
      var cl = toStr(vals[r][idx.clinic]);
      if (cl === fromClinic) srcRow = r;
      if (cl === toClinic) dstRow = r;
    }

    if (srcRow < 0) throw new Error('移動元（' + fromClinic + '）にこの資材の在庫がありません。');
    if (toStr(vals[srcRow][idx.mode]) !== '数量管理') {
      throw new Error('数量管理の資材のみ移動できます（この資材は数量管理ではありません）。');
    }
    name = toStr(vals[srcRow][idx.name]);

    var srcStock = numOrZero(vals[srcRow][idx.stock]);
    if (srcStock < qty) {
      throw new Error('移動元の在庫が不足しています（在庫 ' + srcStock + ' ／ 移動 ' + qty + '）。');
    }
    var newSrc = srcStock - qty;

    // 移動先：既存行があれば数量管理であることを確認して加算、無ければ新規作成
    var newDst;
    if (dstRow >= 0) {
      if (toStr(vals[dstRow][idx.mode]) !== '数量管理') {
        throw new Error('移動先（' + toClinic + '）ではこの資材が数量管理ではないため受け入れできません。');
      }
      newDst = numOrZero(vals[dstRow][idx.stock]) + qty;
    }

    var now = new Date();

    // 書き込み（移動元）
    invSheet.getRange(srcRow + 1, idx.stock + 1).setValue(newSrc);
    if (idx.updatedAt >= 0) invSheet.getRange(srcRow + 1, idx.updatedAt + 1).setValue(now);

    // 書き込み（移動先）
    if (dstRow >= 0) {
      invSheet.getRange(dstRow + 1, idx.stock + 1).setValue(newDst);
      if (idx.updatedAt >= 0) invSheet.getRange(dstRow + 1, idx.updatedAt + 1).setValue(now);
    } else {
      var newRow = buildRowByIndex_(iCols, [
        { col: idx.clinic, val: toClinic },
        { col: idx.productId, val: productId },
        { col: idx.name, val: name },
        { col: idx.mode, val: '数量管理' },
        { col: idx.kijun, val: '' },        // 発注基準数は移動先で後設定
        { col: idx.trigger, val: '' },
        { col: idx.stock, val: qty },
        { col: idx.openQty, val: 0 },
        { col: idx.expiry, val: '' },        // 期限は引き継がない（v1）
        { col: idx.updatedAt, val: now }
      ]);
      invSheet.appendRow(newRow);
      newDst = qty;
    }

    // 移動ログに記録
    appendTransferLog_(now, fromClinic, toClinic, productId, name, qty, toStr(operator), toStr(token));

    return {
      transferred: true,
      from: fromClinic, to: toClinic,
      productId: productId, name: name, qty: qty,
      fromStock: newSrc, toStock: newDst,
      createdAtDestination: (dstRow < 0)
    };
  } finally {
    lock.releaseLock();
  }
}

/** 移動ログシートを取得（無ければヘッダー付きで作成）。 */
function getTransferLogSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TRANSFER_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(TRANSFER_LOG_SHEET);
    sheet.getRange(1, 1, 1, TRANSFER_LOG_HEADERS.length)
         .setValues([TRANSFER_LOG_HEADERS]).setFontWeight('bold').setBackground('#e8eef7');
    sheet.setFrozenRows(1);
    return sheet;
  }
  assertSheetHeaders_(sheet, TRANSFER_LOG_HEADERS);
  return sheet;
}

/** 移動ログに1行追記する。 */
function appendTransferLog_(when, from, to, productId, name, qty, operator, token) {
  getTransferLogSheet_().appendRow([when, from, to, productId, name, qty, operator, token]);
}

/** トークンが移動ログに記録済みか（二重送信防止）。 */
function isTransferTokenUsed_(token) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TRANSFER_LOG_SHEET);
  if (!sheet) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  assertSheetHeaders_(sheet, TRANSFER_LOG_HEADERS);
  var tokenCol = TRANSFER_LOG_HEADERS.indexOf('トークン') + 1;
  var col = sheet.getRange(2, tokenCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (toStr(col[i][0]) === token) return true;
  }
  return false;
}
