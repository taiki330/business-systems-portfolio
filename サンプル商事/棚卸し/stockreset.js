/**
 * 医院別在庫の在庫数リセット
 * ------------------------------------------------------------------
 * 目的（2026-08-22 時点の状況）:
 *   ②で医院別在庫を作ったとき、元の棚卸しスプレッドシートに入っていた
 *   「個数」をそのまま初期在庫として取り込んでいる。
 *   しかし実際に現物を数えてシステムへ入れたのはPVだけで、他の医院には
 *   まだURLも配っておらず、現物を数えていない。
 *   つまりPV以外の在庫数は「そこにあることになっているが、実態と合っていない数」で、
 *   このまま残すと理事長ビューの総資産額が実態とかけ離れる。
 *
 *   そこで、指定した医院の在庫数を0に戻し、各医院が自分で棚卸しをした時点から
 *   実数が入り始めるようにする。
 *
 * 何を消して、何を残すか:
 *   消す … 現在庫数（数量管理の商品のみ）／発注済み未入荷数量
 *   残す … 管理方式・発注基準数・発注トリガー条件（スタッフが設定した内容）
 *          使用期限（スプレッドシートから取り込んだ、医院ごとの実データ）
 *          商品マスタ・商品ID・QRコード（作り直すと印刷済みのQRが使えなくなる）
 *   ＝行そのものは消さない。消すのは「数」だけ。
 *
 * 安全設計:
 *   - 消す前の在庫数を「在庫リセット履歴」シートに1件ずつ記録する。
 *     間違えて実行しても、この記録から元の数を確認して戻せる。
 *   - 実行前に、医院ごとの対象件数と消える資産額を出して確認を取る。
 *   - 発注管理に「発注済み・一部入荷」の発注が残っている医院は、
 *     未入荷数量を0にすると入荷登録がずれるため警告する。
 *   - 在庫確定履歴には書かない。あちらに書くと一斉在庫登録の画面で
 *     「本日登録済み」と表示され、まだ数えていない資材を数えたことにしてしまうため。
 *
 * 依存:
 *   master.js  … INVENTORY_SHEET_NAME
 *   usage.js   … getInventorySheetOrThrow / inventoryHeaderIndex / writeSheetColumn_
 *                getOrCreateSheet / appendRows
 *   order.js   … ORDER_SHEET / ORDER_HEADERS / ORDER_STATUS_ORDERED / ORDER_STATUS_PARTIAL / numOrZero
 *   stock.js   … getMasterInfoMap / unitPriceExTax_
 *   migration.js … CLINICS
 *   webapp.js  … toStr
 */

var STOCK_RESET_LOG_SHEET = '在庫リセット履歴';
var STOCK_RESET_LOG_HEADERS = [
  '日時', '医院ID', '商品ID', '品名', 'リセット前在庫', 'リセット前未入荷', 'トークン'
];

/**
 * メニュー「在庫数をリセットする（医院を選ぶ）」。
 * 在庫を残す医院を入力させ、それ以外の医院の在庫数を0にする。
 */
function resetStockForClinics() {
  var ui = SpreadsheetApp.getUi();

  var res = ui.prompt(
    '在庫数のリセット',
    '在庫数を「残す」医院コードを入力してください（複数ならカンマ区切り）。\n' +
    'ここに入力しなかった医院の在庫数が0になります。\n\n' +
    '医院コード： ' + CLINICS.join(' , ') + '\n\n' +
    '例）PVだけ残す場合は  PV  と入力',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) {
    ui.alert('中止しました。医院別在庫は変更していません。');
    return;
  }

  var keep = parseClinicList_(toStr(res.getResponseText()));
  if (keep.unknown.length) {
    ui.alert('医院コードが違います：' + keep.unknown.join(' , ') + '\n\n' +
      '使えるのは次のコードだけです：\n' + CLINICS.join(' , ') + '\n\n処理を中止しました。');
    return;
  }

  var targets = CLINICS.filter(function (c) { return keep.clinics.indexOf(c) < 0; });
  if (!targets.length) {
    ui.alert('すべての医院を「残す」に指定したため、リセットする医院がありません。処理を中止しました。');
    return;
  }

  // 先に件数と金額を出す（この時点ではまだ書き込まない）
  var plan = applyStockReset_(targets, '', true);
  if (plan.total === 0) {
    ui.alert('リセットする在庫がありませんでした。\n\n' +
      '対象の医院：' + targets.join(' , ') + '\n' +
      '（すでに在庫数がすべて0になっています）');
    return;
  }

  var openOrders = clinicsWithOpenOrders_(targets);
  var proceed = ui.alert(
    '在庫数を0にします',
    '残す医院：' + (keep.clinics.length ? keep.clinics.join(' , ') : '（なし）') + '\n' +
    'リセットする医院：' + targets.join(' , ') + '\n\n' +
    plan.lines.join('\n') + '\n\n' +
    '合計 ' + plan.total + ' 品目／資産額 ￥' + Math.round(plan.valuation).toLocaleString() + ' ぶんが0になります。\n\n' +
    (openOrders.length
      ? '⚠ ' + openOrders.join(' , ') + ' には未入荷の発注が残っています。\n' +
        '　 未入荷数量も0にするため、その発注の入荷登録がずれます。\n\n'
      : '') +
    '管理方式・発注基準数・使用期限・QRコードはそのまま残ります。\n' +
    'リセット前の在庫数は「' + STOCK_RESET_LOG_SHEET + '」シートに記録するので、\n' +
    '間違えた場合はそこから元の数を確認できます。\n\n' +
    '実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (proceed !== ui.Button.YES) {
    ui.alert('中止しました。医院別在庫は変更していません。');
    return;
  }

  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var token = 'reset-' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss');

  var result;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    result = applyStockReset_(targets, token, false);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  ui.alert('完了しました。\n\n' +
    'リセットした医院：' + targets.join(' , ') + '\n' +
    '在庫数を0にした品目：' + result.total + '件\n' +
    '記録先：「' + STOCK_RESET_LOG_SHEET + '」シート（トークン ' + token + '）\n\n' +
    '各医院が棚卸しをして一斉在庫登録をすると、そこから実数が入り始めます。');
}

