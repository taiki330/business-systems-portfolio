/**
 * 商品マスタ・医院別在庫 生成ロジック（「棚卸しツール ② 」）
 * ------------------------------------------------------------------
 * 目的:
 *   migration.js が生成した医院別作業シート（NIS_在庫 等。スタッフが
 *   管理方式・発注基準数等を記入済み）を読み込み、要件定義書 第13章の
 *   最終スキーマに沿って以下を生成する。
 *
 *     ① 商品マスタ   … 医院共通の商品情報（1商品1行）
 *     ② 医院別在庫   … 医院×商品で1行。管理方式・発注基準数は医院ごとに保持する
 *                       （※各医院の来客状況により同じ資材でも管理方式が異なりうるため、
 *                         商品マスタ側ではなく医院別在庫側の項目とする）
 *     ③ 要確認リスト … 管理方式が未設定（空欄）のまま残っている行。
 *                       商品マスタ化・医院別在庫化せず、ここに一覧化して保留する
 *     ④ 単価参考シート … 商品ごとに4医院の税込価格を並べて表示。
 *                       評価単価は商品マスタに転記しない（空欄で生成）。
 *                       別途、価格入力チーム用の入力機能でこの参考値を見ながら確定する。
 *
 * 安全設計:
 *   - 医院別作業シート（NIS_在庫 等）は読み取りのみ。変更しない。
 *   - 出力シートは実行のたびに削除→再生成（何度でも安全に流せる）。
 *   - この段階ではまだ使用履歴等のトランザクションが存在しない前提のため、
 *     商品IDは実行のたびに振り直す。実運用が始まった後にこのツールを
 *     再実行すると商品IDがズレるため、本番稼働後は使用しないこと。
 *
 * マッチングキー:
 *   カテゴリ＋発注先＋品名（前後の空白・全角/半角スペースを正規化して比較）。
 *   このキーが完全一致する行を同一商品とみなして医院を横断して束ねる。
 *   表記揺れで一致しなかった場合は別商品として扱われる（自動判定はしない）。
 *
 * 「メーカー」と「発注先」について（2026-08-22 ヒアリングで確定）:
 *   医院運用上、商品マスタの「メーカー」に入っていた値は実際には発注先そのものだった。
 *   そのため商品マスタからは「メーカー」列を廃止し、「発注先」1本に統一している
 *   （統合作業は suppliermerge.js の「メーカー列を発注先へ統合」を1度だけ実行する）。
 *   医院別作業シート（NIS_在庫 等）の側は列構成をそのまま残しており、
 *   その「メーカー」列の値＝発注先として読む。マッチングキーの真ん中に入る値は
 *   統合の前後で変わらないため、既存の突き合わせはそのまま成立する。
 */

var MASTER_SHEET_NAME = '商品マスタ';
var INVENTORY_SHEET_NAME = '医院別在庫';
var UNRESOLVED_SHEET_NAME = '要確認リスト（管理方式未設定）';
var PRICE_REF_SHEET_NAME = '単価参考（価格入力チーム用）';

var MASTER_SUPPLIER_HEADER = '発注先';
var MASTER_LEGACY_MAKER_HEADER = 'メーカー'; // 統合前の旧列名（読み取りの後方互換用）

var MASTER_HEADERS = [
  '商品ID', 'カテゴリ', '品名', '税抜価格', '評価単価（税込）',
  '発注先', '標準発注数量', '有効/無効', '使用期限管理', '備考'
];
// 使用期限管理の値。商品ごと（医院共通）に設定する。既定は「不要」。
var EXPIRY_MANAGED_YES = '要';
var EXPIRY_MANAGED_NO = '不要';

var INVENTORY_HEADERS = [
  '医院ID', '商品ID', '品名（参考）', '管理方式', '発注基準数',
  '発注トリガー条件', '現在庫数', '発注済み未入荷数量', '使用期限', '最終更新日時'
];
var UNRESOLVED_HEADERS = ['医院ID', 'カテゴリ', '発注先', '品名', '現在庫数', '備考'];

/**
 * 商品マスタのヘッダー行から「発注先として読み書きする列」（0始まり）を返す。
 * 見つからなければ -1。
 *
 * 「メーカー」列がまだ残っている（＝suppliermerge.js の統合を実行していない）間は、
 * 発注先の実データが入っているのは旧「メーカー」列のほうで、「発注先」列は②の生成時に
 * 作られた空欄のまま。メーカー＝発注先なので、両方ある間は旧メーカー列を発注先として扱う。
 * こうしておくと統合の実行前でも画面に発注先が出るし、画面から編集した値も
 * 同じ列に入るので、あとから統合しても内容がずれない。
 * 統合でメーカー列が消えたあとは「発注先」列を読む。
 *
 * @param {Array} header 商品マスタの1行目
 * @return {number}
 */
function masterSupplierIndex_(header) {
  header = header || [];
  var supplier = -1, legacy = -1;
  for (var i = 0; i < header.length; i++) {
    var label = toStr(header[i]);
    if (label === MASTER_SUPPLIER_HEADER && supplier < 0) supplier = i;
    if (label === MASTER_LEGACY_MAKER_HEADER && legacy < 0) legacy = i;
  }
  return legacy >= 0 ? legacy : supplier;
}

