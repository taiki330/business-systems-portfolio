/**
 * QR読取・使用登録・在庫減算（サーバーサイド）
 * ------------------------------------------------------------------
 * 目的（要件定義書 10.4 / 10.4a / 10.5）:
 *   スタッフがスマホでQRを読み取り、
 *     - 数量管理商品   → 使用数量を確定し、医院別在庫を減算・使用履歴を記録
 *     - 発注トリガー管理商品 → 在庫は変えず、発注候補へ登録
 *
 * 依存:
 *   master.js  … INVENTORY_SHEET_NAME（医院別在庫）
 *   qr.js      … QR_PREFIX / parseQrText
 *   migration.js … CLINICS
 *
 * 安全設計:
 *   - LockService で同時更新を直列化
 *   - 処理ID（クライアント生成）で二重送信を防止
 *   - マイナス在庫は許容し、警告フラグを返す（要件 15.4）
 *   - 使用履歴・発注候補シートは無ければ自動生成（既存は壊さない）
 */

var USAGE_HISTORY_SHEET = '使用履歴';
var USAGE_HISTORY_HEADERS = [
  '処理ID', '使用日時', '医院ID', '商品ID', '品名', '使用数量',
  '登録者', '登録日時', '登録前在庫', '登録後在庫', '取消フラグ', '取消理由'
];

var ORDER_CANDIDATE_SHEET = '発注候補';
var ORDER_CANDIDATE_HEADERS = [
  '候補ID', '医院ID', '商品ID', '品名', '登録理由', '発注トリガー条件', '登録者', '登録日時', '状態'
];
var ORDER_CANDIDATE_STATUS_OPEN = '未発注';
var CANDIDATE_REASON_TRIGGER = '発注トリガー';
var CANDIDATE_REASON_THRESHOLD = '在庫基準以下'; // 現在庫＋未入荷数量 が発注基準数以下（判定式B）


/**
 * QR読取画面の初期データ。医院別在庫から、その医院の商品情報を返す。
 * クライアントは products[商品ID] でQRの商品を引く。
 * @param {string} clinic 医院コード
 * @return {{clinic:string, qrPrefix:string, products:Object}}
 */
function getUsageContext(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  var sheet = getInventorySheetOrThrow();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  var products = {};
  if (lastRow >= 2) {
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var idx = inventoryHeaderIndex(values[0]);
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      if (toStr(row[idx.clinic]) !== clinic) continue;
      var pid = toStr(row[idx.productId]);
      if (pid === '') continue;
      products[pid] = {
        productId: pid,
        name: toStr(row[idx.name]),
        mode: toStr(row[idx.mode]),
        trigger: toStr(row[idx.trigger]),
        stock: toStr(row[idx.stock])
      };
    }
  }
  return { clinic: clinic, qrPrefix: QR_PREFIX, products: products };
}

/**
 * QR読取の確定処理。数量管理商品の使用登録と、発注トリガー商品の候補登録を
 * まとめて1つのロック内で実行する。
 *
 * @param {string} clinic 医院コード
 * @param {{
 *   processId:string,
 *   registrant:string,
 *   usageItems:Array<{productId:string, qty:number}>,
 *   triggerItems:Array<string>
 * }} payload
 * @return {{duplicated:boolean, usage:Array, candidates:{added:number, skipped:number}}}
 */
