/**
 * 商品マスタへの「オペ関連(ＰＶ)の金額」取り込み
 * ------------------------------------------------------------------
 * 目的（2026-08-22 ヒアリングで確定）:
 *   オペ関連(ＰＶ)シートには金額の列が2つある。
 *     O列「定価（税込み）」  … 定価
 *     P列「購入価格（40%off）」… 実際に医院が支払っている仕入れ値
 *   購入価格が入っていればそちらを、空欄なら定価を、その資材の金額として採用する。
 *
 * 税抜へ直してから入れる:
 *   他の資材（診療室・バー・薬・ＤＨ・訪問部）の金額は、商品マスタの「税抜価格」列に
 *   税抜で入っている。オペ関連のO/P列はどちらも税込のため（実データで
 *   購入価格＝定価×0.6 が一致することを確認済み）、そのまま入れると
 *   同じ列に税込と税抜が混ざり、資産評価額がずれる。
 *   ここで 税込 ÷ 1.1 の小数点切り捨て に直してから「税抜価格」列へ入れ、
 *   金額の置き場所と税の扱いを全資材でそろえる。
 *   取り込んだ後は、他の資材と同じように商品マスタ管理画面から編集できる。
 *
 * 安全設計（masterprice.js と同じ方針）:
 *   - 既に値が入っているセルは絶対に上書きしない（手入力を尊重する）。
 *     ＝空欄のセルを埋めるだけなので、何度実行しても結果は変わらない。
 *   - 書き込み前に件数を出して確認を取る。
 *   - 医院別シート（PV_在庫 等）には触らない。①の再実行も不要。
 *
 * 依存:
 *   master.js    … MASTER_SHEET_NAME / normalizeKey
 *   migration.js … OPE_PV_CONFIG / opePriceOf_ / cell / cellStr
 *   masterprice.js … PRICE_EX_TAX_HEADER
 *   usage.js     … writeSheetColumn_
 *   webapp.js    … toStr
 */

// 消費税率。税込しか金額を持たない資材を、商品マスタの「税抜価格」へそろえるときに使う。
var TAX_RATE = 0.1;

/**
 * 税込金額を税抜（小数点切り捨て）に直す。
 * 読み取れない値は '' を返す（＝取り込まない）。
 *
 * 割ってすぐ切り捨ててはいけない理由:
 *   1100 / 1.1 は計算上 999.9999999999999 になるため、そのまま切り捨てると
 *   本来1000円のものが999円になる（2200→1999、110→99 も同様）。
 *   いったん小数第6位で丸めて計算誤差を落としてから切り捨てる。
 *
 * @param {(number|string)} incTax
 * @return {(number|string)} 税抜金額、または ''（金額として読めない）
 */
function toExTaxFloor_(incTax) {
  var n = Number(incTax);
  if (toStr(incTax) === '' || isNaN(n) || n < 0) return '';
  var exact = n / (1 + TAX_RATE);
  return Math.floor(Math.round(exact * 1000000) / 1000000);
}

/**
 * メニュー「オペ関連の金額を商品マスタに取り込む」。
 * 購入価格（無ければ定価）を税抜に直して、商品マスタの税抜価格が空欄の行にだけ流し込む。
 */
function importOpePriceToMaster() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!sheet) {
    ui.alert(MASTER_SHEET_NAME + ' シートがありません。処理を中止しました。');
    return;
  }

  var lookup = buildOpePriceLookup_();
  var found = Object.keys(lookup.priceByKey).length;
  if (found === 0) {
    ui.alert('「' + OPE_PV_CONFIG.sheetName + '」シートから金額を1件も読み取れませんでした。\n' +
      '処理を中止しました。');
    return;
  }

  var plan = applyOpePrice_(sheet, lookup.priceByKey, true);
  if (plan.filled === 0) {
    ui.alert('取り込める金額はありませんでした。\n\n' +
      '・入力済みのため対象外：' + plan.already + '件\n' +
      '・オペ関連シートに該当が無い：' + plan.notFound + '件');
    return;
  }

  var proceed = ui.alert(
    'オペ関連の金額を取り込みます',
    '「' + OPE_PV_CONFIG.sheetName + '」から読み取れた金額：' + found + '種類\n' +
    '　（うち購入価格を採用：' + lookup.purchaseCount + '件／定価を採用：' + lookup.listCount + '件）\n\n' +
    '金額は税込のため、÷1.1 の小数点切り捨てで税抜に直して\n' +
    '「' + PRICE_EX_TAX_HEADER + '」列へ入れます（他の資材と同じ扱いになります）。\n\n' +
    '・これから埋める（税抜価格が空欄）：' + plan.filled + '件\n' +
    '・入力済みのため触らない：' + plan.already + '件\n' +
    '・オペ関連シートに該当が無い：' + plan.notFound + '件\n\n' +
    '空欄のセルだけを埋めます。入力済みの値は上書きしません。\n' +
    '実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (proceed !== ui.Button.YES) {
    ui.alert('中止しました。商品マスタは変更していません。');
    return;
  }

  var result;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    result = applyOpePrice_(sheet, lookup.priceByKey, false);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  ui.alert('完了しました。\n\n' +
    '・取り込んだ金額：' + result.filled + '件\n' +
    '・入力済みのため触らなかった：' + result.already + '件\n' +
    '・該当が無かった：' + result.notFound + '件');
}

