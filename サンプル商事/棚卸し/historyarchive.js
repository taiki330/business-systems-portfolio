/**
 * 履歴の年次保管（書き出し）と削除
 * ------------------------------------------------------------------
 * 目的（2026-08-22 ヒアリングで確定）:
 *   このシステムは操作のたびに履歴を書き足していくため、放っておくと
 *   数年後には重くて使い物にならなくなる。一方で現場が履歴をさかのぼることは無く、
 *   必要なのは「年1回、1年分の記録を見て見直しをする」ことだけ、という結論だった。
 *
 *   そこで年1回の運用として、
 *     ① 基準日より前の履歴を別のスプレッドシートへ書き出して保管する
 *     ② 書き出せたことを確認したうえで、元の履歴から消す
 *   の2段階を用意する。①をしていないと②は実行できない。
 *
 * 何を対象にするか:
 *   終わった記録（使用履歴・在庫確定履歴・入荷履歴・資材移動ログ・在庫修正履歴）だけ。
 *   「発注管理」「発注候補」は未入荷・未発注という“今の状態”を持っているため対象外
 *   （消すと発注中の資材が消えてしまう）。
 *   「QR印刷済み」も、消すと印刷済みのQRが未印刷に見えてしまうため対象外。
 *
 * 安全設計:
 *   - 削除は「アーカイブ記録」に残った書き出し済みファイルを指定したときだけ実行できる。
 *     書き出しに失敗した状態では削除できない。
 *   - 削除の直前にもう一度、保管先ファイルが実在するかを確認する。
 *   - 保管先ファイルを消してしまっても元には戻せないため、削除は基準日より前だけに限定し、
 *     基準日以降の行は1行も触らない。
 *   - LockService で直列化し、ロック解放前に flush()。
 *
 * 依存:
 *   usage.js  … USAGE_HISTORY_SHEET / USAGE_HISTORY_HEADERS / assertSheetHeaders_
 *               getOrCreateSheet / appendRows
 *   bulkstock.js / order.js / transfer.js / correction.js … 各履歴シートの定数
 *   backup.js … （同じ発想の保管フォルダを作る）
 *   webapp.js … toStr
 */

// 保管先フォルダ名（元ファイルと同じ場所に作られる）
var HISTORY_ARCHIVE_FOLDER_NAME = '棚卸しシステム_履歴アーカイブ';

// 保管・削除を実行した記録を残すシート
var HISTORY_ARCHIVE_LOG_SHEET = '履歴アーカイブ記録';
var HISTORY_ARCHIVE_LOG_HEADERS = [
  'アーカイブID', '書き出し日時', '基準日（この日より前を対象）', '書き出し件数',
  '保管ファイル名', '保管ファイルID', '保管ファイルURL', '削除日時', '削除件数'
];

/**
 * 保管・削除の対象にする履歴シートの定義。
 *   sheet   … シート名
 *   headers … 列構成（assertSheetHeaders_ で列ズレを検知するため）
 *   dateHeader … 「いつの記録か」を表す列の見出し。この列で基準日と比べる
 */
function historyArchiveTargets_() {
  return [
    { sheet: USAGE_HISTORY_SHEET,      headers: USAGE_HISTORY_HEADERS,      dateHeader: '使用日時',
      label: '使用履歴（QR読取での使用登録）' },
    { sheet: BULK_STOCK_HISTORY_SHEET, headers: BULK_STOCK_HISTORY_HEADERS, dateHeader: '日時',
      label: '在庫確定履歴（棚卸しでの一斉登録）' },
    { sheet: RECEIPT_HISTORY_SHEET,    headers: RECEIPT_HISTORY_HEADERS,    dateHeader: '入荷日',
      label: '入荷履歴' },
    { sheet: TRANSFER_LOG_SHEET,       headers: TRANSFER_LOG_HEADERS,       dateHeader: '日時',
      label: '資材移動ログ（医院間の貸し借り）' },
    { sheet: STOCK_ADJUST_HISTORY_SHEET, headers: STOCK_ADJUST_HISTORY_HEADERS, dateHeader: '日時',
      label: '在庫修正履歴' }
  ];
}

/**
 * 履歴の状況（各シートの件数・最古・最新、基準日より前の件数）と、
 * 過去のアーカイブ記録を返す。画面の初期表示に使う。
 * @param {string} [beforeDateStr] 'YYYY-MM-DD'。省略時は1年前
 * @return {{beforeDate:string, sheets:Array, logs:Array, canPurge:boolean}}
 */
