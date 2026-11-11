/**
 * Phase7（安全衛生協議会）の処理。
 */
var Phase7Handler = (function() {
  var FOLDER_NAME = '07_衛生協議会';
  var FIELD_SITE_NAME = '② 現場名';
  var FIELD_TOPIC = '⑤ 現場安全巡回';
  var FIELD_MEMO = '⑧ その他、伝達事項';

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
      Logger.log('Phase7: siteName not found.');
      var keys = Object.keys(namedValues).join('\n');
      var msg = '【エラー】現場名が取得できませんでした(Phase7)。\n' +
                'フォームから受け取った質問項目一覧:\n' + keys;
      NotificationService.sendLineMessage(msg);
      return;
    }

    try {
      DriveService.resolvePhaseFolder(siteName, phaseConfig.phase, FOLDER_NAME);
    } catch (e) {
      Logger.log('Phase7: Drive operation failed: ' + e.toString());
    }

    var updates = {
      '安全衛生協議会最終報告日': new Date(),
      '安全衛生協議会テーマ': FormUtils.getFirstValue(namedValues, FIELD_TOPIC),
      '安全衛生協議会メモ': FormUtils.getFirstValue(namedValues, FIELD_MEMO)
    };
    SheetService.updateDashboard(siteName, updates);

    var message = FormUtils.composeMessage('安全衛生協議会', siteName, namedValues, [
      FIELD_TOPIC,
      FIELD_MEMO
    ]);
    NotificationService.sendLineMessage(message);
  }

  return {
    handleSubmit: handleSubmit
  };
})();
