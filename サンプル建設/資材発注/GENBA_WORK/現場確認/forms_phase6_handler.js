/**
 * Phase6（稼働現場巡回）の処理。
 */
var Phase6Handler = (function() {
  var FOLDER_NAME = '06_巡回';
  var FIELD_SITE_NAME = '④ 工事名称';
  var FIELD_DATE = '① 点検実施日';
  var FIELD_STATUS = '⑩ 点検内容の判定欄に○がついてるかどうか';
  var FIELD_COMMENT = '⑫ 担当者が工区点検に不備がないか確認';
  var FIELD_PHOTOS = '【重要】記録・アップロード（作業写真、点検表）';

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
      Logger.log('Phase6: siteName not found.');
      var keys = Object.keys(namedValues).join('\n');
      var msg = '【エラー】現場名が取得できませんでした(Phase6)。\n' +
                'フォームから受け取った質問項目一覧:\n' + keys;
      NotificationService.sendLineMessage(msg);
      return;
    }

    var photoUrls = FormUtils.getFileUrls(namedValues, FIELD_PHOTOS);
    var folderContext = null;
    if (photoUrls.length > 0) {
      try {
        var saveResult = DriveService.savePhasePhotosFromForm_(
          siteName,
          phaseConfig.phase,
          FOLDER_NAME,
          photoUrls,
          siteName + '_巡回',
          { phaseName: phaseConfig.name || '稼働現場巡回' }
        );
        folderContext = saveResult.folderContext;
      } catch (err) {
        Logger.log('Phase6: Drive operation failed: ' + err.toString());
        if ((config.DRIVE_GUARD_FAILURE_MODE || 'block') === 'block') {
          NotificationService.sendLineMessage('【Drive保存失敗】' + err.message);
          return;
        }
      }
    }

    var updates = {
      '現場巡回最終報告日': FormUtils.parseDate(FormUtils.getFirstValue(namedValues, FIELD_DATE)) || new Date(),
      '現場巡回結果': FormUtils.getFirstValue(namedValues, FIELD_STATUS),
      '現場巡回メモ': FormUtils.getFirstValue(namedValues, FIELD_COMMENT)
    };
    FormUtils.applyQuarantineToUpdates_(updates, folderContext, '現場巡回メモ');
    SheetService.updateDashboard(siteName, updates);

    var message = FormUtils.composeMessage('稼働現場巡回', siteName, namedValues, [
      FIELD_DATE,
      FIELD_STATUS,
      FIELD_COMMENT
    ]);
    if (folderContext && folderContext.isQuarantine) {
      message += '\n【要確認】写真は隔離フォルダに保存しました: ' + folderContext.quarantineFolderUrl;
    }
    NotificationService.sendLineMessage(message);
  }

  return {
    handleSubmit: handleSubmit
  };
})();
