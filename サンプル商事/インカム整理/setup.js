/**
 * 管理シートの作成（初期セットアップ）
 * ------------------------------------------------------------------
 * 「全院インカム管理」スプレッドシートに、アプリが読み書きする正規化シートを追加する。
 *
 * 安全設計:
 *   - 既存の PV / NIS / KDC / MDC / インカム本体管理 / イヤホン管理 などのシートには
 *     一切書き込まない。これらは移行後も参照用に残す。
 *   - 既にある管理シートは作り直さない（データが消えるため）。ヘッダーが欠けている
 *     場合だけ知らせる。何度実行しても安全。
 *
 * 実行方法:
 *   clasp push 後、スプレッドシートを開き直すと「インカム管理ツール」メニューが出る。
 *   「① 管理シートを作成」→「② 現行データを移行」の順に実行する。
 */

// ===== シートのヘッダー定義 =====
// 各モジュールは列名（日本語）で参照するため、ここの順番を変えても壊れない。
// 逆に、列名そのものを変えると headerIndex_ が例外を出す（気付ける）。

var DEVICE_HEADERS = [
  '機器ID', '種別', '所属医院', '管理番号', '品番',
  'シリアルナンバー', 'シリアル表記',
  '購入日', '購入日表記', '保証期限',
  '状態', '使用者', '現在地医院', '最終修理日',
  '備考', '要確認', '更新日時', '更新者'
];

var REPAIR_HEADERS = [
  '案件ID', '対象種別', '機器ID', '対象表記', '所属医院',
  '故障日', '症状', '報告日', '報告者', '状態',
  '修理依頼日', '原因', '対応区分', '費用(税抜)', '完了日',
  '備考', '要確認', '更新日時', '更新者'
];

/**
 * 修理案件が何についての案件か。
 * イヤホンは本体台帳に載らない消耗品なので機器IDを持たない。
 * まとめ出しの台数カウントは「本体」だけを数えるため、この列で区別する。
 */
var REPAIR_TARGET_KINDS = ['本体', '中継器', 'イヤホン'];

var HISTORY_HEADERS = [
  '日時', '操作者', '医院', '対象種別', '対象ID', '操作', '変更前', '変更後', 'メモ'
];

var SETTINGS_HEADERS = ['キー', '値', '説明'];

var EAR_STOCK_HEADERS = ['医院', '型番', '総在庫数', '備考', '更新日時'];

var EAR_ISSUE_HEADERS = ['支給ID', '医院', 'スタッフ名', '型番', '支給日', '状態', '備考', '要確認'];

/** イヤホン支給の状態（第2弾で画面を作る。移行では値だけ入れる） */
var EAR_ISSUE_STATUS_LIST = ['支給中', '貸出中', '返却', '破棄'];

/**
 * シートごとの作成定義。
 * validations は {列名: 選択肢配列} で、その列にプルダウンを設定する。
 */
var SHEET_SPECS = [
  { name: SHEETS.devices, headers: DEVICE_HEADERS, widths: { '備考': 260, '要確認': 260 },
    validations: { '状態': DEVICE_STATUS_LIST, '種別': DEVICE_KINDS,
                   '所属医院': CLINICS, '現在地医院': CLINICS } },
  { name: SHEETS.repairs, headers: REPAIR_HEADERS,
    widths: { '対象表記': 220, '症状': 240, '備考': 240, '要確認': 240 },
    validations: { '状態': REPAIR_STATUS_LIST, '所属医院': CLINICS,
                   '対応区分': REPAIR_ACTIONS, '対象種別': REPAIR_TARGET_KINDS } },
  { name: SHEETS.history, headers: HISTORY_HEADERS, widths: { '変更前': 200, '変更後': 200, 'メモ': 260 },
    validations: {} },
  { name: SHEETS.settings, headers: SETTINGS_HEADERS, widths: { '説明': 460 }, validations: {} },
  { name: SHEETS.earStock, headers: EAR_STOCK_HEADERS, widths: { '備考': 260 },
    validations: { '医院': CLINICS } },
  { name: SHEETS.earIssue, headers: EAR_ISSUE_HEADERS, widths: { '備考': 260, '要確認': 240 },
    validations: { '医院': CLINICS, '状態': EAR_ISSUE_STATUS_LIST } }
];

/** スプレッドシートを開いたときにメニューを追加する */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('インカム管理ツール')
    .addItem('① 管理シートを作成', 'setupSheets')
    .addItem('② 現行データを移行', 'runMigration')
    .addSeparator()
    .addItem('移行結果を確認（レポート）', 'showMigrationReport')
    .addItem('移行をやり直す（管理シートを空にして再移行）', 'rerunMigration')
    .addToUi();
}

