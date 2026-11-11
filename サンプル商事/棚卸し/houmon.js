/**
 * 訪問部の立ち上げ（状態確認 → 運用データへの反映）
 * ------------------------------------------------------------------
 * 訪問部は5番目の拠点として他医院と同じ仕組みで運用する。立ち上げの流れは3段階。
 *
 *   1. addHoumonSheet（migration.js）
 *        元の「訪問部」シートを読み、管理方式設定用の「訪問部_在庫」を作る。
 *   2. 訪問部ホーム →「⚙️ 管理方式を設定」画面
 *        資材ごとに 管理方式（数量管理／発注トリガー管理／取り扱いなし）と
 *        発注基準数を決める。ここまでは設定段階のデータで、運用には出ない。
 *   3. deployHoumonToOperations（このファイル）
 *        設定済みの資材を 商品マスタ＋医院別在庫へ載せる。これで訪問部でも
 *        在庫一覧・発注・入荷・使用登録・QRが他医院と同じように使えるようになる。
 *
 * なぜ②（generateMasterAndInventory）を使わないか:
 *   ②は全医院ぶんの商品マスタ・医院別在庫を作り直し、商品IDを振り直す。
 *   本番稼働後に実行すると印刷済みQRの商品IDや実在庫が失われるため使えない。
 *   ここでは既存データに一切触れず、訪問部の行を「足すだけ」にしている。
 *
 * 安全設計:
 *   - 商品マスタ・医院別在庫の既存行は読むだけで書き換えない。追加のみ。
 *   - 既に載っている資材（同じ商品IDが訪問部の行として存在する）は飛ばす。
 *     ＝何度実行しても二重に増えない。
 *   - 管理方式が未設定の資材は載せない（設定してから再実行すれば載る）。
 *   - 「取り扱いなし」の資材は載せない。
 *   - 書き込み前に previewHoumonDeploy で件数を確かめられる。
 *
 * 実行方法:
 *   Apps Script エディタで関数を選んで実行する。結果は「実行ログ」に出る。
 *     checkHoumonStatus       … 訪問部が今どの段階にいるかを調べる
 *     previewHoumonDeploy     … 何件載るかを出すだけ（書き込みなし）
 *     deployHoumonToOperations … 実際に運用データへ載せる
 *
 * 依存:
 *   migration.js … CLINICS / OUTPUT_SUFFIX / HOUMON_CONFIG / maintenanceReport_
 *   master.js    … MASTER_SHEET_NAME / masterHeaderIndex / normalizeKey / EXPIRY_MANAGED_NO
 *   additem.js   … addItemMasterIndex_ / buildRowByIndex_
 *   usage.js     … getInventorySheetOrThrow / inventoryHeaderIndex
 *   webapp.js    … getClinicSheetOrThrow / toStr
 */

/** 訪問部の医院コード（CLINICS の5番目）。 */
var HOUMON_CLINIC = '訪問部';

/**
 * 訪問部が今どの段階にいるかを調べて実行ログに出す（何も変更しない）。
 * 「管理方式設定画面に資材が出ない」「発注できない」といったときの切り分けに使う。
 */
function checkHoumonStatus() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lines = [];

  var src = ss.getSheetByName(HOUMON_CONFIG.sheetName);
  lines.push('・元の「' + HOUMON_CONFIG.sheetName + '」シート：' +
    (src ? 'あり（' + Math.max(0, src.getLastRow() - HOUMON_CONFIG.dataStart + 1) + '行）' : 'なし'));

  var workName = HOUMON_CLINIC + OUTPUT_SUFFIX;
  var work = ss.getSheetByName(workName);
  var workRows = work ? Math.max(0, work.getLastRow() - 1) : 0;
  lines.push('・管理方式設定用の「' + workName + '」：' +
    (work ? 'あり（' + workRows + '件）' : 'なし ← addHoumonSheet（migration.js）を実行してください'));

  // 管理方式の記入状況
  if (work && workRows > 0) {
    var wVals = work.getRange(1, 1, work.getLastRow(), work.getLastColumn()).getValues();
    var wIdx = masterHeaderIndex(wVals[0]);
    var set = 0, unset = 0, notHandled = 0;
    for (var r = 1; r < wVals.length; r++) {
      if (toStr(wVals[r][wIdx.name]) === '') continue;
      var mode = toStr(wVals[r][wIdx.mode]);
      if (mode === '') unset++;
      else if (mode === '取り扱いなし') notHandled++;
      else set++;
    }
    lines.push('　　うち 管理方式 設定済み：' + set + '件／未設定：' + unset + '件／取り扱いなし：' + notHandled + '件');
  }

  // 運用データ側
  var invSheet = ss.getSheetByName(INVENTORY_SHEET_NAME);
  if (!invSheet || invSheet.getLastRow() < 2) {
    lines.push('・医院別在庫：なし（または空）');
  } else {
    var iVals = invSheet.getRange(1, 1, invSheet.getLastRow(), invSheet.getLastColumn()).getValues();
    var iIdx = inventoryHeaderIndex(iVals[0]);
    var live = 0;
    for (var ir = 1; ir < iVals.length; ir++) {
      if (toStr(iVals[ir][iIdx.clinic]) === HOUMON_CLINIC) live++;
    }
    lines.push('・医院別在庫の訪問部の行：' + live + '件' +
      (live === 0 ? ' ← deployHoumonToOperations を実行すると載ります' : '（運用中）'));
  }

  lines.push('');
  lines.push('【画面の見え方】');
  lines.push('　医院別在庫に訪問部の行が0件のうちは、管理方式設定画面は「' + workName + '」を読みます。');
  lines.push('　1件以上あると運用データ（医院別在庫）を直接読む運用中モードに切り替わります。');

  var text = lines.join('\n');
  maintenanceReport_('訪問部の状態', text);
  return text;
}

