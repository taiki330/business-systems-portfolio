/**
 * ダッシュボードWebApp 設定モジュール
 *
 * データの流れ（通常運用）:
 *   1. 現場管理フォーム等のGAS → スプレッドシートの「データベース」シートに案件行を書く
 *   2. 本Webアプリ → 同じシート名（CASE_DATA_SHEET_NAME）を読み、画面に表示
 * 現場管理フォームの DASHBOARD_DATA_SHEET_NAME と必ず同じシート名にしてください。
 */
var CONFIG = {
  // --- Google Drive ---
  DRIVE_ROOT_FOLDER_ID: 'SAMPLE_ID_018',
  SCHEDULE_SUBFOLDER_NAME: '00_工程表',

  // --- スプレッドシート ---
  SOURCE_SPREADSHEET_ID: 'SAMPLE_ID_011',

  // --- 進捗データ取得元（職人進捗アプリ／先方納品・実運用中の本番） ---
  PROGRESS_SOURCE_SPREADSHEET_ID: 'SAMPLE_ID_019',
  PROGRESS_SOURCE_SHEET_NAME: 'Log_終業前報告',

  // --- シート名 ---
  /** 案件行（現場名・報告日など）。現場管理フォームの「データベース」シートと同一。1行目は DASHBOARD_HEADERS */
  CASE_DATA_SHEET_NAME: 'データベース',

  MASTER_SHEET_NAME: '稼働現場リスト',
  PROGRESS_SHEET_NAME: '進捗報告',
  /**
   * 表示現場のホワイトリスト用シート名（A列2行目以降に現場名）。
   * USE_GANTT_SHEET_SITE_FILTER が false のときは読みに行かない → このタブは不要でよい。
   * true にしたときだけ必要（旧スプレッドシート上のダッシュボードUI用）。
   */
  SITE_WHITELIST_SHEET_NAME: 'ダッシュボード',
  // --- 動作モード ---
  // true: ダッシュボードは閲覧専用（更新APIを拒否、編集UIは非表示）
  READ_ONLY_MODE: true,

  /**
   * true: SITE_WHITELIST_SHEET_NAME のA列だけ表示（絞り込み）。
   * false: データベースシートの全現場を表示。この場合スプシの「ダッシュボード」タブは未使用。
   */
  USE_GANTT_SHEET_SITE_FILTER: false,

  // --- タイムライン ---
  TIMELINE_START_YEAR: 2026,
  TIMELINE_START_MONTH: 0,   // 0 = 1月
  TIMELINE_START_DAY: 1,
  TIMELINE_DAYS: 730,        // 2年分

  // --- ダッシュボードヘッダー（38列） ---
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

  // --- フェーズ定義（表示スロット 1〜9） ---
  PHASES: {
    1: '現場調査',
    2: '仮設計画打合わせ',
    3: '現場着工前に必ずやるべき事',
    4: '送り出し教育',
    5: '解体前教育',
    6: '足場工区点検',
    7: '稼働現場巡回',
    8: '安全衛生協議会',
    9: '現場完工報告書'
  },

  // --- フェーズごとの色定義（実績マーカー用） ---
  PHASE_COLORS: {
    1: '#0277BD', // 現場調査 (濃い水色)
    2: '#1565C0', // 仮設計画 (濃い青)
    3: '#00897B', // 現場着工前 (Teal)
    4: '#F9A825', // 送り出し教育 (濃い黄)
    5: '#EF6C00', // 解体前教育 (濃い橙)
    6: '#558B2F', // 足場工区点検 (濃い黄緑)
    7: '#2E7D32', // 稼働現場巡回 (濃い緑)
    8: '#7B1FA2', // 安全衛生協議会 (濃い紫)
    9: '#455A64'  // 現場完工報告書 (Blue Grey)
  },

  // --- ガントバー色 ---
  BAR_COLORS: {
    assemblyPlan:   '#a4c2f4', // 組立予定（親行: 薄青）
    dismantlePlan:  '#93c47d', // 解体予定（親行: 薄緑）
    assemblyChild:  '#4285f4', // 組立予定（子行: 濃青）
    dismantleChild: '#34a853', // 解体予定（子行: 濃緑）
    sendOutMilestone:      '#f9a825', // 送出教育マイルストーン
    preEducationMilestone: '#f57c00'  // 解体前教育マイルストーン
  },

  // --- 実績バーの色 ---
  ACTUAL_BAR_COLORS: {
    assembly:  '#1976D2', // 組立実績 (濃青)
    dismantle: '#388E3C'  // 解体実績 (濃緑)
  },

  // --- 進捗グラデーション色（実色パレット / 10% 刻み） ---
  // 0% = 描画しない, 10%～100% = 薄ピンク→深赤（Material Design Red）
  PROGRESS_GRADIENTS: [
    '#FFEBEE',  // 10% - ごく薄いピンク
    '#FFCDD2',  // 20% - 薄いピンク
    '#EF9A9A',  // 30% - ピンク
    '#E57373',  // 40% - サーモン
    '#EF5350',  // 50% - 明るい赤
    '#F44336',  // 60% - 赤
    '#E53935',  // 70% - やや濃い赤
    '#D32F2F',  // 80% - 濃い赤
    '#C62828',  // 90% - さらに濃い赤
    '#B71C1C'   // 100% - 最も濃い赤
  ],

  // --- フェーズ別報告日ヘッダー（チェック判定・マーカー描画用） ---
  PHASE_DATE_HEADERS: {
    1: '現場調査最終報告日',
    2: '仮設計画打合わせ最終報告日',
    3: '現場着工前最終報告日',
    4: '送り出し教育最終報告日',
    5: '解体前教育最終報告日',
    6: '足場工区点検最終報告日',
    7: '現場巡回最終報告日',
    8: '安全衛生協議会最終報告日',
    9: '現場完工報告最終報告日'
  },

  /** 予定日列（MVP: 送り出し④・解体前⑤）。実施日は PHASE_DATE_HEADERS を使用 */
  PHASE_PLANNED_DATE_HEADERS: {
    4: '送出教育予定日',
    5: '解体前教育予定日'
  },

  // --- フェーズアイコン（表示スロット ①〜⑨） ---
  PHASE_ICONS: {
    1: '\u2460', // ①
    2: '\u2461', // ②
    3: '\u2462', // ③
    4: '\u2463', // ④
    5: '\u2464', // ⑤
    6: '\u2465', // ⑥
    7: '\u2466', // ⑦
    8: '\u2467', // ⑧
    9: '\u2468'  // ⑨
  },

  // --- フェーズごとのシート名（フォーム回答データ取得用） ---
  PHASE_SHEET_NAMES: {
    1: '現場調査',
    2: '仮設計画打合わせ',
    3: '現場着工前に必ずやるべき事',
    4: '送り出し教育',
    5: '解体前教育',
    6: '足場工区点検',
    7: '稼働現場巡回',
    8: '安全衛生協議会',
    9: '現場完工報告書'
  },

  // --- 写真・アップロード系カラムの除外キーワード ---
  PHASE_SKIP_KEYWORDS: ['写真', 'アップロード', '記録'],

  // --- フェーズごとの追加フィールド定義（ツールチップ表示用） ---
  PHASE_EXTRA_FIELDS: {
    1: [
      { header: '現場調査担当者', label: '担当者' },
      { header: '現場調査メモ', label: 'メモ' }
    ],
    2: [],
    3: [
      { header: '現場着工前実施日', label: '実施日', isDate: true },
      { header: '現場着工前担当者', label: '担当者' },
      { header: '現場着工前完了', label: '完了チェック' },
      { header: '現場着工前チェックリスト', label: 'チェックリスト' },
      { header: '現場着工前メモ', label: 'メモ' }
    ],
    4: [
      { header: '送出教育予定日', label: '予定日', isDate: true },
      { header: '送り出し教育備考', label: '備考' }
    ],
    5: [
      { header: '解体前教育予定日', label: '予定日', isDate: true },
      { header: '解体前教育メモ', label: 'メモ' }
    ],
    6: [
      { header: '足場工区点検結果', label: '結果' },
      { header: '足場工区点検メモ', label: 'メモ' }
    ],
    7: [
      { header: '現場巡回結果', label: '結果' },
      { header: '現場巡回メモ', label: 'メモ' }
    ],
    8: [
      { header: '安全衛生協議会テーマ', label: 'テーマ' },
      { header: '安全衛生協議会メモ', label: 'メモ' }
    ],
    9: [
      { header: '現場完工報告日', label: '報告日', isDate: true },
      { header: '現場完工報告者', label: '報告者' },
      { header: '現場完工報告元請', label: '元請' },
      { header: '現場完工報告施工班', label: '施工班' },
      { header: '現場完工報告平米数', label: '平米数' },
      { header: '現場完工報告合計金額', label: '合計金額' },
      { header: '現場完工報告メモ', label: 'メモ' }
    ]
  },

  /** 表示スロット数（PHASES / PHASE_ICONS と一致させる） */
  PHASE_SLOT_COUNT: 9,

  /** アラート判定用: 送り出し教育・解体前教育の表示スロット番号 */
  ALERT_PHASE_SEND_OUT: 4,
  ALERT_PHASE_PRE_EDUCATION: 5,

  // --- アラート（index.html の ALERT_WARN_DAYS と一致させる）---
  /** 予定日のこの日数前から warning（画面上の黄色帯と同じ考え方） */
  ALERT_WARN_DAYS: 3,

  // --- 外部Webアプリ ---
  /**
   * 是正報告WebアプリのデプロイURL（/exec まで。クエリは付けない）。
   * 再デプロイした場合はここを更新してください。
   */
  CORRECTION_WEBAPP_URL:
    'https://script.google.com/macros/s/AKfycb_SAMPLE_DEPLOYMENT_ID/exec',

  // --- キャッシュ ---
  CACHE_TTL_SECONDS: 120
};

/**
 * 是正集計画面URL（?screen=stats 付き）を返す。
 * CORRECTION_WEBAPP_URL 未設定時は空文字。
 * @return {string}
 */
function getCorrectionWebAppStatsUrl() {
  var base = (CONFIG.CORRECTION_WEBAPP_URL || '').trim();
  if (!base) return '';
  if (/[?&]screen=stats(?:&|$)/.test(base)) return base;
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'screen=stats';
}
