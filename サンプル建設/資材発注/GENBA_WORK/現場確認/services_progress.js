/**
 * 日次進捗入力・管理サービス
 */

var ProgressService = (function() {
  
  /**
   * 日次進捗入力ダイアログを表示
   */
  function showDailyProgressDialog() {
    var ui = SpreadsheetApp.getUi();
    var template = HtmlService.createTemplateFromFile('dialog_daily_progress');
    
    var html = template.evaluate()
      .setWidth(500)
      .setHeight(600)
      .setTitle('📝 今日の実績を入力');
      
    ui.showModalDialog(html, '📝 今日の実績を入力');
  }
  
  /**
   * 現場リストを取得（ダイアログ用）
   */
  function getSiteList() {
    var data = SheetService.getDashboardData();
    var sites = {};
    
    data.rows.forEach(function(row) {
      var siteName = row['現場名'];
      if (siteName) {
        if (!sites[siteName]) {
          sites[siteName] = [];
        }
        var zoneName = row['工区名'];
        if (zoneName) {
          sites[siteName].push(zoneName);
        }
      }
    });
    
    return sites;
  }
  
  /**
   * 日次進捗を記録
   * @param {Object} payload - { siteName, zoneName, reportDate, progressItems }
   * progressItems: [{ type: '組立開始'|'組立中'|'組立終了'|'解体開始'|'解体中'|'解体終了', completion: 0-100 }]
   */
  function logDailyProgress(payload) {
    var config = getConfig();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(config.PROGRESS_REPORT_SHEET_NAME);
    
    // シートがない場合は作成
    if (!sheet) {
      sheet = ss.insertSheet(config.PROGRESS_REPORT_SHEET_NAME);
      sheet.getRange(1, 1, 1, 7).setValues([[
        'タイムスタンプ',
        '現場名',
        '工区名',
        '報告日',
        '報告種別',
        '達成度(%)',
        '報告者'
      ]]);
      sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#f3f3f3');
      sheet.setFrozenRows(1);
    }
    
    var timestamp = new Date();
    var reporter = Session.getActiveUser().getEmail() || 'Manual';
    var siteName = payload.siteName;
    var zoneName = payload.zoneName || '';
    var reportDate = payload.reportDate || new Date();
    
    // 各進捗項目を行として追加
    var rows = [];
    payload.progressItems.forEach(function(item) {
      rows.push([
        timestamp,
        siteName,
        zoneName,
        reportDate,
        item.type,
        item.completion || 0,
        reporter
      ]);
    });
    
    if (rows.length > 0) {
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, rows.length, 7).setValues(rows);
    }
    
    // データベース更新（開始/終了日）
    var updates = {};
    payload.progressItems.forEach(function(item) {
      if (item.type === '組立開始') {
        updates['組立開始実績日'] = reportDate;
      } else if (item.type === '組立終了') {
        updates['組立終了実績日'] = reportDate;
      } else if (item.type === '解体開始') {
        updates['解体開始実績日'] = reportDate;
      } else if (item.type === '解体終了') {
        updates['解体終了実績日'] = reportDate;
      }
    });
    
    if (Object.keys(updates).length > 0) {
      SheetService.updateDashboard(siteName, updates, zoneName);
    }
    
    // ダッシュボード更新（部分更新）
    DashboardUIService.refreshSiteRow(siteName, zoneName);

    // 資材管理へ自動連携。通信失敗時も元の進捗登録は成功扱いとし、内部キューから再送する。
    ResourceManagementSyncService.onProgressRecorded(payload);
    
    return true;
  }
  
  /**
   * 指定現場・工区の進捗履歴を取得
   * @param {string} siteName
   * @param {string} zoneName
   * @return {Object} { '2026-01-15': { assembly: 30, dismantle: 50 }, ... }
   */
  function getProgressHistory(siteName, zoneName) {
    var config = getConfig();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(config.PROGRESS_REPORT_SHEET_NAME);
    
    if (!sheet) return {};
    
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};
    
    var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    var history = {};
    
    data.forEach(function(row) {
      var rowSite = row[1];
      var rowZone = row[2] || '';
      var reportDate = row[3];
      var reportType = row[4];
      var completion = row[5];
      
      if (rowSite === siteName && rowZone === (zoneName || '')) {
        var dateKey = Utilities.formatDate(new Date(reportDate), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        
        if (!history[dateKey]) {
          history[dateKey] = {};
        }
        
        if (reportType === '組立中') {
          history[dateKey].assembly = completion;
        } else if (reportType === '解体中') {
          history[dateKey].dismantle = completion;
        }
      }
    });
    
    return history;
  }
  
  /**
   * 全現場・全工区の進捗データを一括取得（ダッシュボード描画用）
   * @return {Object} { siteName: { zoneName: { dateKey: { assembly: %, dismantle: % } } } }
   */
  function getAllProgressData() {
    var config = getConfig();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(config.PROGRESS_REPORT_SHEET_NAME);
    
    if (!sheet) return {};
    
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};
    
    var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    var progressMap = {};
    
    data.forEach(function(row) {
      var siteName = SiteNameUtils.normalizeSiteName(row[1]);
      var zoneName = row[2] || '';
      var reportDate = row[3];
      var reportType = row[4];
      var completion = row[5];
      
      if (!siteName) return;
      
      var dateKey = Utilities.formatDate(new Date(reportDate), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      
      if (!progressMap[siteName]) progressMap[siteName] = {};
      if (!progressMap[siteName][zoneName]) progressMap[siteName][zoneName] = {};
      if (!progressMap[siteName][zoneName][dateKey]) progressMap[siteName][zoneName][dateKey] = {};
      
      if (reportType === '組立中') {
        progressMap[siteName][zoneName][dateKey].assembly = completion;
      } else if (reportType === '解体中') {
        progressMap[siteName][zoneName][dateKey].dismantle = completion;
      }
    });
    
    return progressMap;
  }
  
  return {
    showDailyProgressDialog: showDailyProgressDialog,
    getSiteList: getSiteList,
    logDailyProgress: logDailyProgress,
    getProgressHistory: getProgressHistory,
    getAllProgressData: getAllProgressData
  };
})();