function getHistoryArchiveStatus(beforeDateStr) {
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var before = parseArchiveBeforeDate_(beforeDateStr, tz);

  var sheets = historyArchiveTargets_().map(function (t) {
    var info = scanHistorySheet_(t, before, tz);
    return {
      sheet: t.sheet, label: t.label,
      exists: info.exists,
      totalRows: info.totalRows,
      targetRows: info.targetRows,
      oldest: info.oldest,
      newest: info.newest,
      undatedRows: info.undatedRows
    };
  });

  return {
    beforeDate: Utilities.formatDate(before, tz, 'yyyy-MM-dd'),
    sheets: sheets,
    logs: readArchiveLogs_(tz),
    totalTargetRows: sheets.reduce(function (s, x) { return s + x.targetRows; }, 0)
  };
}

/**
 * 基準日より前の履歴を、新しいスプレッドシート1つへ書き出して保管する。
 * この時点では元の履歴は1行も消さない（消すのは purgeArchivedHistory）。
 * @param {string} beforeDateStr 'YYYY-MM-DD'。この日の0時より前の記録が対象
 * @return {{archiveId:string, name:string, url:string, counts:Array, total:number}}
 */
function archiveHistoryBefore(beforeDateStr) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var before = parseArchiveBeforeDate_(beforeDateStr, tz);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // ① 先に全シートぶんの対象行を集める（1件も無ければファイルを作らない）
    var collected = [];
    var total = 0;
    historyArchiveTargets_().forEach(function (t) {
      var info = scanHistorySheet_(t, before, tz, true);
      if (!info.exists || !info.rows.length) return;
      collected.push({ target: t, rows: info.rows, headerRow: info.headerRow, width: info.width });
      total += info.rows.length;
    });
    if (total === 0) {
      throw new Error('指定した基準日（' + Utilities.formatDate(before, tz, 'yyyy-MM-dd') +
        '）より前の履歴は1件もありませんでした。書き出すものがないため中止しました。');
    }

    // ② 保管用スプレッドシートを作り、シートごとに書き出す
    var stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss');
    var name = '【履歴アーカイブ】' + ss.getName() + '_' +
      Utilities.formatDate(before, tz, 'yyyyMMdd') + 'より前_' + stamp;
    var archive = SpreadsheetApp.create(name);

    var counts = [];
    collected.forEach(function (c, i) {
      var sh = (i === 0) ? archive.getSheets()[0] : archive.insertSheet();
      sh.setName(c.target.sheet);
      sh.getRange(1, 1, 1, c.width)
        .setValues([c.headerRow]).setFontWeight('bold').setBackground('#e8eef7');
      sh.getRange(2, 1, c.rows.length, c.width).setValues(c.rows);
      sh.setFrozenRows(1);
      counts.push({ sheet: c.target.sheet, rows: c.rows.length });
    });
    SpreadsheetApp.flush();

    // ③ 元ファイルと同じ場所の専用フォルダへ移す（探しに行く手間をなくすため）
    var file = DriveApp.getFileById(archive.getId());
    moveToHistoryArchiveFolder_(file);

    // ④ アーカイブ記録に残す。削除はこの記録を指定したときだけ実行できる。
    var archiveId = 'A' + stamp;
    appendRows(getOrCreateSheet(HISTORY_ARCHIVE_LOG_SHEET, HISTORY_ARCHIVE_LOG_HEADERS), [[
      archiveId, new Date(), Utilities.formatDate(before, tz, 'yyyy-MM-dd'), total,
      name, archive.getId(), archive.getUrl(), '', ''
    ]]);
    SpreadsheetApp.flush();

    return {
      archiveId: archiveId, name: name, url: archive.getUrl(),
      counts: counts, total: total,
      beforeDate: Utilities.formatDate(before, tz, 'yyyy-MM-dd')
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 書き出し済みのアーカイブを指定して、その基準日より前の履歴を元シートから削除する。
 * アーカイブ記録に無いIDや、保管ファイルが実在しないIDは受け付けない。
 * @param {string} archiveId archiveHistoryBefore が返したID
 * @return {{archiveId:string, deleted:number, counts:Array}}
 */
function purgeArchivedHistory(archiveId) {
  archiveId = toStr(archiveId);
  if (archiveId === '') throw new Error('アーカイブIDが指定されていません。');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var logSheet = getOrCreateSheet(HISTORY_ARCHIVE_LOG_SHEET, HISTORY_ARCHIVE_LOG_HEADERS);
    var lastRow = logSheet.getLastRow();
    if (lastRow < 2) throw new Error('アーカイブ記録がありません。先に「書き出して保管」を実行してください。');

    var values = logSheet.getRange(1, 1, lastRow, HISTORY_ARCHIVE_LOG_HEADERS.length).getValues();
    var cId = HISTORY_ARCHIVE_LOG_HEADERS.indexOf('アーカイブID');
    var cBefore = HISTORY_ARCHIVE_LOG_HEADERS.indexOf('基準日（この日より前を対象）');
    var cFileId = HISTORY_ARCHIVE_LOG_HEADERS.indexOf('保管ファイルID');
    var cPurgedAt = HISTORY_ARCHIVE_LOG_HEADERS.indexOf('削除日時');
    var cPurged = HISTORY_ARCHIVE_LOG_HEADERS.indexOf('削除件数');

    var ri = -1;
    for (var r = 1; r < values.length; r++) {
      if (toStr(values[r][cId]) === archiveId) { ri = r; break; }
    }
    if (ri < 0) throw new Error('アーカイブ記録に「' + archiveId + '」が見つかりません。');
    if (toStr(values[ri][cPurgedAt]) !== '') {
      throw new Error('このアーカイブ（' + archiveId + '）の削除は既に実行済みです。');
    }

    // 保管ファイルが本当に残っているか、削除の直前にもう一度確かめる。
    // 誤って捨てられていた場合、ここで止めないと元に戻せない削除になる。
    var fileId = toStr(values[ri][cFileId]);
    assertArchiveFileAlive_(fileId, archiveId);

    // 文字列で書いた基準日がシート側で日付セルに変換されている場合があるため、生値のまま渡す
    var before = parseArchiveBeforeDate_(values[ri][cBefore], tz);

    var counts = [];
    var deleted = 0;
    historyArchiveTargets_().forEach(function (t) {
      var n = deleteRowsBefore_(t, before, tz);
      if (n > 0) counts.push({ sheet: t.sheet, rows: n });
      deleted += n;
    });

    logSheet.getRange(ri + 1, cPurgedAt + 1).setValue(new Date());
    logSheet.getRange(ri + 1, cPurged + 1).setValue(deleted);
    SpreadsheetApp.flush();

    return { archiveId: archiveId, deleted: deleted, counts: counts };
  } finally {
    lock.releaseLock();
  }
}

