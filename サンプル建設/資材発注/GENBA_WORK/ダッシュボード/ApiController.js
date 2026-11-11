/**
 * Webアプリのエントリーポイント + クライアント公開API
 */

// =============================================
//  doGet — Webアプリ表示
// =============================================
function doGet() {
  try {
    var payload;
    var cache = CacheService.getScriptCache();
    var cached = cache.get('dashboard_payload');

    if (cached) {
      payload = JSON.parse(cached);
    } else {
      payload = DataService.buildDashboardPayload();
      try {
        var json = JSON.stringify(payload);
        // CacheService の上限は 100KB。超える場合はキャッシュしない
        if (json.length < 100000) {
          cache.put('dashboard_payload', json, CONFIG.CACHE_TTL_SECONDS);
        }
      } catch (e) {
        // キャッシュ失敗は無視
      }
    }

    var template = HtmlService.createTemplateFromFile('index');
    template.bootstrap = payload;

    return template
      .evaluate()
      .setTitle('ダッシュボード')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (e) {
    Logger.log('doGet エラー: ' + e.toString());
    Logger.log('スタック: ' + e.stack);
    return HtmlService.createHtmlOutput(
      '<h2>エラーが発生しました</h2><pre>' + e.toString() + '\n\n' + e.stack + '</pre>'
    );
  }
}

// =============================================
//  google.script.run 用 公開API
// =============================================

/** 最新データを取得（キャッシュクリア） */
function refreshDashboardData() {
  var cache = CacheService.getScriptCache();
  cache.remove('dashboard_payload');
  return DataService.buildDashboardPayload();
}

/**
 * 【診断用】指定現場の工期が各シートにどう入っているかをログ出力する。
 * GASエディタで debugScheduleForSite('現場名') を実行 → 実行ログを確認。
 * 引数を省略すると稼働現場リストの先頭20行をダンプする。
 */
function debugScheduleForSite(siteName) {
  var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SPREADSHEET_ID);
  var log = [];
  var norm = function(s) {
    if (s === null || s === undefined) return '';
    var str = String(s);
    str = str.replace(/\u337F/g, '(株)');
    str = str.replace(/\uFF08\u682A\uFF09/g, '(株)');
    str = str.replace(/\uFF08\u682A\)/g, '(株)');
    str = str.replace(/\(\u682A\uFF09/g, '(株)');
    str = str.replace(/[０-９Ａ-Ｚａ-ｚ]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    });
    str = str.replace(/\u3000/g, ' ');
    str = str.trim().replace(/\s+/g, ' ');
    return str;
  };
  var fmt = function(v){
    if (v === '' || v === null || v === undefined) return '(空)';
    if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return '"' + v + '"';
  };
  var maxRows = siteName ? 999 : 5;

  // ---- 稼働現場リスト ----
  var ms = ss.getSheetByName(CONFIG.MASTER_SHEET_NAME);
  log.push('=== 稼働現場リスト (gid: ' + (ms ? ms.getSheetId() : 'なし') + ') ===');
  if (ms) {
    var mlast = ms.getLastRow();
    var mdata = ms.getRange(2, 1, Math.max(0, mlast - 1), 8).getValues();
    var hit = 0;
    mdata.forEach(function(r, i){
      if (siteName && norm(r[0]) !== norm(siteName)) return;
      hit++;
      log.push('行' + (i+2) + ' ' + fmt(r[0]) + ' | E=' + fmt(r[4]) + ' F=' + fmt(r[5]) + ' G=' + fmt(r[6]) + ' H=' + fmt(r[7]));
      if (hit >= maxRows) return;
    });
    if (siteName && hit === 0) log.push('  → 稼働現場リストに「' + siteName + '」なし');
    if (!siteName) log.push('  （先頭' + maxRows + '行のみ。特定現場は debugScheduleForSite("現場名") で実行）');
  }

  // ---- データベース ----
  var db = ss.getSheetByName(CONFIG.CASE_DATA_SHEET_NAME);
  log.push('=== データベース ===');
  if (db) {
    var headers = CONFIG.DASHBOARD_HEADERS;
    var idxAS = headers.indexOf('組立開始予定日');
    var idxAE = headers.indexOf('組立終了予定日');
    var idxDS = headers.indexOf('解体開始予定日');
    var idxDE = headers.indexOf('解体終了予定日');
    var dlast = db.getLastRow();
    var ncol = Math.min(headers.length, db.getLastColumn());
    var ddata = db.getRange(2, 1, Math.max(0, dlast - 1), ncol).getValues();
    var dhit = 0;
    ddata.forEach(function(r, i){
      if (siteName && norm(r[0]) !== norm(siteName)) return;
      dhit++;
      log.push('行' + (i+2) + ' ' + fmt(r[0]) + ' 工区=' + fmt(r[1]) +
        ' | 組=' + fmt(idxAS>=0?r[idxAS]:'') + '~' + fmt(idxAE>=0?r[idxAE]:'') +
        ' 解=' + fmt(idxDS>=0?r[idxDS]:'') + '~' + fmt(idxDE>=0?r[idxDE]:''));
      if (dhit >= maxRows) return;
    });
    if (siteName && dhit === 0) log.push('  → データベースに「' + siteName + '」なし');
  }

  // ---- ダッシュボード最終解決結果 ----
  if (siteName) {
    log.push('=== ダッシュボード解決結果 ===');
    var payload = DataService.buildDashboardPayload();
    var targetNorm = norm(siteName);
    var found = null;
    for (var si = 0; si < payload.sites.length; si++) {
      if (norm(payload.sites[si].name) === targetNorm) { found = payload.sites[si]; break; }
    }
    if (found) {
      log.push('dateInfo: ' + found.dateInfo);
      log.push('schedule: ' + JSON.stringify(found.schedule));
    } else {
      log.push('  → ダッシュボード表示対象に含まれていません（データベースに親行がない）');
    }
  }

  var out = log.join('\n');
  Logger.log(out);
  return out;
}

