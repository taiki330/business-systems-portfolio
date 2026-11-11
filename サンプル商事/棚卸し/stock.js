/**
 * 現在庫一覧・検索（サーバーサイド）
 * ------------------------------------------------------------------
 * 目的（要件定義書 10.6）:
 *   医院別・商品別の現在庫を一覧表示し、商品名・カテゴリで検索・絞り込みできるようにする。
 *
 * 依存:
 *   master.js  … MASTER_SHEET_NAME / INVENTORY_SHEET_NAME
 *   migration.js … CLINICS
 *
 * 性能方針:
 *   「読み込み過多を避け医院別に絞り込む」（要件10.6異常系）ため、
 *   常に医院を1つ指定した状態で取得する（全医院一括取得は行わない）。
 */

/**
 * 資材1つぶんの評価単価（税抜）を求める。
 *
 * 金額は資材の種類によらず、商品マスタの「税抜価格」1か所に集約している。
 * 元シートが税込しか持たないオペ関連(ＰＶ)についても、opeprice.js が取り込みのときに
 * 税抜へ直して同じ列に入れる。ここで税の種類を場合分けしないのは、同じ列に
 * 税込と税抜が混ざると資産評価額が静かにずれるため。
 * 未設定なら null（金額不明）を返す。
 *
 * @param {Object} m getMasterInfoMap() の1商品ぶん
 * @return {(number|null)}
 */
function unitPriceExTax_(m) {
  if (toStr(m.priceExTax) === '') return null;
  var n = Number(m.priceExTax);
  return isNaN(n) ? null : n;
}

/**
 * 指定医院の現在庫一覧を返す。
 * 商品マスタ（カテゴリ・税抜価格）と医院別在庫（現在庫・未入荷・管理方式・発注基準）を結合する。
 * 評価額は税抜価格ベース。「評価単価（税込）」は運用しないため参照しない。
 * @param {string} clinic
 * @return {{clinic:string, items:Array, summary:Object}}
 */
function getStockList(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);

  var masterMap = getMasterInfoMap(); // productId -> {category, supplier, name, priceExTax, active}

  var invSheet = getInventorySheetOrThrow();
  var invLastRow = invSheet.getLastRow();
  var invLastCol = invSheet.getLastColumn();
  if (invLastRow < 2) return { clinic: clinic, items: [], summary: emptySummary() };

  var invValues = invSheet.getRange(1, 1, invLastRow, invLastCol).getValues();
  var invIdx = inventoryHeaderIndex(invValues[0]);

  var items = [];
  for (var r = 1; r < invValues.length; r++) {
    var row = invValues[r];
    if (toStr(row[invIdx.clinic]) !== clinic) continue;
    var pid = toStr(row[invIdx.productId]);
    if (pid === '') continue;

    var mode = toStr(row[invIdx.mode]);
    var m = masterMap[pid] || {};
    var kijun = toStr(row[invIdx.kijun]);
    var openQty = numOrZero(row[invIdx.openQty]);

    var item = {
      productId: pid,
      name: toStr(row[invIdx.name]) || m.name || '',
      category: m.category || '',
      supplier: m.supplier || '',
      mode: mode,
      openQty: openQty,
      kijun: kijun
    };

    if (mode === '発注トリガー管理') {
      item.stock = null; // 管理対象外
      item.status = '管理対象外';
      item.valuation = null;
    } else {
      var stock = numOrZero(row[invIdx.stock]);
      item.stock = stock;
      item.status = deriveStatus(stock, openQty, kijun);
      // 単価は税抜価格を使う（商品マスタ管理画面で入力・ソースシートから取り込む項目）。
      // 「評価単価（税込）」は当面運用しないため、評価額の計算には使わない。
      item.unitPrice = unitPriceExTax_(m);
      item.valuation = (item.unitPrice !== null) ? item.unitPrice * stock : 0;
    }
    items.push(item);
  }

  return { clinic: clinic, items: items, summary: buildSummary(items) };
}

/** 在庫状態を判定する（要件15.4：マイナス許容＋警告／15.5：発注基準判定） */
function deriveStatus(stock, openQty, kijunStr) {
  if (stock < 0) return 'マイナス';
  if (kijunStr !== '') {
    var kijun = Number(kijunStr);
    if (!isNaN(kijun) && (stock + openQty) <= kijun) return '在庫不足';
  }
  return '正常';
}

function buildSummary(items) {
  var s = emptySummary();
  items.forEach(function (it) {
    s.count++;
    if (it.status === '在庫不足') s.lowStockCount++;
    if (it.status === 'マイナス') s.negativeCount++;
    if (typeof it.valuation === 'number') s.totalValuation += it.valuation;
  });
  return s;
}

function emptySummary() {
  return { count: 0, lowStockCount: 0, negativeCount: 0, totalValuation: 0 };
}

/** 商品マスタから 商品ID -> {category, supplier, name, priceExTax, active} のマップを作る */
function getMasterInfoMap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var header = values[0];
  var idId = header.indexOf('商品ID');
  var idCategory = header.indexOf('カテゴリ');
  var idSupplier = masterSupplierIndex_(header); // 発注先（統合前は旧「メーカー」列）
  var idName = header.indexOf('品名');
  var idPriceExTax = header.indexOf('税抜価格');
  var idActive = header.indexOf('有効/無効');
  for (var r = 1; r < values.length; r++) {
    var pid = toStr(values[r][idId]);
    if (pid === '') continue;
    map[pid] = {
      category: toStr(values[r][idCategory]),
      supplier: idSupplier >= 0 ? toStr(values[r][idSupplier]) : '',
      name: toStr(values[r][idName]),
      priceExTax: idPriceExTax >= 0 ? toStr(values[r][idPriceExTax]) : '',
      active: toStr(values[r][idActive])
    };
  }
  return map;
}
