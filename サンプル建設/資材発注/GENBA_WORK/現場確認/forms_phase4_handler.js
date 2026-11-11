/**
 * Phase4（解体前教育）の処理。
 */
var Phase4Handler = (function() {
  var FIELD_SITE_NAME = '② 現場名';
  var FIELD_DEMOLITION_START = '③ 着工日';
  var FIELD_MEMO = '⑨ 注意・重要ポイント';

  function handleSubmit(e, phaseConfig) {
    var namedValues = e.namedValues || {};
    var config = getConfig();
    var siteName = FormUtils.getSiteName(
      namedValues, 
      config.EXISTING_SITE_FIELD, 
      config.NEW_SITE_FIELD, 
      FIELD_SITE_NAME, 
      phaseConfig
    );
    if (!siteName) {
      Logger.log('Phase4: siteName not found.');
      var keys = Object.keys(namedValues).join('\n');
      var msg = '【エラー】現場名が取得できませんでした(Phase4)。\n' +
                'フォームから受け取った質問項目一覧:\n' + keys;
      NotificationService.sendLineMessage(msg);
      return;
    }

    var demolitionStart = FormUtils.parseDate(FormUtils.getFirstValue(namedValues, FIELD_DEMOLITION_START));
    if (!demolitionStart) {
      var existing = SheetService.getDashboardValue(siteName, '解体開始予定日');
      demolitionStart = FormUtils.parseDate(existing);
    }
    var preEducationDate = demolitionStart ? FormUtils.addDays(demolitionStart, -7) : null;

    var updates = {
      '解体前教育最終報告日': new Date(),
      '解体前教育メモ': FormUtils.getFirstValue(namedValues, FIELD_MEMO)
    };
    
    // フォームから解体着工日が入力された場合は更新し、予定日も再計算する
    if (demolitionStart) {
      updates['解体開始予定日'] = demolitionStart;
      updates['解体前教育予定日'] = FormUtils.addDays(demolitionStart, -7);
    }
    
    SheetService.updateDashboard(siteName, updates);

    var message = FormUtils.composeMessage('解体前教育', siteName, namedValues, [
      FIELD_DEMOLITION_START,
      FIELD_MEMO
    ]);
    NotificationService.sendLineMessage(message);
  }

  return {
    handleSubmit: handleSubmit
  };
})();
