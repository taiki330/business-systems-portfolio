/**
 * 商品マスタへの「税抜価格」取り込み
 * ------------------------------------------------------------------
 * 目的:
 *   税抜価格は、元のカテゴリシート（診療室／バー／薬／ＤＨ）の共通列に入っている。
 *   医院をまたいで同じ値＝資材そのものの価格なので、置き場所は商品マスタが正しい。
 *   ここでは稼働中の商品マスタに「税抜価格」列を足し、ソースシートから値を移す。
 *
 * 安全設計:
 *   - 既に「税抜価格」列があれば作らない（何度実行しても列は増えない）。
 *   - 既に値が入っているセルは絶対に上書きしない（手入力を尊重する）。
 *     ＝空欄のセルを埋めるだけなので、何度実行しても結果は変わらない。
 *   - 書き込み前に件数を出して確認を取る。
 *   - 列の追加は insertColumnBefore で行うため、既存データの並びは崩れない。
 *
 * 対象外:
 *   「オペ関連(ＰＶ)」「ハンドピース」のソースシートには税抜価格の列が無い。
 *   これらのカテゴリの商品は空欄のまま残るので、商品マスタ管理画面で手入力する。
 *
 * 依存:
 *   master.js    … MASTER_SHEET_NAME / normalizeKey
 *   migration.js … SOURCE_CONFIG / cell / cellStr
 *   usage.js     … writeSheetColumn_
 *   webapp.js    … toStr
 */

var PRICE_EX_TAX_HEADER = '税抜価格';
var PRICE_INC_TAX_HEADER = '評価単価（税込）';

/**
 * メニュー「商品マスタに税抜価格を取り込む」。
 * 列が無ければ追加し、ソースシートの税抜価格を空欄のセルにだけ流し込む。
 */
function importPriceExTaxToMaster() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!sheet) {
    ui.alert(MASTER_SHEET_NAME + ' シートがありません。処理を中止しました。');
    return;
  }

  // ① 列を用意する（既にあれば何もしない）
  var columnAdded;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    columnAdded = ensurePriceExTaxColumn_(sheet);
  } finally {
    lock.releaseLock();
  }

  // ② ソースシートから 税抜価格 を集める
  var lookup = buildPriceExTaxLookup_();
  var found = Object.keys(lookup).length;
  if (found === 0) {
    ui.alert('ソースシート（' + Object.keys(SOURCE_CONFIG).join('／') + '）から\n' +
      '税抜価格を1件も読み取れませんでした。処理を中止しました。');
    return;
  }

  // ③ 何件埋まるかを先に出して確認を取る（ここではまだ書き込まない）
  var plan = applyPriceExTax_(sheet, lookup, true);
  if (plan.filled === 0) {
    ui.alert('取り込める税抜価格はありませんでした。\n\n' +
      (columnAdded ? '「' + PRICE_EX_TAX_HEADER + '」列は追加しました。\n\n' : '') +
      '・入力済みのため対象外：' + plan.already + '件\n' +
      '・ソースに該当が無い：' + plan.notFound + '件');
    return;
  }

  var proceed = ui.alert(
    '税抜価格を取り込みます',
    (columnAdded ? '「' + PRICE_EX_TAX_HEADER + '」列を追加しました。\n\n' : '') +
    'ソースシートから読み取れた税抜価格：' + found + '種類\n\n' +
    '・これから埋める（空欄）：' + plan.filled + '件\n' +
    '・入力済みのため触らない：' + plan.already + '件\n' +
    '・ソースに該当が無い：' + plan.notFound + '件\n\n' +
    '空欄のセルだけを埋めます。入力済みの値は上書きしません。\n' +
    '実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (proceed !== ui.Button.YES) {
    ui.alert('中止しました。商品マスタは変更していません。');
    return;
  }

  // ④ 実際に書き込む
  var result;
  lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    result = applyPriceExTax_(sheet, lookup, false);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  ui.alert('完了しました。\n\n' +
    '・取り込んだ税抜価格：' + result.filled + '件\n' +
    '・入力済みのため触らなかった：' + result.already + '件\n' +
    '・ソースに該当が無かった：' + result.notFound + '件\n\n' +
    (result.notFound
      ? '該当が無かった商品（オペ関連・ハンドピース等）は、\n' +
        '商品マスタ管理画面から手入力してください。'
      : ''));
}

