/**
 * 使用期限の一括取り込み（棚卸しスプレッドシート → 医院別在庫）
 * ------------------------------------------------------------------
 * 目的（2026-08-22 ヒアリングで確定）:
 *   元の棚卸しスプレッドシートには、医院ごとに「賞味期限」が既に入力されている
 *   （① 医院別シート生成で各医院シートの「賞味期限」列へ転記済み）。
 *   これを運用データ側の 医院別在庫「使用期限」へ流し込み、あわせて対象商品の
 *   商品マスタ「使用期限管理」を「要」にして期限アラートに載るようにする。
 *
 * 期限切れの扱い:
 *   「入っているものはそのまま入れてよい。期限が切れているものは各医院で確認して
 *     入れ直す」という運用方針のため、過去日でも除外せずそのまま取り込む
 *   （理事長判断で意図的に期限切れの資材を置いている場合もあるため、
 *     こちらで勝手に捨てない）。取り込み後は 使用期限アラート画面に
 *     「期限切れ」として並ぶので、各医院で確認・修正してもらう。
 *
 * 安全設計:
 *   - 医院別在庫の「使用期限」が既に入っている行は上書きしない。
 *     ＝空欄を埋めるだけなので、何度実行しても結果は変わらない。
 *   - 元シート（各医院シート・カテゴリシート）は読み取りのみ。変更しない。
 *   - 書き込み前に previewExpiryImport で件数を確かめられる（下見は一切書き込まない）。
 *   - ①「医院別シートを生成」の再実行は一切不要（記入済みデータを壊さない）。
 *
 * 実行方法:
 *   Apps Script エディタで関数を選んで実行する。結果は「実行ログ」に出る。
 *     previewExpiryImport          … 何件入るかを出すだけ（書き込みなし）
 *     importExpiryFromClinicSheets … 実際に取り込む
 *
 * 依存:
 *   master.js    … MASTER_SHEET_NAME / INVENTORY_SHEET_NAME / EXPIRY_MANAGED_YES / normalizeKey
 *   migration.js … CLINICS / OUTPUT_SUFFIX / maintenanceReport_
 *   usage.js     … getInventorySheetOrThrow / inventoryHeaderIndex / writeSheetColumn_
 *   webapp.js    … toStr
 */

// 各医院シート（NIS_在庫 等）で使用期限が入っている列の見出し。
// 元の棚卸し表の呼び名に合わせて「賞味期限」（migration.js の OUT_HEADERS と同じ）。
var CLINIC_SHEET_EXPIRY_HEADER = '賞味期限';

// 「医院コード＋商品キー」を1本の文字列にするときの区切り。
// 品名等に絶対に現れない制御文字を使い、医院コードと商品名が地続きになって
// 別の資材と誤って一致するのを防ぐ。
var EXPIRY_KEY_SEP = String.fromCharCode(1);

/** 医院コードと 商品キー（カテゴリ＋発注先＋品名）から、突き合わせ用のキーを作る。 */
function expiryLookupKey_(clinic, category, supplier, name) {
  return clinic + EXPIRY_KEY_SEP + normalizeKey(category, supplier, name);
}

/**
 * 取り込んだら何件入るかを調べて実行ログに出す（シートは一切変更しない）。
 * 先にこれを実行して件数を確かめてから importExpiryFromClinicSheets を実行するとよい。
 */
function previewExpiryImport() {
  var text = runExpiryImport_(true);
  maintenanceReport_('【下見】使用期限の取り込み', text);
  return text;
}

/**
 * 各医院シートの賞味期限を、医院別在庫の「空欄の」使用期限にだけ流し込む。
 * 既に期限が入っている行は触らないため、何度実行しても現場が入れ直した値は消えない。
 * 結果は実行ログに出す（Apps Script エディタから直接実行できるようUIに依存させない）。
 */
function importExpiryFromClinicSheets() {
  var text = runExpiryImport_(false);
  safeRebuildExpiryViewAll_();
  maintenanceReport_('使用期限の取り込み', text);
  return text;
}

/**
 * 使用期限取り込みの本体。
 * @param {boolean} dryRun true なら件数を数えるだけで書き込まない
 * @return {string} 実行ログ・ダイアログに出す結果文
 */
