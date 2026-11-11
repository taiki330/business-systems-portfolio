/**
 * QRコード生成（サーバーサイド）
 * ------------------------------------------------------------------
 * 目的（要件定義書 10.3）:
 *   商品マスタの商品IDから、印刷用QRを生成する。
 *   画面（QrPrint.html）で商品名・カテゴリ・商品IDを併記したカードを並べ、
 *   ブラウザ印刷（Ctrl+P）でQRカードを作成できるようにする。
 *
 * QRの中身:
 *   自システムのQRだと判別できるよう、プレフィックス付きの商品ID。
 *   例: 商品ID「P0001」→ QR内容「INV-P0001」
 *   （医院・保管場所は含めない＝要件定義書 14章で確定）
 *   このプレフィックスは読取側（使用登録）と共有する。
 *
 * QR画像:
 *   外部サービス QuickChart（https://quickchart.io/qr）で生成する。
 *   GAS単体ではQR画像を描けないため。画像URLの組み立ては
 *   qrImageUrl() に集約し、読取側と生成側で表記をずらさない。
 *
 * 前提:
 *   商品マスタ（master.js の②で生成）が存在すること。
 */

// 自システムQRのプレフィックス（読取側と必ず一致させること）
var QR_PREFIX = 'INV-';
var PRODUCT_PHOTO_SHEET = '商品写真';
var PRODUCT_PHOTO_HEADERS = ['商品ID', 'DriveファイルID', '画像URL', '更新日時'];
var PRODUCT_PHOTO_FOLDER = '棚卸システム_商品写真';

/**
 * 商品IDからQRに埋め込む文字列を作る。
 * iPhone等の標準カメラで読み取るだけで使用登録できるよう、
 * WebアプリのURL形式にする（医院はQRに含めない＝要件14章）。
 *   例: https://script.google.com/macros/s/XXX/exec?p=P0001
 */
function qrTextForProduct(productId) {
  return getWebAppBaseUrl() + '?p=' + encodeURIComponent(productId);
}

/** デプロイ済みWebアプリのURL（末尾 /exec）を返す。未デプロイなら空文字。 */
function getWebAppBaseUrl() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

/**
 * QR文字列から商品IDを取り出す（読取側で使用）。
 * URL形式（?p=ID）と、旧形式（INV-ID）の両方に対応。
 * 自システムのQRでなければ null を返す。
 */
function parseQrText(text) {
  var s = String(text || '').trim();
  // URL形式: ?p=ID または &p=ID
  var m = s.match(/[?&]p=([^&]+)/);
  if (m) {
    try { return decodeURIComponent(m[1]) || null; } catch (e) { return m[1] || null; }
  }
  // 旧形式: INV-ID
  if (s.indexOf(QR_PREFIX) === 0) {
    var id = s.substring(QR_PREFIX.length);
    return id || null;
  }
  return null;
}

/** QR画像のURL（QuickChart）を組み立てる */
function qrImageUrl(qrText, size) {
  var px = size || 150;
  return 'https://quickchart.io/qr'
    + '?text=' + encodeURIComponent(qrText)
    + '&size=' + px
    + '&margin=2'
    + '&ecLevel=M';
}

/**
 * 印刷対象の商品一覧を返す（QrPrint.html から呼ぶ）。
 * 有効な商品のみ。カテゴリで絞り込みたい場合は category を渡す。
 * clinic を渡すと、その医院の在庫にある商品だけに絞る（各医院ホームからのQR発行用）。
 * clinic指定時は、その医院で「印刷済み」にした商品は既定で除外する
 * （includePrinted=true で印刷済みも含めて返す）。
 * @param {string} [category] 省略時は全カテゴリ
 * @param {string} [clinic] 省略時は全医院の商品（この場合、印刷済み管理は行わない）
 * @param {boolean} [includePrinted] true なら印刷済みも含めて返す
 * @return {{products:Array, categories:Array, hiddenPrintedCount:number}}
 */
