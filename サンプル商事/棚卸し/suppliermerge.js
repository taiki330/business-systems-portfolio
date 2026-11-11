/**
 * 商品マスタ「メーカー」列 → 「発注先」列 への統合（1度だけ実行する使い切りツール）
 * ------------------------------------------------------------------
 * 背景（2026-08-22 ヒアリングで確定）:
 *   商品マスタの「メーカー」に入っていた値は、実態としてはその資材の発注先だった。
 *   一方「発注先」列は②の生成時に空欄で作られ、ほとんど使われていない。
 *   同じものを指す列が2つあると、発注画面にどちらを出すのかが決まらないため、
 *   「発注先」1本に統一する。
 *
 * この関数がやること:
 *   1. 商品マスタを丸ごとコピーしてバックアップシートを残す
 *   2. 各行の「発注先」に「メーカー」の値を入れる（既存の発注先は上書き）
 *   3. 「メーカー」列を削除する
 *
 * 実行方法:
 *   Apps Script エディタで関数を選んで実行する。
 *   （毎日目に入るメニューには出さない。押し間違いで本番データを壊さないため）
 *
 *     previewMakerIntoSupplier … 何が起きるかを実行ログに出すだけ（書き込みなし）
 *     mergeMakerIntoSupplier   … 実際に統合する
 *
 *   結果は「実行ログ」に出る（migration.js の maintenanceReport_）。
 *   エディタから直接実行すると SpreadsheetApp.getUi() が使えないことがあるため、
 *   ダイアログは「出せたら出す」扱いにして、処理そのものはUIに依存させていない。
 *
 * 実行後:
 *   商品マスタの列は 商品ID／カテゴリ／品名／税抜価格／評価単価（税込）／発注先／
 *   標準発注数量／有効-無効／使用期限管理／備考 になる（master.js の MASTER_HEADERS）。
 *   医院別作業シート（NIS_在庫 等）の列構成は変えない。そちらの「メーカー」列の値も
 *   発注先なので、商品マスタとのマッチングキーは統合の前後で変わらない。
 *
 * 依存:
 *   master.js  … MASTER_SHEET_NAME / MASTER_SUPPLIER_HEADER / MASTER_LEGACY_MAKER_HEADER
 *   webapp.js  … toStr
 */

/** バックアップシート名の接頭辞。 */
var SUPPLIER_MERGE_BACKUP_PREFIX = '商品マスタ_統合前_';

/**
 * 統合したら何が起きるかを調べて実行ログに出す（シートは一切変更しない）。
 * 先にこれを実行して件数を確かめてから mergeMakerIntoSupplier を実行するとよい。
 */
function previewMakerIntoSupplier() {
  var plan = planMakerIntoSupplier_();
  maintenanceReport_('【下見】メーカー列→発注先 統合', plan.description +
    (plan.canRun ? '\n\n実行するには mergeMakerIntoSupplier を実行してください。' : ''));
  return plan.description;
}

/**
 * 商品マスタの「メーカー」列を「発注先」列へ統合し、メーカー列を削除する。
 * 何度実行しても安全（2回目以降は「統合済み」で何もしない）。
 */
function mergeMakerIntoSupplier() {
  var plan = planMakerIntoSupplier_();
  if (!plan.canRun) {
    maintenanceReport_('メーカー列→発注先 統合：実行しませんでした', plan.description);
    return plan.description;
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var result;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
    var backupName = backupMasterSheet_(ss, sheet);

    if (plan.mode === 'rename') {
      // 「発注先」列がまだ無い場合は、見出しを付け替えるだけで統合が完了する。
      sheet.getRange(1, plan.makerCol + 1).setValue(MASTER_SUPPLIER_HEADER);
      SpreadsheetApp.flush();
      result = '完了しました。\n' +
        '・「' + MASTER_LEGACY_MAKER_HEADER + '」列を「' + MASTER_SUPPLIER_HEADER + '」に付け替えました\n' +
        '・バックアップ：' + backupName;
    } else {
      // 発注先列へ一括書き込み（メーカーの値をそのまま入れる）→ メーカー列を削除
      sheet.getRange(2, plan.supplierCol + 1, plan.supplierValues.length, 1)
        .setValues(plan.supplierValues);
      sheet.deleteColumn(plan.makerCol + 1); // 列番号は1始まり
      SpreadsheetApp.flush();
      result = '完了しました。\n' +
        '・発注先へ転記：' + plan.moved + '件\n' +
        '・上書きした発注先：' + plan.overwritten.length + '件\n' +
        '・「' + MASTER_LEGACY_MAKER_HEADER + '」列を削除しました\n' +
        '・バックアップ：' + backupName + '\n\n' +
        '発注先の内容は「商品マスタ管理」画面から直せます。';
    }
  } finally {
    lock.releaseLock();
  }

  maintenanceReport_('メーカー列→発注先 統合', result);
  return result;
}

