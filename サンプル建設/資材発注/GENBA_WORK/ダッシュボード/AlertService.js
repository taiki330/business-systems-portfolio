/**
 * ダッシュボードのアラート判定（index.html の computeAlerts と同等）
 * - 時間トリガー・LINE 等の通知はブラウザを開かないため、判定は GAS 側で行うのが正攻法
 * - warning のみ抽出する API（画面の黄色帯相当）
 * - LINE 送信用は warning + danger をまとめた API を提供（LineService が前回スナップショットと差分比較）
 */
var AlertService = (function() {
  function warnDays() {
    var n = Number(CONFIG && CONFIG.ALERT_WARN_DAYS);
    return !isNaN(n) && n > 0 ? n : 3;
  }

  function startOfToday() {
    var t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }

  function getLatestPct(siteName, progressData, type) {
    var siteMap = progressData[siteName];
    if (!siteMap || !siteMap['']) return 0;
    var dates = Object.keys(siteMap['']).sort();
    if (dates.length === 0) return 0;
    var latest = siteMap[''][dates[dates.length - 1]];
    return (latest && latest[type]) || 0;
  }

  /**
   * @param {string} dateStr - yyyy-MM-dd 等
   * @param {Date} today - 00:00 の今日
   * @returns {{ level: string, dateText: string, diffDays: number }|null}
   */
  function checkDate(dateStr, today) {
    if (!dateStr) return null;
    var d = DataService.parseDate(dateStr);
    if (!d || isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    var warn = new Date(d.getTime());
    warn.setDate(warn.getDate() - warnDays());
    var diff = Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    var level = null;
    if (today >= d) level = 'danger';
    else if (today >= warn) level = 'warning';
    if (!level) return null;
    var dateText =
      diff < 0 ? Math.abs(diff) + '日超過' : diff === 0 ? '当日' : 'あと' + diff + '日';
    return { level: level, dateText: dateText, diffDays: diff };
  }

  function phaseHasDate(phaseDetails, num) {
    if (!phaseDetails) return false;
    var pd = phaseDetails[num] || phaseDetails[String(num)];
    return !!(pd && pd.date);
  }

  /**
   * @returns {Array<{ siteName: string, level: string, type: string, dueDate: string, dueDateText: string, actionRequired: string, line: string }>}
   */
  function computeAllAlerts(sites, progressData) {
    var today = startOfToday();
    var out = [];
    (sites || []).forEach(function(site) {
      var siteName = site.name || '';
      var sched = site.schedule || {};
      var ml = site.milestones || {};
      var phaseDetails = site.phaseDetails || {};

      var assemblyPct = getLatestPct(siteName, progressData, 'assembly');
      var aAlert = checkDate(sched.assemblyEnd, today);
      if (aAlert && assemblyPct < 100) {
        var aPctRound = Math.round(assemblyPct);
        out.push({
          siteName: siteName,
          level: aAlert.level,
          type: 'assembly_incomplete',
          dueDate: DataService.formatDateISO(sched.assemblyEnd) || String(sched.assemblyEnd || ''),
          dueDateText: aAlert.dateText,
          actionRequired: '組立終了予定日までに組立進捗を100%完了すること（現在 ' + aPctRound + '%）',
          line:
            '【' +
            siteName +
            '】組立終了予定 ' +
            (DataService.formatDateISO(sched.assemblyEnd) || '') +
            '（' +
            aAlert.dateText +
            '）／組立進捗を100%にしてください（現在 ' +
            aPctRound +
            '%）'
        });
      }

      var dismantlePct = getLatestPct(siteName, progressData, 'dismantle');
      var dAlert = checkDate(sched.dismantleEnd, today);
      if (dAlert && dismantlePct < 100) {
        var dPctRound = Math.round(dismantlePct);
        out.push({
          siteName: siteName,
          level: dAlert.level,
          type: 'dismantle_incomplete',
          dueDate: DataService.formatDateISO(sched.dismantleEnd) || String(sched.dismantleEnd || ''),
          dueDateText: dAlert.dateText,
          actionRequired: '解体終了予定日までに解体進捗を100%完了すること（現在 ' + dPctRound + '%）',
          line:
            '【' +
            siteName +
            '】解体終了予定 ' +
            (DataService.formatDateISO(sched.dismantleEnd) || '') +
            '（' +
            dAlert.dateText +
            '）／解体進捗を100%にしてください（現在 ' +
            dPctRound +
            '%）'
        });
      }

      var sAlert = checkDate(ml.sendOut, today);
      if (sAlert && !phaseHasDate(phaseDetails, CONFIG.ALERT_PHASE_SEND_OUT || 4)) {
        out.push({
          siteName: siteName,
          level: sAlert.level,
          type: 'sendout_education',
          dueDate: DataService.formatDateISO(ml.sendOut) || String(ml.sendOut || ''),
          dueDateText: sAlert.dateText,
          actionRequired: '送出教育予定日までに送り出し教育の報告・記録を完了すること',
          line:
            '【' +
            siteName +
            '】送出教育予定 ' +
            (DataService.formatDateISO(ml.sendOut) || '') +
            '（' +
            sAlert.dateText +
            '）／送り出し教育の報告を完了してください'
        });
      }

      var pAlert = checkDate(ml.preEducation, today);
      if (pAlert && !phaseHasDate(phaseDetails, CONFIG.ALERT_PHASE_PRE_EDUCATION || 5)) {
        out.push({
          siteName: siteName,
          level: pAlert.level,
          type: 'pre_education',
          dueDate: DataService.formatDateISO(ml.preEducation) || String(ml.preEducation || ''),
          dueDateText: pAlert.dateText,
          actionRequired: '解体前教育予定日までに解体前教育の報告・記録を完了すること',
          line:
            '【' +
            siteName +
            '】解体前教育予定 ' +
            (DataService.formatDateISO(ml.preEducation) || '') +
            '（' +
            pAlert.dateText +
            '）／解体前教育の報告を完了してください'
        });
      }
    });
    return out;
  }

  /**
   * warning のみ（画面上の黄色アラート相当）
   */
  function getWarningNotificationItems() {
    var payload = DataService.buildDashboardPayload();
    var all = computeAllAlerts(payload.sites, payload.progressData || {});
    return all.filter(function(a) {
      return a.level === 'warning';
    });
  }

  /**
   * warning + danger（画面上の黄＋赤相当。LINE Push 用）
   */
  function getLineNotificationItems() {
    var payload = DataService.buildDashboardPayload();
    var all = computeAllAlerts(payload.sites, payload.progressData || {});
    return all.filter(function(a) {
      return a.level === 'warning' || a.level === 'danger';
    });
  }

  /**
   * LINE 等にそのまま投げやすいプレーンテキスト（件名なし・本文のみ）
   */
  function getWarningDigestPlainText() {
    var items = getWarningNotificationItems();
    if (!items.length) {
      return '【ダッシュボード】warning アラート対象はありません。';
    }
    var lines = items.map(function(x) {
      return x.line;
    });
    return '【ダッシュボード】warning ' + items.length + '件\n' + lines.join('\n');
  }

  /**
   * LINE 送信用：danger を先に並べ、各行にレベルタグを付ける
   */
  function getLineAlertDigestPlainText() {
    var items = getLineNotificationItems();
    if (!items.length) {
      return '【ダッシュボード】要対応アラート（warning／danger）はありません。';
    }
    var dangerCount = 0;
    var warningCount = 0;
    items.forEach(function(a) {
      if (a.level === 'danger') dangerCount += 1;
      else if (a.level === 'warning') warningCount += 1;
    });
    var sorted = items.slice().sort(function(a, b) {
      var rank = function(level) {
        if (level === 'danger') return 0;
        if (level === 'warning') return 1;
        return 2;
      };
      return rank(a.level) - rank(b.level);
    });
    var lines = sorted.map(function(x) {
      var tag = x.level === 'danger' ? '【danger】' : '【warning】';
      return tag + x.line;
    });
    return (
      '【ダッシュボード】要対応アラート danger ' +
      dangerCount +
      '件 / warning ' +
      warningCount +
      '件\n' +
      lines.join('\n')
    );
  }

  return {
    getWarningNotificationItems: getWarningNotificationItems,
    getLineNotificationItems: getLineNotificationItems,
    getWarningDigestPlainText: getWarningDigestPlainText,
    getLineAlertDigestPlainText: getLineAlertDigestPlainText,
    computeAllAlerts: computeAllAlerts
  };
})();

/** GASエディタから実行: warning 一覧をログ出力 */
function debug_dashboardWarnings() {
  var items = AlertService.getWarningNotificationItems();
  Logger.log('warning count: ' + items.length);
  items.forEach(function(x, i) {
    Logger.log(i + 1 + ': ' + x.line);
  });
}
