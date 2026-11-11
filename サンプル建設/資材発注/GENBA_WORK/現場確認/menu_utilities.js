/**
 * 管理者用メニューとユーティリティ関数。
 */

/**
 * スプレッドシート開封時にカスタムメニューを追加する。
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('📊 ダッシュボード管理')
    .addItem('📝 今日の実績を入力', 'showDailyProgressDialog')
    .addSeparator()
    .addItem('📅 予定日を手動修正', 'showEditScheduleDialog')
    .addItem('🔄 ダッシュボードを再描画', 'refreshDashboardUI')
    .addItem('➕ 新規現場を追加', 'addNewSiteManually')
    .addItem('🔁 既存現場プルダウン同期', 'syncExistingSiteDropdowns')
    .addItem('🔄 全現場の工期を一括同期', 'syncAllSchedulesToDashboard')
    .addSeparator()
    .addSubMenu(ui.createMenu('🛠 メンテナンス設定')
      .addItem('🎨 データベースの書式を整える', 'applyProfessionalFormatting')
      .addItem('📁 データベースを階層整理', 'reorganizeBackendData')
      .addItem('🧹 未登録フォルダを整理（ゴミ箱へ）', 'runDriveCleanup')
      .addItem('🔧 ヘッダーの初期化', 'setupDashboardHeaders'))
    .addToUi();
}

/**
 * ダッシュボードヘッダーを初期化する。
 */
function setupDashboardHeaders() {
  SheetService.bootstrapDashboard();
  SpreadsheetApp.getUi().alert('ダッシュボードヘッダーを初期化しました。');
}

/**
 * プロフェッショナルな書式をデータベースシートに適用する。
 */
function applyProfessionalFormatting() {
  try {
    SheetService.setupDashboardFormatting();
    SpreadsheetApp.getUi().alert('プロフェッショナル書式を適用しました。');
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラーが発生しました: ' + e.toString());
  }
}

/**
 * 既存のデータシートを階層構造に整理する。
 */
function reorganizeBackendData() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    'データシートの整理',
    '既存の全データを現場名・工区名で並び替え、親子構造（グループ化）を適用します。実行しますか？',
    ui.ButtonSet.YES_NO
  );
  
  if (result == ui.Button.YES) {
    try {
      SheetService.reorganizeExistingData();
      ui.alert('完了', 'データシートの整理が完了しました。', ui.ButtonSet.OK);
    } catch (e) {
      ui.alert('エラー', '整理中にエラーが発生しました: ' + e.toString(), ui.ButtonSet.OK);
    }
  }
}

/**
 * 手動で新規現場を追加する。
 */
function addNewSiteManually() {
  var ui = SpreadsheetApp.getUi();
  var config = getConfig();
  
  // 1. 現場名の入力
  var siteResponse = ui.prompt('新規現場追加', '現場名を入力してください:', ui.ButtonSet.OK_CANCEL);
  if (siteResponse.getSelectedButton() !== ui.Button.OK) return;
  var siteName = siteResponse.getResponseText().trim();
  if (!siteName) {
    ui.alert('エラー', '現場名は必須です。', ui.ButtonSet.OK);
    return;
  }
  
  // 2. 工区名の入力（任意）
  var zoneResponse = ui.prompt('新規現場追加', '工区名を入力してください（任意）:', ui.ButtonSet.OK_CANCEL);
  if (zoneResponse.getSelectedButton() !== ui.Button.OK) return;
  var zoneName = zoneResponse.getResponseText().trim();
  
  var toastId = SpreadsheetApp.getActive().toast('処理中...', '新規現場作成', -1);
  
  try {
    var resolved = SiteMasterResolver.resolveSiteForDrive(siteName);
    var folderUrl = '';

    if (!resolved.ok) {
      ui.alert(
        'Driveフォルダ未作成',
        '稼働現場リストに未登録の現場です。\n' +
          '大本DBで syncSitesWithSchedule を実行し、C列にDriveフォルダIDが設定されてから再度お試しください。',
        ui.ButtonSet.OK
      );
      return;
    }

    if (!resolved.driveFolderId) {
      ui.alert(
        'Driveフォルダ未設定',
        'この現場のDriveフォルダが未設定です。\n' +
          '大本DBで同期後、runCreateMissingFoldersExecute または syncSitesWithSchedule でフォルダを作成してください。',
        ui.ButtonSet.OK
      );
      return;
    }

    var siteFolder = SiteDriveFolderGuard.assertSiteDriveFolderForPhase_({
      siteName: resolved.siteName,
      siteId: resolved.siteId,
      driveFolderId: resolved.driveFolderId
    });
    folderUrl = siteFolder.getUrl();

    var updates = {
      '現場フォルダURL': folderUrl,
      '最終更新日時': new Date(),
      '最終更新者': Session.getActiveUser().getEmail() || 'Manual'
    };
    
    SheetService.updateDashboard(siteName, updates, zoneName);
    
    // 5. 稼働現場リスト（マスタ）への登録
    if (MasterSync && MasterSync.registerSiteIfNew) {
      MasterSync.registerSiteIfNew(siteName);
    }
    
    // 6. 再描画
    DashboardUIService.refreshDashboardData();
    
    SpreadsheetApp.getActive().toast('完了しました', '新規現場作成', 5);
    ui.alert('完了', '現場「' + siteName + '」を追加しました。\n\nDriveフォルダ:\n' + folderUrl, ui.ButtonSet.OK);
    
  } catch (e) {
    ui.alert('エラーが発生しました: ' + e.toString());
  }
}

/**
 * 稼働現場リストを基にフォームの既存現場プルダウンを強制同期する。
 */
