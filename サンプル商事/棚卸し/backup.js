/**
 * 自動バックアップ（毎日1回、スプレッドシートを丸ごと複製）
 * ------------------------------------------------------------------
 * 目的:
 *   このシステムには、壊れたデータを元に戻す手段が無い。
 *   使用登録・入荷・取消・列の編集など、気づかないまま数字が狂う経路が複数あり、
 *   「いつ壊れたか」が分からないとGoogleの版履歴では実質戻せない。
 *   毎日の世代バックアップを残すことで、あらゆる事故を
 *   「その日の朝の状態まで戻せる事故」に格下げする。
 *
 * 方式:
 *   - このスプレッドシートを Drive 上でまるごとコピーする（形式変換なし）。
 *     復旧は「コピーを開いて中身を貼り戻す」だけで済み、特別な手順が要らない。
 *   - 保存先は元ファイルと同じ場所に作る専用フォルダ（BACKUP_FOLDER_NAME）。
 *   - BACKUP_RETENTION_DAYS 日より古い世代はゴミ箱へ送る（完全削除はしない）。
 *   - 実行結果は「バックアップ履歴」シートに毎回記録する。
 *     成功も失敗も残すので、「いつの間にか止まっていた」を後から発見できる。
 *   - 失敗した場合はオーナー宛にメールで知らせる。
 *     黙って止まったバックアップは無いのと同じであるため。
 *
 * 使い方（スプレッドシートのメニュー「バックアップ」）:
 *   1. 「今すぐバックアップを取る」… 動作確認。初回はここで権限承認が出る。
 *   2. 「毎日の自動バックアップを有効にする」… 以後、毎日自動で走る。
 *   3. 「バックアップの状態を確認」… 動いているか・最新がいつかを確認する。
 *
 * ⚠ 初回のみ、Drive とメールの権限承認が必要（このファイルを追加したことで
 *   スクリプトの権限が増えるため）。承認するまで自動実行は動かない。
 */

// バックアップ先フォルダ名（元ファイルと同じ場所に作られる）
var BACKUP_FOLDER_NAME = '棚卸しシステム_自動バックアップ';

// バックアップファイル名の頭。この文字列で始まるファイルだけを世代管理の対象にする
// （利用者が同じフォルダに置いた別のファイルを誤って消さないため）。
var BACKUP_NAME_PREFIX = '【自動バックアップ】';

// 何日分残すか。これより古い世代はゴミ箱へ送る。
var BACKUP_RETENTION_DAYS = 30;

// 日数に関わらず必ず残す最新世代数。設定ミスや時刻のズレで
// 全世代を消してしまう事故を防ぐための下限。
var BACKUP_MIN_KEEP = 3;

// 自動実行する時刻（0-23）。診療時間外に走らせる。
var BACKUP_HOUR = 3;

// 自動実行で呼ばれる関数名（トリガー登録・解除の目印に使う）
var BACKUP_TRIGGER_FUNC = 'runDailyBackup';

var BACKUP_LOG_SHEET = 'バックアップ履歴';
var BACKUP_LOG_HEADERS = ['実行日時', '結果', 'バックアップ名', '削除した古い世代', 'エラー内容'];


/* ============================ 自動実行の入口 ============================ */

/**
 * 毎日のトリガーから呼ばれる。
 * ここでは絶対に例外を投げない（投げるとトリガーが黙って失敗するだけになるため）。
 * 成功・失敗どちらも履歴シートに残し、失敗はメールでも知らせる。
 */
function runDailyBackup() {
  try {
    var result = createBackup_();
    var purged = purgeOldBackups_(result.folder);
    writeBackupLog_('成功', result.name, purged, '');
    return result;
  } catch (e) {
    var message = (e && e.message) ? e.message : String(e);
    // 履歴への記録自体が失敗しても、メール通知だけは試みる。
    try { writeBackupLog_('失敗', '', 0, message); } catch (ignored) {}
    notifyBackupFailure_(message);
    return null;
  }
}


/* ============================ メニュー操作 ============================ */

