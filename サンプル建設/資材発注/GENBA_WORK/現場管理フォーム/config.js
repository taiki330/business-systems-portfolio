/**
 * 環境依存のIDやURLを一括管理する設定モジュール。
 * 全フェーズ情報・フォルダID・マッピング定数はここに集約する。
 */
var CONFIG = {
  SPREADSHEET_ID: 'SAMPLE_ID_011',
  DASHBOARD_DATA_SHEET_NAME: 'データベース',
  DASHBOARD_UI_SHEET_NAME: 'ダッシュボード',
  PROGRESS_REPORT_SHEET_NAME: '進捗報告',
  MASTER_SHEET_NAME: '稼働現場リスト',
  MASTER_RANGE: 'A2:C',
  MASTER_COL_SITE_NAME: 0,
  MASTER_COL_SITE_ID: 1,
  MASTER_COL_DRIVE_FOLDER_ID: 2,
  EXISTING_SITE_FIELD: '既存現場から入力',
  NEW_SITE_FIELD: '新規現場を入力',
  FORM_ID: 'SAMPLE_ID_031',
  PHASE_INDICATOR_KEY: '実施する業務を選択してください',

  // フェーズ定義（全情報を一元管理）
  FORMS: [
    {
      id: 'SAMPLE_ID_031',
      name: '現場調査',
      phase: 1,
      subFolder: '01_現調',
      reportHeader: '現場調査最終報告日',
      icon: '①',
      siteQuestionTitle: '現場名',
      responseSheetName: 'フォームの回答 1',
      phaseIndicatorKey: '実施する業務を選択してください',
      phaseIndicatorValue: '現場調査'
    },
    {
      id: 'SAMPLE_ID_031',
      name: '仮設計画打合わせ',
      phase: 2,
      subFolder: '02_仮設計画',
      reportHeader: '仮設計画打合わせ最終報告日',
      icon: '②',
      siteQuestionTitle: '② 現場名',
      responseSheetName: 'フォームの回答 1',
      phaseIndicatorKey: '実施する業務を選択してください',
      phaseIndicatorValue: '仮設計画打合わせ'
    },
    {
      id: 'SAMPLE_ID_031',
      name: '現場着工前に必ずやるべき事',
      phase: 3,
      subFolder: '03_着工前',
      reportHeader: '現場着工前最終報告日',
      icon: '③',
      siteQuestionTitle: '現場名',
      responseSheetName: 'フォームの回答 1',
      phaseIndicatorKey: '実施する業務を選択してください',
      phaseIndicatorValue: '現場着工前に必ずやるべき事'
    },
    {
      id: 'SAMPLE_ID_031',
      name: '送り出し教育',
      phase: 4,
      subFolder: '03_送り出し教育',
      reportHeader: '送り出し教育最終報告日',
      icon: '④',
      siteQuestionTitle: '現場名',
      responseSheetName: 'フォームの回答 1',
      phaseIndicatorKey: '実施する業務を選択してください',
      phaseIndicatorValue: '送り出し教育'
    },
    {
      id: 'SAMPLE_ID_031',
      name: '解体前教育',
      phase: 5,
      subFolder: '04_解体前教育',
      reportHeader: '解体前教育最終報告日',
      icon: '⑤',
      siteQuestionTitle: '現場名',
      responseSheetName: 'フォームの回答 1',
      phaseIndicatorKey: '実施する業務を選択してください',
      phaseIndicatorValue: '解体前教育'
    },
    {
      id: 'SAMPLE_ID_031',
      name: '足場工区点検',
      phase: 6,
      subFolder: '05_点検',
      reportHeader: '足場工区点検最終報告日',
      icon: '⑥',
      siteQuestionTitle: '現場名',
      responseSheetName: 'フォームの回答 1',
      phaseIndicatorKey: '実施する業務を選択してください',
      phaseIndicatorValue: '足場工区点検'
    },
    {
      id: 'SAMPLE_ID_031',
      name: '稼働現場巡回',
      phase: 7,
      subFolder: '06_巡回',
      reportHeader: '現場巡回最終報告日',
      icon: '⑦',
      siteQuestionTitle: '現場名',
      responseSheetName: 'フォームの回答 1',
      phaseIndicatorKey: '実施する業務を選択してください',
      phaseIndicatorValue: '稼働現場巡回'
    },
    {
      id: 'SAMPLE_ID_031',
      name: '安全衛生協議会',
      phase: 8,
      subFolder: '07_衛生協議会',
      reportHeader: '安全衛生協議会最終報告日',
      icon: '⑧',
      siteQuestionTitle: '現場名',
      responseSheetName: 'フォームの回答 1',
      phaseIndicatorKey: '実施する業務を選択してください',
      phaseIndicatorValue: '安全衛生協議会'
    },
    {
      id: 'SAMPLE_ID_031',
      name: '現場完工報告書',
      phase: 9,
      subFolder: '09_完工報告',
      reportHeader: '現場完工報告最終報告日',
      icon: '⑨',
      siteQuestionTitle: '④ 現場名',
      responseSheetName: 'フォームの回答 1',
      phaseIndicatorKey: '実施する業務を選択してください',
      phaseIndicatorValue: '現場完工報告書'
    }
  ],

  // Webアプリ業務選択画面の準備中タイル（FORMSには含めない）
  PLACEHOLDER_BUSINESS_TILES: [],

  // Drive設定
  DRIVE_ROOT_ID: 'SAMPLE_ID_018',
  TEMP_FOLDER_NAME: '仮置き',
  TEMP_PHASE_FOLDER_NAMES: {
    1: '01_現調（仮置き）',
    2: '02_仮設計画（仮置き）'
  },

  // 新規現場用の仮フォルダID（旧 organizeFilesOnSubmit_v2.js から移動）
  TEMP_FOLDER_IDS: {
    '現場調査': 'SAMPLE_ID_033',
    '仮設計画打合わせ': 'SAMPLE_ID_034'
  },

  // 現場フォルダ配下の標準サブフォルダ
  SITE_SUB_FOLDERS: [
    '00_工程表',
    '01_現調',
    '02_仮設計画',
    '03_着工前',
    '03_送り出し教育',
    '04_解体前教育',
    '05_点検',
    '06_巡回',
    '07_衛生協議会',
    '09_完工報告'
  ],

  // 棟名フォルダ省略対象の値
  SKIP_BUILDING_VALUES: ['', '（現場名に含む）', '該当なし'],

  // 会社名オートコンプリート用の外部スプレッドシート設定
  COMPANY_SOURCE: {
    SPREADSHEET_ID: 'SAMPLE_ID_035',
    SHEET_NAMES: ['2026年合計【枠・楔】', '2025年'],
    CONTRACTOR_COLUMN: 3,       // C列（発注）→ 元請け・一次の候補
    SUBCONTRACTOR_COLUMN: 14    // N列（施工班）→ 二次の候補
  },

  // オートコンプリート対象フィールドのタイトル定義
  AUTOCOMPLETE_FIELDS: {
    CONTRACTOR_TITLES: ['元請け'],
    PRIMARY_TITLES: ['一次'],
    SECONDARY_TITLES: ['二次', 'ニ次']  // カタカナ「ニ」にも対応
  },

  // データベースシートのヘッダー（列順序）
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
    '足場工区点検開始時間',
    '足場工区点検終了時間',
    '足場工区点検滞在時間',
    '足場工区点検超過時間',
    '足場工区点検超過理由',
    '現場着工前最終報告日',
    '現場完工報告最終報告日'
  ],

  /**
   * 現場着工前チェックリスト定義（表示・必須判定の唯一のソース）。
   * legacyHiddenValues / legacyValueAliases は既存シートデータ互換用（画面非表示・表示名正規化）。
   */
  PRE_START_CHECKLIST: {
    fieldTitle: '④ 着工前チェックリスト',
    helpText: '実施した項目を選択してください。＊印は必須、（任意）は未選択でも送信できます。',
    items: [
      { value: '現場表へ情報入力', required: true },
      { value: 'ダッシュボードへ反映', required: true },
      { value: '送り出し教育資料作成', required: true },
      { value: '資材の総数拾い出し', required: true },
      { value: '安全資料', required: true },
      { value: 'リース材・特殊材見積確認', required: false }
    ],
    legacyHiddenValues: ['請求資料の作成'],
    legacyValueAliases: {
      '現場表に情報入力': '現場表へ情報入力',
      '安全書類の有無確認': '安全資料',
      'リース材・特殊材の見積もり確認': 'リース材・特殊材見積確認'
    }
  }
};