function confirmScan(clinic, payload) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  payload = payload || {};
  var processId = toStr(payload.processId);
  if (processId === '') throw new Error('処理IDがありません。画面を再読み込みしてください。');
  var registrant = toStr(payload.registrant);
  var usageItems = payload.usageItems || [];
  var triggerItems = payload.triggerItems || [];

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 二重送信防止：同じ処理IDが既に使用履歴にあれば、処理済みとして何もしない
    if (isProcessIdUsed(processId)) {
      return { duplicated: true, usage: [], candidates: { added: 0, skipped: 0 } };
    }

    var sheet = getInventorySheetOrThrow();
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var idx = inventoryHeaderIndex(values[0]);

    // 商品ID → 行index（0始まり、values内） のマップ（この医院のみ）
    var rowOf = {};
    for (var r = 1; r < values.length; r++) {
      if (toStr(values[r][idx.clinic]) !== clinic) continue;
      rowOf[toStr(values[r][idx.productId])] = r;
    }

    var now = new Date();
    var usageResults = [];
    var historyRows = [];

    // --- 数量管理商品の使用登録 ---
    usageItems.forEach(function (it) {
      var pid = toStr(it.productId);
      var qty = Number(it.qty);
      if (pid === '' || !(qty > 0)) return;
      var ri = rowOf[pid];
      if (ri === undefined) {
        throw new Error('医院別在庫に商品が見つかりません（' + clinic + ' / ' + pid + '）。');
      }
      var row = values[ri];
      if (toStr(row[idx.mode]) !== '数量管理') {
        throw new Error('数量管理以外の商品が使用登録に含まれています（' + pid + '）。');
      }
      var before = Number(row[idx.stock]);
      if (isNaN(before)) before = 0;
      var after = before - qty;

      row[idx.stock] = after;
      row[idx.updatedAt] = now;

      usageResults.push({
        productId: pid, name: toStr(row[idx.name]),
        qty: qty, before: before, after: after, negative: after < 0
      });
      historyRows.push([
        processId, now, clinic, pid, toStr(row[idx.name]), qty,
        registrant, now, before, after, '', ''
      ]);
    });

    // 在庫の書き戻し（変更のあった行のみ）
    usageResults.forEach(function (u) {
      var ri = rowOf[u.productId];
      sheet.getRange(ri + 1, idx.stock + 1).setValue(values[ri][idx.stock]);
      sheet.getRange(ri + 1, idx.updatedAt + 1).setValue(values[ri][idx.updatedAt]);
    });

    // 使用履歴を追記
    if (historyRows.length) appendRows(getOrCreateSheet(USAGE_HISTORY_SHEET, USAGE_HISTORY_HEADERS), historyRows);

    // --- 発注候補の登録 ---
    // ①発注トリガー管理商品（読取＝発注が必要のサイン）
    var entries = triggerItems.map(function (pidRaw) {
      return { productId: toStr(pidRaw), reason: CANDIDATE_REASON_TRIGGER };
    });
    // ②数量管理商品：使用登録の結果、現在庫＋未入荷数量が発注基準数以下になったもの
    //   （判定式B：要件定義書 15章で確定）
    entries = entries.concat(thresholdEntriesFromUsage(usageResults, rowOf, values, idx));

    var candResult = addOrderCandidates(clinic, entries, registrant, values, idx);

    return { duplicated: false, usage: usageResults, candidates: candResult };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 使用登録の結果（usageResults）から、発注基準数以下になった商品の
 * 発注候補エントリを作る。発注基準数が未設定の商品は判定しない。
 */
function thresholdEntriesFromUsage(usageResults, rowOf, values, idx) {
  var entries = [];
  usageResults.forEach(function (u) {
    var ri = rowOf[u.productId];
    var row = values[ri];
    if (isBelowThreshold(row, idx, u.after)) {
      entries.push({ productId: u.productId, reason: CANDIDATE_REASON_THRESHOLD });
    }
  });
  return entries;
}

/**
 * 現在庫（afterStock）＋発注済み未入荷数量 が発注基準数以下かを判定する。
 * 発注基準数が未設定（空欄）の場合は判定しない（false）。
 */
function isBelowThreshold(inventoryRow, idx, afterStock) {
  var kijunStr = toStr(inventoryRow[idx.kijun]);
  if (kijunStr === '') return false;
  var kijun = Number(kijunStr);
  if (isNaN(kijun)) return false;
  var openQty = Number(inventoryRow[idx.openQty]);
  if (isNaN(openQty)) openQty = 0;
  return (afterStock + openQty) <= kijun;
}

/**
 * 発注候補を発注候補シートへ追加する。
 * 同じ医院・商品で「未発注」の候補が既にあれば重複追加しない
 * （発注トリガーと在庫基準以下の両方から同時に候補化されても1件にまとまる）。
 * @param {string} clinic
 * @param {Array<{productId:string, reason:string}>} entries
 */