/** メニュー「今すぐバックアップを取る」。動作確認と、初回の権限承認を兼ねる。 */
function backupNow() {
  var ui = backupUi_();
  try {
    var result = createBackup_();
    var purged = purgeOldBackups_(result.folder);
    writeBackupLog_('成功（手動）', result.name, purged, '');
    backupTell_(ui, 'バックアップを取りました。\n\n' +
      '・ファイル名：' + result.name + '\n' +
      '・保存先：' + BACKUP_FOLDER_NAME + '（このファイルと同じ場所）\n' +
      (purged ? '・古い世代を' + purged + '件ゴミ箱へ移動しました\n' : '') +
      '\n自動実行はまだ有効になっていない場合があります。\n' +
      'メニュー「バックアップの状態を確認」でご確認ください。');
  } catch (e) {
    var message = (e && e.message) ? e.message : String(e);
    try { writeBackupLog_('失敗（手動）', '', 0, message); } catch (ignored) {}
    backupTell_(ui, 'バックアップに失敗しました。\n\n' + message);
  }
}

/** メニュー「毎日の自動バックアップを有効にする」。 */
function setupDailyBackup() {
  var ui = backupUi_();

  // 二重登録を防ぐため、同じ関数の既存トリガーを先に消してから作り直す。
  var removed = deleteBackupTriggers_();

  ScriptApp.newTrigger(BACKUP_TRIGGER_FUNC)
    .timeBased()
    .atHour(BACKUP_HOUR)
    .everyDays(1)
    .create();

  backupTell_(ui, '毎日の自動バックアップを有効にしました。\n\n' +
    '・実行時刻：毎日 ' + BACKUP_HOUR + '時ごろ\n' +
    '・保存先：' + BACKUP_FOLDER_NAME + '（このファイルと同じ場所）\n' +
    '・保存期間：' + BACKUP_RETENTION_DAYS + '日分\n' +
    (removed ? '\n（古い設定を' + removed + '件置き換えました）\n' : '') +
    '\n実行結果は「' + BACKUP_LOG_SHEET + '」シートに毎回記録されます。\n' +
    '失敗したときはオーナー宛にメールが届きます。');
}

/** メニュー「自動バックアップを停止する」。 */
function disableDailyBackup() {
  var ui = backupUi_();
  var removed = deleteBackupTriggers_();
  if (!removed) {
    backupTell_(ui, '自動バックアップは設定されていません。');
    return;
  }
  backupTell_(ui, '自動バックアップを停止しました（' + removed + '件）。\n\n' +
    '既に取ってあるバックアップは削除されません。\n' +
    '停止中は世代の入れ替えも止まるため、古い世代もそのまま残ります。');
}

/** メニュー「バックアップの状態を確認」。 */
function showBackupStatus() {
  var ui = backupUi_();
  var lines = [];

  // 自動実行の有無
  var triggers = findBackupTriggers_();
  lines.push(triggers.length
    ? '◯ 自動バックアップ：有効（毎日 ' + BACKUP_HOUR + '時ごろ）'
    : '× 自動バックアップ：無効（メニューから有効にしてください）');

  // 保存されている世代
  try {
    var file = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
    var folder = getBackupFolder_(file);
    var backups = listBackups_(folder);
    if (!backups.length) {
      lines.push('× 保存済みのバックアップ：0件（まだ一度も取れていません）');
    } else {
      var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
      var newest = Utilities.formatDate(backups[0].date, tz, 'yyyy/MM/dd HH:mm');
      var ageHours = Math.floor((Date.now() - backups[0].date.getTime()) / 3600000);
      lines.push('◯ 保存済みのバックアップ：' + backups.length + '件');
      lines.push('　 最新：' + newest + '（' + ageHours + '時間前）');
      if (ageHours > 48) {
        lines.push('　 ⚠ 2日以上更新されていません。自動実行が止まっている可能性があります。');
      }
      lines.push('　 保存先：' + folder.getUrl());
    }
  } catch (e) {
    lines.push('× 保存先を確認できませんでした：' + ((e && e.message) ? e.message : String(e)));
  }

  backupTell_(ui, 'バックアップの状態\n\n' + lines.join('\n') +
    '\n\n【元に戻したいとき】\n' +
    '保存先フォルダから戻したい日付のファイルを開き、必要なシートを\n' +
    '右クリック →「他のスプレッドシートにコピー」でこのファイルへ戻してください。');
}


/* ============================ 中身 ============================ */

/**
 * スプレッドシートをまるごと複製する。
 * @return {{name:string, id:string, url:string, folder:Folder}}
 */
function createBackup_() {
  var ss = SpreadsheetApp.getActive();
  var file = DriveApp.getFileById(ss.getId());
  var folder = getBackupFolder_(file);

  var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd_HHmm');
  var name = BACKUP_NAME_PREFIX + ss.getName() + '_' + stamp;

  var copy = file.makeCopy(name, folder);
  return { name: name, id: copy.getId(), url: copy.getUrl(), folder: folder };
}