/**
 * オペ関連(ＰＶ)シートから「カテゴリ＋発注先＋品名」→ 金額 のマップを作る。
 * 品名は migration.js と同じルール（規格があれば「品名（規格）」）で組み立てる。
 * 同じキーが複数行にある場合は先に出てきた行を採用する。
 * @return {{priceByKey:Object, purchaseCount:number, listCount:number}}
 */
function buildOpePriceLookup_() {
  var cfg = OPE_PV_CONFIG;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(cfg.sheetName);
  var out = { priceByKey: {}, purchaseCount: 0, listCount: 0 };
  if (!sheet) return out;

  var lastRow = sheet.getLastRow();
  if (lastRow < cfg.dataStart) return out;

  var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  for (var r = cfg.dataStart - 1; r < values.length; r++) {
    var row = values[r];
    var baseName = cellStr(row, cfg.colName);
    if (baseName === '') continue;

    var spec = cellStr(row, cfg.colSpec).replace(/\n/g, ' ');
    var name = spec ? baseName + '（' + spec + '）' : baseName;
    var price = opePriceOf_(row);
    if (toStr(price) === '') continue;

    // カテゴリはシート名（migration.js が商品マスタへそう入れている）
    var key = normalizeKey(cfg.sheetName, cellStr(row, cfg.colMaker), name);
    if (out.priceByKey.hasOwnProperty(key)) continue;
    out.priceByKey[key] = price;
    if (toStr(cell(row, cfg.colPurchasePrice)) !== '') out.purchaseCount++;
    else out.listCount++;
  }
  return out;
}

/**
 * 商品マスタの空欄の「税抜価格」を、lookup の金額を税抜に直して埋める。
 * @param {Sheet} sheet 商品マスタ
 * @param {Object} priceByKey buildOpePriceLookup_().priceByKey（税込金額）
 * @param {boolean} dryRun true なら件数を数えるだけで書き込まない
 * @return {{filled:number, already:number, notFound:number}}
 */
function applyOpePrice_(sheet, priceByKey, dryRun) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { filled: 0, already: 0, notFound: 0 };

  var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var header = values[0];
  var idId = header.indexOf('商品ID');
  var idCat = header.indexOf('カテゴリ');
  var idSupplier = masterSupplierIndex_(header); // 発注先（統合前は旧「メーカー」列）
  var idName = header.indexOf('品名');
  var idPrice = header.indexOf(PRICE_EX_TAX_HEADER); // masterprice.js：'税抜価格'
  if (idId < 0 || idCat < 0 || idSupplier < 0 || idName < 0 || idPrice < 0) {
    throw new Error('商品マスタの列（商品ID／カテゴリ／発注先／品名／' +
      PRICE_EX_TAX_HEADER + '）が見つかりません。\n' +
      '「' + PRICE_EX_TAX_HEADER + '」列が無い場合は、先に「商品マスタに税抜価格を取り込む」を実行してください。');
  }

  var filled = 0, already = 0, notFound = 0;
  for (var r = 1; r < values.length; r++) {
    if (toStr(values[r][idId]) === '') continue;
    // オペ関連カテゴリの商品だけが対象（他カテゴリはこのシートに載っていない）
    if (toStr(values[r][idCat]) !== OPE_PV_CONFIG.sheetName) continue;

    if (toStr(values[r][idPrice]) !== '') { already++; continue; } // 入力済みは触らない

    var key = normalizeKey(toStr(values[r][idCat]), toStr(values[r][idSupplier]), toStr(values[r][idName]));
    if (!priceByKey.hasOwnProperty(key)) { notFound++; continue; }

    var exTax = toExTaxFloor_(priceByKey[key]);
    if (exTax === '') { notFound++; continue; } // 金額として読めない記入
    values[r][idPrice] = exTax;
    filled++;
  }

  if (!dryRun && filled > 0) writeSheetColumn_(sheet, values, idPrice); // usage.js
  return { filled: filled, already: already, notFound: notFound };
}
