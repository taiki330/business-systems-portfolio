/**
 * Phase1（現場調査）の処理。
 */
var Phase1Handler = (function() {
  var SUB_FOLDER = '01_現調';
  var FIELD_SITE_NAME = '⑤ 現場名';
  var FIELD_REPORTER = '会社名　'; // 末尾スペースあり
  var FIELD_PHOTOS = '現調時写真';
  var FIELD_MEMO_PRIMARY = ' 施工案・コメント'; // 先頭にスペースあり
  var FIELD_MEMO_SECONDARY = '⑮ 要注意事項';

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
      Logger.log('Phase1: siteName not found.');
      var keys = Object.keys(namedValues).join('\n');
      var msg = '【エラー】現場名が取得できませんでした(Phase1)。\n' +
                'フォームから受け取った質問項目一覧:\n' + keys;
      NotificationService.sendLineMessage(msg);
      return;
    }

    var folderContext = null;
    try {
      folderContext = DriveService.resolvePhaseFolder(siteName, phaseConfig.phase, SUB_FOLDER);
      var photoUrls = FormUtils.getFileUrls(namedValues, FIELD_PHOTOS);
      if (photoUrls.length && folderContext && folderContext.targetFolder) {
        DriveService.saveFilesFromResponse(photoUrls, folderContext.targetFolder, siteName);
      }
    } catch (e) {
      Logger.log('Phase1: Drive operation failed: ' + e.toString());
    }

    var updates = {
      '現場調査最終報告日': new Date(),
      '現場調査担当者': FormUtils.getFirstValue(namedValues, FIELD_REPORTER),
      '現場調査メモ': combineNotes(
        FormUtils.getFirstValue(namedValues, FIELD_REPORTER), // Note: reporter is used as a fallback or part of memo if needed, but here we follow the existing pattern
        FormUtils.getFirstValue(namedValues, FIELD_MEMO_PRIMARY),
        FormUtils.getFirstValue(namedValues, FIELD_MEMO_SECONDARY)
      )
    };
    if (folderContext && folderContext.siteFolder) {
      updates['現場フォルダURL'] = folderContext.siteFolder.getUrl();
    }
    SheetService.updateDashboard(siteName, updates);
  }

  function combineNotes() {
    var parts = Array.prototype.slice.call(arguments).filter(function(value) {
      return value && value.trim() !== '';
    });
    return parts.join('\n');
  }

  return {
    handleSubmit: handleSubmit
  };
})();