function runExpiryImport_(dryRun) {
  var collected = collectExpiryFromClinicSheets_();
  if (collected.total === 0) {
    return '各医院シート（' + CLINICS.map(function (c) { return c + OUTPUT_SUFFIX; }).join('／') + '）の\n' +
      '「' + CLINIC_SHEET_EXPIRY_HEADER + '」列から、日付として読み取れる値が1件もありませんでした。\n' +
      (collected.missingSheets.length
        ? '見つからなかったシート：' + collected.missingSheets.join('／') + '\n'
        : '') +
      (collected.missingColumn.length
        ? '「' + CLINIC_SHEET_EXPIRY_HEADER + '」列が無いシート：' + collected.missingColumn.join('／') + '\n'
        : '') +
      '処理を中止しました。';
  }

  var head = '各医院シートから読み取れた使用期限：' + collected.total + '件\n' +
    (collected.unparsed ? '　（日付として読めず読み飛ばした記入：' + collected.unparsed + '件）\n' : '') +
    '　（年月のみの記入は、その月の1日として取り込みます）\n';

  var plan = applyExpiryToInventory_(collected.byClinicKey, true);
  if (plan.filled === 0) {
    return head + '\n取り込める使用期限はありませんでした。\n' +
      '・入力済みのため対象外：' + plan.already + '件\n' +
      '・医院別在庫に該当が無い：' + plan.notFound + '件' +
      (plan.notFound > 0 && plan.already === 0
        ? '\n\n※すべて「該当が無い」場合は、商品マスタと医院別シートの' +
          'カテゴリ／発注先／品名が食い違っている可能性があります。'
        : '');
  }

  if (dryRun) {
    return head + '\n・これから埋める（使用期限が空欄）：' + plan.filled + '件\n' +
      '　　うち既に期限切れ：' + plan.expired + '件\n' +
      '・入力済みのため触らない：' + plan.already + '件\n' +
      '・医院別在庫に該当が無い：' + plan.notFound + '件\n\n' +
      '取り込んだ商品は、商品マスタの「使用期限管理」を「' + EXPIRY_MANAGED_YES + '」にします。\n' +
      '期限切れのものも、いったんそのまま取り込みます（各医院で確認・修正してください）。\n\n' +
      '実際に取り込むには importExpiryFromClinicSheets を実行してください。';
  }

  var result;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    result = applyExpiryToInventory_(collected.byClinicKey, false);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  return head + '\n完了しました。\n' +
    '・取り込んだ使用期限：' + result.filled + '件\n' +
    '　　うち既に期限切れ：' + result.expired + '件\n' +
    '・「使用期限管理」を「' + EXPIRY_MANAGED_YES + '」にした商品：' + result.managedUpdated + '件\n' +
    '・入力済みのため触らなかった：' + result.already + '件\n' +
    '・医院別在庫に該当が無かった：' + result.notFound + '件' +
    (result.expired
      ? '\n\n期限切れの資材は「使用期限アラート」画面に赤で並びます。\n' +
        '各医院で現物を確認して入れ直してもらってください。'
      : '');
}

/**
 * 各医院シート（NIS_在庫 等）から「医院コード＋商品キー」→ 使用期限(Date) を集める。
 * 商品キーは カテゴリ＋発注先＋品名（②のマッチングキーと同じ normalizeKey）。
 * @return {{byClinicKey:Object, total:number, unparsed:number,
 *           missingSheets:Array<string>, missingColumn:Array<string>}}
 */
function collectExpiryFromClinicSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = { byClinicKey: {}, total: 0, unparsed: 0, missingSheets: [], missingColumn: [] };

  CLINICS.forEach(function (clinic) {
    var sheetName = clinic + OUTPUT_SUFFIX;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) { out.missingSheets.push(sheetName); return; }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();

    var header = values[0];
    var idExpiry = -1;
    for (var i = 0; i < header.length; i++) {
      if (toStr(header[i]) === CLINIC_SHEET_EXPIRY_HEADER) { idExpiry = i; break; }
    }
    if (idExpiry < 0) { out.missingColumn.push(sheetName); return; }

    var idx = headerIndex(header); // webapp.js：カテゴリ／発注先（列名はメーカー）／品名 等
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var name = toStr(row[idx.name]);
      if (name === '') continue;

      var raw = row[idExpiry];
      if (toStr(raw) === '') continue;

      var d = parseExpiryValue_(raw);
      if (!d) { out.unparsed++; continue; }

      var key = expiryLookupKey_(clinic, toStr(row[idx.category]), toStr(row[idx.supplier]), name);
      // 同じ資材が複数行にある場合は、より早い期限を採用する（先に切れるほうを見せる）
      if (out.byClinicKey.hasOwnProperty(key)) {
        if (d.getTime() < out.byClinicKey[key].getTime()) out.byClinicKey[key] = d;
        continue;
      }
      out.byClinicKey[key] = d;
      out.total++;
    }
  });

  return out;
}

/**
 * 賞味期限セルの値を Date にする。読み取れなければ null。
 *
 * 実データには次の形式が混在している:
 *   - 日付セル（Date）                        … そのまま
 *   - 日付シリアル値（46722 等の数値）        … 1899-12-30 起点で変換
 *   - '2028/10' '2026.7' '2028年10月'（年月）… その月の1日として扱う
 *   - '2027/3/31' '2027-03-31'（年月日）      … そのまま
 *   - 'なし' '在庫置いてない' 等              … null（対象外）
 *
 * 年月のみの記入をその月の1日とするのは、月末とみなして遅らせるより
 * アラートが早めに出るほうが安全なため（見逃しより空振りを選ぶ）。
 *
 * @param {*} raw シートのセル値
 * @return {(Date|null)}
 */