/**
 * 入力された医院コードの文字列を配列にする。
 * 全角カンマ・読点・空白区切りも受け付ける（手入力なので表記を狭めない）。
 * @return {{clinics:Array<string>, unknown:Array<string>}}
 */
function parseClinicList_(s) {
  var parts = s.split(/[,、，\s]+/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x !== ''; });

  var clinics = [], unknown = [];
  parts.forEach(function (p) {
    if (CLINICS.indexOf(p) >= 0) {
      if (clinics.indexOf(p) < 0) clinics.push(p);
    } else if (unknown.indexOf(p) < 0) {
      unknown.push(p);
    }
  });
  return { clinics: clinics, unknown: unknown };
}

/**
 * 指定医院の在庫数・未入荷数量を0にする。
 *
 * 現在庫数は数量管理の商品だけを対象にする（発注トリガー管理は在庫数を持たず
 * 「（管理対象外）」が入っているため、0を書くと管理方式と食い違う）。
 * 未入荷数量は管理方式に関わらず0にする。
 *
 * @param {Array<string>} targets リセットする医院コード
 * @param {string} token 実行を識別するトークン（履歴に残す）
 * @param {boolean} dryRun true なら件数を数えるだけで書き込まない
 * @return {{total:number, valuation:number, lines:Array<string>}}
 */
function applyStockReset_(targets, token, dryRun) {
  var out = { total: 0, valuation: 0, lines: [] };

  var invSheet = getInventorySheetOrThrow(); // usage.js
  var lastRow = invSheet.getLastRow();
  if (lastRow < 2) return out;

  var values = invSheet.getRange(1, 1, lastRow, invSheet.getLastColumn()).getValues();
  var idx = inventoryHeaderIndex(values[0]);
  var masterMap = getMasterInfoMap(); // stock.js

  var isTarget = {};
  targets.forEach(function (c) { isTarget[c] = true; });

  var perClinic = {};
  targets.forEach(function (c) { perClinic[c] = { count: 0, valuation: 0 }; });

  var now = new Date();
  var logRows = [];
  var touched = false;

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var clinic = toStr(row[idx.clinic]);
    if (!isTarget[clinic]) continue;

    var stock = numOrZero(row[idx.stock]);      // order.js
    var openQty = numOrZero(row[idx.openQty]);
    var isQty = toStr(row[idx.mode]) === '数量管理';
    // 数量管理でない行は在庫数を持たないので、未入荷数量だけを見る
    var resetStock = isQty && stock !== 0;
    var resetOpen = openQty !== 0;
    if (!resetStock && !resetOpen) continue;

    if (resetStock) {
      var pid = toStr(row[idx.productId]);
      var unitPrice = unitPriceExTax_(masterMap[pid] || {}); // stock.js
      perClinic[clinic].count++;
      perClinic[clinic].valuation += (unitPrice !== null) ? unitPrice * stock : 0;
      out.total++;
      out.valuation += (unitPrice !== null) ? unitPrice * stock : 0;
    }

    if (!dryRun) {
      if (resetStock) row[idx.stock] = 0;
      if (resetOpen) row[idx.openQty] = 0;
      row[idx.updatedAt] = now;
      touched = true;
      logRows.push([
        now, clinic, toStr(row[idx.productId]), toStr(row[idx.name]),
        stock, openQty, token
      ]);
    }
  }

  targets.forEach(function (c) {
    var p = perClinic[c];
    out.lines.push('・' + c + '：' + p.count + '品目／￥' +
      Math.round(p.valuation).toLocaleString());
  });

  if (!dryRun && touched) {
    // 消す前の数を先に記録してから在庫を書き換える。
    // 逆順だと、書き換え後に記録が失敗したとき元の数が分からなくなる。
    if (logRows.length) {
      appendRows(getOrCreateSheet(STOCK_RESET_LOG_SHEET, STOCK_RESET_LOG_HEADERS), logRows);
      SpreadsheetApp.flush();
    }
    writeSheetColumn_(invSheet, values, idx.stock);     // usage.js
    writeSheetColumn_(invSheet, values, idx.openQty);
    writeSheetColumn_(invSheet, values, idx.updatedAt);
  }
  return out;
}

/**
 * 対象医院のうち、未入荷の発注（発注済み・一部入荷）が残っている医院を返す。
 * 未入荷数量を0にするとその発注の入荷登録がずれるため、実行前に知らせる。
 * @param {Array<string>} targets
 * @return {Array<string>}
 */
function clinicsWithOpenOrders_(targets) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ORDER_SHEET); // order.js
  if (!sheet || sheet.getLastRow() < 2) return [];

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ORDER_HEADERS.length).getValues();
  var cClinic = ORDER_HEADERS.indexOf('医院ID');
  var cStatus = ORDER_HEADERS.indexOf('状態');

  var found = [];
  values.forEach(function (row) {
    var clinic = toStr(row[cClinic]);
    if (targets.indexOf(clinic) < 0) return;
    var status = toStr(row[cStatus]);
    if (status !== ORDER_STATUS_ORDERED && status !== ORDER_STATUS_PARTIAL) return;
    if (found.indexOf(clinic) < 0) found.push(clinic);
  });
  return found;
}
