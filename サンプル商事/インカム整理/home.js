/**
 * ホーム画面に出すサマリ
 * ------------------------------------------------------------------
 * 「今どうなっているか」を開いた瞬間に伝えるのが目的。
 * 現行スプレッドシートは開いても状況が読み取れない（数字が手計算、
 * 進行中の案件が対応状況欄の文章に埋もれている）ことが一番の不満だったため、
 * 件数と、次に何をすべきかだけを最初に出す。
 *
 * アクセス制御は「URLで分けるだけ」の方針（?clinic= を各医院に配る）。
 * 本部（PV）だけは全院の修理プールを見る画面へ入れる。
 */

/**
 * 医院ホームに出す情報。
 * 画面表示は1回の呼び出しで済ませる（読み込みのたびに何往復もさせない）。
 * @param {string} clinic
 * @return {Object}
 */
function getHomeSummary(clinic) {
  assertClinic_(clinic);

  var list = getDeviceList(clinic);
  var openCases = getOpenCasesForClinic(clinic);
  var warranty = getWarrantyAlerts(clinic);
  var isHq = (clinic === HQ_CLINIC);

  var summary = {
    clinic: clinic,
    clinicLabel: CLINIC_LABELS[clinic] || clinic,
    isHq: isHq,
    devices: list.summary,
    openCaseCount: openCases.length,
    // 自院から本部へまだ送っていない機器（現場が次にやること）
    toSendCount: openCases.filter(function (c) { return c.status === REPAIR_STATUS.reported; }).length,
    warrantyCount: warranty.length,
    warrantyDays: getWarrantyAlertDays(),
    flaggedCount: list.summary.flagged,
    pool: null,
    returnQueueCount: 0
  };

  // 本部だけは全院のまとめ出し状況と返却待ちを持つ
  if (isHq) {
    var pool = getRepairPool();
    summary.pool = {
      total: pool.total, threshold: pool.threshold, reached: pool.reached,
      // まだ本部に届いていない台数。先に集めないと修理に出せない
      notArrived: pool.items.filter(function (i) { return !i.atHq; }).length
    };
    summary.returnQueueCount = getReturnQueue().length;
    summary.orderedCount = getOrderedCases().length;
  }

  return summary;
}

/** 医院プルダウン用（?clinic= 未指定でホームを開いたとき） */
function getClinicList() {
  return CLINICS.map(function (c) {
    return { code: c, label: CLINIC_LABELS[c] || c };
  });
}
