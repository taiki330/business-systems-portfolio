/**
 * google.script.run 用エントリ（UiController.js と同様にトップレベル関数として公開）
 */
function getIssueLogStats(filters) {
  try {
    return IssueLogStatsService.computeStats(filters || {});
  } catch (e) {
    Logger.log('getIssueLogStats: ' + e);
    return { ok: false, error: String((e && e.message) || e) };
  }
}