/**
 * 単価参考シートのヘッダーを生成する。
 * migration.js の CLINICS / OUTPUT_SUFFIX に依存するため、トップレベルの定数では
 * なく関数として持つ（GASはファイルをアルファベット順に評価するため、master.js の
 * トップレベルでは migration.js の定数がまだ未定義になりうる）。
 */
function priceRefHeaders() {
  return ['商品ID', 'カテゴリ', '発注先', '品名']
    .concat(CLINICS.map(function (c) {
      return c + ' 税込価格（' + OUTPUT_SUFFIX.replace('_', '') + '記載）';
    }));
}


/**
 * メイン処理。医院別作業シートを統合し、商品マスタ・医院別在庫・
 * 要確認リスト・単価参考シートを生成する。
 */
function generateMasterAndInventory() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  // 医院別作業シートの存在チェック
  var missing = [];
  CLINICS.forEach(function (c) {
    if (!ss.getSheetByName(c + OUTPUT_SUFFIX)) missing.push(c + OUTPUT_SUFFIX);
  });
  if (missing.length) {
    ui.alert('次のシートが見つかりません:\n' + missing.join(' , ') +
      '\n\n先に「① 医院別シートを生成」を実行してください。処理を中止しました。');
    return;
  }

  // 安全ガード：既に運用が始まっている（使用履歴・発注・入荷の記録がある）場合、
  // このツールを再実行すると商品マスタ・医院別在庫が作り直され、
  // QR運用で更新された実在庫やQRに埋め込んだ商品IDが失われる。
  // 誤実行を防ぐため、明示的な確認を必須にする。
  var opStatus = checkOperationStarted(ss);
  if (opStatus.started) {
    var proceed = ui.alert(
      '⚠ 運用データが存在します',
      '以下の運用記録が見つかりました。\n\n' + opStatus.detail +
      '\n\nこのツールを再実行すると「商品マスタ」「医院別在庫」が作り直され、' +
      'QRで登録した現在庫の変更や、印刷済みQRの商品IDが失われる可能性があります。\n\n' +
      '本当に再生成しますか？（通常は初期セットアップ時のみ実行してください）',
      ui.ButtonSet.YES_NO
    );
    if (proceed !== ui.Button.YES) {
      ui.alert('中止しました。既存の商品マスタ・医院別在庫は変更していません。');
      return;
    }
  }

  // groups: key -> { category, supplier, name, byClinic: { NIS:{...}, MDC:{...}, ... } }
  var groups = {};
  var order = []; // 出現順を保持（商品IDの採番順に使う）
  var unresolved = []; // 管理方式が未設定の行

  CLINICS.forEach(function (clinic) {
    var sheet = ss.getSheetByName(clinic + OUTPUT_SUFFIX);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2) return;

    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var idx = masterHeaderIndex(values[0]);

    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var name = toStr(row[idx.name]);
      if (name === '') continue;

      var category = toStr(row[idx.category]);
      var supplier = toStr(row[idx.supplier]);
      var mode = toStr(row[idx.mode]);
      var kijun = row[idx.kijun];
      var trigger = toStr(row[idx.trigger]);
      var stock = row[idx.stock];
      var priceExTax = row[idx.priceExTax];
      var priceIncTax = row[idx.priceIncTax];
      var note = toStr(row[idx.note]);

      // 管理方式が未設定 → 商品マスタ化せず要確認リストへ
      if (mode === '') {
        unresolved.push([clinic, category, supplier, name, stock, note]);
        continue;
      }

      // 「取り扱いなし」→ その医院では扱わないので運用データに含めない。
      // （管理方式ツールでは行削除せず取り扱いなしとして残すため、ここで明示的に除外する。
      //   商品マスタ・医院別在庫のどちらにも入れない。）
      if (mode === '取り扱いなし') continue;

      var key = normalizeKey(category, supplier, name);
      if (!groups[key]) {
        groups[key] = { category: category, supplier: supplier, name: name, priceExTax: '', byClinic: {} };
        order.push(key);
      }
      // 税抜価格はソースシートの共通列（医院をまたいで同じ値）なので商品マスタ側に持つ。
      // 医院ごとに空欄のことがあるため、最初に見つかった値を採用する。
      if (toStr(groups[key].priceExTax) === '' && toStr(priceExTax) !== '') {
        groups[key].priceExTax = priceExTax;
      }
      groups[key].byClinic[clinic] = {
        mode: mode,
        kijun: kijun,
        trigger: trigger,
        stock: stock,
        priceIncTax: priceIncTax
      };
    }
  });

  // 商品ID採番 → 商品マスタ・医院別在庫・単価参考シートの行を組み立て
  var masterRows = [];
  var inventoryRows = [];
  var priceRefRows = [];
  var now = new Date();
  var seq = 1;

  order.forEach(function (key) {
    var g = groups[key];
    var productId = 'P' + ('0000' + seq).slice(-4);
    seq++;

    masterRows.push([
      productId, g.category, g.name,
      g.priceExTax, // 税抜価格（ソースシートの共通列から転記）
      '', // 評価単価は空欄で生成（価格入力チームが別画面で確定）
      g.supplier, // 発注先（医院別シートの「メーカー」列＝実態は発注先。以後はここ1本で管理）
      '', // 標準発注数量（商品マスタ管理画面で別途設定）
      '有効',
      EXPIRY_MANAGED_NO, // 使用期限管理：既定は「不要」。対象商品は商品マスタで「要」に変更する
      ''
    ]);

    var priceRow = [productId, g.category, g.supplier, g.name];

    CLINICS.forEach(function (clinic) {
      var d = g.byClinic[clinic];
      priceRow.push(d ? toStr(d.priceIncTax) : '（取扱なし）');
      if (!d) return; // その医院では取り扱いなし
      inventoryRows.push([
        clinic, productId, g.name, d.mode, d.kijun, d.trigger,
        d.mode === '発注トリガー管理' ? '（管理対象外）' : d.stock,
        0, // 発注済み未入荷数量：この段階では0
        '', // 使用期限：未設定（入荷登録時に設定）
        now
      ]);
    });

    priceRefRows.push(priceRow);
  });

  writeSheet(ss, MASTER_SHEET_NAME, MASTER_HEADERS, masterRows);
  writeSheet(ss, INVENTORY_SHEET_NAME, INVENTORY_HEADERS, inventoryRows);
  writeSheet(ss, UNRESOLVED_SHEET_NAME, UNRESOLVED_HEADERS, unresolved);
  writeSheet(ss, PRICE_REF_SHEET_NAME, priceRefHeaders(), priceRefRows);

  ui.alert('完了しました。\n\n' +
    '・商品マスタ：' + masterRows.length + '件\n' +
    '・医院別在庫：' + inventoryRows.length + '件\n' +
    '・要確認リスト（管理方式未設定）：' + unresolved.length + '件\n' +
    '・単価参考シート：' + priceRefRows.length + '件\n\n' +
    (unresolved.length
      ? '「' + UNRESOLVED_SHEET_NAME + '」に管理方式が未設定の資材があります。\n' +
        '該当の医院別シートで設定後、再実行してください。\n\n'
      : '') +
    '評価単価は未入力です。「' + PRICE_REF_SHEET_NAME + '」を参考に、' +
    '価格入力チーム用の画面（別途用意）で確定してください。');
}


