/**
 * Webアプリ ルーター
 * ------------------------------------------------------------------
 * GASのWebアプリでは doGet() をプロジェクト全体で1つしか持てない。
 * 複数の画面を同じデプロイURLで出し分けるため、?page= で切り替える。
 *
 * 例:
 *   https://script.google.com/.../exec?clinic=PV            → ホーム
 *   https://script.google.com/.../exec?page=devices&clinic=NIS → 現況一覧
 *
 * 医院の指定:
 *   ?clinic=NIS のように医院コードをURLに付けて各医院へ配る。
 *   アクセス制御はURLで分けるだけの方針（棚卸しアプリと同じ運用に揃えている）。
 */

var PAGE_ROUTES = {
  'home':    { file: 'Home',        title: 'インカム管理' },
  'devices': { file: 'Devices',     title: '現況一覧' },
  'report':  { file: 'Report',      title: '故障を報告する' },
  'pool':    { file: 'RepairPool',  title: '修理待ち（全院）' },
  'order':   { file: 'RepairOrder', title: '修理依頼・完了・返却' },
  'history': { file: 'History',     title: '履歴' }
};

var DEFAULT_PAGE = 'home';

/** WebアプリのGETエントリポイント（プロジェクト唯一の doGet） */
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var page = params.page ? String(params.page) : DEFAULT_PAGE;
  var route = PAGE_ROUTES[page] || PAGE_ROUTES[DEFAULT_PAGE];

  var t = HtmlService.createTemplateFromFile(route.file);
  // appUrl … GASのiframe内では相対URLが正しく解決されない（実体は
  //          googleusercontent 上で動くため）。実行URLを渡して絶対リンクを組む。
  t.initParams = {
    page: page,
    clinic: params.clinic ? String(params.clinic) : '',
    appUrl: getAppUrl_()
  };

  return t.evaluate()
    .setTitle(route.title)
    // Apps Script は script.googleusercontent.com の iframe 内で画面を描画する。
    // 同一 Web アプリの /exec へ遷移する際に script.google.com が iframe 表示を
    // 拒否しないよう、明示的に許可する。
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** HTMLファイルから別のHTML部品を読み込むヘルパー。使い方: <?!= include('Style'); ?> */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** このWebアプリの実行URL（.../exec）。未デプロイ等で取れない場合は空文字。 */
function getAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}
