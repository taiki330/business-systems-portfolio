/**
 * インカム管理アプリ 全体設定
 * ------------------------------------------------------------------
 * 医院コード・シート名・状態（ステータス）の定義を1箇所にまとめる。
 * 他のファイルはここの定数だけを参照し、文字列リテラルを直書きしない
 * （「故障報告済」のような日本語の状態名をあちこちに書くと、
 *   後で言い回しを変えたときに片方だけ直し忘れて必ず壊れるため）。
 */

// ===== 接続先スプレッドシート =====

// このスクリプトはスタンドアロン（スプレッドシートに紐付いていない独立プロジェクト）
// として作られているため、SpreadsheetApp.getActiveSpreadsheet() が使えない。
// 「全院インカム管理 のコピー」のIDを既定値として持たせておき、sheets.js の getSS_() が
// 使う。スクリプトプロパティ SPREADSHEET_ID を設定すればそちらを優先する
// （テスト用に別のシートへ向けたい場合など）。
var DEFAULT_SPREADSHEET_ID = 'SAMPLE_ID_002';

// ===== 医院 =====

// 医院コード。表示順もこの並びに揃える。
var CLINICS = ['PV', 'NIS', 'KDC', 'MDC'];

// 本部。故障したインカムはここに集約し、まとまった台数で修理に出す運用。
var HQ_CLINIC = 'PV';

// 画面に出す医院の正式名称（URLに乗せるのはコードのまま）
var CLINIC_LABELS = {
  'PV':  'サンプル商事（本部）',
  'NIS': 'NIS',
  'KDC': 'KDC',
  'MDC': 'MDC'
};

// ===== シート名 =====

// アプリが読み書きする正規化シート。既存の PV/NIS/KDC/MDC などの
// シートは参照用にそのまま残し、アプリからは一切書き込まない。
var SHEETS = {
  devices:  '本体台帳',
  repairs:  '修理案件',
  history:  '履歴ログ',
  settings: '設定',
  earStock: 'イヤホン在庫',
  earIssue: 'イヤホン支給'
};

// 移行元となる既存シート（読み取り専用）
var LEGACY_SHEETS = {
  // 医院別の本体台帳＋イヤホン支給表。シート名は医院コードそのもの。
  clinics: ['PV', 'NIS', 'KDC', 'MDC'],
  // 全院横断の故障・修理履歴
  bodyRepairs: 'インカム本体管理',
  earRepairs:  'イヤホン管理'
};

// ===== 状態（ステータス） =====

/**
 * 本体1台のライフサイクル。
 * 現行スプレッドシートでは備考欄の日本語（「MDCに借りている」「修理依頼中」）で
 * 表していたものを、この列挙 ＋ 現在地医院 の2列に置き換える。
 */
var DEVICE_STATUS = {
  inUse:      '使用中',       // 使用者が決まっている
  spare:      '予備',         // 医院内の在庫。使用者なし
  reported:   '故障報告済',   // 現場で不具合。まだ医院にある
  pooled:     '本部集約済',   // 本部に集まり、修理まとめ出し待ち
  ordered:    '修理依頼中',   // メーカー（ウェッジ）へ送付済み
  returning:  '返却待ち',     // 修理から戻り、所属医院へ返送待ち
  discarded:  '破棄'          // 廃棄済み。台帳には残すが集計から外す
};

// プルダウン（入力規則）に出す順。破棄まで含めて手動修正できるようにする。
var DEVICE_STATUS_LIST = [
  DEVICE_STATUS.inUse, DEVICE_STATUS.spare, DEVICE_STATUS.reported,
  DEVICE_STATUS.pooled, DEVICE_STATUS.ordered, DEVICE_STATUS.returning,
  DEVICE_STATUS.discarded
];

// 「稼働している台数」に数える状態。故障中・修理中・破棄は含めない。
var ACTIVE_DEVICE_STATUSES = [DEVICE_STATUS.inUse, DEVICE_STATUS.spare];

/** 修理案件のライフサイクル */
var REPAIR_STATUS = {
  reported: '報告済',       // 医院から不具合の報告が上がった
  pooled:   '本部集約済',   // 実機が本部に届いた。まとめ出し待ち
  ordered:  '修理依頼中',   // メーカーへ依頼済み
  done:     '完了',         // 修理・購入が完了して医院へ戻った
  scrapped: '破棄'          // 修理せず廃棄した
};

