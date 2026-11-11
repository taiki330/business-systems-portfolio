/**
 * 誤操作リカバリ（在庫手動修正・使用/入荷の取消／サーバーサイド）
 * ------------------------------------------------------------------
 * 目的（要件10.11 / 10.12）:
 *   - 10.12 在庫手動修正：数え間違い等を、正しい在庫数へ理由付きで直す。
 *   - 10.11 使用/入荷の取消：誤登録した使用・入荷を取り消し、在庫を元に戻す。
 *
 * 方針:
 *   - 履歴レコードは削除しない。使用履歴／入荷履歴の「取消フラグ・取消理由」を立て、
 *     在庫を逆算して戻す（使用取消＝在庫を加算、入荷取消＝在庫を減算）。
 *   - 在庫手動修正は「在庫修正履歴」シートに 変更前→変更後 を残す。
 *   - 対象は数量管理商品（在庫数を持つもの）。理由は必須。
 *   - LockService で直列化し、ロック解放前に flush()。二重取消は弾く。
 *
 * 注意（v1の割り切り）:
 *   入荷取消は在庫を戻す＋取消フラグまで。元の発注状態（入荷済み等）は自動では戻さない。
 *
 * 依存:
 *   usage.js … getInventorySheetOrThrow / inventoryHeaderIndex / getOrCreateSheet /
 *              appendRows / USAGE_HISTORY_SHEET / USAGE_HISTORY_HEADERS
 *   order.js … numOrZero / RECEIPT_HISTORY_SHEET / RECEIPT_HISTORY_HEADERS
 *   migration.js … CLINICS
 */

var STOCK_ADJUST_HISTORY_SHEET = '在庫修正履歴';
var STOCK_ADJUST_HISTORY_HEADERS = ['日時', '医院ID', '商品ID', '品名', '修正理由', '変更前', '変更後', 'トークン'];
var CANCEL_FLAG = '取消';
var RECENT_LIMIT_DEFAULT = 50;

/* ============================ 10.12 在庫手動修正 ============================ */

/**
 * 在庫を正しい実数へ上書き修正する（理由必須）。
 * @param {string} clinic
 * @param {string} productId
 * @param {(number|string)} newCount 修正後の在庫数（0以上）
 * @param {string} reason 修正理由（必須）
 * @param {string} token 冪等トークン
 * @return {{adjusted:boolean, duplicated:boolean, before:number, after:number, name:string}}
 */
function adjustStock(clinic, productId, newCount, reason, token) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  productId = toStr(productId);
  reason = toStr(reason);
  token = toStr(token);
  if (productId === '') throw new Error('商品が指定されていません。');
  if (reason === '') throw new Error('修正理由は必須です。');
  var count = Number(newCount);
  if (isNaN(count) || count < 0) throw new Error('在庫数は0以上の数値で入力してください。');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (token !== '' && isAdjustTokenUsed_(token)) {
      return { adjusted: false, duplicated: true };
    }

    var invSheet = getInventorySheetOrThrow();
    var vals = invSheet.getRange(1, 1, invSheet.getLastRow(), invSheet.getLastColumn()).getValues();
    var idx = inventoryHeaderIndex(vals[0]);

    var ri = findInvRow_(vals, idx, clinic, productId);
    if (ri < 0) throw new Error('医院別在庫に商品が見つかりません（' + clinic + ' / ' + productId + '）。');
    if (toStr(vals[ri][idx.mode]) !== '数量管理') {
      throw new Error('発注トリガー管理商品は在庫数を持たないため、手動修正の対象外です（' + productId + '）。');
    }

    var before = numOrZero(vals[ri][idx.stock]);
    var name = toStr(vals[ri][idx.name]);
    var now = new Date();

    invSheet.getRange(ri + 1, idx.stock + 1).setValue(count);
    invSheet.getRange(ri + 1, idx.updatedAt + 1).setValue(now);

    appendRows(getOrCreateSheet(STOCK_ADJUST_HISTORY_SHEET, STOCK_ADJUST_HISTORY_HEADERS),
      [[now, clinic, productId, name, reason, before, count, token]]);

    SpreadsheetApp.flush();
    return { adjusted: true, duplicated: false, before: before, after: count, name: name };
  } finally {
    lock.releaseLock();
  }
}

/* ============================ 10.11 使用/入荷の取消 ============================ */