function addOrderCandidates(clinic, entries, registrant, invValues, invIdx) {
  if (!entries || !entries.length) return { added: 0, skipped: 0 };

  var candSheet = getOrCreateSheet(ORDER_CANDIDATE_SHEET, ORDER_CANDIDATE_HEADERS);
  var cLastRow = candSheet.getLastRow();
  var cIdx = candidateHeaderIndex(ORDER_CANDIDATE_HEADERS);

  // 既存の「未発注」候補を (医院+商品) で把握
  var SEP = '\u0001';
  var openSet = {};
  if (cLastRow >= 2) {
    var cVals = candSheet.getRange(2, 1, cLastRow - 1, ORDER_CANDIDATE_HEADERS.length).getValues();
    cVals.forEach(function (row) {
      if (toStr(row[cIdx.status]) === ORDER_CANDIDATE_STATUS_OPEN) {
        openSet[toStr(row[cIdx.clinic]) + SEP + toStr(row[cIdx.productId])] = true;
      }
    });
  }

  // 商品ID → 医院別在庫の行（品名・トリガー条件参照用）
  var invRowOf = {};
  for (var r = 1; r < invValues.length; r++) {
    if (toStr(invValues[r][invIdx.clinic]) !== clinic) continue;
    invRowOf[toStr(invValues[r][invIdx.productId])] = invValues[r];
  }

  var now = new Date();
  var added = 0, skipped = 0;
  var newRows = [];
  entries.forEach(function (e) {
    var pid = toStr(e.productId);
    if (pid === '') return;
    var key = clinic + SEP + pid;
    if (openSet[key]) { skipped++; return; }
    var inv = invRowOf[pid];
    var name = inv ? toStr(inv[invIdx.name]) : '';
    var trg = inv ? toStr(inv[invIdx.trigger]) : '';
    newRows.push([
      'C' + now.getTime() + '-' + (added + 1),
      clinic, pid, name, e.reason || '', trg, registrant, now, ORDER_CANDIDATE_STATUS_OPEN
    ]);
    openSet[key] = true;
    added++;
  });
  if (newRows.length) appendRows(candSheet, newRows);
  return { added: added, skipped: skipped };
}


/**
 * 即時使用（iPhone標準カメラ運用）。
 * QRのURLを開くと、この関数が1商品を即座に処理する。
 *   - 数量管理商品   → 在庫を1減算し、使用履歴を記録
 *   - 発注トリガー管理商品 → 発注候補へ登録（在庫は変えない）
 *
 * 二重処理防止:
 *   token（クライアントの1回のページ表示ごとに一意）を使用履歴の処理ID列に記録し、
 *   同じ token が既にあれば処理済みとして何もしない。
 *   （リロードによる二重は、クライアント側の短時間デバウンスでも防ぐ）
 *
 * @param {string} clinic 医院コード（端末に記憶した値）
 * @param {string} productId 商品ID
 * @param {string} token 冪等トークン
 * @return {Object} 処理結果
 */
function instantUse(clinic, productId, token) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  productId = toStr(productId);
  token = toStr(token);
  if (productId === '') throw new Error('商品IDがありません。');
  if (token === '') token = 'instant-' + new Date().getTime();

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (isProcessIdUsed(token)) {
      return { duplicated: true, message: 'この読み取りは処理済みです。' };
    }

    var sheet = getInventorySheetOrThrow();
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var idx = inventoryHeaderIndex(values[0]);

    var ri = -1;
    for (var r = 1; r < values.length; r++) {
      if (toStr(values[r][idx.clinic]) === clinic &&
          toStr(values[r][idx.productId]) === productId) { ri = r; break; }
    }
    if (ri < 0) {
      throw new Error('この医院（' + clinic + '）の在庫に商品が見つかりません（' + productId + '）。');
    }

    var row = values[ri];
    var name = toStr(row[idx.name]);
    var mode = toStr(row[idx.mode]);
    var now = new Date();

    if (mode === '発注トリガー管理') {
      var tr = addOrderCandidates(clinic,
        [{ productId: productId, reason: CANDIDATE_REASON_TRIGGER }], '', values, idx);
      return {
        duplicated: false, kind: 'trigger', name: name,
        added: tr.added, skipped: tr.skipped,
        message: tr.added ? '発注候補に追加しました。' : 'すでに発注候補に入っています。'
      };
    }

    if (mode === '数量管理') {
      var before = Number(row[idx.stock]);
      if (isNaN(before)) before = 0;
      var after = before - 1;
      sheet.getRange(ri + 1, idx.stock + 1).setValue(after);
      sheet.getRange(ri + 1, idx.updatedAt + 1).setValue(now);
      appendRows(getOrCreateSheet(USAGE_HISTORY_SHEET, USAGE_HISTORY_HEADERS),
        [[token, now, clinic, productId, name, 1, '', now, before, after, '', '']]);

      // 発注基準数以下になっていれば、発注候補へ自動登録（判定式B）
      var candAdded = false;
      if (isBelowThreshold(row, idx, after)) {
        var cr = addOrderCandidates(clinic,
          [{ productId: productId, reason: CANDIDATE_REASON_THRESHOLD }], '', values, idx);
        candAdded = cr.added > 0;
      }

      return {
        duplicated: false, kind: 'usage', name: name,
        before: before, after: after, negative: after < 0,
        orderCandidateAdded: candAdded,
        message: '使用登録しました。'
      };
    }

    throw new Error('管理方式が未設定の商品です（' + productId + '）。管理方式設定ツールで設定してください。');
  } finally {
    lock.releaseLock();
  }
}