/**
 * 訪問部を運用データへ載せたら何件になるかを出す（書き込みなし）。
 */
function previewHoumonDeploy() {
  var text = runHoumonDeploy_(true);
  maintenanceReport_('【下見】訪問部を運用データへ反映', text);
  return text;
}

/**
 * 管理方式が設定済みの訪問部の資材を、商品マスタ＋医院別在庫へ追加する。
 * 既存行は変更せず、追加のみ。既に載っている資材は飛ばすので何度でも実行できる。
 */
function deployHoumonToOperations() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var text;
  try {
    text = runHoumonDeploy_(false);
  } finally {
    lock.releaseLock();
  }
  maintenanceReport_('訪問部を運用データへ反映', text);
  return text;
}

/* ===== 本体 ===== */

/**
 * 訪問部反映の本体。
 * @param {boolean} dryRun true なら件数を数えるだけで書き込まない
 * @return {string} 実行ログに出す結果文
 */
function runHoumonDeploy_(dryRun) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var workSheet = ss.getSheetByName(HOUMON_CLINIC + OUTPUT_SUFFIX);
  if (!workSheet || workSheet.getLastRow() < 2) {
    return '「' + HOUMON_CLINIC + OUTPUT_SUFFIX + '」シートがありません（または空です）。\n' +
      '先に addHoumonSheet（migration.js）を実行してください。';
  }
  var masterSheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!masterSheet || masterSheet.getLastRow() < 1) {
    return MASTER_SHEET_NAME + ' シートがありません。処理を中止しました。';
  }
  var invSheet = getInventorySheetOrThrow();

  var wVals = workSheet.getRange(1, 1, workSheet.getLastRow(), workSheet.getLastColumn()).getValues();
  var wIdx = masterHeaderIndex(wVals[0]);

  var mCols = masterSheet.getLastColumn();
  var mVals = masterSheet.getRange(1, 1, masterSheet.getLastRow(), mCols).getValues();
  var mIdx = addItemMasterIndex_(mVals[0]);

  // 商品マスタ：マッチングキー → 商品ID、および採番用の最大連番
  var idByKey = {};
  var maxSeq = 0;
  for (var r = 1; r < mVals.length; r++) {
    var pid = toStr(mVals[r][mIdx.id]);
    if (pid === '') continue;
    var seqMatch = pid.match(/^P(\d+)$/);
    if (seqMatch) maxSeq = Math.max(maxSeq, Number(seqMatch[1]));
    var mKey = normalizeKey(
      toStr(mVals[r][mIdx.category]),
      mIdx.supplier >= 0 ? toStr(mVals[r][mIdx.supplier]) : '',
      toStr(mVals[r][mIdx.name]));
    if (!idByKey.hasOwnProperty(mKey)) idByKey[mKey] = pid;
  }

  // 医院別在庫：訪問部に既に載っている商品ID
  var iCols = invSheet.getLastColumn();
  var iVals = invSheet.getRange(1, 1, invSheet.getLastRow(), iCols).getValues();
  var iIdx = inventoryHeaderIndex(iVals[0]);
  var alreadyDeployed = {};
  for (var ir = 1; ir < iVals.length; ir++) {
    if (toStr(iVals[ir][iIdx.clinic]) === HOUMON_CLINIC) {
      alreadyDeployed[toStr(iVals[ir][iIdx.productId])] = true;
    }
  }

  var newMasterRows = [];
  var newInvRows = [];
  var now = new Date();
  var stat = { reused: 0, createdMaster: 0, skippedNoMode: 0, skippedNotHandled: 0, skippedAlready: 0 };

  for (var wr = 1; wr < wVals.length; wr++) {
    var row = wVals[wr];
    var name = toStr(row[wIdx.name]);
    if (name === '') continue;

    var mode = toStr(row[wIdx.mode]);
    if (mode === '') { stat.skippedNoMode++; continue; }
    if (mode === '取り扱いなし') { stat.skippedNotHandled++; continue; }

    var category = toStr(row[wIdx.category]);
    var supplier = toStr(row[wIdx.supplier]);
    var key = normalizeKey(category, supplier, name);

    var productId = idByKey[key];
    if (productId === undefined) {
      // 他医院に同じ資材が無い＝訪問部で初めて登場する商品。商品マスタに1行足す。
      maxSeq++;
      productId = 'P' + ('0000' + maxSeq).slice(-4);
      idByKey[key] = productId;
      newMasterRows.push(buildRowByIndex_(mCols, [
        { col: mIdx.id, val: productId },
        { col: mIdx.category, val: category },
        { col: mIdx.supplier, val: supplier },
        { col: mIdx.name, val: name },
        { col: mIdx.priceExTax, val: row[wIdx.priceExTax] },
        { col: mIdx.active, val: '有効' },
        { col: mIdx.expiryManaged, val: EXPIRY_MANAGED_NO }
      ]));
      stat.createdMaster++;
    } else {
      stat.reused++;
    }

    if (alreadyDeployed[productId]) { stat.skippedAlready++; continue; }
    alreadyDeployed[productId] = true;

    newInvRows.push(buildRowByIndex_(iCols, [
      { col: iIdx.clinic, val: HOUMON_CLINIC },
      { col: iIdx.productId, val: productId },
      { col: iIdx.name, val: name },
      { col: iIdx.mode, val: mode },
      { col: iIdx.kijun, val: row[wIdx.kijun] },
      { col: iIdx.trigger, val: toStr(row[wIdx.trigger]) },
      // 発注トリガー管理は在庫数を持たない（管理対象外）
      { col: iIdx.stock, val: (mode === '発注トリガー管理') ? '（管理対象外）' : numOrZero(row[wIdx.stock]) },
      { col: iIdx.openQty, val: 0 },
      { col: iIdx.expiry, val: '' },
      { col: iIdx.updatedAt, val: now }
    ]));
  }

  var summary = '対象：' + HOUMON_CLINIC + OUTPUT_SUFFIX + ' の ' + (wVals.length - 1) + '行\n' +
    '・医院別在庫へ追加：' + newInvRows.length + '件\n' +
    '　　うち商品マスタにも新規登録：' + stat.createdMaster + '件\n' +
    '　　既存商品と同一（商品ID・QRを共有）：' + stat.reused + '件\n' +
    '・管理方式が未設定のため見送り：' + stat.skippedNoMode + '件\n' +
    '・取り扱いなしのため見送り：' + stat.skippedNotHandled + '件\n' +
    '・既に載っているため見送り：' + stat.skippedAlready + '件';

  if (dryRun) {
    return summary + '\n\n実際に反映するには deployHoumonToOperations を実行してください。' +
      (stat.skippedNoMode
        ? '\n※ 管理方式が未設定の資材は載りません。訪問部ホームの「管理方式を設定」画面で決めてから、もう一度実行してください。'
        : '');
  }

  if (!newInvRows.length) {
    return summary + '\n\n追加するものがありませんでした。何も書き込んでいません。' +
      (stat.skippedNoMode
        ? '\n※ 管理方式が未設定の資材があります。訪問部ホームの「管理方式を設定」画面で決めてから、もう一度実行してください。'
        : '');
  }

  if (newMasterRows.length) {
    masterSheet.getRange(masterSheet.getLastRow() + 1, 1, newMasterRows.length, mCols)
      .setValues(newMasterRows);
  }
  invSheet.getRange(invSheet.getLastRow() + 1, 1, newInvRows.length, iCols)
    .setValues(newInvRows);
  SpreadsheetApp.flush();

  return summary + '\n\n完了しました。\n' +
    '訪問部ホームの在庫一覧・発注・入荷が使えるようになります。\n' +
    '新しく登録した商品のQRは「QRコード発行」画面（医院＝訪問部）から印刷してください。' +
    (stat.skippedNoMode
      ? '\n※ 管理方式が未設定の資材は載せていません。設定後にもう一度実行すれば追加されます。'
      : '');
}