// ========================================
// ヘルパー関数
// ========================================

/**
 * 設定オブジェクトを取得。
 */
function getConfig() {
  return CONFIG;
}

/**
 * フェーズ名からFORMS配列の要素を検索する。
 * @param {string} phaseName フェーズ名（例: '現場調査'）
 * @return {Object|null} FORMS配列の要素 or null
 */
function getPhaseConfig(phaseName) {
  var forms = CONFIG.FORMS;
  for (var i = 0; i < forms.length; i++) {
    if (forms[i].name === phaseName || forms[i].phaseIndicatorValue === phaseName) {
      return forms[i];
    }
  }
  return null;
}

/**
 * Webアプリ業務選択画面用のカテゴリ一覧（稼働中7件 + 準備中タイル）。
 * @return {Array<{name: string, available: boolean}>}
 */
function getWebAppBusinessCategories() {
  var categories = CONFIG.FORMS.map(function(f) {
    return { name: f.name, available: true };
  });
  CONFIG.PLACEHOLDER_BUSINESS_TILES.forEach(function(tile) {
    categories.push({ name: tile.name, available: false });
  });
  return categories;
}

/**
 * 全フェーズの最終報告日ヘッダー配列を取得する。
 * @return {Array<string>}
 */
function getAllReportHeaders() {
  return CONFIG.FORMS.map(function(f) { return f.reportHeader; });
}

