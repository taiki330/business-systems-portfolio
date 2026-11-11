/**
 * 是正報告システム - グローバル設定
 */
const APP_CONFIG = Object.freeze({
  // 公式LINE・案件共有で使う固定の公開WebアプリURL。
  // 新規デプロイを別IDで作成した場合は、新しい /exec URLへ更新する。
  publicWebAppUrl: 'https://script.google.com/macros/s/AKfycb_SAMPLE_DEPLOYMENT_ID/exec',

  // 是正報告書専用スプレッドシートID
  spreadsheetId: 'SAMPLE_ID_020',

  sheetNames: Object.freeze({
    cases: '案件',
    details: '指摘明細',
    issueLogs: '指摘ログ'
  }),

  /** 種別（Phase2: 即報告 / 是正 / 注意。旧データ「良好」は読取互換） */
  issueKinds: Object.freeze({
    immediate: '即報告',
    correction: '是正',
    notice: '注意',
    legacyGood: '良好'
  }),

  // マスタ参照元（職人管理と共有／先方納品・実運用中の本番）
  // 業者マスタ: 1行目「請負業者名」「施工業者名」（A,B）、2行目〜データ（MasterDataService.loadVendorMatrix）
  masterSpreadsheetId: 'SAMPLE_ID_019',
  masterSheetNames: Object.freeze({
    sites: 16994545,       // Master_Sites シートID
    contractors: '業者マスタ'
  }),

  // Google Drive ルートフォルダID（この直下に 現場名 / 案件ID / 是正前・是正後 が作られる）
  rootDriveFolderId: 'SAMPLE_ID_030',

  // ステータス定数
  status: Object.freeze({
    case: Object.freeze({
      draft: '下書き',
      submitted: '提出済み',
      reviewing: '確認中',
      completed: '完了'
    }),
    detail: Object.freeze({
      pending: '未提出',
      submitted: '提出済み',
      rejected: '差し戻し',
      approved: '確認完了'
    })
  }),

  // 業務定数
  reportCategory: '自主安全パトロール',
  /** 新規案件の報告区分は自主安全パトロールに固定 */
  reportCategoryOptions: Object.freeze([
    '自主安全パトロール'
  ]),
  businessDaysToSubmit: 3,

  // 案件シートのヘッダー順序（A〜L 固定）
  // A:案件ID B:報告区分 C:現場名 D:施工会社名 E:点検者 F:巡回日 G:提出期日
  // H:全体ステータス I:共有URL J:作成日時 K:更新日時 L:請負業者名
  caseHeaders: [
    '案件ID', '報告区分', '現場名', '施工会社名',
    '点検者', '巡回日', '提出期日', '全体ステータス',
    '共有URL', '作成日時', '更新日時',
    '請負業者名',
    '施工班',
    '棟名',
    '是正通知済み日時',
    '修正完了通知済み日時'
  ],

  // 明細シートのヘッダー順序
  detailHeaders: [
    '明細ID', '案件ID', '表示順', '区分番号', '種別',
    '指摘事項', '是正内容',
    '是正前写真URL', '是正後写真URL', '是正後アップロード日時',
    '確認状態', '差し戻し理由', '確認者', '確認日時',
    '作成日時', '更新日時',
    '指摘項目ID',
    '自由記述',
    '修正依頼内容',
    '備考',
    '是正前写真URL（変更前）',
    '是正後写真URL（変更前）',
    '是正後アップロード日時（変更前）',
    '確認状態（変更前）',
    '差し戻し理由（変更前）',
    '確認者（変更前）',
    '確認日時（変更前）',
    '是正前写真変更履歴あり',
    '是正後写真変更履歴あり'
  ],

  // 指摘ログ（1指摘=1行・集計用）
  issueLogHeaders: [
    'ログID',
    '案件ID',
    '明細ID',
    '報告日時',
    '現場名',
    '会社名',
    '施工班',
    '巡回者',
    '区分',
    '指摘項目ID',
    '指摘項目',
    '自由記述',
    '報告区分',
    '作成日時'
  ]
});
