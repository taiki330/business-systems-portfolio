/**
 * 承認WebApp エントリーポイント
 */

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('報告確認・承認')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// --- 公開API（google.script.run から呼び出し） ---

/**
 * 報告種別一覧を取得
 */
function fetchReportTypes() {
  return CONFIG.REPORT_TYPES;
}

/**
 * 報告一覧取得（種別指定）
 */
function fetchReportList(approverName, reportType) {
  return ApprovalService.getReportList(approverName, reportType);
}

/**
 * 報告詳細取得
 */
function fetchReportDetail(reportType, reportKeyOrRow) {
  return ApprovalService.getReportDetail(reportType, reportKeyOrRow);
}

/**
 * 承認
 */
function approveReport(reportType, reportKey, approverName) {
  return ApprovalService.approveReport(reportType, reportKey, approverName);
}

/**
 * 差し戻し（画像単位）
 */
function rejectReport(reportType, reportKey, approverName, rejectedImages) {
  return ApprovalService.rejectReport(reportType, reportKey, approverName, rejectedImages);
}

/**
 * 承認履歴取得
 */
function fetchApprovalHistory(reportType, siteName) {
  return ApprovalService.getApprovalHistory(reportType, siteName);
}

// --- トリガー関連 ---

/**
 * 差し戻し写真の再送を自動検知して処理する
 * onChange トリガーから呼び出される
 */
function processResubmissions() {
  ApprovalService.processResubmissions();
}

/**
 * 再送自動検知トリガーを設定する
 * Apps Script エディタから1回だけ手動実行する
 */
function setupResubmissionTrigger() {
  // 既存の同名トリガーを削除してから再作成
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processResubmissions') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // 1分間隔で実行
  ScriptApp.newTrigger('processResubmissions')
    .timeBased()
    .everyMinutes(1)
    .create();
}