/* ===== ヘルパー ===== */

/**
 * 統合の実行計画を作る（シートは変更しない）。
 * @return {{canRun:boolean, mode:string, description:string,
 *           makerCol:number, supplierCol:number, moved:number, blank:number,
 *           overwritten:Array<string>, supplierValues:Array<Array<string>>}}
 */
function planMakerIntoSupplier_() {
  var none = { canRun: false, mode: 'none', makerCol: -1, supplierCol: -1,
    moved: 0, blank: 0, overwritten: [], supplierValues: [] };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    none.description = 'スプレッドシートを取得できませんでした。'
      + '対象のスプレッドシートから「拡張機能 → Apps Script」で開いて実行してください。';
    return none;
  }
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!sheet) {
    none.description = MASTER_SHEET_NAME + ' シートがありません。';
    return none;
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var makerCol = indexOfHeader_(header, MASTER_LEGACY_MAKER_HEADER);   // 0始まり
  var supplierCol = indexOfHeader_(header, MASTER_SUPPLIER_HEADER);    // 0始まり

  if (makerCol < 0) {
    none.description = '「' + MASTER_LEGACY_MAKER_HEADER + '」列がありません。'
      + '既に発注先へ統合済みです。処理は不要です。';
    return none;
  }

  if (supplierCol < 0) {
    return {
      canRun: true, mode: 'rename', makerCol: makerCol, supplierCol: -1,
      moved: 0, blank: 0, overwritten: [], supplierValues: [],
      description: '「' + MASTER_LEGACY_MAKER_HEADER + '」列の見出しを「' +
        MASTER_SUPPLIER_HEADER + '」に変更します。\n' +
        '（「' + MASTER_SUPPLIER_HEADER + '」列がまだ無いため、値の移動は不要です）'
    };
  }

  if (lastRow < 2) {
    none.description = '商品マスタにデータ行がありません。';
    return none;
  }

  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var moved = 0;        // 発注先へ値が入る行
  var blank = 0;        // メーカーが空欄で、発注先も空のままになる行
  var overwritten = []; // 既存の発注先が別の値で上書きされる行（確認用）
  var supplierValues = [];

  values.forEach(function (row, i) {
    var maker = toStr(row[makerCol]);
    var supplier = toStr(row[supplierCol]);
    supplierValues.push([maker]);
    if (maker === '') { if (supplier === '') blank++; }
    else moved++;
    if (supplier !== '' && supplier !== maker) {
      overwritten.push('　' + (i + 2) + '行目：「' + supplier + '」→「' + maker + '」');
    }
  });

  var warn = overwritten.length
    ? '\n\n⚠ 既に入っている発注先が上書きされる行が ' + overwritten.length + '件あります：\n' +
      overwritten.slice(0, 15).join('\n') +
      (overwritten.length > 15 ? '\n　…ほか ' + (overwritten.length - 15) + '件' : '')
    : '';

  return {
    canRun: true, mode: 'merge', makerCol: makerCol, supplierCol: supplierCol,
    moved: moved, blank: blank, overwritten: overwritten, supplierValues: supplierValues,
    description: '対象：' + (lastRow - 1) + '行\n' +
      '・発注先へ転記：' + moved + '件\n' +
      '・メーカーが空欄のため発注先も空のまま：' + blank + '件\n' +
      '・このあと「' + MASTER_LEGACY_MAKER_HEADER + '」列は削除されます\n' +
      '・実行前の商品マスタはバックアップシートとして残します' + warn
  };
}

/**
 * 商品マスタを丸ごと複製してバックアップシートを作る。
 * @param {Spreadsheet} ss
 * @param {Sheet} sheet 商品マスタ
 * @return {string} 作成したバックアップシート名
 */
function backupMasterSheet_(ss, sheet) {
  var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyyMMdd_HHmm');
  var name = SUPPLIER_MERGE_BACKUP_PREFIX + stamp;
  // 同じ分に2回実行した場合に備えて連番を足す
  var suffix = 2;
  while (ss.getSheetByName(name)) { name = SUPPLIER_MERGE_BACKUP_PREFIX + stamp + '_' + suffix; suffix++; }
  var copy = sheet.copyTo(ss);
  copy.setName(name);
  copy.hideSheet();
  return name;
}

/** ヘッダー行から見出しの列インデックス（0始まり）を返す。無ければ -1。 */
function indexOfHeader_(header, label) {
  for (var i = 0; i < header.length; i++) {
    if (toStr(header[i]) === label) return i;
  }
  return -1;
}
