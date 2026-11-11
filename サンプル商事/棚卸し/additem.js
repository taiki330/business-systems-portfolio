/**
 * 運用中の資材追加（②各医院ページからの資材追加・サーバーサイド）
 * ------------------------------------------------------------------
 * 目的:
 *   本番稼働後に、各医院ページから新しい資材を1件だけ追加する。
 *   書き込み先は運用データ（商品マスタ＋医院別在庫）。
 *
 * 重要:
 *   master.js の generateMasterAndInventory は全商品IDを振り直すため本番稼働後は使えない。
 *   ここでは再統合せず「既存の最大ID＋1」で採番して1件だけ追記する。
 *
 * 挙動:
 *   - 同一資材（カテゴリ＋発注先＋品名）が商品マスタに既にあれば、その商品IDを再利用し
 *     商品マスタには追加しない（＝医院間で商品マスタは共有）。医院別在庫にその医院の行を足す。
 *   - 無ければ商品マスタに新規1行＋医院別在庫にその医院の行を足す。
 *   - 追加後、その商品のQR（URL形式）を返し、画面でその場で表示・印刷できる。
 *
 * 依存:
 *   master.js  … MASTER_SHEET_NAME / INVENTORY_SHEET_NAME / EXPIRY_MANAGED_NO / normalizeKey
 *   usage.js   … inventoryHeaderIndex
 *   qr.js      … qrTextForProduct / qrImageUrl / getWebAppBaseUrl
 *   migration.js … CLINICS
 */

/**
 * 各医院ページから資材を1件追加する。
 * @param {string} clinic 医院コード
 * @param {{category:string, supplier:string, name:string, mode:string,
 *          kijun:(string|number), stock:(string|number), price:(string|number)}} item
 * @return {{productId:string, name:string, createdMaster:boolean, reused:boolean,
 *           deployed:boolean, qrText:string, qrImageUrl:string}}
 */