/**
 * 全フェーズのデフォルトアイコン配列を取得する。
 * @return {Array<string>}
 */
function getAllDefaultIcons() {
  return CONFIG.FORMS.map(function(f) { return f.icon; });
}

/**
 * フェーズ名→サブフォルダ名のマッピングを動的に生成する。
 * @return {Object} { '現場調査': '01_現調', ... }
 */
function getPhaseToSubFolderMap() {
  var map = {};
  CONFIG.FORMS.forEach(function(f) {
    map[f.name] = f.subFolder;
  });
  return map;
}

/**
 * 着工前チェックリストの Web クライアント向け設定（必須・任意の判定用）。
 * @return {Object|null}
 */
function getPreStartChecklistBootstrap() {
  var cfg = CONFIG.PRE_START_CHECKLIST;
  if (!cfg || !cfg.items) return null;
  var requiredValues = [];
  var optionalValues = [];
  cfg.items.forEach(function(it) {
    if (it.required) requiredValues.push(it.value);
    else optionalValues.push(it.value);
  });
  return {
    fieldTitle: cfg.fieldTitle,
    requiredValues: requiredValues,
    optionalValues: optionalValues
  };
}

/**
 * WEBAPP_FORM_STRUCTURE の着工前チェックリスト項目を CONFIG 定義で上書きする。
 * @param {Array<Object>} structure
 * @return {Array<Object>}
 */
function applyPreStartChecklistToFormStructure(structure) {
  var cfg = CONFIG.PRE_START_CHECKLIST;
  if (!cfg || !structure) return structure;
  return structure.map(function(item) {
    if (item.title !== cfg.fieldTitle || item.type !== 'CHECKBOX') return item;
    var patched = {};
    Object.keys(item).forEach(function(key) { patched[key] = item[key]; });
    patched.isRequired = false;
    if (cfg.helpText) patched.helpText = cfg.helpText;
    patched.options = (cfg.items || []).map(function(it) {
      return { value: it.value, required: !!it.required };
    });
    return patched;
  });
}