function getProductsForQr(category, clinic, includePrinted) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME); // master.js の定数
  if (!sheet) {
    throw new Error(MASTER_SHEET_NAME +
      ' シートがありません。先に「棚卸しツール →② 商品マスタ・医院別在庫を生成」を実行してください。');
  }
  // QRはWebアプリURLを埋め込むため、先にデプロイが必要
  if (getWebAppBaseUrl() === '') {
    throw new Error('先にウェブアプリをデプロイしてください（QRにアプリのURLを埋め込むため）。' +
      '\nApps Scriptエディタ → デプロイ → 新しいデプロイ → ウェブアプリ。');
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { products: [], categories: [], hiddenPrintedCount: 0 };

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var idx = qrMasterHeaderIndex(values[0]);

  // 医院指定があれば、その医院の在庫にある商品IDだけに絞る
  var clinicSet = clinic ? getClinicProductIdSet_(clinic) : null;
  var printedSet = clinic ? getQrPrintedSet_(clinic) : {};
  var photoMap = getProductPhotoMap_();
  var ruleMap = clinic ? getClinicOrderRuleMap_(clinic) : {};

  var products = [];
  var catSet = {};
  var hiddenPrintedCount = 0;
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var id = toStr(row[idx.id]);
    if (id === '') continue;
    // 有効/無効：無効は除外（列が無ければ全件対象）
    if (idx.active >= 0 && toStr(row[idx.active]) === '無効') continue;
    // 医院指定時：その医院で扱わない商品は除外
    if (clinicSet && !clinicSet[id]) continue;

    var cat = toStr(row[idx.category]);
    catSet[cat] = true;
    if (category && cat !== category) continue;

    var printed = clinic ? !!printedSet[id] : false;
    if (printed && !includePrinted) { hiddenPrintedCount++; continue; }

    var qrText = qrTextForProduct(id);
    products.push({
      id: id,
      category: cat,
      supplier: idx.supplier >= 0 ? toStr(row[idx.supplier]) : '',
      name: toStr(row[idx.name]),
      qrText: qrText,
      imageUrl: qrImageUrl(qrText, 150),
      photoUrl: photoMap[id] ? photoMap[id].url : '',
      mode: clinic && ruleMap[id] ? ruleMap[id].mode : '',
      orderRule: clinic && ruleMap[id] ? ruleMap[id].rule : '',
      printed: printed
    });
  }
  return { products: products, categories: Object.keys(catSet), hiddenPrintedCount: hiddenPrintedCount };
}

/** 商品写真を保存する。既存写真があれば差し替える。 */
function saveProductPhoto(productId, dataUrl) {
  productId = toStr(productId);
  if (productId === '') throw new Error('商品が指定されていません。');
  var m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('写真データの形式が正しくありません。JPEG・PNG・WebPを使用してください。');
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 1500000) throw new Error('写真が大きすぎます。1.5MB以下にしてください。');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var master = ss.getSheetByName(MASTER_SHEET_NAME);
    if (!master) throw new Error(MASTER_SHEET_NAME + ' シートがありません。');
    var ids = master.getRange(2, 1, Math.max(master.getLastRow() - 1, 1), 1).getValues();
    var exists = ids.some(function (r) { return toStr(r[0]) === productId; });
    if (!exists) throw new Error('商品マスタに商品が見つかりません（' + productId + '）。');

    var folder = getProductPhotoFolder_();
    var ext = m[1] === 'image/png' ? '.png' : (m[1] === 'image/webp' ? '.webp' : '.jpg');
    var blob = Utilities.newBlob(bytes, m[1], productId + ext);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(file.getId()) + '&sz=w800';

    var sheet = getOrCreateProductPhotoSheet_();
    var row = findProductPhotoRow_(sheet, productId);
    var oldId = '';
    if (row > 0) oldId = toStr(sheet.getRange(row, 2).getValue());
    var values = [[productId, file.getId(), url, new Date()]];
    if (row > 0) sheet.getRange(row, 1, 1, 4).setValues(values);
    else sheet.getRange(sheet.getLastRow() + 1, 1, 1, 4).setValues(values);

    if (oldId && oldId !== file.getId()) {
      try { DriveApp.getFileById(oldId).setTrashed(true); } catch (ignore) {}
    }
    return { productId: productId, photoUrl: url };
  } finally {
    lock.releaseLock();
  }
}

