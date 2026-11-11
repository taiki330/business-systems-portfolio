/**
 * Phase3（送り出し教育）の処理。
 * フォーム回答をダッシュボードに反映する。
 */
var Phase3Handler = (function() {
  var FIELD_SITE_NAME = '現場名';
  var FIELD_MEMO = '⑫ 当現場における重要ポイント（上席の確認済みか）';

  function handleSubmit(e, phaseConfig) {
    var config = getConfig();
    var namedValues = e.namedValues || {};
    var siteName = FormUtils.getSiteName(
      namedValues, 
      config.EXISTING_SITE_FIELD, 
      config.NEW_SITE_FIELD, 
      FIELD_SITE_NAME, 
      phaseConfig
    );
    if (!siteName) {
      Logger.log('Phase3: siteName not found.');
      var keys = Object.keys(namedValues).join('\n');
      var msg = '【エラー】現場名が取得できませんでした。\n' +
                'フォームから受け取った質問項目一覧:\n' + keys + '\n\n' +
                '※「現場」「工事名」などが含まれる項目を自動検索しましたが、見つかりませんでした。';
      NotificationService.sendLineMessage(msg);
      return;
    }

    // 親行（現場全体）の基本情報を更新（③アイコン表示用）
    var parentUpdates = {
      '送り出し教育最終報告日': new Date(),
      '送り出し教育備考': FormUtils.getFirstValue(namedValues, FIELD_MEMO)
    };
    SheetService.updateDashboard(siteName, parentUpdates, ''); // 空文字列で親行を指定

    // LINE通知
    var message = FormUtils.composeMessage('送り出し教育', siteName, namedValues, [
      FIELD_MEMO
    ]);
    NotificationService.sendLineMessage(message);
    
    Logger.log('Phase3: Processed report for site %s', siteName);
  }

  return {
    handleSubmit: handleSubmit
  };
})();