function syncExistingSiteDropdowns() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  
  if (!MasterSync || typeof MasterSync.getSiteMaster !== 'function' || typeof MasterSync.updateFormDropdowns !== 'function') {
    ui.alert('同期エラー', 'MasterSyncモジュールが利用できません。', ui.ButtonSet.OK);
    return;
  }
  
  var toastId = ss.toast('フォームの選択肢を更新中...', 'マスタ同期', -1);
  try {
    var siteNames = MasterSync.getSiteMaster();
    if (!siteNames.length) {
      throw new Error('稼働現場リストに有効な現場名がありません。');
    }
    MasterSync.updateFormDropdowns(siteNames);
    ss.toast('フォームの選択肢を同期しました。', 'マスタ同期', 5);
    ui.alert('完了', '「既存現場から入力」のプルダウンを最新のマスタで更新しました。', ui.ButtonSet.OK);
  } catch (e) {
    ss.toast('同期に失敗しました', 'マスタ同期', 5);
    ui.alert('同期に失敗しました: ' + e.toString(), ui.ButtonSet.OK);
  }
}

/**
 * 現場名を直接入力して予定日を修正するダイアログを表示する。
 */
function showEditScheduleDialog() {
  var ui = SpreadsheetApp.getUi();
  
  // 1. 現場名の入力
  var prompt = ui.prompt('予定日の手動修正', '修正したい現場名を入力してください：', ui.ButtonSet.OK_CANCEL);
  if (prompt.getSelectedButton() !== ui.Button.OK) return;
  
  var inputSiteName = prompt.getResponseText().trim();
  if (!inputSiteName) {
    ui.alert('エラー', '現場名を入力してください。', ui.ButtonSet.OK);
    return;
  }
  
  // 2. データベースから該当する現場を探す
  var dbData = SheetService.getDashboardData();
  var normInput = SiteNameUtils.normalizeSiteName(inputSiteName);
  var matches = dbData.rows.filter(function(r) {
    return SiteNameUtils.normalizeSiteName(r['現場名']) === normInput;
  });
  
  if (matches.length === 0) {
    ui.alert('エラー', '「' + inputSiteName + '」という現場は見つかりませんでした。', ui.ButtonSet.OK);
    return;
  }
  
  var targetRow = null;
  var siteName = inputSiteName;
  var zoneName = '';
  
  if (matches.length === 1) {
    // 1件のみなら確定
    targetRow = matches[0];
    zoneName = targetRow['工区名'] || '';
  } else {
    // 複数（工区）ある場合は選択させる
    var zoneList = matches.map(function(m) { return m['工区名'] || '（工区なし）'; }).join('\n');
    var zonePrompt = ui.prompt(
      '工区の選択',
      '「' + siteName + '」には複数の工区があります。修正したい工区名を入力してください：\n\n【見つかった工区】\n' + zoneList,
      ui.ButtonSet.OK_CANCEL
    );
    if (zonePrompt.getSelectedButton() !== ui.Button.OK) return;
    
    var inputZoneName = zonePrompt.getResponseText().trim();
    if (inputZoneName === '（工区なし）') inputZoneName = '';
    
    targetRow = matches.find(function(m) {
      return (m['工区名'] || '') === inputZoneName;
    });
    
    if (!targetRow) {
      ui.alert('エラー', '指定された工区が見つかりませんでした。', ui.ButtonSet.OK);
      return;
    }
    zoneName = inputZoneName;
  }
  
  // 3. ダイアログを表示
  var template = HtmlService.createTemplateFromFile('dialog_edit_schedule');
  template.data = {
    siteName: siteName,
    zoneName: zoneName,
    '組立開始予定日': targetRow['組立開始予定日'],
    '組立終了予定日': targetRow['組立終了予定日'],
    '解体開始予定日': targetRow['解体開始予定日'],
    '解体終了予定日': targetRow['解体終了予定日']
  };
  
  var html = template.evaluate()
    .setWidth(450)
    .setHeight(500)
    .setTitle('予定日の手動修正');
    
  ui.showModalDialog(html, '予定日の手動修正');
}

/**
 * ダイアログからの更新リクエストを処理する。
 */
function updateScheduleFromDialog(payload) {
  try {
    var siteName = payload.siteName;
    var zoneName = payload.zoneName;
    var updates = payload.updates;
    
    // 日付文字列をDateオブジェクトに変換
    Object.keys(updates).forEach(function(key) {
      if (updates[key]) {
        updates[key] = new Date(updates[key]);
      } else {
        updates[key] = ''; // 空更新
      }
    });
    
    // データベース更新
    SheetService.updateDashboard(siteName, updates, zoneName);
    
    // 親行のサマリー更新（子行の更新だった場合）
    if (zoneName) {
      SheetService.updateParentSummary(siteName);
    }
    
    // ダッシュボード再描画（部分更新）
    DashboardUIService.refreshSiteRow(siteName, zoneName);
    
    return true;
  } catch (e) {
    throw new Error('更新に失敗しました: ' + e.toString());
  }
}

// Wrapper functions for ProgressService

/**
 * 日次進捗入力ダイアログを表示（ProgressServiceへのラッパー）
 */
function showDailyProgressDialog() {
  ProgressService.showDailyProgressDialog();
}

/**
 * 現場リストを取得（HTMLダイアログから呼び出される）
 */
function getSiteList() {
  return ProgressService.getSiteList();
}

/**
 * 進捗を記録（HTMLダイアログから呼び出される）
 */
function logDailyProgress(payload) {
  return ProgressService.logDailyProgress(payload);
}