/**
 * 即時使用画面の確認表示用に、1商品の情報だけを返す（読み取り専用・在庫は変えない）。
 *
 * QRを開いた時点では在庫を動かさず、この情報を見せて「本当にこれでよいか」を
 * スタッフに確認させるために使う。実際の減算はボタン押下で instantUse が行う。
 * これにより、画面の再読み込み・戻る操作で在庫が減ることがなくなる。
 *
 * @param {string} clinic 医院コード
 * @param {string} productId 商品ID
 * @return {{found:boolean, name:string, mode:string, stock:(number|null)}}
 */
function getInstantUseInfo(clinic, productId) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  productId = toStr(productId);
  if (productId === '') throw new Error('商品IDがありません。');

  var sheet = getInventorySheetOrThrow();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { found: false, clinic: clinic, productId: productId };

  var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var idx = inventoryHeaderIndex(values[0]);

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (toStr(row[idx.clinic]) !== clinic) continue;
    if (toStr(row[idx.productId]) !== productId) continue;

    var mode = toStr(row[idx.mode]);
    return {
      found: true,
      clinic: clinic,
      productId: productId,
      name: toStr(row[idx.name]),
      mode: mode,
      // 発注トリガー管理は在庫数を持たないため null を返す（画面側で在庫欄を出さない）
      stock: (mode === '数量管理') ? numOrZero(row[idx.stock]) : null
    };
  }
  return { found: false, clinic: clinic, productId: productId };
}


// ===== ヘルパー =====

function getInventorySheetOrThrow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(INVENTORY_SHEET_NAME); // master.js の定数
  if (!sheet) {
    throw new Error(INVENTORY_SHEET_NAME +
      ' シートがありません。先に「棚卸しツール →② 商品マスタ・医院別在庫を生成」を実行してください。');
  }
  return sheet;
}

/**
 * 医院別在庫から指定医院の行だけを読み込む。
 * 全医院分の全列を毎回取得すると、期限・入荷画面の初期表示が遅くなるため、
 * 医院ID列で該当範囲を特定してから必要な行ブロックだけを取得する。
 * @param {string} clinic
 * @return {{sheet:GoogleAppsScript.Spreadsheet.Sheet,values:Array,idx:Object}}
 */
function getClinicInventoryValues_(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  var sheet = getInventorySheetOrThrow();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = inventoryHeaderIndex(header);
  if (lastRow < 2) return { sheet: sheet, values: [header], idx: idx };

  var clinics = sheet.getRange(2, idx.clinic + 1, lastRow - 1, 1).getValues();
  var first = -1, last = -1;
  for (var i = 0; i < clinics.length; i++) {
    if (toStr(clinics[i][0]) !== clinic) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return { sheet: sheet, values: [header], idx: idx };

  var block = sheet.getRange(first + 2, 1, last - first + 1, lastCol).getValues();
  var values = [header];
  block.forEach(function (row) {
    if (toStr(row[idx.clinic]) === clinic) values.push(row);
  });
  return { sheet: sheet, values: values, idx: idx };
}

/** 医院別在庫のヘッダーから列インデックスを取得 */
function inventoryHeaderIndex(headerRow) {
  function find(label) {
    for (var i = 0; i < headerRow.length; i++) {
      if (toStr(headerRow[i]) === label) return i;
    }
    throw new Error('医院別在庫に列「' + label + '」が見つかりません。');
  }
  function findOptional(label) {
    for (var i = 0; i < headerRow.length; i++) {
      if (toStr(headerRow[i]) === label) return i;
    }
    return -1; // 旧シート等、列が無い場合は -1（呼び出し側で無視する）
  }
  return {
    clinic: find('医院ID'),
    productId: find('商品ID'),
    name: find('品名（参考）'),
    mode: find('管理方式'),
    kijun: find('発注基準数'),
    trigger: find('発注トリガー条件'),
    stock: find('現在庫数'),
    openQty: find('発注済み未入荷数量'),
    expiry: findOptional('使用期限'),
    updatedAt: find('最終更新日時')
  };
}

function candidateHeaderIndex(headerRow) {
  function find(label) {
    for (var i = 0; i < headerRow.length; i++) {
      if (toStr(headerRow[i]) === label) return i;
    }
    return -1;
  }
  return {
    clinic: find('医院ID'),
    productId: find('商品ID'),
    name: find('品名'),
    reason: find('登録理由'),
    trigger: find('発注トリガー条件'),
    status: find('状態')
  };
}

/** 使用履歴に同じ処理IDが既に存在するか（二重送信チェック） */
function isProcessIdUsed(processId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(USAGE_HISTORY_SHEET);
  if (!sheet) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  assertSheetHeaders_(sheet, USAGE_HISTORY_HEADERS);
  // 処理ID列（1列目）だけ読む
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (toStr(ids[i][0]) === processId) return true;
  }
  return false;
}

