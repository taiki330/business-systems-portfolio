/**
 * 管理方式 設定Webアプリ（サーバーサイド）
 * ------------------------------------------------------------------
 * 目的:
 *   医院別シート（NIS_在庫 等。migration.js で生成）を対象に、
 *   資材ごとの「管理方式」をブラウザ上で設定する。
 *     - 1件ずつ選択
 *     - 複数選択してまとめて設定
 *     - 「取り扱いなし」を選んでも行は削除せず、取り扱いなしとして残し一覧の最下部に置く
 *       （後から戻せるようにするため。運用データ側は master.js が取り扱いなしを除外する）
 *
 * 依存:
 *   migration.js の定数（CLINICS / OUTPUT_SUFFIX / KANRI_HOSHIKI）を共用する。
 *
 * デプロイ:
 *   clasp push 後、Apps Scriptエディタ →「デプロイ」→「新しいデプロイ」→
 *   種類「ウェブアプリ」。アクセス範囲は appsscript.json の webapp.access
 *   （既定 MYSELF＝自分のみ）。スタッフに使わせる場合はデプロイ設定で調整。
 */

// 管理方式の選択肢（Webアプリで選べる値）。空文字＝未設定。
// '取り扱いなし' は特別扱い（シートから行削除）。
var MODE_OPTIONS = ['', '数量管理', '発注トリガー管理', '取り扱いなし'];

// ※ Webアプリのエントリポイント doGet() は router.js に集約（画面を増やすため）。

/** 医院コード一覧を返す（クライアントの医院プルダウン用） */
function getClinicList() {
  return CLINICS;
}

/**
 * 指定医院シートの資材一覧を返す。
 *
 * この医院が既に運用中（＝医院別在庫にその医院の行がある＝②を実行済み）の場合は、
 * 本番の「医院別在庫」を直接読む（＝ここでの操作がそのまま発注・使用登録に反映される）。
 * まだ運用開始前（設定段階）の医院は、従来どおり作業用の「医院コード_在庫」シートを読む。
 * 医院別在庫には「カテゴリ」「発注先」列が無いため、商品マスタと商品IDで突き合わせて補う。
 *
 * @param {string} clinic 医院コード（NIS 等）
 * @return {{clinic:string, items:Array}}
 */
function getClinicItems(clinic) {
  if (isClinicLive_(clinic)) return getClinicItemsLive_(clinic);

  // 運用開始後に商品マスタ画面等から医院へ追加された商品は、旧来の作業用シートへ
  // 自動では入らない。画面表示前に差分だけを非破壊で補完し、一覧漏れを防ぐ。
  var synced = syncMissingOperationalItemsToClinicSheet_(clinic);
  var sheet = getClinicSheetOrThrow(clinic);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { clinic: clinic, items: [], synced: synced, live: false };

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var idx = headerIndex(values[0]);

  var items = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var name = row[idx.name];
    if (name === '' || name === null) continue;
    items.push({
      row: r + 1, // シート上の実行番号（1始まり）
      category: toStr(row[idx.category]),
      supplier: toStr(row[idx.supplier]),
      name: toStr(name),
      stock: toStr(row[idx.stock]),
      mode: toStr(row[idx.mode]),
      // 発注基準数（医院別）。数量管理商品でのみ使う。この医院シート固有の値なので、
      // 同じ資材でも医院ごとに異なる基準を持てる。
      kijun: toStr(row[idx.kijun])
    });
  }

  items.sort(function (a, b) { return kanriSortRank_(a.mode) - kanriSortRank_(b.mode); });

  // live=false：運用前の作業用シートなので、使用期限まわりの列は画面に出さない。
  return { clinic: clinic, items: items, synced: synced, live: false };
}

/** 運用中（医院別在庫にその医院の行がある）かどうか。 */
function isClinicLive_(clinic) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var invSheet = ss.getSheetByName(INVENTORY_SHEET_NAME);
  if (!invSheet || invSheet.getLastRow() < 2) return false;
  var lastCol = invSheet.getLastColumn();
  var values = invSheet.getRange(1, 1, invSheet.getLastRow(), lastCol).getValues();
  var iIdx = inventoryHeaderIndex(values[0]);
  for (var r = 1; r < values.length; r++) {
    if (toStr(values[r][iIdx.clinic]) === clinic) return true;
  }
  return false;
}