/**
 * 取消できる直近の使用登録を返す（未取消のみ）。
 * @param {string} clinic
 * @param {number} [limit]
 * @return {{clinic:string, items:Array}}
 */
function getRecentUsage(clinic, limit) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  limit = Number(limit) > 0 ? Number(limit) : RECENT_LIMIT_DEFAULT;
  return { clinic: clinic, items: readRecentHistory_(USAGE_HISTORY_SHEET, USAGE_HISTORY_HEADERS, clinic, limit, '使用数量', '使用日時') };
}

/**
 * 取消できる直近の入荷登録を返す（未取消のみ）。
 */
function getRecentReceipts(clinic, limit) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  limit = Number(limit) > 0 ? Number(limit) : RECENT_LIMIT_DEFAULT;
  return { clinic: clinic, items: readRecentHistory_(RECEIPT_HISTORY_SHEET, RECEIPT_HISTORY_HEADERS, clinic, limit, '入荷数量', '入荷日') };
}

/**
 * 使用登録を取り消す（在庫を使用数量ぶん戻す）。
 * @param {string} clinic
 * @param {number} row 使用履歴のシート行番号（getRecentUsageが返すrow）
 * @param {string} reason 取消理由（必須）
 * @param {{productId:string, qty:number}} expect 画面に表示していた内容。
 *        行番号だけを信じると、一覧表示後に履歴シートが並べ替え・行削除された場合に
 *        別のレコードを取り消して在庫が逆方向にずれるため、必ず照合する。
 */
function cancelUsage(clinic, row, reason, expect) {
  return cancelHistory_({
    clinic: clinic, row: row, reason: reason, expect: expect,
    sheetName: USAGE_HISTORY_SHEET, headers: USAGE_HISTORY_HEADERS,
    qtyLabel: '使用数量', direction: +1 // 使用取消＝在庫に戻す（加算）
  });
}

/**
 * 入荷登録を取り消す（在庫を入荷数量ぶん減らす）。発注状態は自動では戻さない（v1）。
 * expect の意味は cancelUsage と同じ。
 */
function cancelReceipt(clinic, row, reason, expect) {
  return cancelHistory_({
    clinic: clinic, row: row, reason: reason, expect: expect,
    sheetName: RECEIPT_HISTORY_SHEET, headers: RECEIPT_HISTORY_HEADERS,
    qtyLabel: '入荷数量', direction: -1 // 入荷取消＝在庫を減らす
  });
}

/* ============================ 共通ヘルパー ============================ */

/** 使用/入荷履歴の取消共通処理。 */
function cancelHistory_(opt) {
  var clinic = opt.clinic;
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  var rowNum = Number(opt.row);
  var reason = toStr(opt.reason);
  if (!(rowNum >= 2)) throw new Error('取消対象が不正です。');
  if (reason === '') throw new Error('取消理由は必須です。');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(opt.sheetName);
    if (!sheet || sheet.getLastRow() < rowNum) throw new Error('取消対象の履歴が見つかりません。');
    assertSheetHeaders_(sheet, opt.headers);
    var cols = opt.headers.length;
    var rowVals = sheet.getRange(rowNum, 1, 1, cols).getValues()[0];

    var col = {};
    opt.headers.forEach(function (h, i) { col[h] = i; });

    if (toStr(rowVals[col['医院ID']]) !== clinic) throw new Error('医院が一致しない履歴です。');
    if (toStr(rowVals[col['取消フラグ']]) !== '') {
      return { canceled: false, alreadyCanceled: true, message: 'この履歴は既に取消済みです。' };
    }

    var productId = toStr(rowVals[col['商品ID']]);
    var name = toStr(rowVals[col['品名']]);
    var qty = numOrZero(rowVals[col[opt.qtyLabel]]);
    var beforeStock = toStr(rowVals[col['登録前在庫']]);

    // 行番号は一覧を表示した時点のもの。表示後に履歴シートが並べ替えられたり行が
    // 削除されたりすると同じ行番号が別レコードを指すため、画面に出していた
    // 商品ID・数量と突き合わせ、食い違ったら在庫を触らずに中止する。
    var expect = opt.expect;
    if (!expect || toStr(expect.productId) === '') {
      throw new Error('画面の情報が古い可能性があります。ページを再読み込みしてからやり直してください。');
    }
    if (toStr(expect.productId) !== productId || numOrZero(expect.qty) !== qty) {
      throw new Error('取消対象がずれています（履歴が並べ替え・削除された可能性があります）。' +
        '安全のため中止しました。ページを再読み込みしてからやり直してください。');
    }

    // 在庫を逆算して戻す（数量管理の在庫がある場合のみ。発注トリガー管理＝「対象外」はスキップ）
    var stockResult = null;
    if (beforeStock !== '対象外') {
      stockResult = reverseInventoryStock_(clinic, productId, opt.direction * qty);
    }

    // 履歴に取消フラグ・理由を立てる（レコードは残す）
    sheet.getRange(rowNum, col['取消フラグ'] + 1).setValue(CANCEL_FLAG);
    sheet.getRange(rowNum, col['取消理由'] + 1).setValue(reason);

    SpreadsheetApp.flush();
    return {
      canceled: true, alreadyCanceled: false, name: name, qty: qty,
      stock: stockResult // {before, after} or null（対象外）
    };
  } finally {
    lock.releaseLock();
  }
}