var REPAIR_STATUS_LIST = [
  REPAIR_STATUS.reported, REPAIR_STATUS.pooled, REPAIR_STATUS.ordered,
  REPAIR_STATUS.done, REPAIR_STATUS.scrapped
];

// まとめ出し待ちとして数える状態（この件数が閾値に達したら本部へ知らせる）
var POOLING_STATUSES = [REPAIR_STATUS.reported, REPAIR_STATUS.pooled];

/** 修理完了時の対応区分。現行シートの「修理or購入or破棄」列を選択式にしたもの。 */
var REPAIR_ACTIONS = ['修理', '修理（保証）', '購入', '破棄'];

/** 機器の種別 */
var DEVICE_KINDS = ['本体', '中継器'];

/**
 * 故障の症状。現行シートの記述から頻出パターンを選択肢化した。
 * 「その他」を選んだ場合のみ自由記入欄を使う（自由記入だけにすると
 * 表記ゆれで集計できなくなり、現行シートと同じ問題を繰り返すため）。
 */
var SYMPTOM_OPTIONS = [
  '音が聞こえない',
  'マイクが入らない（相手に声が届かない）',
  '雑音が入る',
  '電源が入らない',
  '充電できない',
  'その他'
];

// ===== 設定シート =====

// 設定シートの既定値。setup.js がこの内容で初期化し、
// 以降は現場がスプレッドシート上で値を書き換えられる。
var DEFAULT_SETTINGS = [
  ['修理まとめ出し閾値', 5,
   '故障機がこの台数たまったら本部にアラートを出す。医院ごとに変えたい場合は「修理まとめ出し閾値_MDC」のように医院コードを付けた行を追加する'],
  ['保証期限アラート日数', 60, '保証期限がこの日数以内に迫った機器をホームで知らせる'],
  ['単価_本体_PV', 17950, 'PVの本体 新規購入価格（税抜）'],
  ['単価_本体_分院', 16120, '分院（NIS/KDC/MDC）の本体 新規購入価格（税抜）'],
  ['単価_イヤホン_PV', 2000, 'PVのイヤホンマイク 新規購入価格（税抜）'],
  ['単価_イヤホン_分院', 3800, '分院のイヤホンマイク 新規購入価格（税抜）'],
  ['単価_電池', 1800, '電池の価格（税抜）'],
  ['単価_送料', 1000, '1回あたりの送料（税抜）'],
  ['備考_点検費用', '点検後に新規購入となった場合、別途点検費用が発生する（実績で＋￥2,000）', '見積り時の注意書き']
];

// 設定シートが読めない/値が壊れている場合に使うフォールバック。
// 設定シート未作成の状態でも画面が真っ白にならないようにするための保険。
var FALLBACK_REPAIR_THRESHOLD = 5;
var FALLBACK_WARRANTY_ALERT_DAYS = 60;

/**
 * 設定シートを キー → 値 のオブジェクトで返す。
 * 画面表示のたびに読むため、60秒キャッシュ（sheets.js の readSheet_ 経由）に乗る。
 * @return {Object<string, (string|number|Date)>}
 */
function getSettings() {
  var data = readSheet_(SHEETS.settings);
  var map = {};
  if (!data) return map;
  for (var r = 1; r < data.length; r++) {
    var key = toStr(data[r][0]);
    if (key === '') continue;
    map[key] = data[r][1];
  }
  return map;
}

/**
 * 修理まとめ出しの閾値を返す。
 * 医院別の設定（例「修理まとめ出し閾値_MDC」）があればそちらを優先する。
 * 打ち合わせでは「5台集まったら修理に出す」、一方で現行シートには
 * 「後2個不具合でたら」＝3台運用のメモが残っており実態が揺れているため、
 * コードに埋め込まず設定シートで変えられるようにしてある。
 * @param {string} [clinic] 医院コード。省略時は全体設定
 * @return {number}
 */
function getRepairThreshold(clinic) {
  var settings = getSettings();
  var perClinic = clinic ? settings['修理まとめ出し閾値_' + clinic] : null;
  var n = Number(perClinic);
  if (n > 0) return n;
  n = Number(settings['修理まとめ出し閾値']);
  return n > 0 ? n : FALLBACK_REPAIR_THRESHOLD;
}

/** 保証期限アラートの日数を返す */
function getWarrantyAlertDays() {
  var n = Number(getSettings()['保証期限アラート日数']);
  return n > 0 ? n : FALLBACK_WARRANTY_ALERT_DAYS;
}