/**
 * バックアップ先フォルダを取得（無ければ作る）。
 * 元ファイルと同じ場所に置くことで、ファイルを探しに行く手間をなくす。
 */
function getBackupFolder_(file) {
  var parents = file.getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var found = parent.getFoldersByName(BACKUP_FOLDER_NAME);
  return found.hasNext() ? found.next() : parent.createFolder(BACKUP_FOLDER_NAME);
}

/**
 * バックアップ世代の一覧を新しい順で返す。
 * BACKUP_NAME_PREFIX で始まるファイルだけを対象にする（他のファイルには触れない）。
 * @return {Array<{file:File, date:Date}>}
 */
function listBackups_(folder) {
  var list = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(BACKUP_NAME_PREFIX) !== 0) continue;
    list.push({ file: f, date: f.getDateCreated() });
  }
  list.sort(function (a, b) { return b.date.getTime() - a.date.getTime(); });
  return list;
}

/**
 * 保存期間を過ぎた世代をゴミ箱へ送る（完全削除はしない＝取り違えても復旧できる）。
 * 日数に関わらず最新 BACKUP_MIN_KEEP 件は必ず残す。
 * @return {number} ゴミ箱へ送った件数
 */
function purgeOldBackups_(folder) {
  var backups = listBackups_(folder);
  var cutoff = Date.now() - BACKUP_RETENTION_DAYS * 86400000;
  var purged = 0;

  for (var i = BACKUP_MIN_KEEP; i < backups.length; i++) {
    if (backups[i].date.getTime() >= cutoff) continue;
    backups[i].file.setTrashed(true);
    purged++;
  }
  return purged;
}

/** 実行結果を「バックアップ履歴」シートに1行追記する。 */
function writeBackupLog_(status, name, purged, errorMessage) {
  var sheet = getOrCreateSheet(BACKUP_LOG_SHEET, BACKUP_LOG_HEADERS); // usage.js
  appendRows(sheet, [[new Date(), status, name, purged, errorMessage]]);
}

/**
 * バックアップ失敗をオーナー宛にメールで知らせる。
 * 通知自体が失敗しても本体の処理を巻き込まないよう、例外は握りつぶす
 * （履歴シートには既に記録済みのため、通知が飛ばなくても記録は残る）。
 */
function notifyBackupFailure_(message) {
  try {
    var to = Session.getEffectiveUser().getEmail();
    if (!to) return;
    var ss = SpreadsheetApp.getActive();
    MailApp.sendEmail(to,
      '【要対応】棚卸しシステムのバックアップが失敗しました',
      'スプレッドシート「' + ss.getName() + '」の自動バックアップが失敗しました。\n\n' +
      '発生日時：' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy/MM/dd HH:mm') + '\n' +
      'エラー内容：' + message + '\n\n' +
      'ファイル：' + ss.getUrl() + '\n\n' +
      'バックアップが止まっている間は、データが壊れても元に戻せません。\n' +
      'スプレッドシートのメニュー「バックアップ →今すぐバックアップを取る」で\n' +
      '再実行し、原因をご確認ください。');
  } catch (ignored) {
    // 通知できなくても、失敗自体は履歴シートに残っている。
  }
}

/** このスクリプトに登録済みのバックアップ用トリガーを返す。 */
function findBackupTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === BACKUP_TRIGGER_FUNC;
  });
}

/** バックアップ用トリガーを全て削除する。 @return {number} 削除件数 */
function deleteBackupTriggers_() {
  var triggers = findBackupTriggers_();
  triggers.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  return triggers.length;
}


/* ============================ 実行コンテキストの吸収 ============================ */

/**
 * スプレッドシートのUIを返す。取得できない場合は null。
 *
 * Apps Scriptエディタの「実行」ボタンから直接呼ぶと画面が無く、
 * SpreadsheetApp.getUi() は「Cannot call ... from this context」で失敗する。
 * メニューからでもエディタからでも動かせるよう、ここで吸収する。
 */
function backupUi_() {
  try { return SpreadsheetApp.getUi(); } catch (e) { return null; }
}

/** 画面があればダイアログ、無ければ実行ログに出す。 */
function backupTell_(ui, message) {
  if (ui) { ui.alert(message); return; }
  Logger.log(message);
}
