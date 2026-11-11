/**
 * 環境依存のIDやURLを一括管理する設定モジュール。
 * TODO: 実運用の値に置き換える。
 */
var CONFIG = {
  SPREADSHEET_ID: 'SAMPLE_ID_027', // 現場管理・報告フォーム回答
  DASHBOARD_DATA_SHEET_NAME: 'データベース', // データ蓄積用（旧ダッシュボード）
  DASHBOARD_UI_SHEET_NAME: 'ダッシュボード', // 表示用（新規）
  PROGRESS_REPORT_SHEET_NAME: '進捗報告', // 日次進捗記録用
  MASTER_SHEET_NAME: '稼働現場リスト',
  MASTER_RANGE: 'A2:C',
  MASTER_COL_SITE_NAME: 0,
  MASTER_COL_SITE_ID: 1,
  MASTER_COL_DRIVE_FOLDER_ID: 2,
  DASHBOARD_HEADERS: [
    '現場名',
    '工区名',
    '最終更新日時',
    '最終更新者',
    '現場フォルダURL',
    '現場調査最終報告日',
    '現場調査担当者',
    '現場調査メモ',
    '着工予定日',
    '送出教育予定日',
    '仮設計画打合わせ最終報告日',
    '送り出し教育最終報告日',
    '送り出し教育備考',
    '組立開始予定日',
    '組立終了予定日',
    '解体開始予定日',
    '解体終了予定日',
    '解体前教育予定日',
    '解体前教育最終報告日',
    '解体前教育メモ',
    '足場工区点検最終報告日',
    '足場工区点検結果',
    '足場工区点検メモ',
    '現場巡回最終報告日',
    '現場巡回結果',
    '現場巡回メモ',
    '安全衛生協議会最終報告日',
    '安全衛生協議会テーマ',
    '安全衛生協議会メモ',
    '組立開始実績日',
    '組立終了実績日',
    '解体開始実績日',
    '解体終了実績日',
    '全報告日ログ',
    '承認ステータス',
    '承認者',
    '最終承認日時',
    '差し戻しコメント'
  ],
  // フェーズごとの色定義（実績マーカー用）
  PHASE_COLORS: {
    1: '#0277BD', // 現場調査 (濃い水色)
    2: '#1565C0', // 仮設計画 (濃い青)
    3: '#F9A825', // 送り出し教育 (濃い黄)
    4: '#EF6C00', // 解体前教育 (濃い橙)
    5: '#558B2F', // 足場工区点検 (濃い黄緑)
    6: '#2E7D32', // 稼働現場巡回 (濃い緑)
    7: '#7B1FA2'  // 安全衛生協議会 (濃い紫)
  },
  // 実績バーの色
  ACTUAL_BAR_COLORS: {
    assembly: '#1976D2', // 組立実績 (濃青)
    dismantle: '#388E3C' // 解体実績 (濃緑)
  },
  // 進捗グラデーション色（10% = 最薄, 100% = 最濃）
  PROGRESS_GRADIENTS: {
    assembly: [
      '#E3F2FD', // 10%
      '#BBDEFB', // 20%
      '#90CAF9', // 30%
      '#64B5F6', // 40%
      '#42A5F5', // 50%
      '#2196F3', // 60%
      '#1E88E5', // 70%
      '#1976D2', // 80%
      '#1565C0', // 90%
      '#0D47A1'  // 100%
    ],
    dismantle: [
      '#FFEBEE', // 10%
      '#FFCDD2', // 20%
      '#EF9A9A', // 30%
      '#E57373', // 40%
      '#EF5350', // 50%
      '#F44336', // 60%
      '#E53935', // 70%
      '#D32F2F', // 80%
      '#C62828', // 90%
      '#B71C1C'  // 100%
    ]
  },
  // ハイブリッド方式の現場名フィールド（実際のフォームに合わせて修正）
  EXISTING_SITE_FIELD: '既存現場から入力',
  NEW_SITE_FIELD: '新規現場を入力',
  
  // フォーム設定（1つのフォームで7つのセクションに分岐）
  FORM_ID: 'SAMPLE_ID_031', // 実際のフォームID
  PHASE_INDICATOR_KEY: '実施する業務を選択してください',
  
  FORMS: [
    { id: 'SAMPLE_ID_031', name: '現場調査', phase: 1, siteQuestionTitle: '現場名', responseSheetName: 'フォームの回答 1', phaseIndicatorKey: '実施する業務を選択してください', phaseIndicatorValue: '現場調査' },
    { id: 'SAMPLE_ID_031', name: '仮設計画打合わせ', phase: 2, siteQuestionTitle: '② 現場名', responseSheetName: 'フォームの回答 1', phaseIndicatorKey: '実施する業務を選択してください', phaseIndicatorValue: '仮設計画打合わせ' },
    { id: 'SAMPLE_ID_031', name: '送り出し教育', phase: 3, siteQuestionTitle: '現場名', responseSheetName: 'フォームの回答 1', phaseIndicatorKey: '実施する業務を選択してください', phaseIndicatorValue: '送り出し教育' },
    { id: 'SAMPLE_ID_031', name: '解体前教育', phase: 4, siteQuestionTitle: '現場名', responseSheetName: 'フォームの回答 1', phaseIndicatorKey: '実施する業務を選択してください', phaseIndicatorValue: '解体前教育' },
    { id: 'SAMPLE_ID_031', name: '足場工区点検', phase: 5, siteQuestionTitle: '現場名', responseSheetName: 'フォームの回答 1', phaseIndicatorKey: '実施する業務を選択してください', phaseIndicatorValue: '足場工区点検' },
    { id: 'SAMPLE_ID_031', name: '稼働現場巡回', phase: 6, siteQuestionTitle: '現場名', responseSheetName: 'フォームの回答 1', phaseIndicatorKey: '実施する業務を選択してください', phaseIndicatorValue: '稼働現場巡回' },
    { id: 'SAMPLE_ID_031', name: '安全衛生協議会', phase: 7, siteQuestionTitle: '現場名', responseSheetName: 'フォームの回答 1', phaseIndicatorKey: '実施する業務を選択してください', phaseIndicatorValue: '安全衛生協議会' }
  ],
  // 承認ステータス定数
  APPROVAL_STATUS: {
    NOT_SUBMITTED: '未提出',
    SUBMITTED: '提出済',
    REJECTED: '差し戻し',
    RESUBMITTED: '再提出',
    APPROVED: '承認済'
  },

  // 承認履歴シート名
  APPROVAL_HISTORY_SHEET_NAME: '承認履歴',

  // 承認履歴シートのヘッダー
  APPROVAL_HISTORY_HEADERS: [
    '操作日時',
    '現場名',
    '操作者',
    '操作内容',
    'コメント'
  ],

  LINE_WEBHOOK_URL: '', // TODO: LINE Messaging APIのWebhook URLを後で設定
  DRIVE_ROOT_ID: 'SAMPLE_ID_018', // 実際のDriveフォルダID
  /**
   * Driveガード失敗時の挙動。
   * - 'quarantine': 隔離フォルダへ保存し報告は継続（緊急運用）
   * - 'block': エラー停止（本番方針）
   */
  DRIVE_GUARD_FAILURE_MODE: 'quarantine',
  /** Driveルート直下に作成してよい隔離用コンテナ（現場名フォルダは作らない） */
  QUARANTINE_ROOT_FOLDER_NAME: '99_要確認_保存先不整合',
  QUARANTINE_PHOTOS_SUBFOLDER_NAME: '写真',
  /**
   * Web送信で「新規現場を入力」したときの写真の親フォルダ（本番用の箱の中に手で作ったフォルダのID）。
   * Drive でフォルダを開き、URL の /folders/ の後ろのIDを貼る。未設定のフェーズは従来どおり
   * DRIVE_ROOT_ID + 仮置き 側の自動生成パスにフォールバックする。
   * 構造: このフォルダ直下に <現場名> フォルダ → saveBase64Files が日時フォルダをその下に作成。
   */
  WEB_UPLOAD_STAGING_BUCKET_IDS: {
    1: '', // 例: 現場調査仮
    2: '' // 例: 仮設計画打合わせ
  },
  TEMP_FOLDER_NAME: '仮置き', // 正規フォルダ未作成時の退避用フォルダ
  TEMP_PHASE_FOLDER_NAMES: {
    1: '01_現調（仮置き）',
    2: '02_仮設計画（仮置き）'
  },
  
  // フォルダ設定
  SCHEDULE_FOLDER_NAME: '00_工程表',
  SITE_SUB_FOLDERS: [
    '00_工程表',
    '01_現調',
    '02_仮設計画',
    '03_送り出し教育',
    '04_解体前教育',
    '05_点検',
    '06_巡回',
    '07_衛生協議会'
  ]
};

/**
 * 設定オブジェクトを取得。
 */
function getConfig() {
  return CONFIG;
}
