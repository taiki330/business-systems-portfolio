/**
 * Global configuration shared across server files.
 */
const APP_CONFIG = Object.freeze({
  spreadsheetId: 'SAMPLE_ID_019', // テスト用コピー（元: SAMPLE_ID_010）
  sheetNames: Object.freeze({
    forms: 398345384,
    settings: 1849331237,
    sites: '現場一覧',
    contractors: '業者マスタ',
    logs: 'DB_Report_Log',
    resend: '差し戻し写真再送'
  }),
  /** 通常報告の appendRow が尽きても失敗したときの退避先（手動追補・調査用） */
  reportWriteQueueSheetName: 'Report_SheetWriteQueue',
  /**
   * 外部の進捗確認用スプレッドシート（DashboardService）。
   * enabled が true のときだけ SpreadsheetApp.openById する。false / 省略は連携しない。
   * spreadsheetId だけ残っていても enabled が true でなければ開かない。
   */
  dashboard: Object.freeze({
    enabled: false,
    spreadsheetId: '',
    sheetGid: null
  }),
  // 隔離フォルダの親。本番は共有Driveルート SAMPLE_ID_018 を指すこと。
  rootDriveFolderId: 'SAMPLE_ID_037', // テスト用（元: SAMPLE_ID_018）
  /** 'quarantine' = 不整合時は隔離保存して送信継続 / 'block' = throw で停止 */
  DRIVE_GUARD_FAILURE_MODE: 'quarantine',
  QUARANTINE_ROOT_FOLDER_NAME: '99_要確認_保存先不整合',
  QUARANTINE_PHOTOS_SUBFOLDER_NAME: '写真',
  QUARANTINE_FOLDER_PREFIX: 'shokunin',
  QUARANTINE_MAX_SITE_NAME_LEN: 48,
  mockMode: false, // Set to false when connecting to Spreadsheet/Drive
  settingsKeys: Object.freeze({
    passcode: 'settings_passcode',
    formVersion: 'form_version',
    formUpdatedAt: 'form_updated_at'
  }),
  admin: Object.freeze({
    configPropertyKey: 'FORM_CONFIG_JSON',
    largeConfigSettingKey: 'FORM_CONFIG_LARGE',
    storageMarker: '__LARGE_CONFIG_IN_SHEET__',
    maxPropertySize: 100000 // Total combined limit (GAS cell limit is ~50k, but we can store more if needed across rows, though 100k is safe for now)
  }),
  defaultFormTypes: ['始業前報告', '午後報告', '終業前報告', '中間報告'],
  resendBaseHeaders: ['タイムスタンプ', '現場名', '棟名', '請負業者名', '施工業者名', '再送区分', '報告者名'],
  resendMaxPhotoCols: 15,
  cache: Object.freeze({
    bootstrapKey: 'bootstrap_payload',
    ttlSeconds: 60
  }),
  logHeaders: [
    'Timestamp',
    'SiteId',
    'SiteName',
    'ReporterId',
    'ReporterName',
    'ReportType',
    'ImagesJSON',
    'DriveFolderId',
    'MetaJSON'
  ],
  getLogSheetName: reportType => {
    const rt = String(reportType || '').trim();
    const typeMap = {
      '始業前報告': 1515074869,
      '午後報告': 792029407,
      '終業前報告': 1020468898,
      '中間報告': 181053983
    };
    return typeMap[rt] || `Log_${rt}`;
  },
  /**
   * ログシートを数値GIDで開けないとき（ブックコピー後など）のフォールバック先タブ名。
   * 例: Object.freeze({ '始業前報告': '始業前報告' })
   */
  logSheetFallbackByType: Object.freeze({})
});
