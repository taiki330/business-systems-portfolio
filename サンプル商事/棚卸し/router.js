/**
 * Webアプリ ルーター
 * ------------------------------------------------------------------
 * GASのWebアプリでは doGet() はプロジェクト全体で1つだけ持てる。
 * 複数の画面（管理方式設定・現在庫一覧・QR読取・ダッシュボード等）を
 * 同じデプロイURLで出し分けるため、URLの ?page= パラメータで
 * 表示するHTMLファイルを切り替える。
 *
 * 例:
 *   https://script.google.com/.../exec              → 管理方式設定ツール（既定）
 *   https://script.google.com/.../exec?page=kanri   → 管理方式設定ツール
 *
 * アプリ内カメラは「資材移動」画面（transfer）専用とする方針のため、
 * 旧 ?page=qr（アプリ内カメラでのまとめ読取・使用登録）は廃止した。
 * 日常の使用登録はスマホの標準カメラでQRを写す運用（?p=商品ID → UseInstant）に統一している。
 *
 * 医院の指定:
 *   ?clinic=NIS のように医院コードをURLに付けられる。各画面のHTML側で
 *   getUrlParams() 経由で参照する想定（医院別URL運用に対応）。
 */

// 画面ルート定義。key = ?page= の値, file = HTMLファイル名, title = タブ表示名。
var PAGE_ROUTES = {
  'home':     { file: 'Home',            title: '在庫管理ホーム' },
  'director': { file: 'Director',        title: '全医院サマリ（理事長）' },
  'kanri':    { file: 'Index',           title: '管理方式 設定ツール' },
  'qrprint':  { file: 'QrPrint',         title: 'QRコード生成（印刷用）' },
  'order':    { file: 'OrderCandidates', title: '発注候補・発注登録' },
  'receive':  { file: 'Receiving',       title: '入荷登録' },
  'stock':    { file: 'StockList',       title: '現在庫一覧・検索' },
  'expiry':   { file: 'ExpiryAlert',     title: '使用期限アラート' },
  'transfer': { file: 'Transfer',        title: '資材移動（貸し借り）' },
  'bulkstock':{ file: 'BulkStock',       title: '一斉在庫登録' },
  'correction':{ file: 'Correction',     title: '訂正・取消' },
  'productmaster':{ file: 'ProductMaster', title: '商品マスタ管理' },
  // 事務・理事長向け（各医院には配らない画面）。入口は adminhome に集約する。
  'adminhome':{ file: 'AdminHome',       title: '在庫管理ホーム（理事長・事務）' },
  'usagerate':{ file: 'UsageRate',       title: '資材の稼働率' },
  'historyadmin':{ file: 'HistoryAdmin', title: '履歴の保管・削除' }
  // 今後の画面はここに追加していく:
  // 'dashboard': { file: 'Dashboard', title: 'ダッシュボード' }
};

var DEFAULT_PAGE = 'kanri';

/** WebアプリのGETエントリポイント（プロジェクト唯一のdoGet） */
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  // 標準カメラで読むQR（?p=商品ID）→ 即時使用ページ
  if (params.p) {
    var tp = HtmlService.createTemplateFromFile('UseInstant');
    tp.initParams = { productId: String(params.p) };
    return tp.evaluate()
      .setTitle('使用登録')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  var page = params.page ? String(params.page) : DEFAULT_PAGE;
  var route = PAGE_ROUTES[page] || PAGE_ROUTES[DEFAULT_PAGE];

  var t = HtmlService.createTemplateFromFile(route.file);
  // HTML側（<?= ?>）から初期パラメータを参照できるように渡す。
  // appUrl … ホーム画面のリンクは、GASのiframe内では相対URLが正しく解決されない
  //          （実体は googleusercontent 上で動くため）。実行URLを渡して絶対リンクを組む。
  t.initParams = {
    page: page,
    clinic: params.clinic ? String(params.clinic) : '',
    appUrl: getAppUrl_()
  };

  return t.evaluate()
    .setTitle(route.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * HTMLファイルから別のHTML/CSS/JS部品を読み込むためのヘルパー。
 * 使い方（HTML内）: <?!= include('スタイル'); ?>
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * このWebアプリの実行URL（.../exec）を返す。未デプロイ等で取れない場合は空文字。
 * ホーム画面の絶対リンク生成に使う。
 */
function getAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}