/**
 * 【診断用】現場名がダッシュボード上で重複表示される原因を特定する。
 * データベースシートで対象キーワードを含む全行を、現場名のコードポイント単位で出力し、
 * 正規化キーが何種類できているか（＝何件に分かれるか）を集計する。
 * GASエディタで debugDuplicateSite('グランメゾン大濠公園') を実行 → 実行ログを確認。
 */
function debugDuplicateSite(siteName) {
  var keyword = (siteName || 'グランメゾン大濠公園').toString();
  var loose = keyword.replace(/\s/g, '');
  var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SPREADSHEET_ID);
  var db = ss.getSheetByName(CONFIG.CASE_DATA_SHEET_NAME);
  var log = [];
  var codePoints = function(s) {
    var a = [];
    for (var i = 0; i < s.length; i++) {
      a.push('U+' + ('0000' + s.charCodeAt(i).toString(16).toUpperCase()).slice(-4));
    }
    return a.join(' ');
  };

  if (!db) { Logger.log('データベースシートが見つかりません'); return 'no sheet'; }

  var headers = CONFIG.DASHBOARD_HEADERS;
  var dlast = db.getLastRow();
  var ncol = Math.min(headers.length, db.getLastColumn());
  var data = db.getRange(2, 1, Math.max(0, dlast - 1), ncol).getValues();

  var keyCount = {};   // 正規化キー → 件数
  var keyCp = {};      // 正規化キー → コードポイント

  log.push('=== データベースシート「' + keyword + '」を含む行 ===');
  data.forEach(function(r, i) {
    var name = (r[0] || '').toString();
    if (name.replace(/\s/g, '').indexOf(loose) < 0) return;
    var nk = DataService.normalizeSiteNameKey(name);
    keyCount[nk] = (keyCount[nk] || 0) + 1;
    keyCp[nk] = codePoints(nk);
    log.push('行' + (i + 2) + ' 現場名=' + JSON.stringify(name) + ' 工区=' + JSON.stringify((r[1] || '').toString()));
    log.push('   生の文字数=' + name.length + ' / コードポイント: ' + codePoints(name));
    log.push('   正規化キー=' + JSON.stringify(nk));
  });

  var keys = Object.keys(keyCount);
  log.push('');
  log.push('=== 正規化キー別の件数（このキーの種類数＝ダッシュボードに出る件数） ===');
  log.push('キーの種類数: ' + keys.length);
  keys.forEach(function(k) {
    log.push('  ' + JSON.stringify(k) + ' → ' + keyCount[k] + '行  [' + keyCp[k] + ']');
  });
  if (keys.length <= 1) {
    log.push('→ 正規化キーは1種類。重複の原因はデータベースシートではなく、棟/工区(buildingProgress)側の可能性があります。');
  } else {
    log.push('→ キーが複数種類あります。上のコードポイントの差（不可視文字や濁点の合成差）が原因です。');
  }

  var out = log.join('\n');
  Logger.log(out);
  return out;
}