/** 運用中の医院向け：医院別在庫を直接読んで一覧を組み立てる（作業用シートは一切使わない）。 */
function getClinicItemsLive_(clinic) {
  var invSheet = getInventorySheetOrThrow();
  var lastRow = invSheet.getLastRow();
  var lastCol = invSheet.getLastColumn();
  if (lastRow < 2) return { clinic: clinic, items: [], synced: 0 };

  var values = invSheet.getRange(1, 1, lastRow, lastCol).getValues();
  var iIdx = inventoryHeaderIndex(values[0]);
  var masterMap = getMasterInfoMap();
  var expiryManagedMap = getExpiryManagedMap(); // expiry.js：使用期限管理＝要 の商品のみ true
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();

  var items = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (toStr(row[iIdx.clinic]) !== clinic) continue;
    var pid = toStr(row[iIdx.productId]);
    var master = masterMap[pid] || {};
    var name = toStr(row[iIdx.name]) || toStr(master.name);
    if (!name) continue;
    items.push({
      row: r + 1, // 医院別在庫シート上の実行番号（1始まり）
      productId: pid,
      category: toStr(master.category),
      supplier: toStr(master.supplier),
      name: name,
      stock: toStr(row[iIdx.stock]),
      mode: toStr(row[iIdx.mode]),
      kijun: toStr(row[iIdx.kijun]),
      // 使用期限管理は商品そのものの性質なので商品マスタ側（＝全医院共通）の値。
      expiryManaged: expiryManagedMap[pid] ? EXPIRY_MANAGED_YES : EXPIRY_MANAGED_NO,
      // 使用期限はこの医院が持っているロットの期限なので医院別在庫側（＝医院ごと）の値。
      expiry: (iIdx.expiry >= 0) ? formatExpiryForInput_(row[iIdx.expiry], tz) : ''
    });
  }

  items.sort(function (a, b) { return kanriSortRank_(a.mode) - kanriSortRank_(b.mode); });

  // live=true のときだけ画面に使用期限の列を出す。
  // 運用前の作業用シートには使用期限の置き場所が無いため。
  return { clinic: clinic, items: items, synced: 0, live: true };
}

/** 医院別在庫の使用期限セルを <input type="date"> 用の 'YYYY-MM-DD' にする（未設定は ''）。 */
function formatExpiryForInput_(v, tz) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return '';
}

// 並び順を3段階にする：未入力(0) → 設定済み(1) → 取り扱いなし(2)。
// 未入力を上に集めて残作業を分かりやすく、取り扱いなしは最下部に控えさせる。
// 選択した瞬間ではなく、保存→再読み込みで一覧を取り直したときに反映される。
// シートの物理的な行順は変えず、返す配列の順序のみ変更する（各itemはrow番号を保持）。
function kanriSortRank_(mode) {
  if (mode === '') return 0;             // 未入力
  if (mode === '取り扱いなし') return 2; // 取り扱いなし
  return 1;                              // 設定済み（数量管理・発注トリガー管理）
}

/**
 * 運用中の「医院別在庫」にあり、管理方式設定用の「医院コード_在庫」にない商品を追記する。
 * 既存行は一切変更せず、カテゴリ＋発注先＋品名が一致する商品は追加しない。
 * @param {string} clinic
 * @return {number} 追加件数
 */
