/**
 * 承認WebApp 設定モジュール
 */
var CONFIG = {
  // 職人進捗管理スプレッドシートID
  SOURCE_SPREADSHEET_ID: 'SAMPLE_ID_019',

  // ログシートGID（報告種別 → シートGID）
  LOG_SHEETS: {
    '始業前報告': 1515074869,
    '午後報告': 792029407,
    '終業前報告': 1020468898,
    '中間報告': 181053983
  },

  // 報告種別の表示順
  REPORT_TYPES: ['始業前報告', '午後報告', '終業前報告', '中間報告'],

  // 承認設定シート名
  SETTINGS_SHEET_NAME: '承認設定',

  // 承認履歴シート名
  APPROVAL_HISTORY_SHEET_NAME: '承認履歴',

  // 差し戻し写真再送シート名
  RESUBMISSION_SHEET_NAME: '差し戻し写真再送',

  // 承認履歴ヘッダー
  APPROVAL_HISTORY_HEADERS: [
    '操作日時',
    '報告種別',
    '現場名',
    '報告者名',
    '送信日時',
    '操作者',
    '操作内容',
    'コメント'
  ],

  // 承認ステータス定数
  APPROVAL_STATUS: {
    UNCHECKED: '未確認',
    APPROVED: '確認済',
    REJECTED: '差し戻し'
  },

  // 承認関連の列名
  APPROVAL_COLUMNS: {
    STATUS: '承認ステータス',
    APPROVER: '承認者',
    APPROVED_AT: '承認日時',
    REJECT_COMMENT: '差し戻しコメント',
    REJECTED_IMAGES: '差し戻し画像'
  },

  // 既存のベースヘッダー（参考情報：ログシートの固定列）
  BASE_HEADERS: ['送信日時', '現場ID', '工事現場名', '棟名', '請負業者名', '施工業者名', '報告者ID', '報告者名', '報告種別'],
  TAIL_HEADERS: ['ImagesJSON', 'DriveFolderId', 'MetaJSON']
};