/**
 * 【最初に1回だけ実行】スプレッドシートを開いたときに自動でメニューが出るようにする。
 *
 * このプロジェクトはスタンドアロン（「全院インカム管理 のコピー」に紐付いていない
 * 独立したスクリプト）なので、onOpen() を書くだけではメニューが自動で出ない。
 * 対象スプレッドシートを開いたときに onOpen を呼ぶ「インストール型トリガー」を
 * ここで作成する。
 *
 * 実行方法:
 *   Apps Scriptエディタの関数選択で initializeBinding を選び、▷実行 を押す
 *   （初回は権限の承認ダイアログが出るので許可する）。ログに「完了」と出れば成功。
 *   何度実行しても、前回のトリガーを削除してから作り直すので安全。
 */
function initializeBinding() {
  var ss = getSS_();

  // 既にこのプロジェクトが作った onOpen トリガーがあれば削除してから作り直す
  // （実行するたびに増えてしまうのを防ぐ）。
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onOpen') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onOpen').forSpreadsheet(ss).onOpen().create();

  Logger.log('完了: 「' + ss.getName() + '」を開くと「インカム管理ツール」メニューが' +
    '自動で出るようになりました。');
}

/**
 * 管理シート6枚を作成する。既にあるシートは中身を残したまま、
 * ヘッダーの不足だけを報告する。何度実行してもデータは消えない。
 * @return {{created:Array<string>, existing:Array<string>, warnings:Array<string>}}
 */
function setupSheets() {
  var result = setupSheetsQuiet_();
  var message = '作成: ' + (result.created.length ? result.created.join(' / ') : 'なし') + '\n'
              + '既存（そのまま）: ' + (result.existing.length ? result.existing.join(' / ') : 'なし')
              + (result.warnings.length ? '\n\n⚠ ' + result.warnings.join('\n⚠ ') : '');
  notify_('① 管理シートの作成', message);
  return result;
}

/**
 * 管理シートを作る本体。ダイアログを出さないので、移行処理からも呼べる。
 * @return {{created:Array<string>, existing:Array<string>, warnings:Array<string>}}
 */
function setupSheetsQuiet_() {
  var ss = getSS_();
  var created = [];
  var existing = [];
  var warnings = [];

  SHEET_SPECS.forEach(function (spec) {
    var sheet = ss.getSheetByName(spec.name);
    if (sheet) {
      existing.push(spec.name);
      // ヘッダーが欠けていないか点検する（列名を変えられるとアプリが動かなくなるため）
      var lastCol = Math.max(sheet.getLastColumn(), 1);
      var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(toStr);
      var missing = spec.headers.filter(function (h) { return header.indexOf(h) < 0; });
      if (missing.length) {
        warnings.push('「' + spec.name + '」に列がありません: ' + missing.join(' / '));
      }
      return;
    }
    createSheet_(ss, spec);
    created.push(spec.name);
  });

  // 設定シートは作りたてなら既定値を入れる（既にあれば触らない）
  if (created.indexOf(SHEETS.settings) >= 0) {
    var settingsSheet = ss.getSheetByName(SHEETS.settings);
    settingsSheet.getRange(2, 1, DEFAULT_SETTINGS.length, SETTINGS_HEADERS.length)
      .setValues(DEFAULT_SETTINGS);
  }

  invalidateCache_();

  return { created: created, existing: existing, warnings: warnings };
}

/**
 * 1枚のシートを作る。ヘッダー・書式・プルダウン・列幅・固定行までまとめて設定する。
 * @param {Spreadsheet} ss
 * @param {{name:string, headers:Array<string>, widths:Object, validations:Object}} spec
 */
function createSheet_(ss, spec) {
  var sheet = ss.insertSheet(spec.name);
  var n = spec.headers.length;

  sheet.getRange(1, 1, 1, n).setValues([spec.headers])
    .setFontWeight('bold')
    .setBackground('#e8eef7')
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);

  // 既定の列幅。指定があるものだけ広げる。
  for (var c = 1; c <= n; c++) {
    var label = spec.headers[c - 1];
    sheet.setColumnWidth(c, spec.widths[label] || 110);
  }

  // プルダウン。手でシートを直すときの打ち間違いを防ぐ。
  // 追記される行の分も見込んで、余裕を持った行数に設定しておく。
  Object.keys(spec.validations).forEach(function (label) {
    var col = spec.headers.indexOf(label) + 1;
    if (col <= 0) return;
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(spec.validations[label], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, col, 500, 1).setDataValidation(rule);
  });

  // 日付・日時列の表示形式
  spec.headers.forEach(function (label, i) {
    if (/日$|期限$/.test(label)) {
      sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy/mm/dd');
    } else if (label === '日時' || label === '更新日時') {
      sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy/mm/dd hh:mm');
    } else if (label === '費用(税抜)') {
      sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('¥#,##0');
    }
  });

  return sheet;
}

/**
 * 実行結果を知らせる。スプレッドシートのUIから実行されたときだけダイアログを出し、
 * エディタやWebアプリから呼ばれた場合はログに残す（UIが無い文脈で落ちないように）。
 */
function notify_(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    Logger.log(title + '\n' + message);
  }
}