function syncMissingOperationalItemsToClinicSheet_(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var workSheet = getClinicSheetOrThrow(clinic);
    var workLastCol = workSheet.getLastColumn();
    var workLastRow = workSheet.getLastRow();
    var workHeaders = workSheet.getRange(1, 1, 1, workLastCol).getValues()[0];
    var wIdx = headerIndex(workHeaders);
    var existing = {};
    if (workLastRow >= 2) {
      var workValues = workSheet.getRange(2, 1, workLastRow - 1, workLastCol).getValues();
      workValues.forEach(function (row) {
        var name = toStr(row[wIdx.name]);
        if (name) existing[kanriSyncKey_(row[wIdx.category], row[wIdx.supplier], name)] = true;
      });
    }

    var invSheet = getInventorySheetOrThrow();
    var invLastRow = invSheet.getLastRow();
    if (invLastRow < 2) return 0;
    var invLastCol = invSheet.getLastColumn();
    var invValues = invSheet.getRange(1, 1, invLastRow, invLastCol).getValues();
    var iIdx = inventoryHeaderIndex(invValues[0]);
    var masterMap = getMasterInfoMap();
    var toAdd = [];
    for (var r = 1; r < invValues.length; r++) {
      var inv = invValues[r];
      if (toStr(inv[iIdx.clinic]) !== clinic) continue;
      var pid = toStr(inv[iIdx.productId]);
      var master = masterMap[pid] || {};
      var name = toStr(inv[iIdx.name]) || toStr(master.name);
      if (!name) continue;
      var category = toStr(master.category);
      var supplier = toStr(master.supplier);
      var key = kanriSyncKey_(category, supplier, name);
      if (existing[key]) continue;
      existing[key] = true;

      var out = Array(workLastCol).fill('');
      out[wIdx.category] = category;
      out[wIdx.supplier] = supplier;
      out[wIdx.name] = name;
      out[wIdx.stock] = inv[iIdx.stock];
      out[wIdx.mode] = toStr(inv[iIdx.mode]);
      out[wIdx.kijun] = inv[iIdx.kijun];
      toAdd.push(out);
    }
    if (!toAdd.length) return 0;

    var startRow = workSheet.getLastRow() + 1;
    applyKanriValidation_(workSheet, wIdx.mode, (startRow - 2) + toAdd.length);
    workSheet.getRange(startRow, 1, toAdd.length, workLastCol).setValues(toAdd);
    SpreadsheetApp.flush();
    return toAdd.length;
  } finally {
    lock.releaseLock();
  }
}

function kanriSyncKey_(category, supplier, name) {
  function norm(v) { return toStr(v).replace(/[　\s]+/g, ' ').toLowerCase(); }
  return norm(category) + '\u0001' + norm(supplier) + '\u0001' + norm(name);
}

/**
 * 変更内容を保存する。
 * @param {string} clinic 医院コード
 * @param {Array<{row:number, mode:string, kijun:(string|number)}>} changes 変更のあった行のみ。
 *        kijun は発注基準数（数量管理商品のみ有効。空文字＝未設定）。
 * @return {{updated:number, deleted:number}}
 */