/**
 * 商品マスタに「税抜価格」列が無ければ追加する。
 * 価格が2列並ぶように「評価単価（税込）」の直前へ入れる（無ければ末尾）。
 * @return {boolean} 追加したら true、既にあれば false
 */
function ensurePriceExTaxColumn_(sheet) {
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < header.length; i++) {
    if (toStr(header[i]) === PRICE_EX_TAX_HEADER) return false;
  }

  var target = 0; // 1始まりの列番号。0＝見つからなかった
  for (var j = 0; j < header.length; j++) {
    if (toStr(header[j]) === PRICE_INC_TAX_HEADER) { target = j + 1; break; }
  }

  var col;
  if (target > 0) {
    sheet.insertColumnBefore(target);
    col = target;
  } else {
    sheet.insertColumnAfter(lastCol);
    col = lastCol + 1;
  }
  sheet.getRange(1, col).setValue(PRICE_EX_TAX_HEADER)
    .setFontWeight('bold').setBackground('#e8eef7');
  return true;
}

/**
 * ソースシート（診療室／バー／薬／ＤＨ）から
 * 「カテゴリ＋発注先＋品名」→ 税抜価格 のマップを作る。
 * 同じキーが複数行にある場合は先に出てきた行を採用する。
 */
function buildPriceExTaxLookup_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lookup = {};

  Object.keys(SOURCE_CONFIG).forEach(function (sheetName) {
    var cfg = SOURCE_CONFIG[sheetName];
    if (!cfg.common || !cfg.common.priceExTax) return; // 税抜列を持たないシートは対象外
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < cfg.dataStart) return;

    var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
    for (var r = cfg.dataStart - 1; r < values.length; r++) {
      var row = values[r];
      var name = cellStr(row, cfg.common.name);
      if (name === '') continue;
      var price = cell(row, cfg.common.priceExTax);
      if (toStr(price) === '') continue;
      // カテゴリはソースのシート名（migration.js が商品マスタへそう入れている）
      var key = normalizeKey(sheetName, cellStr(row, cfg.common.maker), name);
      if (!lookup.hasOwnProperty(key)) lookup[key] = price;
    }
  });

  return lookup;
}

/**
 * 商品マスタの空欄の税抜価格を、lookup の値で埋める。
 * @param {Sheet} sheet 商品マスタ
 * @param {Object} lookup buildPriceExTaxLookup_ の結果
 * @param {boolean} dryRun true なら件数を数えるだけで書き込まない
 * @return {{filled:number, already:number, notFound:number}}
 */
function applyPriceExTax_(sheet, lookup, dryRun) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { filled: 0, already: 0, notFound: 0 };

  var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var header = values[0];
  var idId = header.indexOf('商品ID');
  var idCat = header.indexOf('カテゴリ');
  var idSupplier = masterSupplierIndex_(header); // 発注先（統合前は旧「メーカー」列）
  var idName = header.indexOf('品名');
  var idEx = header.indexOf(PRICE_EX_TAX_HEADER);
  if (idId < 0 || idCat < 0 || idSupplier < 0 || idName < 0 || idEx < 0) {
    throw new Error('商品マスタの列（商品ID／カテゴリ／発注先／品名／' +
      PRICE_EX_TAX_HEADER + '）が見つかりません。');
  }

  var filled = 0, already = 0, notFound = 0;
  for (var r = 1; r < values.length; r++) {
    if (toStr(values[r][idId]) === '') continue;
    // 入力済みは上書きしない（手入力・前回取り込みぶんを守る）
    if (toStr(values[r][idEx]) !== '') { already++; continue; }

    var key = normalizeKey(toStr(values[r][idCat]), toStr(values[r][idSupplier]), toStr(values[r][idName]));
    if (!lookup.hasOwnProperty(key)) { notFound++; continue; }

    values[r][idEx] = lookup[key];
    filled++;
  }

  if (!dryRun && filled > 0) writeSheetColumn_(sheet, values, idEx); // usage.js
  return { filled: filled, already: already, notFound: notFound };
}