/** 医院別在庫の在庫数を delta ぶん増減する（数量管理のみ）。 */
function reverseInventoryStock_(clinic, productId, delta) {
  var invSheet = getInventorySheetOrThrow();
  var vals = invSheet.getRange(1, 1, invSheet.getLastRow(), invSheet.getLastColumn()).getValues();
  var idx = inventoryHeaderIndex(vals[0]);
  var ri = findInvRow_(vals, idx, clinic, productId);
  if (ri < 0) throw new Error('医院別在庫に商品が見つかりません（' + clinic + ' / ' + productId + '）。取消できません。');
  if (toStr(vals[ri][idx.mode]) !== '数量管理') {
    // 在庫数を持たない商品は在庫の巻き戻し不可（フラグのみ立てる想定だが、明示的に知らせる）
    return { before: null, after: null, skipped: true };
  }
  var before = numOrZero(vals[ri][idx.stock]);
  var after = before + delta;
  invSheet.getRange(ri + 1, idx.stock + 1).setValue(after);
  invSheet.getRange(ri + 1, idx.updatedAt + 1).setValue(new Date());
  return { before: before, after: after, skipped: false };
}

/** 履歴シートから、その医院の未取消レコードを直近 limit 件返す（新しい順）。 */
function readRecentHistory_(sheetName, headers, clinic, limit, qtyLabel, dateLabel) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  assertSheetHeaders_(sheet, headers);
  var lastRow = sheet.getLastRow();
  var vals = sheet.getRange(1, 1, lastRow, headers.length).getValues();
  var col = {};
  headers.forEach(function (h, i) { col[h] = i; });

  var items = [];
  for (var r = lastRow - 1; r >= 1; r--) { // 下（新しい）から
    var row = vals[r];
    if (toStr(row[col['医院ID']]) !== clinic) continue;
    if (toStr(row[col['取消フラグ']]) !== '') continue; // 取消済みは出さない
    items.push({
      row: r + 1, // シート行番号（取消の handle。履歴は消さないので安定）
      date: formatDate_(row[col[dateLabel]]),
      productId: toStr(row[col['商品ID']]),
      name: toStr(row[col['品名']]),
      qty: numOrZero(row[col[qtyLabel]]),
      target: toStr(row[col['登録前在庫']]) === '対象外' ? '（管理対象外）' : ''
    });
    if (items.length >= limit) break;
  }
  return items;
}

function findInvRow_(vals, idx, clinic, productId) {
  for (var r = 1; r < vals.length; r++) {
    if (toStr(vals[r][idx.clinic]) === clinic && toStr(vals[r][idx.productId]) === productId) return r;
  }
  return -1;
}

function isAdjustTokenUsed_(token) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(STOCK_ADJUST_HISTORY_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return false;
  assertSheetHeaders_(sheet, STOCK_ADJUST_HISTORY_HEADERS);
  var tokenCol = STOCK_ADJUST_HISTORY_HEADERS.indexOf('トークン') + 1;
  var col = sheet.getRange(2, tokenCol, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) if (toStr(col[i][0]) === token) return true;
  return false;
}

function formatDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    var y = v.getFullYear(), m = ('0' + (v.getMonth() + 1)).slice(-2), d = ('0' + v.getDate()).slice(-2);
    var hh = ('0' + v.getHours()).slice(-2), mm = ('0' + v.getMinutes()).slice(-2);
    return y + '/' + m + '/' + d + ' ' + hh + ':' + mm;
  }
  return toStr(v);
}