function saveKanri(clinic, changes) {
  if (!changes || !changes.length) return { updated: 0, deleted: 0 };
  if (isClinicLive_(clinic)) return saveKanriLive_(clinic, changes);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getClinicSheetOrThrow(clinic);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var idx = headerIndex(values[0]);

    // 行番号 → {mode, kijun} のマップ
    var changeMap = {};
    changes.forEach(function (ch) {
      if (MODE_OPTIONS.indexOf(ch.mode) < 0) {
        throw new Error('不正な管理方式です: ' + ch.mode);
      }
      changeMap[ch.row] = { mode: ch.mode, kijun: normalizeKijun(ch.kijun) };
    });

    // 既存データを走査し、変更を反映して詰め直す。
    // 「取り扱いなし」も行削除せず、その管理方式のまま残す（後で戻せるよう最下部に置く方針）。
    var newData = [];
    var updated = 0;
    for (var r = 1; r < values.length; r++) {
      var sheetRow = r + 1;
      var row = values[r];
      if (changeMap.hasOwnProperty(sheetRow)) {
        var ch = changeMap[sheetRow];
        row[idx.mode] = ch.mode;
        // 発注基準数は数量管理商品でのみ保持する。
        // 発注トリガー管理・取り扱いなし・未設定に切り替えた場合は数値基準を使わないため空にする。
        row[idx.kijun] = (ch.mode === '数量管理') ? ch.kijun : '';
        updated++;
      }
      newData.push(row);
    }

    // 既存シートの管理方式列の入力規則が2択（取り扱いなし無し）のままだと、
    // 「取り扱いなし」をsetValuesで書き込む際に弾かれて例外になる。
    // 3択（取り扱いなし含む）の入力規則を貼り直してから書き戻す（migration.jsの共通ヘルパー）。
    applyKanriValidation_(sheet, idx.mode, newData.length);

    // 書き戻し（値の型はgetValues由来なので日付・数値も保持される）。
    // 行削除は行わないため行数は変わらない（余分な末尾行の削除処理も不要）。
    if (newData.length > 0) {
      sheet.getRange(2, 1, newData.length, lastCol).setValues(newData);
    }

    // deleted は互換のため残すが、行削除しなくなったため常に0。
    return { updated: updated, deleted: 0 };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 運用中の医院向け：医院別在庫に直接「管理方式」「発注基準数」「使用期限」を書き込み、
 * 「使用期限管理（要/不要）」は商品マスタへ書き込む。
 *
 * 書き込み先が2つに分かれる理由:
 *   - 使用期限（日付）… 医院ごとに持っているロットが違うので医院別在庫（この医院の行だけ）
 *   - 使用期限管理     … 「その資材に期限があるか」は商品そのものの性質なので商品マスタ。
 *                        こちらは医院共通のため、1医院で変えると全医院に反映される。
 */
function saveKanriLive_(clinic, changes) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var invSheet = getInventorySheetOrThrow();
    var lastRow = invSheet.getLastRow();
    var lastCol = invSheet.getLastColumn();
    var values = invSheet.getRange(1, 1, lastRow, lastCol).getValues();
    var iIdx = inventoryHeaderIndex(values[0]);

    // 先に全件バリデーション（1件でも不正なら何も書かずに中断＝部分更新を防ぐ）
    var changeMap = {};
    changes.forEach(function (ch) {
      if (MODE_OPTIONS.indexOf(ch.mode) < 0) {
        throw new Error('不正な管理方式です: ' + ch.mode);
      }
      changeMap[ch.row] = {
        mode: ch.mode,
        kijun: normalizeKijun(ch.kijun),
        expiryManaged: normalizeExpiryManaged_(ch.expiryManaged),
        expiry: normalizeExpiryDate_(ch.expiry)
      };
    });

    // 変更をメモリ上に反映してから、触れた列だけを1回ずつまとめ書きする。
    // 「表示中を全選択 → まとめて設定」で数百件が一度に来ても書き込みは数回で済む。
    // 1行ずつ setValue すると数百〜千回に膨らみ、その間ロックを握って
    // 他医院の使用登録・発注をタイムアウトさせてしまう。
    var updated = 0;
    var expiryTouched = false;
    var masterFlagByPid = {}; // 商品ID -> '要'/'不要'（商品マスタへまとめて反映する）
    for (var r = 1; r < values.length; r++) {
      var sheetRow = r + 1;
      if (toStr(values[r][iIdx.clinic]) !== clinic) continue;
      if (!changeMap.hasOwnProperty(sheetRow)) continue;
      var ch = changeMap[sheetRow];
      values[r][iIdx.mode] = ch.mode;
      values[r][iIdx.kijun] = (ch.mode === '数量管理') ? ch.kijun : '';

      // 使用期限（この医院のロット）。null＝画面から送られていない＝変更しない。
      // '' を入れると、まとめ書きのときにそのセルが空になる（クリアと同じ）。
      if (iIdx.expiry >= 0 && ch.expiry !== null) {
        values[r][iIdx.expiry] = ch.expiry;
        expiryTouched = true;
      }

      // 使用期限管理（商品の性質・全医院共通）。
      // 「不要」に戻しても日付は消さない。入力し直す手間が大きく、
      // 「要」に戻したときにそのまま使えるほうが安全なため（アラート対象からは外れる）。
      if (ch.expiryManaged !== null) {
        var pid = toStr(values[r][iIdx.productId]);
        if (pid) masterFlagByPid[pid] = ch.expiryManaged;
      }
      updated++;
    }

    if (updated > 0) {
      writeSheetColumn_(invSheet, values, iIdx.mode);   // usage.js
      writeSheetColumn_(invSheet, values, iIdx.kijun);
      if (expiryTouched) writeSheetColumn_(invSheet, values, iIdx.expiry);
    }

    var masterUpdated = applyExpiryManagedToMaster_(masterFlagByPid);
    if (masterUpdated > 0) clearExpiryManagedCache_();
    if (masterUpdated > 0) safeRebuildExpiryViewAll_();
    else if (expiryTouched) safeRefreshExpiryViewForClinic_(clinic);

    SpreadsheetApp.flush();
    return { updated: updated, deleted: 0, expiryManagedUpdated: masterUpdated };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 使用期限管理の入力値を検証する。
 * @return {(string|null)} '要'/'不要'、または null（画面から送られていない＝変更しない）
 */
function normalizeExpiryManaged_(v) {
  if (v === undefined || v === null) return null;
  var s = toStr(v);
  if (s === '') return null;
  if (s !== EXPIRY_MANAGED_YES && s !== EXPIRY_MANAGED_NO) {
    throw new Error('使用期限管理は「' + EXPIRY_MANAGED_YES + '」か「' + EXPIRY_MANAGED_NO +
      '」で指定してください（入力値: ' + s + '）。');
  }
  return s;
}

/**
 * 使用期限の入力値（'YYYY-MM-DD'）を Date にする。
 * タイムゾーンの解釈差で前日・翌日にずれないよう、文字列を分解して組み立てる。
 * @return {(Date|string|null)} Date＝その日付に設定 ／ ''＝クリア ／ null＝変更しない
 */
function normalizeExpiryDate_(v) {
  if (v === undefined || v === null) return null;
  var s = toStr(v);
  if (s === '') return '';
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) {
    throw new Error('使用期限は「2027-03-31」のような形式で入力してください（入力値: ' + s + '）。');
  }
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) {
    throw new Error('使用期限の日付が正しくありません（入力値: ' + s + '）。');
  }
  return d;
}