function getProductPhotoMap_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCT_PHOTO_SHEET);
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  vals.forEach(function (r) {
    var id = toStr(r[0]);
    if (id) map[id] = { fileId: toStr(r[1]), url: toStr(r[2]) };
  });
  return map;
}

function getClinicOrderRuleMap_(clinic) {
  var map = {};
  var sheet = getInventorySheetOrThrow();
  if (sheet.getLastRow() < 2) return map;
  var vals = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var idx = inventoryHeaderIndex(vals[0]);
  for (var r = 1; r < vals.length; r++) {
    if (toStr(vals[r][idx.clinic]) !== clinic) continue;
    var mode = toStr(vals[r][idx.mode]);
    map[toStr(vals[r][idx.productId])] = {
      mode: mode,
      rule: mode === '発注トリガー管理' ? toStr(vals[r][idx.trigger]) : toStr(vals[r][idx.kijun])
    };
  }
  return map;
}

/** QR札画面から、管理方式に応じた発注基準を保存する。 */
function saveQrOrderRule(clinic, productId, rule) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('医院が指定されていません。');
  productId = toStr(productId);
  rule = toStr(rule);
  if (productId === '') throw new Error('商品が指定されていません。');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getInventorySheetOrThrow();
    var vals = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    var idx = inventoryHeaderIndex(vals[0]);
    var ri = -1;
    for (var r = 1; r < vals.length; r++) {
      if (toStr(vals[r][idx.clinic]) === clinic && toStr(vals[r][idx.productId]) === productId) { ri = r; break; }
    }
    if (ri < 0) throw new Error('医院別在庫に商品が見つかりません（' + clinic + ' / ' + productId + '）。');
    var mode = toStr(vals[ri][idx.mode]);
    if (mode === '数量管理') {
      if (rule !== '') {
        var n = Number(rule);
        if (isNaN(n) || n < 0 || Math.floor(n) !== n) throw new Error('数量管理の発注基準は0以上の整数で入力してください。');
        rule = n;
      }
      sheet.getRange(ri + 1, idx.kijun + 1).setValue(rule);
    } else if (mode === '発注トリガー管理') {
      if (rule.length > 60) throw new Error('発注する条件は60文字以内で入力してください。');
      sheet.getRange(ri + 1, idx.trigger + 1).setValue(rule);
    } else {
      throw new Error('管理方式が未設定の商品です。先に管理方式を設定してください。');
    }
    if (idx.updatedAt >= 0) sheet.getRange(ri + 1, idx.updatedAt + 1).setValue(new Date());
    SpreadsheetApp.flush();
    return { productId: productId, mode: mode, orderRule: toStr(rule) };
  } finally {
    lock.releaseLock();
  }
}

function getProductPhotoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PRODUCT_PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (ignore) {}
  }
  var folders = DriveApp.getFoldersByName(PRODUCT_PHOTO_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(PRODUCT_PHOTO_FOLDER);
  props.setProperty('PRODUCT_PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function getOrCreateProductPhotoSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PRODUCT_PHOTO_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PRODUCT_PHOTO_SHEET);
    sheet.getRange(1, 1, 1, PRODUCT_PHOTO_HEADERS.length).setValues([PRODUCT_PHOTO_HEADERS])
      .setFontWeight('bold').setBackground('#e8eef7');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findProductPhotoRow_(sheet, productId) {
  if (sheet.getLastRow() < 2) return -1;
  var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (toStr(vals[i][0]) === productId) return i + 2;
  return -1;
}

// ===== QR印刷済み管理（医院×商品。専用シートで管理し、医院別在庫の列は変更しない） =====

var QR_PRINTED_SHEET = 'QR印刷済み';
var QR_PRINTED_HEADERS = ['医院ID', '商品ID', '印刷日時'];

/** 指定医院で「印刷済み」にした商品IDの集合を返す。 */
function getQrPrintedSet_(clinic) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(QR_PRINTED_SHEET);
  var set = {};
  if (!sheet || sheet.getLastRow() < 2) return set;
  var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  vals.forEach(function (row) {
    if (toStr(row[0]) === clinic) set[toStr(row[1])] = true;
  });
  return set;
}

/**
 * 指定医院で、指定した商品IDを「印刷済み」にする（QrPrint.htmlのボタンから呼ぶ）。
 * 既に印刷済みのものは重複追加しない。
 * @param {string} clinic
 * @param {Array<string>} productIds
 * @return {{marked:number}}
 */
function markQrPrinted(clinic, productIds) {
  if (!clinic) throw new Error('医院が指定されていません。');
  productIds = (productIds || []).map(toStr).filter(function (s) { return s !== ''; });
  if (!productIds.length) return { marked: 0 };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(QR_PRINTED_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(QR_PRINTED_SHEET);
      sheet.getRange(1, 1, 1, QR_PRINTED_HEADERS.length)
        .setValues([QR_PRINTED_HEADERS]).setFontWeight('bold').setBackground('#e8eef7');
      sheet.setFrozenRows(1);
    }
    var existing = getQrPrintedSet_(clinic);
    var now = new Date();
    var rows = [];
    productIds.forEach(function (pid) {
      if (existing[pid]) return; // 重複防止
      rows.push([clinic, pid, now]);
    });
    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, QR_PRINTED_HEADERS.length).setValues(rows);
    }
    return { marked: rows.length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 指定医院の「印刷済み」を解除する（誤操作時の取消用）。
 * @param {string} clinic
 * @param {Array<string>} productIds
 * @return {{unmarked:number}}
 */
function unmarkQrPrinted(clinic, productIds) {
  if (!clinic) throw new Error('医院が指定されていません。');
  var idSet = {};
  (productIds || []).forEach(function (p) { idSet[toStr(p)] = true; });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(QR_PRINTED_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return { unmarked: 0 };
    var lastRow = sheet.getLastRow();
    var vals = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    var keepRows = [];
    var removed = 0;
    for (var i = 0; i < vals.length; i++) {
      var c = toStr(vals[i][0]), pid = toStr(vals[i][1]);
      if (c === clinic && idSet[pid]) { removed++; continue; }
      keepRows.push(vals[i]);
    }
    sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
    if (keepRows.length) sheet.getRange(2, 1, keepRows.length, 2).setValues(keepRows);
    return { unmarked: removed };
  } finally {
    lock.releaseLock();
  }
}

/** 指定医院の医院別在庫にある商品IDの集合を返す（QR発行の絞り込み用）。 */
function getClinicProductIdSet_(clinic) {
  var set = {};
  var invSheet = getInventorySheetOrThrow(); // usage.js（医院別在庫）
  var lastRow = invSheet.getLastRow();
  if (lastRow < 2) return set;
  var vals = invSheet.getRange(1, 1, lastRow, invSheet.getLastColumn()).getValues();
  var idx = inventoryHeaderIndex(vals[0]);
  for (var r = 1; r < vals.length; r++) {
    if (toStr(vals[r][idx.clinic]) === clinic) {
      var pid = toStr(vals[r][idx.productId]);
      if (pid !== '') set[pid] = true;
    }
  }
  return set;
}

/** 商品マスタのヘッダーから必要列インデックスを取得 */
function qrMasterHeaderIndex(headerRow) {
  function find(label, optional) {
    for (var i = 0; i < headerRow.length; i++) {
      if (toStr(headerRow[i]) === label) return i;
    }
    if (optional) return -1;
    throw new Error('商品マスタに列「' + label + '」が見つかりません。');
  }
  return {
    id: find('商品ID'),
    category: find('カテゴリ'),
    supplier: masterSupplierIndex_(headerRow), // 発注先（統合前は旧「メーカー」列）
    name: find('品名'),
    active: find('有効/無効', true)
  };
}
