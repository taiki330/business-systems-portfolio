/**
 * Phase5（足場工区点検）の処理。
 */
var Phase5Handler = (function() {
  var FOLDER_NAME = '05_点検';
  var FIELD_SITE_NAME = '④ 工事名称';
  var FIELD_DATE = '① 点検実施日';
  var FIELD_RESULT = '⑥ 点検チェックシート記入';
  var FIELD_COMMENT = '⑧ 指摘事項の資料作成';
  var FIELD_COMMENT_2 = '⑨ 指摘事項の資料を施工業者へ伝達、指示';
  var FIELD_PHOTOS = '【重要】記録・アップロード';

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
      Logger.log('Phase5: siteName not found.');
      var keys = Object.keys(namedValues).join('\n');
      var msg = '【エラー】現場名が取得できませんでした(Phase5)。\n' +
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
          siteName + '_点検',
          { phaseName: phaseConfig.name || '足場工区点検' }
        );
        folderContext = saveResult.folderContext;
      } catch (err) {
        Logger.log('Phase5: Drive operation failed: ' + err.toString());
        if ((config.DRIVE_GUARD_FAILURE_MODE || 'block') === 'block') {
          NotificationService.sendLineMessage('【Drive保存失敗】' + err.message);
          return;
        }
      }
    }

    var updates = {
      '足場工区点検最終報告日': FormUtils.parseDate(FormUtils.getFirstValue(namedValues, FIELD_DATE)) || new Date(),
      '足場工区点検結果': FormUtils.getFirstValue(namedValues, FIELD_RESULT),
      '足場工区点検メモ': combineNotes(
        FormUtils.getFirstValue(namedValues, FIELD_COMMENT),
        FormUtils.getFirstValue(namedValues, FIELD_COMMENT_2)
      )
    };
    FormUtils.applyQuarantineToUpdates_(updates, folderContext, '足場工区点検メモ');
    SheetService.updateDashboard(siteName, updates);

    var message = FormUtils.composeMessage('足場工区点検', siteName, namedValues, [
      FIELD_DATE,
      FIELD_RESULT,
      FIELD_COMMENT,
      FIELD_COMMENT_2
    ]);
    if (folderContext && folderContext.isQuarantine) {
      message += '\n【要確認】写真は隔離フォルダに保存しました: ' + folderContext.quarantineFolderUrl;
    }
    NotificationService.sendLineMessage(message);
  }

  function combineNotes() {
    return Array.prototype.slice.call(arguments).filter(function(text) {
      return text && text.trim() !== '';
    }).join('\n');
  }

  return {
    handleSubmit: handleSubmit
  };
})();