/**
 * 商品マスタの「使用期限管理」列をまとめて更新する。
 * 値が変わらない行には書き込まない（無駄な書き込みでロックを長く握らないため）。
 * @param {Object} flagByPid 商品ID -> '要'/'不要'
 * @return {number} 実際に書き換えた商品数
 */
function applyExpiryManagedToMaster_(flagByPid) {
  var pids = Object.keys(flagByPid);
  if (!pids.length) return 0;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!sheet) throw new Error(MASTER_SHEET_NAME + ' シートがありません。');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var header = values[0];
  var idId = header.indexOf('商品ID');
  var idFlag = header.indexOf('使用期限管理');
  if (idId < 0 || idFlag < 0) {
    throw new Error('商品マスタに「商品ID」または「使用期限管理」列が見つかりません。');
  }

  var changed = 0;
  for (var r = 1; r < values.length; r++) {
    var pid = toStr(values[r][idId]);
    if (!flagByPid.hasOwnProperty(pid)) continue;
    if (toStr(values[r][idFlag]) === flagByPid[pid]) continue; // 変化なし
    values[r][idFlag] = flagByPid[pid];
    changed++;
  }
  // 使用期限が必要な資材は全体のごく一部なので通常は数件だが、
  // 件数が増えても書き込みが1回で済むよう列単位でまとめ書きする。
  if (changed > 0) writeSheetColumn_(sheet, values, idFlag); // usage.js
  return changed;
}

/**
 * 医院別シートに新しい資材を1行追加する（①管理方式ツールからの資材追加）。
 * 管理方式・発注基準数は未設定（空欄）で追加するため、一覧では未入力として上に並び、
 * そのまま管理方式を設定できる。書き込み先はあくまで医院別シート（設定段階のデータ）で、
 * 運用側の商品マスタ・医院別在庫には次回のマスタ統合時に取り込まれる。
 * @param {string} clinic 医院コード
 * @param {{category:string, supplier:string, name:string, stock:(string|number)}} item
 * @param {boolean} [force] 同名がこの医院に既にあっても追加する場合 true
 * @return {{added:boolean, duplicate:boolean, name:string, row:(number|undefined)}}
 */