/* ===== ヘルパー ===== */

/**
 * 基準日を Date（その日の0時）にする。未指定なら1年前の同じ日。
 * 未来の日付は、まだ終わっていない期間を消してしまうため受け付けない。
 *
 * 画面からは 'YYYY-MM-DD' の文字列で来るが、アーカイブ記録シートに書いた基準日は
 * スプレッドシート側で日付セルに変換されていることがあるため、Date も受け付ける。
 * @param {(string|Date)} v
 */
function parseArchiveBeforeDate_(v, tz) {
  var d;
  if (v instanceof Date && !isNaN(v.getTime())) {
    d = new Date(v.getFullYear(), v.getMonth(), v.getDate());
  } else {
    var s = toStr(v);
    if (s === '') {
      var now = new Date();
      d = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    } else {
      var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!m) throw new Error('基準日は「2026-04-01」のような形式で指定してください（入力値: ' + s + '）。');
      d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (isNaN(d.getTime())) throw new Error('基準日が正しくありません（入力値: ' + s + '）。');
    }
  }
  var today = new Date();
  var todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (d.getTime() > todayStart.getTime()) {
    throw new Error('基準日に未来の日付は指定できません（入力値: ' +
      Utilities.formatDate(d, tz, 'yyyy-MM-dd') + '）。');
  }
  return d;
}

/**
 * 1つの履歴シートを走査して、件数・最古・最新・基準日より前の件数を調べる。
 *
 * 列は「コードが前提とする headers」ではなく、シートの実際の幅で読む。
 * 誰かが右端にメモ列を足していた場合、headers の幅だけで読み書きすると
 * その列を書き出さないまま行を消してしまい、メモだけが失われるため。
 *
 * @param {Object} target historyArchiveTargets_() の1要素
 * @param {Date} before 基準日（この日の0時より前が対象）
 * @param {string} tz
 * @param {boolean} [withRows] true なら対象行の値そのものも返す
 */