function addProductForClinic(clinic, item) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);

  var name = toStr(item && item.name);
  if (name === '') throw new Error('品名を入力してください。');
  var category = toStr(item.category);
  var supplier = toStr(item.supplier);

  var mode = toStr(item.mode);
  if (mode !== '数量管理' && mode !== '発注トリガー管理') {
    throw new Error('管理方式は「数量管理」か「発注トリガー管理」を選んでください。');
  }
  // 発注基準数は数量管理のみ。初期在庫・評価単価は空欄可・0以上の数値。
  var kijun = (mode === '数量管理') ? normalizeNonNeg_(item.kijun, '発注基準数') : '';
  var stock = normalizeNonNeg_(item.stock, '初期在庫数');
  var price = normalizeNonNeg_(item.price, '税抜価格');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var masterSheet = ss.getSheetByName(MASTER_SHEET_NAME);
    var invSheet = ss.getSheetByName(INVENTORY_SHEET_NAME);
    if (!masterSheet || !invSheet) {
      throw new Error('商品マスタ／医院別在庫がまだありません。\n' +
        '先に「棚卸しツール →② 商品マスタ・医院別在庫を生成」を実行してください。');
    }

    // --- 商品マスタ：既存の同一資材を探しつつ最大IDを求める ---
    var mCols = masterSheet.getLastColumn();
    var mLast = masterSheet.getLastRow();
    var mValues = masterSheet.getRange(1, 1, mLast, mCols).getValues();
    var mIdx = addItemMasterIndex_(mValues[0]);

    var targetKey = normalizeKey(category, supplier, name);
    var productId = '';
    var maxSeq = 0;
    for (var r = 1; r < mValues.length; r++) {
      var mrow = mValues[r];
      var id = toStr(mrow[mIdx.id]);
      if (id === '') continue;
      var mm = id.match(/^P(\d+)$/);
      if (mm) { var seq = parseInt(mm[1], 10); if (seq > maxSeq) maxSeq = seq; }
      if (normalizeKey(toStr(mrow[mIdx.category]), toStr(mrow[mIdx.supplier]), toStr(mrow[mIdx.name])) === targetKey) {
        productId = id; // 既存を再利用（商品マスタには足さない）
      }
    }

    var createdMaster = false;
    if (productId === '') {
      productId = 'P' + ('0000' + (maxSeq + 1)).slice(-4);
      // MASTER_HEADERS の並びに合わせて、列インデックスで値を置く
      var masterRow = buildRowByIndex_(mCols, [
        { col: mIdx.id, val: productId },
        { col: mIdx.category, val: category },
        { col: mIdx.supplier, val: supplier },
        { col: mIdx.name, val: name },
        { col: mIdx.priceExTax, val: (price === '' ? '' : price) },
        { col: mIdx.active, val: '有効' },
        { col: mIdx.expiryManaged, val: EXPIRY_MANAGED_NO }
      ]);
      masterSheet.appendRow(masterRow);
      createdMaster = true;
    }

    // --- 医院別在庫：この医院に同じ商品が無いか確認して追加 ---
    var iCols = invSheet.getLastColumn();
    var iLast = invSheet.getLastRow();
    var iValues = invSheet.getRange(1, 1, iLast, iCols).getValues();
    var iIdx = inventoryHeaderIndex(iValues[0]);

    for (var r2 = 1; r2 < iValues.length; r2++) {
      if (toStr(iValues[r2][iIdx.clinic]) === clinic &&
          toStr(iValues[r2][iIdx.productId]) === productId) {
        throw new Error('この資材は既にこの医院の在庫にあります（' + name + '）。');
      }
    }

    var invRow = buildRowByIndex_(iCols, [
      { col: iIdx.clinic, val: clinic },
      { col: iIdx.productId, val: productId },
      { col: iIdx.name, val: name },
      { col: iIdx.mode, val: mode },
      { col: iIdx.kijun, val: kijun },
      { col: iIdx.trigger, val: '' },
      // 発注トリガー管理は在庫数を持たない（管理対象外）。数量管理は初期在庫（空欄は0）。
      { col: iIdx.stock, val: (mode === '発注トリガー管理') ? '（管理対象外）' : (stock === '' ? 0 : stock) },
      { col: iIdx.openQty, val: 0 },
      { col: iIdx.expiry, val: '' },
      { col: iIdx.updatedAt, val: new Date() }
    ]);
    invSheet.appendRow(invRow);

    // --- QR（URL形式）を返す。未デプロイだとURLが空になるため deployed で知らせる ---
    var base = getWebAppBaseUrl();
    var qrText = qrTextForProduct(productId);
    return {
      productId: productId,
      name: name,
      createdMaster: createdMaster,
      reused: !createdMaster,
      deployed: base !== '',
      qrText: qrText,
      qrImageUrl: (base !== '') ? qrImageUrl(qrText, 220) : ''
    };
  } finally {
    lock.releaseLock();
  }
}

/** 商品マスタのヘッダーから列インデックスを取得（商品マスタ専用） */
function addItemMasterIndex_(headerRow) {
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
    priceExTax: find('税抜価格', true),
    active: find('有効/無効', true),
    expiryManaged: find('使用期限管理', true)
  };
}

/** 空欄は許容し、値があれば0以上の数値で返す。 */
function normalizeNonNeg_(v, label) {
  var s = toStr(v);
  if (s === '') return '';
  var n = Number(s);
  if (isNaN(n) || n < 0) {
    throw new Error(label + 'は0以上の数値で入力してください（入力値: ' + s + '）。');
  }
  return n;
}

/** 指定列数の空行を作り、{col,val} の指定だけ埋めて返す（col<0は無視）。 */
function buildRowByIndex_(numCols, assignments) {
  var row = [];
  for (var c = 0; c < numCols; c++) row.push('');
  assignments.forEach(function (a) {
    if (a.col >= 0 && a.col < numCols) row[a.col] = a.val;
  });
  return row;
}