/**
 * 【診断用・引数あり】指定現場の工期解決フルトレースをログ出力。
 * GASエディタでは下の TRACE_この現場 を書き換えて debugTraceSite() を実行してください。
 */
function debugTraceScheduleFull(siteName) {
  var out = DataService.debugScheduleTrace(siteName);
  Logger.log(out);
  return out;
}

/** ここに調べたい現場名を入れて、この関数を実行する */
var TRACE_この現場 = 'ラミアール三ツ沢';
function debugTraceSite() {
  return debugTraceScheduleFull(TRACE_この現場);
}

/**
 * 【診断用】サーバー最終 payload に dateInfo が入っているか実測する。
 * これを実行 → ログの「payload内 dateInfo」を確認。
 */
function debugPayloadSite() {
  var out = DataService.debugPayloadForSite(TRACE_この現場);
  Logger.log(out);
  return out;
}

/**
 * 【手動】doGet の120秒キャッシュを今すぐ消す。
 * これを実行した直後にダッシュボードを開き直すと、最新payloadで再生成される。
 */
function clearDashboardCache() {
  CacheService.getScriptCache().remove('dashboard_payload');
  Logger.log('ダッシュボードキャッシュをクリアしました。画面を開き直してください。');
  return 'cleared';
}

/** 工期を更新 */
function updateScheduleFromDialog(payload) {
  if (CONFIG.READ_ONLY_MODE === true) {
    throw new Error('このダッシュボードは閲覧専用のため、予定日の更新はできません。');
  }
  var cache = CacheService.getScriptCache();
  cache.remove('dashboard_payload');
  return DataService.updateSchedule(payload);
}

/** 進捗詳細を取得（詳細ページ用） */
function getProgressDetails(siteName) {
  return DataService.getProgressDetails(siteName);
}

/** フェーズ別フォーム回答データを取得（フェーズ詳細モーダル用） */
function getPhaseReportData(siteName, phaseNum) {
  return DataService.getPhaseReportData(siteName, phaseNum);
}

/** 工程表PDFのファイルIDを取得（工程表ビューア用） */
function getScheduleFileId(siteName) {
  return DataService.getScheduleFileId(siteName);
}

/**
 * ダッシュボード warning アラート一覧（通知用・JSON）
 * 画面の黄色帯と同じ条件（予定日の CONFIG.ALERT_WARN_DAYS 日前〜前日）
 */
function getDashboardWarningNotificationItems() {
  return AlertService.getWarningNotificationItems();
}

/**
 * LINE 等へそのまま送れるプレーンテキスト（件数＋1行1現場）
 */
function getDashboardWarningDigestPlainText() {
  return AlertService.getWarningDigestPlainText();
}

/**
 * LINE 送信用：warning + danger の一覧（JSON）
 */
function getDashboardLineNotificationItems() {
  return AlertService.getLineNotificationItems();
}

/**
 * LINE 送信用：warning + danger のプレーンテキスト
 */
function getDashboardLineAlertDigestPlainText() {
  return AlertService.getLineAlertDigestPlainText();
}

// =============================================
//  LINE 通知（手動実行 / 時間トリガー用）
// =============================================

/**
 * 日次トリガー用: 前回保存スナップショットと比較し、新規に warning/danger になった行、
 * または warning→danger に悪化した行だけ LINE Push する。
 * 初回（LINE_ALERT_STATE_JSON 未設定）はベースライン保存のみ（LINEは送らない）。
 */
function sendDashboardWarningsToLine() {
  return LineService.sendDashboardWarningsDigestToConfiguredUsers();
}

/**
 * 差分通知の基準をリセット。次回 sendDashboardWarningsToLine は再ベースライン（LINE送信なし）。
 */
function resetLineAlertNotificationBaseline() {
  return LineService.resetLineAlertNotificationBaseline();
}

/**
 * まずは自分のLINEに届くことを確認するための手動テスト。
 * Script Properties の LINE_USER_IDS の先頭 userId に送ります。
 */
function sendLineTestMessage(text) {
  return LineService.sendTestToFirstUser(text);
}