function scanHistorySheet_(target, before, tz, withRows) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(target.sheet);
  var out = { exists: false, totalRows: 0, targetRows: 0, undatedRows: 0,
              oldest: '', newest: '', rows: [], headerRow: [], width: 0 };
  if (!sheet || sheet.getLastRow() < 2) return out;

  assertSheetHeaders_(sheet, target.headers); // usage.js：列ズレのまま消さない
  out.exists = true;

  var lastRow = sheet.getLastRow();
  var width = Math.max(sheet.getLastColumn(), target.headers.length);
  out.width = width;
  out.headerRow = sheet.getRange(1, 1, 1, width).getValues()[0];

  var values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  out.totalRows = values.length;

  var cDate = target.headers.indexOf(target.dateHeader);
  var oldest = null, newest = null;

  values.forEach(function (row) {
    var d = row[cDate];
    if (!(d instanceof Date) || isNaN(d.getTime())) {
      // 日時が読めない行は、いつの記録か判断できないので削除対象にしない（残す）。
      out.undatedRows++;
      return;
    }
    if (!oldest || d.getTime() < oldest.getTime()) oldest = d;
    if (!newest || d.getTime() > newest.getTime()) newest = d;
    if (d.getTime() < before.getTime()) {
      out.targetRows++;
      if (withRows) out.rows.push(row);
    }
  });

  out.oldest = oldest ? Utilities.formatDate(oldest, tz, 'yyyy-MM-dd') : '';
  out.newest = newest ? Utilities.formatDate(newest, tz, 'yyyy-MM-dd') : '';
  return out;
}

/**
 * 基準日より前の行を削除する。残す行だけを書き直す方式にしているのは、
 * 履歴が必ずしも日時順に並んでいるとは限らないため（取消・後追い登録がある）。
 * 日時が読めない行は残す。
 * @return {number} 削除した行数
 */
function deleteRowsBefore_(target, before, tz) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(target.sheet);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  assertSheetHeaders_(sheet, target.headers);

  var lastRow = sheet.getLastRow();
  // シートの実際の幅で読み書きする。headers の幅だけで詰め直すと、右端に足された
  // 列だけが元の行位置に取り残され、別の記録の行とつながってしまう。
  var width = Math.max(sheet.getLastColumn(), target.headers.length);
  var values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  var cDate = target.headers.indexOf(target.dateHeader);

  var keep = values.filter(function (row) {
    var d = row[cDate];
    if (!(d instanceof Date) || isNaN(d.getTime())) return true; // 判断できない行は残す
    return d.getTime() >= before.getTime();
  });

  var removed = values.length - keep.length;
  if (removed === 0) return 0;

  sheet.getRange(2, 1, values.length, width).clearContent();
  if (keep.length) sheet.getRange(2, 1, keep.length, width).setValues(keep);
  return removed;
}

/** 保管ファイルが実在し、ゴミ箱に入っていないことを確認する。 */
function assertArchiveFileAlive_(fileId, archiveId) {
  if (fileId === '') {
    throw new Error('アーカイブ（' + archiveId + '）に保管ファイルIDが記録されていません。' +
      '書き出しからやり直してください。');
  }
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    throw new Error('保管ファイルが見つかりません（' + archiveId + '）。\n' +
      '書き出したファイルが削除・移動された可能性があります。\n' +
      '元の履歴は消していません。書き出しからやり直してください。');
  }
  if (file.isTrashed()) {
    throw new Error('保管ファイルがゴミ箱に入っています（' + archiveId + '）。\n' +
      '元に戻すか、書き出しからやり直してください。元の履歴は消していません。');
  }
}

/** 保管ファイルを、元ファイルと同じ場所の専用フォルダへ移す。 */
function moveToHistoryArchiveFolder_(file) {
  var ssFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  var parents = ssFile.getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var found = parent.getFoldersByName(HISTORY_ARCHIVE_FOLDER_NAME);
  var folder = found.hasNext() ? found.next() : parent.createFolder(HISTORY_ARCHIVE_FOLDER_NAME);
  file.moveTo(folder);
}

/** アーカイブ記録を新しい順で返す（画面表示用）。 */
function readArchiveLogs_(tz) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HISTORY_ARCHIVE_LOG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  assertSheetHeaders_(sheet, HISTORY_ARCHIVE_LOG_HEADERS);

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, HISTORY_ARCHIVE_LOG_HEADERS.length).getValues();
  var c = {};
  HISTORY_ARCHIVE_LOG_HEADERS.forEach(function (h, i) { c[h] = i; });

  var logs = values.map(function (row) {
    return {
      archiveId: toStr(row[c['アーカイブID']]),
      createdAt: fmtArchiveDate_(row[c['書き出し日時']], tz, 'yyyy-MM-dd HH:mm'),
      beforeDate: fmtArchiveDate_(row[c['基準日（この日より前を対象）']], tz, 'yyyy-MM-dd'),
      rows: toStr(row[c['書き出し件数']]),
      name: toStr(row[c['保管ファイル名']]),
      url: toStr(row[c['保管ファイルURL']]),
      purgedAt: fmtArchiveDate_(row[c['削除日時']], tz, 'yyyy-MM-dd HH:mm'),
      purgedRows: toStr(row[c['削除件数']])
    };
  });
  return logs.reverse();
}

function fmtArchiveDate_(v, tz, pattern) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, pattern);
  return toStr(v);
}
