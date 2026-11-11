/**
 * マスタ同期（フェーズ0）を担当するモジュール。
 * 稼働現場リストの更新を検知して全フォームのプルダウンを同期する。
 * また、工期データをダッシュボードに反映する。
 */
var MasterSync = (function() {

  // 稼働現場リストの列定義（1始まり）
  var MASTER_COLUMNS = {
    SITE_NAME: 1,        // A列: 現場名
    ASSEMBLY_START: 5,   // E列: 組始
    ASSEMBLY_END: 6,     // F列: 組終
    DISMANTLE_START: 7,  // G列: 解始
    DISMANTLE_END: 8,    // H列: 解終
  };

  function handleEdit(e) {
    if (!e) return;
    var range = e.range;
    if (!range) return;
    var sheet = range.getSheet();
    var config = getConfig();
    if (!sheet || sheet.getName() !== config.MASTER_SHEET_NAME) return;

    var col = range.getColumn();
    var row = range.getRow();
    if (row < 2) return;

    // A列（現場名）の編集 → フォームのプルダウン更新
    if (col === 1) {
      var siteNames = getSiteMaster();
      updateFormDropdowns(siteNames);
      SpreadsheetApp.getActive().toast('フォームの選択肢を同期しました。', 'マスタ同期');
    }

    // E〜H列（工期）の編集 → ダッシュボードに反映
    if (col >= MASTER_COLUMNS.ASSEMBLY_START && col <= MASTER_COLUMNS.DISMANTLE_END) {
      var siteName = sheet.getRange(row, MASTER_COLUMNS.SITE_NAME).getValue();
      if (siteName) {
        syncScheduleToDashboard(SiteNameUtils.normalizeSiteName(siteName));
        SpreadsheetApp.getActive().toast('工期をダッシュボードに反映しました。', 'マスタ同期');
      }
    }
  }

  function getSiteMaster() {
    var config = getConfig();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(config.MASTER_SHEET_NAME);
    if (!sheet) throw new Error('Master sheet not found: ' + config.MASTER_SHEET_NAME);

    var range = sheet.getRange(config.MASTER_RANGE);
    var values = range.getValues();
    return values
      .filter(function(row) {
        return row[0] && row[0].toString().trim() !== '';
      })
      .map(function(row) {
        return row[0].toString().trim();
      });
  }

  function updateFormDropdowns(siteNames) {
    var config = getConfig();
    var formIds = getTargetFormIds(config);
    if (!formIds.length) return;

    formIds.forEach(function(formId) {
      try {
        var form = FormApp.openById(formId);
        var listItems = form.getItems(FormApp.ItemType.LIST);
        var targetItem = findExistingSiteItem(listItems, config.EXISTING_SITE_FIELD);

        if (targetItem) {
          targetItem.asListItem().setChoiceValues(siteNames);
          Logger.log('Updated dropdown for form ' + formId + ' with ' + siteNames.length + ' sites');
        } else {
          Logger.log('Warning: "' + config.EXISTING_SITE_FIELD + '" dropdown not found in form ' + formId);
        }
      } catch (err) {
        Logger.log('Failed to update dropdown for form ' + formId + ': ' + err);
      }
    });
  }

  function getTargetFormIds(config) {
    var ids = [];
    if (config.FORMS && config.FORMS.length) {
      var seen = {};
      config.FORMS.forEach(function(formConfig) {
        if (formConfig.id && !seen[formConfig.id]) {
          ids.push(formConfig.id);
          seen[formConfig.id] = true;
        }
      });
    }
    if (!ids.length && config.FORM_ID) {
      ids.push(config.FORM_ID);
    }
    return ids;
  }

  function findExistingSiteItem(items, targetTitle) {
    if (!items || !items.length) return null;
    var normalizedTarget = normalizeQuestionTitle(targetTitle);
    for (var i = 0; i < items.length; i++) {
      var title = items[i].getTitle();
      if (!title) continue;
      if (title === targetTitle || normalizeQuestionTitle(title) === normalizedTarget) {
        return items[i];
      }
    }
    return null;
  }

  function normalizeQuestionTitle(title) {
    if (!title) return '';
    var withoutPrefix = title.replace(/^[\s\u2460-\u2473\u3251-\u325f\u32b1-\u32bf\d一二三四五六七八九十〇]+[\.．:：、\-\)\(\uFF09\uFF08\s]*/g, '');
    return withoutPrefix.replace(/\s+/g, '').toLowerCase();
  }

  /**
   * 新しい現場名を稼働現場リストに登録し、フォームのプルダウンを更新する。
   * @param {string} siteName
   */
  function registerSiteIfNew(siteName) {
    if (!siteName || String(siteName).trim() === '') return;

    var normalized = SiteNameUtils.normalizeSiteName(siteName);
    if (!normalized) return;
    
    var config = getConfig();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(config.MASTER_SHEET_NAME);
    
    // シートが存在しない場合は作成
    if (!sheet) {
      sheet = ss.insertSheet(config.MASTER_SHEET_NAME);
      sheet.getRange(1, 1).setValue('現場名');
    }
    
    var siteNames = getSiteMaster();
    
    // 既に登録されているかチェック（表記ゆれを正規化して比較）
    var exists = siteNames.some(function(n) {
      return SiteNameUtils.normalizeSiteName(n) === normalized;
    });
    if (exists) {
      return; // 既存の現場名なので何もしない
    }
    
    // 新規現場名を追加（マスタ上は正規化後の表記で統一）
    sheet.appendRow([normalized]);
    Logger.log('New site registered: ' + siteName);
    
    // フォームのプルダウンを更新
    var updatedSiteNames = getSiteMaster();
    updateFormDropdowns(updatedSiteNames);
  }

  /**
   * 指定した現場の工期データを稼働現場リストからダッシュボードに同期する
   * @param {string} siteName 現場名
   */
  function syncScheduleToDashboard(siteName) {
    if (!siteName) return;

    var config = getConfig();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var masterSheet = ss.getSheetByName(config.MASTER_SHEET_NAME);
    if (!masterSheet) return;

    // 稼働現場リストから該当現場の工期を取得
    var schedule = getScheduleFromMaster(masterSheet, siteName);
    if (!schedule) return;

    // ダッシュボードに反映
    var updates = {};
    if (schedule.assemblyStart) updates['組立開始予定日'] = schedule.assemblyStart;
    if (schedule.assemblyEnd) updates['組立終了予定日'] = schedule.assemblyEnd;
    if (schedule.dismantleStart) updates['解体開始予定日'] = schedule.dismantleStart;
    if (schedule.dismantleEnd) updates['解体終了予定日'] = schedule.dismantleEnd;

    // 解体前教育予定日を自動計算（解体開始の7日前）
    if (schedule.dismantleStart) {
      var dismantleDate = new Date(schedule.dismantleStart);
      if (!isNaN(dismantleDate.getTime())) {
        dismantleDate.setDate(dismantleDate.getDate() - 7);
        updates['解体前教育予定日'] = dismantleDate;
      }
    }

    if (Object.keys(updates).length > 0) {
      SheetService.updateDashboard(siteName, updates, '');
    }
  }

  /**
   * 稼働現場リストから指定現場の工期データを取得
   * @param {Sheet} sheet 稼働現場リストシート
   * @param {string} siteName 現場名
   * @return {Object|null} 工期データ
   */
  function getScheduleFromMaster(sheet, siteName) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;

    var numRows = lastRow - 1;
    var dataRange = sheet.getRange(2, 1, numRows, MASTER_COLUMNS.DISMANTLE_END);
    var values = dataRange.getValues();

    for (var i = 0; i < values.length; i++) {
      var rowSiteName = (values[i][MASTER_COLUMNS.SITE_NAME - 1] || '').toString().trim();
      if (SiteNameUtils.normalizeSiteName(rowSiteName) === SiteNameUtils.normalizeSiteName(siteName)) {
        return {
          assemblyStart: values[i][MASTER_COLUMNS.ASSEMBLY_START - 1],
          assemblyEnd: values[i][MASTER_COLUMNS.ASSEMBLY_END - 1],
          dismantleStart: values[i][MASTER_COLUMNS.DISMANTLE_START - 1],
          dismantleEnd: values[i][MASTER_COLUMNS.DISMANTLE_END - 1],
        };
      }
    }

    return null;
  }

  /**
   * 全現場の工期データを一括でダッシュボードに同期（手動実行用）
   */
  function syncAllSchedulesToDashboard() {
    var config = getConfig();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var masterSheet = ss.getSheetByName(config.MASTER_SHEET_NAME);
    if (!masterSheet) {
      Logger.log('稼働現場リストシートが見つかりません');
      return;
    }

    var lastRow = masterSheet.getLastRow();
    if (lastRow < 2) {
      Logger.log('稼働現場リストにデータがありません');
      return;
    }

    var numRows = lastRow - 1;
    var dataRange = masterSheet.getRange(2, 1, numRows, MASTER_COLUMNS.DISMANTLE_END);
    var values = dataRange.getValues();

    var count = 0;
    values.forEach(function(row) {
      var siteName = (row[MASTER_COLUMNS.SITE_NAME - 1] || '').toString().trim();
      if (!siteName) return;

      var schedule = {
        assemblyStart: row[MASTER_COLUMNS.ASSEMBLY_START - 1],
        assemblyEnd: row[MASTER_COLUMNS.ASSEMBLY_END - 1],
        dismantleStart: row[MASTER_COLUMNS.DISMANTLE_START - 1],
        dismantleEnd: row[MASTER_COLUMNS.DISMANTLE_END - 1],
      };

      var updates = {};
      if (schedule.assemblyStart) updates['組立開始予定日'] = schedule.assemblyStart;
      if (schedule.assemblyEnd) updates['組立終了予定日'] = schedule.assemblyEnd;
      if (schedule.dismantleStart) updates['解体開始予定日'] = schedule.dismantleStart;
      if (schedule.dismantleEnd) updates['解体終了予定日'] = schedule.dismantleEnd;

      // 解体前教育予定日を自動計算
      if (schedule.dismantleStart) {
        var dismantleDate = new Date(schedule.dismantleStart);
        if (!isNaN(dismantleDate.getTime())) {
          dismantleDate.setDate(dismantleDate.getDate() - 7);
          updates['解体前教育予定日'] = dismantleDate;
        }
      }

      if (Object.keys(updates).length > 0) {
        SheetService.updateDashboard(SiteNameUtils.normalizeSiteName(siteName), updates, '');
        count++;
      }
    });

    Logger.log('工期同期完了: %s件', count);
    SpreadsheetApp.getActive().toast('工期データを' + count + '件同期しました。', '一括同期完了');
  }

  return {
    handleEdit: handleEdit,
    getSiteMaster: getSiteMaster,
    updateFormDropdowns: updateFormDropdowns,
    registerSiteIfNew: registerSiteIfNew,
    syncScheduleToDashboard: syncScheduleToDashboard,
    syncAllSchedulesToDashboard: syncAllSchedulesToDashboard
  };
})();

/**
 * 全現場の工期データを一括同期（メニューから実行用）
 */
function syncAllSchedulesToDashboard() {
  MasterSync.syncAllSchedulesToDashboard();
}
