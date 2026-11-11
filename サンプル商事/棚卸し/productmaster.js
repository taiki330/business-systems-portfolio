/**
 * 商品マスタ管理（サーバーサイド・要件10.1）
 * ------------------------------------------------------------------
 * 目的:
 *   商品マスタの各項目（評価単価・発注先・標準発注数量・使用期限管理・備考、
 *   およびカテゴリ・品名の訂正）をブラウザで編集する。
 *   「メーカー」は実態が発注先だったため列ごと廃止し、「発注先」1本に統一している
 *   （master.js の冒頭コメント参照）。
 *   （有効/無効は運用上使わない方針のため編集対象外。列自体は残るが常に「有効」のまま）
 *   これにより 資産評価額（単価）／期限アラート（使用期限管理）／発注（発注先・標準数量）
 *   が本来の精度で機能するようになる。
 *
 * 方針:
 *   - 既存商品の編集のみ（新規追加は addItem.js の②を使う）。商品IDは変更しない。
 *   - 変更した行の編集セルだけを更新（管理者向け・低頻度なので行単位の上書きで十分）。
 *   - 品名を変更したら、医院別在庫の「品名（参考）」も同期してズレを防ぐ。
 *   - LockService で直列化し、ロック解放前に flush()。
 *
 * 依存:
 *   master.js  … MASTER_SHEET_NAME / INVENTORY_SHEET_NAME / EXPIRY_MANAGED_YES / EXPIRY_MANAGED_NO
 *   usage.js   … getInventorySheetOrThrow / inventoryHeaderIndex
 *   webapp.js  … toStr
 */

/**
 * 商品マスタ全件（編集対象項目）を返す。
 * @return {{items:Array}}
 */
function getProductMaster() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!sheet) {
    throw new Error(MASTER_SHEET_NAME + ' シートがありません。先に「② 商品マスタ・医院別在庫を生成」を実行してください。');
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { items: [] };

  var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var idx = productMasterIndex_(values[0]);

  var items = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var id = toStr(row[idx.id]);
    if (id === '') continue;
    items.push({
      productId: id,
      category: idx.category >= 0 ? toStr(row[idx.category]) : '',
      name: toStr(row[idx.name]),
      priceExTax: idx.priceExTax >= 0 ? toStr(row[idx.priceExTax]) : '',
      price: idx.price >= 0 ? toStr(row[idx.price]) : '',
      supplier: idx.supplier >= 0 ? toStr(row[idx.supplier]) : '',
      standardQty: idx.standardQty >= 0 ? toStr(row[idx.standardQty]) : '',
      expiryManaged: idx.expiryManaged >= 0 ? toStr(row[idx.expiryManaged]) : '',
      note: idx.note >= 0 ? toStr(row[idx.note]) : ''
    });
  }
  return { items: items };
}

/**
 * 商品マスタに登録済みの発注先を、重複を除いて五十音順で返す。
 * 画面の発注先プルダウンの選択肢に使う。「その他」で入力された新しい発注先も、
 * 保存されて商品マスタに載った時点でこの一覧に自動的に加わる。
 * @return {Array<string>}
 */
function getSupplierOptions() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var col = masterSupplierIndex_(values[0]);
  if (col < 0) return [];
  var set = {};
  for (var r = 1; r < values.length; r++) {
    var s = toStr(values[r][col]);
    if (s !== '') set[s] = true;
  }
  return Object.keys(set).sort();
}

/**
 * 変更した商品を保存する。changes は変更のあった行のみ。
 * @param {Array<Object>} changes 各要素: {productId, category, name, price, supplier, standardQty, expiryManaged, note}
 * @return {{saved:number}}
 */
