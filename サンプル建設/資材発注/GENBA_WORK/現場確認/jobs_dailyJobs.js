/**
 * 未報告アラートや不備インジケータなどの日次ジョブ。
 */
var DailyJobs = (function() {
  var CHECK_TARGETS = [
    {
      planHeader: '送出教育予定日',
      actualHeader: '送り出し教育最終報告日',
      label: '送出教育'
    },
    {
      planHeader: '解体前教育予定日',
      actualHeader: '解体前教育最終報告日',
      label: '解体前教育'
    }
  ];

  function run() {
    var dashboard = SheetService.getDashboardData();
    if (!dashboard.rows.length) {
      Logger.log('[DailyJobs] No dashboard rows.');
      return;
    }

    var today = resetTime(new Date());
    var alertLines = [];

    dashboard.rows.forEach(function(row) {
      var siteName = row['現場名'];
      if (!siteName) return;

      CHECK_TARGETS.forEach(function(target) {
        var planDate = FormUtils.parseDate(row[target.planHeader]);
        var actualDate = FormUtils.parseDate(row[target.actualHeader]);
        if (planDate && planDate < today && !actualDate) {
          alertLines.push(siteName + ' - ' + target.label + ' 未報告（予定: ' + FormUtils.formatDate(planDate) + '）');
        }
      });
    });

    if (alertLines.length) {
      var message = ['【未報告アラート】'].concat(alertLines).join('\n');
      NotificationService.sendLineMessage(message);
    } else {
      Logger.log('[DailyJobs] No alerts.');
    }
  }

  function resetTime(date) {
    var normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  }

  return {
    run: run
  };
})();
