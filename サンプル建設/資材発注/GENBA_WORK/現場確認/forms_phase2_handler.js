/**
 * Phase2（仮設計画打ち合わせ）の処理。
 */
var Phase2Handler = (function() {
  var FIELD_SITE_NAME = '② 現場名';
  var FIELD_START_DATE = '③ 着工日';
  var FIELD_MEETING_NOTE = '⑯ 打合わせ内容';
  var SUB_FOLDER_NAME = '02_仮設計画';

  function handleSubmit(e, phaseConfig) {
    var config = getConfig();
    var SUB_FOLDERS = config.SITE_SUB_FOLDERS;
    var namedValues = e.namedValues || {};
    Logger.log('Phase2: namedValues keys = ' + Object.keys(namedValues).join(', '));
    
    var siteName = FormUtils.getSiteName(
      namedValues, 
      config.EXISTING_SITE_FIELD, 
      config.NEW_SITE_FIELD, 
      FIELD_SITE_NAME, 
      phaseConfig
    );
    Logger.log('Phase2: siteName = ' + siteName);
    
    if (!siteName) {
      Logger.log('Phase2: siteName not found.');
      var keys = Object.keys(namedValues).join('\n');
      var msg = '【エラー】現場名が取得できませんでした(Phase2)。\n' +
                'フォームから受け取った質問項目一覧:\n' + keys;
      NotificationService.sendLineMessage(msg);
      return;
    }

    var rawStartDate = FormUtils.getFirstValue(namedValues, FIELD_START_DATE);
    Logger.log('Phase2: rawStartDate (' + FIELD_START_DATE + ') = ' + rawStartDate);
    
    var startDate = FormUtils.parseDate(rawStartDate);
    Logger.log('Phase2: parsed startDate = ' + startDate);
    
    var sendOutEducationDate = startDate ? FormUtils.addDays(startDate, -7) : '';

    var folderContext = null;
    try {
      folderContext = DriveService.resolvePhaseFolder(siteName, phaseConfig.phase, SUB_FOLDER_NAME);
    } catch (e) {
      Logger.log('Phase2: Drive operation failed: ' + e.toString());
    }

    var updates = {
      '仮設計画打合わせ最終報告日': new Date()
    };
    if (folderContext && folderContext.siteFolder) {
      updates['現場フォルダURL'] = folderContext.siteFolder.getUrl();
    }
    if (startDate) {
      updates['着工予定日'] = startDate;
    }
    if (sendOutEducationDate) {
      updates['送出教育予定日'] = sendOutEducationDate;
    }
    SheetService.updateDashboard(siteName, updates);

    var message = buildLineMessage(siteName, startDate, sendOutEducationDate, FormUtils.getFirstValue(namedValues, FIELD_MEETING_NOTE));
    NotificationService.sendLineMessage(message);
  }

  function buildLineMessage(siteName, startDate, educationDate, meetingNote) {
    var lines = [
      '【仮設計画打ち合わせ】' + siteName,
      startDate ? '着工予定日: ' + FormUtils.formatDate(startDate) : '着工予定日: 入力なし'
    ];
    if (educationDate) {
      lines.push('送出教育予定日(自動計算): ' + FormUtils.formatDate(educationDate));
    }
    if (meetingNote) {
      lines.push('打合わせ内容: ' + meetingNote);
    }
    return lines.join('\n');
  }

  return {
    handleSubmit: handleSubmit
  };
})();