function saveProductMaster(changes) {
  changes = (changes || []).filter(function (c) { return toStr(c.productId) !== ''; });
  if (!changes.length) return { saved: 0 };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
    if (!sheet) throw new Error(MASTER_SHEET_NAME + ' シートがありません。');
    var lastRow = sheet.getLastRow();
    var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
    var idx = productMasterIndex_(values[0]);

    // 商品ID -> 行index
    var rowOf = {};
    for (var r = 1; r < values.length; r++) {
      var id = toStr(values[r][idx.id]);
      if (id !== '') rowOf[id] = r;
    }

    // 先に全件バリデーション（部分更新を防ぐ）
    var plans = [];
    changes.forEach(function (c) {
      var pid = toStr(c.productId);
      var ri = rowOf[pid];
      if (ri === undefined) throw new Error('商品マスタに商品が見つかりません（' + pid + '）。');
      var name = toStr(c.name);
      if (name === '') throw new Error('品名は必須です（' + pid + '）。');
      var priceExTax = normNonNeg_(c.priceExTax, '税抜価格', pid);
      // 評価単価（税込）は画面から編集しなくなったため、送られてこない＝触らない。
      // ここで normNonNeg_ を通すと '' になり、既に入っている評価単価を消してしまう。
      var hasPrice = Object.prototype.hasOwnProperty.call(c, 'price');
      var price = hasPrice ? normNonNeg_(c.price, '評価単価', pid) : null;
      var stdQty = normNonNeg_(c.standardQty, '標準発注数量', pid);
      var exp = toStr(c.expiryManaged);
      if (exp !== '' && exp !== EXPIRY_MANAGED_YES && exp !== EXPIRY_MANAGED_NO) {
        throw new Error('使用期限管理は「' + EXPIRY_MANAGED_YES + '」か「' + EXPIRY_MANAGED_NO + '」で指定してください（' + pid + '）。');
      }
      plans.push({
        ri: ri, pid: pid, oldName: toStr(values[ri][idx.name]), name: name,
        category: toStr(c.category),
        priceExTax: priceExTax, price: price, supplier: toStr(c.supplier), standardQty: stdQty,
        expiryManaged: exp, note: toStr(c.note)
      });
    });

    // 書き込み（編集セルのみ）
    var nameChanged = {}; // productId -> newName（品名が変わったもの）
    plans.forEach(function (p) {
      setCellIf_(sheet, p.ri, idx.category, p.category);
      setCellIf_(sheet, p.ri, idx.name, p.name);
      setCellIf_(sheet, p.ri, idx.priceExTax, p.priceExTax);
      if (p.price !== null) setCellIf_(sheet, p.ri, idx.price, p.price);
      setCellIf_(sheet, p.ri, idx.supplier, p.supplier);
      setCellIf_(sheet, p.ri, idx.standardQty, p.standardQty);
      setCellIf_(sheet, p.ri, idx.expiryManaged, p.expiryManaged);
      setCellIf_(sheet, p.ri, idx.note, p.note);
      if (p.name !== p.oldName) nameChanged[p.pid] = p.name;
    });

    // 品名を変えたら、医院別在庫の「品名（参考）」も同期する（ズレ防止）
    if (Object.keys(nameChanged).length) syncInventoryNames_(nameChanged);

    SpreadsheetApp.flush();
    return { saved: plans.length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 事務用：商品マスタへ新規資材を登録し、選択した医院へ配布する。
 * 配布先の医院別在庫には「未設定・在庫0」で行を作るため、各院は Index で
 * 管理方式と発注基準数だけを決めればよい。既存の同一商品を選んだ場合は、
 * マスタを重複作成せず、未配布の医院への配布だけを行う。
 * @param {{category:string,name:string,price:(string|number),supplier:string,
 *          standardQty:(string|number),expiryManaged:string,note:string}} item
 * @param {Array<string>} clinics 配布先医院コード
 * @return {{productId:string,name:string,createdMaster:boolean,addedClinics:Array<string>,alreadyDistributed:Array<string>}}
 */
function addProductAndDistribute(item, clinics) {
  item = item || {};
  var name = toStr(item.name);
  if (name === '') throw new Error('品名を入力してください。');
  clinics = (clinics || []).filter(function (c, i, a) {
    return CLINICS.indexOf(c) >= 0 && a.indexOf(c) === i;
  });
  if (!clinics.length) throw new Error('配布先医院を1院以上選んでください。');

  var category = toStr(item.category);
  var supplier = toStr(item.supplier);
  var priceExTax = normNonNeg_(item.priceExTax, '税抜価格', name);
  var price = normNonNeg_(item.price, '評価単価', name);
  var standardQty = normNonNeg_(item.standardQty, '標準発注数量', name);
  var expiryManaged = toStr(item.expiryManaged) || EXPIRY_MANAGED_NO;
  if (expiryManaged !== EXPIRY_MANAGED_YES && expiryManaged !== EXPIRY_MANAGED_NO) {
    throw new Error('使用期限管理は「要」または「不要」を指定してください。');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var masterSheet = ss.getSheetByName(MASTER_SHEET_NAME);
    var invSheet = getInventorySheetOrThrow();
    if (!masterSheet) throw new Error(MASTER_SHEET_NAME + ' シートがありません。');
    var masterVals = masterSheet.getRange(1, 1, masterSheet.getLastRow(), masterSheet.getLastColumn()).getValues();
    var mIdx = productMasterIndex_(masterVals[0]);
    var targetKey = normalizeKey(category, supplier, name);
    var productId = '';
    var maxSeq = 0;
    for (var r = 1; r < masterVals.length; r++) {
      var row = masterVals[r];
      var id = toStr(row[mIdx.id]);
      var match = id.match(/^P(\d+)$/);
      if (match) maxSeq = Math.max(maxSeq, Number(match[1]));
      if (normalizeKey(toStr(row[mIdx.category]), toStr(row[mIdx.supplier]), toStr(row[mIdx.name])) === targetKey) productId = id;
    }

    var createdMaster = productId === '';
    if (createdMaster) {
      productId = 'P' + ('0000' + (maxSeq + 1)).slice(-4);
      var newRow = productMasterBuildRow_(masterSheet.getLastColumn(), mIdx, {
        id: productId, category: category, name: name,
        priceExTax: priceExTax, price: price,
        supplier: supplier, standardQty: standardQty,
        expiryManaged: expiryManaged, note: toStr(item.note)
      });
      masterSheet.appendRow(newRow);
    }

    var invVals = invSheet.getRange(1, 1, invSheet.getLastRow(), invSheet.getLastColumn()).getValues();
    var iIdx = inventoryHeaderIndex(invVals[0]);
    var exists = {};
    for (var ir = 1; ir < invVals.length; ir++) {
      if (toStr(invVals[ir][iIdx.productId]) === productId) exists[toStr(invVals[ir][iIdx.clinic])] = true;
    }
    var addedClinics = [], alreadyDistributed = [];
    clinics.forEach(function (clinic) {
      if (exists[clinic]) { alreadyDistributed.push(clinic); return; }
      var invRow = productMasterInventoryRow_(invSheet.getLastColumn(), iIdx, clinic, productId, name);
      invSheet.appendRow(invRow);
      addedClinics.push(clinic);
    });
    SpreadsheetApp.flush();
    return { productId: productId, name: name, createdMaster: createdMaster,
      addedClinics: addedClinics, alreadyDistributed: alreadyDistributed };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 商品マスタに既にある商品を、選択した医院の医院別在庫へ追加する。
 * 商品マスタは変更せず、追加済みの医院には重複行を作らない。
 * @param {string} productId
 * @param {Array<string>} clinics
 * @return {{productId:string,name:string,addedClinics:Array<string>,alreadyDistributed:Array<string>}}
 */
function distributeExistingProduct(productId, clinics) {
  productId = toStr(productId);
  if (productId === '') throw new Error('商品が指定されていません。');
  clinics = (clinics || []).filter(function (c, i, a) {
    return CLINICS.indexOf(c) >= 0 && a.indexOf(c) === i;
  });
  if (!clinics.length) throw new Error('配布先医院を1院以上選んでください。');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var masterSheet = ss.getSheetByName(MASTER_SHEET_NAME);
    var invSheet = getInventorySheetOrThrow();
    if (!masterSheet) throw new Error(MASTER_SHEET_NAME + ' シートがありません。');

    var masterVals = masterSheet.getRange(1, 1, masterSheet.getLastRow(), masterSheet.getLastColumn()).getValues();
    var mIdx = productMasterIndex_(masterVals[0]);
    var name = '';
    for (var r = 1; r < masterVals.length; r++) {
      if (toStr(masterVals[r][mIdx.id]) === productId) { name = toStr(masterVals[r][mIdx.name]); break; }
    }
    if (name === '') throw new Error('商品マスタに商品が見つかりません（' + productId + '）。');

    var invVals = invSheet.getRange(1, 1, invSheet.getLastRow(), invSheet.getLastColumn()).getValues();
    var iIdx = inventoryHeaderIndex(invVals[0]);
    var exists = {};
    for (var ir = 1; ir < invVals.length; ir++) {
      if (toStr(invVals[ir][iIdx.productId]) === productId) exists[toStr(invVals[ir][iIdx.clinic])] = true;
    }

    var addedClinics = [], alreadyDistributed = [];
    clinics.forEach(function (clinic) {
      if (exists[clinic]) { alreadyDistributed.push(clinic); return; }
      invSheet.appendRow(productMasterInventoryRow_(invSheet.getLastColumn(), iIdx, clinic, productId, name));
      addedClinics.push(clinic);
    });
    SpreadsheetApp.flush();
    return { productId: productId, name: name, addedClinics: addedClinics, alreadyDistributed: alreadyDistributed };
  } finally {
    lock.releaseLock();
  }
}

/* ===== ヘルパー ===== */

function productMasterIndex_(header) {
  function find(label, optional) {
    for (var i = 0; i < header.length; i++) if (toStr(header[i]) === label) return i;
    if (optional) return -1;
    throw new Error('商品マスタに列「' + label + '」が見つかりません。');
  }
  return {
    id: find('商品ID'),
    category: find('カテゴリ', true),
    name: find('品名'),
    priceExTax: find('税抜価格', true),
    price: find('評価単価（税込）', true),
    // 発注先。統合前のシートでは旧「メーカー」列を指す（master.js）。
    supplier: masterSupplierIndex_(header),
    standardQty: find('標準発注数量', true),
    expiryManaged: find('使用期限管理', true),
    note: find('備考', true)
  };
}

function productMasterBuildRow_(width, idx, fields) {
  var row = Array(width).fill('');
  function put(col, value) { if (col >= 0) row[col] = value; }
  put(idx.id, fields.id); put(idx.category, fields.category);
  put(idx.name, fields.name); put(idx.priceExTax, fields.priceExTax);
  put(idx.price, fields.price); put(idx.supplier, fields.supplier);
  put(idx.standardQty, fields.standardQty); put(idx.expiryManaged, fields.expiryManaged); put(idx.note, fields.note);
  return row;
}

function productMasterInventoryRow_(width, idx, clinic, productId, name) {
  var row = Array(width).fill('');
  function put(col, value) { if (col >= 0) row[col] = value; }
  put(idx.clinic, clinic); put(idx.productId, productId); put(idx.name, name);
  put(idx.mode, ''); put(idx.kijun, ''); put(idx.trigger, ''); put(idx.stock, 0);
  put(idx.openQty, 0); put(idx.expiry, ''); put(idx.updatedAt, new Date());
  return row;
}

/** 列が存在する場合のみセルを設定（0始まりcol。-1は無視）。ri は values内index（0=ヘッダー）。 */
function setCellIf_(sheet, ri, col0, val) {
  if (col0 < 0) return;
  sheet.getRange(ri + 1, col0 + 1).setValue(val);
}

/** 空欄可・0以上の数値のみ許可。文字列で返す（マスタは文字/数値どちらでも保持）。 */
function normNonNeg_(v, label, pid) {
  var s = toStr(v);
  if (s === '') return '';
  var n = Number(s);
  if (isNaN(n) || n < 0) throw new Error(label + 'は0以上の数値で入力してください（' + pid + '：' + s + '）。');
  return n;
}

/** 医院別在庫の「品名（参考）」を、指定productIdの新品名に揃える。 */
function syncInventoryNames_(nameChanged) {
  var invSheet = getInventorySheetOrThrow();
  var lastRow = invSheet.getLastRow();
  if (lastRow < 2) return;
  var vals = invSheet.getRange(1, 1, lastRow, invSheet.getLastColumn()).getValues();
  var idx = inventoryHeaderIndex(vals[0]);
  for (var r = 1; r < vals.length; r++) {
    var pid = toStr(vals[r][idx.productId]);
    if (nameChanged.hasOwnProperty(pid)) {
      invSheet.getRange(r + 1, idx.name + 1).setValue(nameChanged[pid]);
    }
  }
}
