/**
 * 【クライアント依頼・商品名訂正の反映漏れ修正用・一時ファイル】
 * ------------------------------------------------------------------
 * client_request_apply.js で「バー」ソースシートの品名は訂正済みだが、
 * 既に生成されている NIS_在庫/MDC_在庫/KDC_在庫/PV_在庫 には旧名の行が
 * そのまま残っている（① を再実行せずに直すため）。
 * カテゴリ＋旧品名が一致する行の「品名」セルだけを新名に書き換える。
 * 管理方式・発注基準数・現在庫数など他の値は一切変更しない。
 *
 * 使い方:
 *   1. clasp push
 *   2. Apps Scriptエディタで propagateRenames を実行
 *   3. 確認ダイアログでOK
 *   4. 完了後のログ・アラートで結果を確認
 */

var CR_RENAME_PROPAGATE = [
  { category: 'バー', oldName: '松風シリコンポイント M3 CA #28(12本入り)', newName: '松風シリコンポイント M2 CA #28(12本入り)' },
  { category: 'バー', oldName: '松風ダイヤモンドポイントＦＧ　106R', newName: '松風ダイヤモンドポイントＦＧ　106RD' },
  { category: 'バー', oldName: '松風ダイヤモンドポイントＦＧ　206R', newName: '松風ダイヤモンドポイントＦＧ　206CR' }
];

function propagateRenames() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var clinics = ['NIS', 'MDC', 'KDC', 'PV'];

  // ---- 事前調査（この時点ではまだ何も書き込まない） ----
  var hits = []; // {clinic, row, category, name}
  clinics.forEach(function (clinic) {
    var sheet = ss.getSheetByName(clinic + '_在庫');
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    values.forEach(function (row, i) {
      var category = String(row[0] || '').trim();
      var name = String(row[3] || '').trim();
      CR_RENAME_PROPAGATE.forEach(function (t) {
        if (category === t.category && name === t.oldName.trim()) {
          hits.push({ clinic: clinic, row: i + 2, target: t });
        }
      });
    });
  });

  if (!hits.length) {
    ui.alert('該当する旧名の行は見つかりませんでした。既に反映済みか、対象がない可能性があります。');
    return;
  }

  var planLines = hits.map(function (h) {
    return h.clinic + '_在庫!' + h.row + ' 「' + h.target.oldName + '」→「' + h.target.newName + '」';
  });
  var resp = ui.alert('商品名訂正の反映漏れ修正',
    '以下の行の品名だけを書き換えます（他の値は変更しません）。よろしいですか？\n\n' + planLines.join('\n'),
    ui.ButtonSet.OK_CANCEL);
  if (resp !== ui.Button.OK) {
    ui.alert('中止しました。何も変更していません。');
    return;
  }

  // ---- 実際の書き込み ----
  var resultLines = [];
  hits.forEach(function (h) {
    var sheet = ss.getSheetByName(h.clinic + '_在庫');
    sheet.getRange(h.row, 4).setValue(h.target.newName);
    resultLines.push('[完了] ' + h.clinic + '_在庫!' + h.row + ' → 「' + h.target.newName + '」');
  });

  var summary = resultLines.join('\n');
  Logger.log(summary);
  ui.alert('反映が完了しました。\n\n' + summary);
}