/**
 * 履歴系シート（使用履歴・発注候補・発注管理・入荷履歴・在庫確定履歴・在庫修正履歴・
 * 資材移動ログ）の見出し行が、コードの前提どおりの並びかを確認する。
 *
 * これらのシートは医院別在庫・商品マスタと違い、見出しを読まずに列位置を定数で
 * 決め打ちして読み書きしている。そのため誰かがスプレッドシート上で列を挿入・並べ替え
 * すると、エラーも出ないまま数量が品名の列に入るような壊れ方をする。
 * 黙って壊れるより確実に止めるほうが安全なので、食い違ったら中止する。
 */
function assertSheetHeaders_(sheet, headers) {
  if (sheet.getLastColumn() < headers.length) {
    throw new Error('「' + sheet.getName() + '」シートの列が足りません（' + headers.length +
      '列必要です）。列を削除していないかご確認ください。処理を中止しました。');
  }
  var actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (toStr(actual[i]) !== headers[i]) {
      throw new Error('「' + sheet.getName() + '」シートの列構成が変わっています。\n' +
        (i + 1) + '列目は「' + headers[i] + '」であるべきですが、' +
        '「' + toStr(actual[i]) + '」になっています。\n\n' +
        '列の挿入・並べ替え・見出しの変更を元に戻してください。' +
        'このまま続けると別の列にデータが書き込まれるため、処理を中止しました。');
    }
  }
}

/** シートを取得（無ければヘッダー付きで作成）。既存の場合は列構成を検証する。 */
function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers]).setFontWeight('bold').setBackground('#e8eef7');
    sheet.setFrozenRows(1);
    return sheet;
  }
  assertSheetHeaders_(sheet, headers);
  return sheet;
}

/**
 * シートの1列を、メモリ上の値でまとめて書き戻す（データ行のみ。ヘッダーは触らない）。
 *
 * なぜ必要か:
 *   変更した行を 1行ずつ setValue すると、数百件の保存で書き込みが千回単位に膨らむ。
 *   その間ずっとスクリプトロックを占有するため、他の医院の使用登録・発注が
 *   30秒待ちでタイムアウトする。列単位でまとめれば書き込みは1回で済む。
 *
 * 割り切り:
 *   変更していない行のセルも同じ値で書き戻される。ロック内で読み直した値をそのまま
 *   書くため内容は変わらないが、ロック中に人がスプレッドシートを直接編集していた場合は
 *   その手編集が戻る可能性がある。運用は画面から行う前提のため許容する。
 *
 * @param {Sheet} sheet
 * @param {Array<Array>} values ヘッダー行を含む、シートから読んだ全値
 * @param {number} col0 列インデックス（0始まり）。-1 は何もしない
 */
function writeSheetColumn_(sheet, values, col0) {
  if (col0 < 0 || !values || values.length < 2) return;
  var out = [];
  for (var r = 1; r < values.length; r++) out.push([values[r][col0]]);
  sheet.getRange(2, col0 + 1, out.length, 1).setValues(out);
}

/** シート末尾に複数行を追記 */
function appendRows(sheet, rows) {
  if (!rows || !rows.length) return;
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
}