function addClinicItem(clinic, item, force) {
  var name = toStr(item && item.name);
  if (name === '') throw new Error('品名を入力してください。');

  // 現在庫数：空欄は許容。値がある場合は0以上の数値のみ許可し、数値型で保存する。
  var stockStr = toStr(item && item.stock);
  var stock = '';
  if (stockStr !== '') {
    var n = Number(stockStr);
    if (isNaN(n) || n < 0) {
      throw new Error('現在庫数は0以上の数値で入力してください（入力値: ' + stockStr + '）。');
    }
    stock = n;
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getClinicSheetOrThrow(clinic);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var idx = headerIndex(header);

    // 重複チェック（同じ品名がこの医院に既にあるか）。あれば force=true のときのみ追加する。
    var duplicate = false;
    if (lastRow >= 2) {
      var names = sheet.getRange(2, idx.name + 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < names.length; i++) {
        if (toStr(names[i][0]) === name) { duplicate = true; break; }
      }
    }
    if (duplicate && !force) {
      return { added: false, duplicate: true, name: name };
    }

    // シート幅に合わせた空行を作り、必要な列だけ埋める（他の列は空のまま）
    var row = [];
    for (var c = 0; c < lastCol; c++) row.push('');
    row[idx.category] = toStr(item.category);
    row[idx.supplier] = toStr(item.supplier);
    row[idx.name] = name;
    row[idx.stock] = stock;
    row[idx.mode] = '';   // 管理方式は未設定（一覧の上に並ぶ）
    row[idx.kijun] = '';  // 発注基準数も未設定

    sheet.appendRow(row);
    return { added: true, duplicate: duplicate, name: name, row: sheet.getLastRow() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 資材の品名を変更する。
 * 指定した医院の指定行だけでなく、同じ資材（カテゴリ＋発注先＋旧品名が一致）を
 * 持つ他の医院別シート（NIS_在庫 等）、および元になったソースシート
 * （診療室／バー／薬／ＤＨ／オペ関連(ＰＶ)／ハンドピース）の該当行も
 * 合わせて書き換える。
 * ソース側を更新しないと、ソースの旧名と出力側の新名がずれてしまい、
 * 「削除した資材を復旧」実行時に旧名で重複登録されてしまうため必須の処理。
 * @param {string} clinic 変更元の医院コード
 * @param {number} row 変更元の医院シート上の行番号（1始まり）
 * @param {string} newName 新しい品名
 * @return {{oldName:string, newName:string, updatedClinics:Array<{clinic:string,row:number}>, updatedSource:(string|null)}}
 */
function renameItem(clinic, row, newName) {
  newName = toStr(newName);
  if (newName === '') throw new Error('品名を入力してください。');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getClinicSheetOrThrow(clinic);
    var lastCol = sheet.getLastColumn();
    var idx = headerIndex(sheet.getRange(1, 1, 1, lastCol).getValues()[0]);

    var rowVals = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
    var oldName = toStr(rowVals[idx.name]);
    var category = toStr(rowVals[idx.category]);
    var supplier = toStr(rowVals[idx.supplier]);
    if (oldName === '') throw new Error('対象の行が見つかりません（品名が空です）。');
    if (newName === oldName) {
      return { oldName: oldName, newName: newName, updatedClinics: [], updatedSource: null };
    }

    // 同一医院内で、別の行に既に同じ資材（カテゴリ＋発注先＋新品名）が無いか確認する。
    // 誤って別商品と統合してしまうのを防ぐための安全チェック。
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var all = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
      for (var i = 0; i < all.length; i++) {
        var r = i + 2;
        if (r === row) continue;
        if (toStr(all[i][idx.category]) === category && toStr(all[i][idx.supplier]) === supplier &&
            toStr(all[i][idx.name]) === newName) {
          throw new Error('この医院に既に同じ品名の資材があります（' + r + '行目）。' +
            '別の商品と統合されてしまうため中止しました。');
        }
      }
    }

    // ---- 医院別シート（NIS_在庫 等）を横断して、同じ資材の品名を更新 ----
    var updatedClinics = [];
    CLINICS.forEach(function (c) {
      var sh = getClinicSheetOrThrow(c);
      var lr = sh.getLastRow();
      if (lr < 2) return;
      var lc = sh.getLastColumn();
      var ix = headerIndex(sh.getRange(1, 1, 1, lc).getValues()[0]);
      var vals = sh.getRange(2, 1, lr - 1, lc).getValues();
      for (var j = 0; j < vals.length; j++) {
        if (toStr(vals[j][ix.category]) === category && toStr(vals[j][ix.supplier]) === supplier &&
            toStr(vals[j][ix.name]) === oldName) {
          sh.getRange(j + 2, ix.name + 1).setValue(newName);
          updatedClinics.push({ clinic: c, row: j + 2 });
        }
      }
    });

    // ---- 元になったソースシートも合わせて更新（無ければ何もしない） ----
    var updatedSource = renameInSourceSheet_(category, supplier, oldName, newName);

    return { oldName: oldName, newName: newName, updatedClinics: updatedClinics, updatedSource: updatedSource };
  } finally {
    lock.releaseLock();
  }
}

/**
 * カテゴリに応じたソースシート（診療室/バー/薬/ＤＨ/オペ関連(ＰＶ)/ハンドピース）の
 * 該当行の品名を書き換える。該当シート・該当行が無ければ null を返す（無理に探さない。
 * 手作業で追加した資材などソースを持たない行は対象外になる）。
 * migration.js の SOURCE_CONFIG / OPE_PV_CONFIG / HANDPIECE_CONFIG を共用する。
 */
function renameInSourceSheet_(category, supplier, oldName, newName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (typeof SOURCE_CONFIG !== 'undefined' && SOURCE_CONFIG[category]) {
    var cfg = SOURCE_CONFIG[category];
    var sheet = ss.getSheetByName(category);
    if (!sheet) return null;
    var lastRow = sheet.getLastRow();
    if (lastRow < cfg.dataStart) return null;
    var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
    for (var r = cfg.dataStart - 1; r < values.length; r++) {
      var row = values[r];
      if (cellStr(row, cfg.common.name) === oldName && cellStr(row, cfg.common.maker) === supplier) {
        sheet.getRange(r + 1, cfg.common.name).setValue(newName);
        return category + '!' + (r + 1);
      }
    }
    return null;
  }

  if (typeof OPE_PV_CONFIG !== 'undefined' && category === OPE_PV_CONFIG.sheetName) {
    var cfg2 = OPE_PV_CONFIG;
    var sheet2 = ss.getSheetByName(cfg2.sheetName);
    if (!sheet2) return null;
    var lastRow2 = sheet2.getLastRow();
    if (lastRow2 < cfg2.dataStart) return null;
    var values2 = sheet2.getRange(1, 1, lastRow2, sheet2.getLastColumn()).getValues();
    for (var r2 = cfg2.dataStart - 1; r2 < values2.length; r2++) {
      var row2 = values2[r2];
      var baseName = cellStr(row2, cfg2.colName);
      var spec = cellStr(row2, cfg2.colSpec).replace(/\n/g, ' ');
      var fullName = spec ? baseName + '（' + spec + '）' : baseName;
      if (fullName !== oldName) continue;
      if (spec) return null; // 規格併記で表示名を合成しているため自動更新はスキップ（要手動確認）
      sheet2.getRange(r2 + 1, cfg2.colName).setValue(newName);
      return cfg2.sheetName + '!' + (r2 + 1);
    }
    return null;
  }

  if (typeof HANDPIECE_CONFIG !== 'undefined' && category === HANDPIECE_CONFIG.sheetName) {
    var cfg3 = HANDPIECE_CONFIG;
    var sheet3 = ss.getSheetByName(cfg3.sheetName);
    if (!sheet3) return null;
    var lastRow3 = sheet3.getLastRow();
    if (lastRow3 < cfg3.dataStart) return null;
    var values3 = sheet3.getRange(1, 1, lastRow3, sheet3.getLastColumn()).getValues();
    for (var r3 = cfg3.dataStart - 1; r3 < values3.length; r3++) {
      var row3 = values3[r3];
      if (cellStr(row3, cfg3.colName) === oldName && cellStr(row3, cfg3.colMaker) === supplier) {
        sheet3.getRange(r3 + 1, cfg3.colName).setValue(newName);
        return cfg3.sheetName + '!' + (r3 + 1);
      }
    }
    return null;
  }

  return null;
}

// ===== ヘルパー =====

function getClinicSheetOrThrow(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(clinic + OUTPUT_SUFFIX);
  if (!sheet) {
    throw new Error(clinic + OUTPUT_SUFFIX +
      ' シートが見つかりません。先に「棚卸しツール →① 医院別シートを生成」を実行してください。');
  }
  return sheet;
}

/** ヘッダー行から必要列のインデックス（0始まり）を取得 */
function headerIndex(headerRow) {
  function find(label) {
    for (var i = 0; i < headerRow.length; i++) {
      if (toStr(headerRow[i]) === label) return i;
    }
    throw new Error('列「' + label + '」が見つかりません。医院別シートの形式をご確認ください。');
  }
  return {
    category: find('カテゴリ'),
    // 医院別作業シートの列名は「メーカー」だが、中身は発注先（master.js 冒頭コメント参照）。
    supplier: find('メーカー'),
    name: find('品名'),
    stock: find('現在庫数'),
    mode: find('管理方式'),
    kijun: find('発注基準数')
  };
}

function toStr(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

/**
 * 発注基準数を正規化する。空欄は '' のまま許容し、値がある場合は
 * 0以上の数値であることを確認して数値型で返す（シートに数値として保存するため）。
 */
function normalizeKijun(v) {
  var s = toStr(v);
  if (s === '') return '';
  var n = Number(s);
  if (isNaN(n) || n < 0) {
    throw new Error('発注基準数は0以上の数値で入力してください（入力値: ' + s + '）。');
  }
  return n;
}