/**
 * 運用が既に始まっているか（使用履歴・発注候補・発注管理・入荷履歴に
 * 実データがあるか）を調べる。1件でもあれば「運用開始済み」とみなす。
 */
function checkOperationStarted(ss) {
  // usage.js の定数（使用履歴・発注候補）。未読込の場合は文字列で代用。
  var targets = [
    (typeof USAGE_HISTORY_SHEET !== 'undefined') ? USAGE_HISTORY_SHEET : '使用履歴',
    (typeof ORDER_CANDIDATE_SHEET !== 'undefined') ? ORDER_CANDIDATE_SHEET : '発注候補',
    '発注管理',
    '入荷履歴'
  ];
  var lines = [];
  targets.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() >= 2) {
      lines.push('・' + name + '：' + (sheet.getLastRow() - 1) + '件');
    }
  });
  return { started: lines.length > 0, detail: lines.join('\n') };
}

// ===== ヘルパー =====

/** 医院別作業シートのヘッダーから列インデックス（0始まり）を取得 */
function masterHeaderIndex(headerRow) {
  function find(label) {
    for (var i = 0; i < headerRow.length; i++) {
      if (toStr(headerRow[i]) === label) return i;
    }
    throw new Error('列「' + label + '」が見つかりません。医院別シートの形式をご確認ください。');
  }
  return {
    category: find('カテゴリ'),
    // 医院別作業シートの列名は「メーカー」のままだが、中身は発注先（2026-08-22 ヒアリング）。
    // 商品マスタ側の「発注先」と同じ値なので、マッチングキーはこの列で組む。
    supplier: find('メーカー'),
    name: find('品名'),
    priceExTax: find('税抜価格'),
    priceIncTax: find('税込価格'),
    stock: find('現在庫数'),
    note: find('備考'),
    mode: find('管理方式'),
    kijun: find('発注基準数'),
    trigger: find('発注トリガー条件')
  };
}

/** カテゴリ＋発注先＋品名 からマッチングキーを作る（表記ゆれを軽く正規化） */
function normalizeKey(category, supplier, name) {
  function norm(s) {
    return String(s || '')
      .replace(/[　\s]+/g, ' ') // 全角/半角スペースの連続を1個の半角スペースに統一
      .trim();
  }
  return norm(category) + '\u0001' + norm(supplier) + '\u0001' + norm(name);
}

/** 出力シートを作り直して書き込む（0件でもヘッダーだけは出す） */
function writeSheet(ss, sheetName, headers, rows) {
  var old = ss.getSheetByName(sheetName);
  if (old) ss.deleteSheet(old);
  var sheet = ss.insertSheet(sheetName);

  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#e8eef7');

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

// toStr() は webapp.js で定義済みのものを共用する（同一プロジェクト内でグローバル共有）