function parseExpiryValue_(raw) {
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
  }

  if (typeof raw === 'number' && isFinite(raw)) {
    // スプレッドシートの日付シリアル値。1900年より前・2200年より後は日付ではないとみなす。
    if (raw < 1 || raw > 120000) return null;
    var fromSerial = new Date(Math.round((raw - 25569) * 86400000));
    if (isNaN(fromSerial.getTime())) return null;
    return new Date(fromSerial.getFullYear(), fromSerial.getMonth(), fromSerial.getDate());
  }

  var s = toStr(raw);
  if (s === '') return null;
  // 「なし」「在庫置いてない」「取扱無し」「−」等、数字を含まない記入は期限ではない。
  // 語句リストで弾くと「2028/10」の '/' まで巻き添えにするため、数字の有無で判定する。
  if (!/\d/.test(s)) return null;

  // 区切りを '/' に統一してから年月日／年月を読む
  var norm = s.replace(/年|月/g, '/').replace(/日/g, '').replace(/[.\-]/g, '/').replace(/\/+$/, '');

  var ymd = norm.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymd) return buildExpiryDate_(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  var ym = norm.match(/^(\d{4})\/(\d{1,2})$/);
  if (ym) return buildExpiryDate_(Number(ym[1]), Number(ym[2]), 1);

  return null;
}

/** 年月日から Date を作る。ありえない日付（2月30日等）は null。 */
function buildExpiryDate_(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  var date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/**
 * 集めた使用期限を医院別在庫へ書き込み、対象商品の商品マスタ「使用期限管理」を「要」にする。
 * @param {Object} byClinicKey collectExpiryFromClinicSheets_().byClinicKey
 * @param {boolean} dryRun true なら件数を数えるだけで書き込まない
 * @return {{filled:number, already:number, notFound:number, expired:number, managedUpdated:number}}
 */
function applyExpiryToInventory_(byClinicKey, dryRun) {
  var result = { filled: 0, already: 0, notFound: 0, expired: 0, managedUpdated: 0 };

  var invSheet = getInventorySheetOrThrow(); // usage.js
  var invLastRow = invSheet.getLastRow();
  if (invLastRow < 2) return result;

  var invValues = invSheet.getRange(1, 1, invLastRow, invSheet.getLastColumn()).getValues();
  var iIdx = inventoryHeaderIndex(invValues[0]);
  if (iIdx.expiry < 0) {
    throw new Error('医院別在庫に「使用期限」列がありません。列が削除されていないかご確認ください。');
  }

  var masterMap = getMasterInfoMap(); // stock.js：商品ID -> {category, supplier, name, ...}
  var today = startOfDay(new Date()); // expiry.js
  var matchedPids = {};
  var usedKeys = {};

  for (var r = 1; r < invValues.length; r++) {
    var row = invValues[r];
    var clinic = toStr(row[iIdx.clinic]);
    var pid = toStr(row[iIdx.productId]);
    if (clinic === '' || pid === '') continue;

    var m = masterMap[pid];
    if (!m) continue;
    var key = expiryLookupKey_(clinic, m.category, m.supplier, m.name);
    if (!byClinicKey.hasOwnProperty(key)) continue;
    usedKeys[key] = true;

    // 既に期限が入っている行は触らない（現場が入れ直した値を守る）
    if (row[iIdx.expiry] instanceof Date && !isNaN(row[iIdx.expiry].getTime())) {
      result.already++;
      continue;
    }

    var d = byClinicKey[key];
    row[iIdx.expiry] = d;
    matchedPids[pid] = true;
    result.filled++;
    if (d.getTime() < today.getTime()) result.expired++;
  }

  // 医院別在庫に該当行が無かった記入（取り扱いなしで運用データに載っていない資材等）
  Object.keys(byClinicKey).forEach(function (k) {
    if (!usedKeys[k]) result.notFound++;
  });

  if (!dryRun && result.filled > 0) {
    writeSheetColumn_(invSheet, invValues, iIdx.expiry); // usage.js
    result.managedUpdated = markExpiryManaged_(Object.keys(matchedPids));
  }
  return result;
}

/**
 * 指定した商品の商品マスタ「使用期限管理」を「要」にする。
 * 既に「要」の商品は書き換えない。
 * @param {Array<string>} productIds
 * @return {number} 実際に書き換えた商品数
 */
function markExpiryManaged_(productIds) {
  if (!productIds.length) return 0;

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

  var target = {};
  productIds.forEach(function (pid) { target[pid] = true; });

  var changed = 0;
  for (var r = 1; r < values.length; r++) {
    var pid = toStr(values[r][idId]);
    if (!target[pid]) continue;
    if (toStr(values[r][idFlag]) === EXPIRY_MANAGED_YES) continue;
    values[r][idFlag] = EXPIRY_MANAGED_YES;
    changed++;
  }
  if (changed > 0) writeSheetColumn_(sheet, values, idFlag); // usage.js
  return changed;
}
