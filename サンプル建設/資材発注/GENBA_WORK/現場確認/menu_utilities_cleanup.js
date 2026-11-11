/**
 * データベースに登録されていないDriveフォルダを特定し、ゴミ箱へ移動する。
 * タイムアウト対策として、必要に応じてトリガーを自動作成して継続実行する。
 */
function runDriveCleanup() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    'フォルダ整理の確認',
    '「データベース」シートに登録されていない現場フォルダをすべてゴミ箱へ移動します。\n' +
    '※現場数が多い場合、バックグラウンドで数分かけて処理されます。\n' +
    '完了するとLINEで通知されます。よろしいですか？',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) return;

  try {
    var config = getConfig();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(config.DASHBOARD_DATA_SHEET_NAME);
    var headers = SheetService.getHeaders(config.DASHBOARD_DATA_SHEET_NAME);
    var urlColIndex = headers.indexOf('現場フォルダURL');
    
    if (urlColIndex === -1) throw new Error('「現場フォルダURL」列が見つかりません。');
    
    var lastRow = sheet.getLastRow();
    var registeredUrls = [];
    if (lastRow >= 2) {
      var values = sheet.getRange(2, urlColIndex + 1, lastRow - 1, 1).getValues();
      registeredUrls = values.flat().filter(function(url) { return url; });
    }
    
    // 状態を初期化して開始
    var props = PropertiesService.getScriptProperties();
    props.setProperty('CLEANUP_REGISTERED_URLS', JSON.stringify(registeredUrls));
    props.setProperty('CLEANUP_TOTAL_COUNT', '0');
    props.deleteProperty('CLEANUP_TOKEN');
    
    // トリガーを掃除してから実行
    clearCleanupTriggers();
    executeCleanupIteration();
    
    SpreadsheetApp.getActive().toast('フォルダ整理を開始しました。完了までお待ちください。', 'フォルダ整理');
  } catch (e) {
    ui.alert('エラー', 'フォルダ整理の開始に失敗しました: ' + e.toString(), ui.ButtonSet.OK);
  }
}

/**
 * 実際のクリーンアップ処理（1イテレーション分）
 */
function executeCleanupIteration() {
  var props = PropertiesService.getScriptProperties();
  var registeredUrls = JSON.parse(props.getProperty('CLEANUP_REGISTERED_URLS') || '[]');
  var token = props.getProperty('CLEANUP_TOKEN');
  var totalCount = parseInt(props.getProperty('CLEANUP_TOTAL_COUNT') || '0', 10);
  
  try {
    var result = DriveService.cleanupUnregisteredFolders(registeredUrls, token);
    totalCount += result.processedCount;
    
    if (result.isFinished) {
      // 完了
      clearCleanupTriggers();
      props.deleteProperty('CLEANUP_REGISTERED_URLS');
      props.deleteProperty('CLEANUP_TOKEN');
      props.deleteProperty('CLEANUP_TOTAL_COUNT');
      
      // LINE通知
      NotificationService.sendLineMessage('✅ 【フォルダ整理完了】\nデータベースに登録されていない ' + totalCount + ' 件のフォルダをゴミ箱へ移動しました。');
      Logger.log('Drive cleanup finished. Total trashed: ' + totalCount);
    } else {
      // 中断・再開
      props.setProperty('CLEANUP_TOKEN', result.continuationToken);
      props.setProperty('CLEANUP_TOTAL_COUNT', totalCount.toString());
      setupCleanupTrigger();
      Logger.log('Drive cleanup paused. Trashed so far: ' + totalCount);
    }
  } catch (e) {
    Logger.log('Error during Drive cleanup iteration: ' + e.toString());
    NotificationService.sendLineMessage('⚠️ 【フォルダ整理エラー】\n処理中にエラーが発生しました: ' + e.toString());
    clearCleanupTriggers();
  }
}

/**
 * 再開用トリガーを作成
 */
function setupCleanupTrigger() {
  clearCleanupTriggers();
  ScriptApp.newTrigger('executeCleanupIteration')
    .timeBased()
    .after(60000) // 1分後
    .create();
}

/**
 * 関連するトリガーをすべて削除
 */
function clearCleanupTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'executeCleanupIteration') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
