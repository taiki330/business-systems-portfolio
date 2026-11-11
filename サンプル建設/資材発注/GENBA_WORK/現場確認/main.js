/**
 * エントリーポイント。GASトリガーから呼び出す。
 */
/**
 * 稼働現場リストの編集を検知する（インストール可能なトリガーとして設定が必要）
 */
function onMasterEdit(e) {
  MasterSync.handleEdit(e);
}

/**
 * 全フォーム共通の受付窓口。
 * 1. 回答をフェーズ別シートに整理
 * 2. フェーズごとの業務処理（フォルダ作成、ダッシュボード更新など）を実行
 */
function onFormSubmit(e) {
  // 1. 回答をフェーズ別シートに転記
  try {
    separateSheetByBusiness_Fixed(e);
  } catch (err) {
    console.error('シート転記エラー: ' + err.toString());
  }
  
  // 2. 業務処理を実行
  try {
    PhaseRouter.handleSubmit(e);
  } catch (err) {
    console.error('業務処理エラー: ' + err.toString());
  }

  // データの書き込みを確定させる（これが重要）
  SpreadsheetApp.flush();

  // 3. ダッシュボードUIの更新
  try {
    DashboardUIService.refreshDashboardData();
  } catch (err) {
    console.error('ダッシュボードUI更新エラー: ' + err.toString());
  }
}

/**
 * 日次ジョブ（未報告チェックなど）をまとめて実行。
 */
function runDailyJobs() {
  if (DailyJobs && typeof DailyJobs.run === 'function') {
    DailyJobs.run();
  }
}

/**
 * ダッシュボードのヘッダーを初期化（手動実行用）。
 */
function setupDashboardHeaders() {
  SheetService.bootstrapDashboard();
  SheetService.setupDashboardFormatting();
}

/**
 * 高度なダッシュボードUIを構築（手動実行用）
 */
function setupAdvancedDashboard() {
  DashboardUIService.setupAdvancedDashboard();
}

/**
 * 初期化: 7つのフェーズ専用シートを一括作成
 * 手動で実行してください（1回だけ実行すればOK）
 */
function setupPhaseSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // PHASE_QUESTIONSからフェーズ名とヘッダーを取得
  // ※PHASE_QUESTIONSは「フォームの回答整理.gs」で定義されています
  var phaseNames = [
    '現場調査',
    '仮設計画打合わせ',
    '送り出し教育',
    '解体前教育',
    '足場工区点検',
    '稼働現場巡回',
    '安全衛生協議会'
  ];
  
  phaseNames.forEach(function(phaseName) {
    var existingSheet = ss.getSheetByName(phaseName);
    if (existingSheet) {
      Logger.log('シート "' + phaseName + '" は既に存在します');
      return;
    }
    
    // PHASE_QUESTIONSから該当するヘッダーを取得
    var headers = PHASE_QUESTIONS[phaseName];
    if (!headers) {
      Logger.log('警告: ' + phaseName + ' のヘッダー定義が見つかりません');
      return;
    }
    
    // シートを作成
    var newSheet = ss.insertSheet(phaseName);
    
    // ヘッダー行を設定
    newSheet.appendRow(headers);
    
    // ヘッダー行のスタイル設定
    var headerRange = newSheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('#ffffff');
    
    // ヘッダー行を固定
    newSheet.setFrozenRows(1);
    
    Logger.log('シート "' + phaseName + '" を作成しました（列数: ' + headers.length + '）');
  });
  
  Logger.log('フェーズシートの初期化が完了しました');
}
