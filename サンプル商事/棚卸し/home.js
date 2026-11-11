/**
 * 役割別ホーム（サーバーサイド）
 * ------------------------------------------------------------------
 * 目的（②役割別UI）:
 *   立場に応じて入口を分けるための「ホーム画面」を支えるデータを返す。
 *     - 各医院ホーム（Home.html）    … 自院の期限バッジ件数
 *     - 理事長ホーム（Director.html）… 全医院の資産額サマリ
 *
 *   アクセス制御は「URLで分けるだけ」（?clinic= を各医院に配る）方針。
 *   厳密なログイン制御は将来対応。ここではデータ提供に徹する。
 *
 * 依存:
 *   stock.js    … getStockList（医院別サマリ）
 *   expiry.js   … getExpiryAlerts（期限アラート、全医院横断）
 *   migration.js … CLINICS
 */

// 期限バッジは「1年以内（＝あと365日以内）＋期限切れ」を対象に数える。
// 要件：期限の1年前から通知バッジを溜め、現場に一番短い期限を入力してもらう運用。
var EXPIRY_BADGE_DAYS = 365;

/**
 * 各医院ホーム用の情報を返す（今は期限バッジ件数のみ）。
 * @param {string} clinic 医院コード（NIS/MDC/KDC/PV）
 * @return {{clinic:string, expiryCount:number, thresholdDays:number}}
 */
function getClinicHome(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  return {
    clinic: clinic,
    expiryCount: countExpiryForClinic(clinic),
    thresholdDays: EXPIRY_BADGE_DAYS
  };
}

/**
 * 理事長ホーム用に、全医院の資産サマリ＋合計を返す。
 * 期限件数は全医院分を1回のgetExpiryAlertsでまとめて集計する（在庫は医院別に取得）。
 * @return {{clinics:Array, grand:Object, thresholdDays:number}}
 */
function getDirectorSummary() {
  // 期限件数を医院別に集計（1回の横断取得で済ませる）
  var expiryByClinic = {};
  var alerts = getExpiryAlerts(EXPIRY_BADGE_DAYS);
  alerts.items.forEach(function (it) {
    if (it.status === '通常') return; // バッジ対象は「まもなく期限」「期限切れ」のみ
    expiryByClinic[it.clinic] = (expiryByClinic[it.clinic] || 0) + 1;
  });

  var clinics = [];
  var grand = { count: 0, lowStockCount: 0, negativeCount: 0, totalValuation: 0, expiryCount: 0 };

  CLINICS.forEach(function (c) {
    var s = getStockList(c).summary;
    var ec = expiryByClinic[c] || 0;
    clinics.push({
      clinic: c,
      count: s.count,
      lowStockCount: s.lowStockCount,
      negativeCount: s.negativeCount,
      totalValuation: s.totalValuation,
      expiryCount: ec
    });
    grand.count += s.count;
    grand.lowStockCount += s.lowStockCount;
    grand.negativeCount += s.negativeCount;
    grand.totalValuation += s.totalValuation;
    grand.expiryCount += ec;
  });

  return { clinics: clinics, grand: grand, thresholdDays: EXPIRY_BADGE_DAYS };
}

/** 指定医院の「まもなく期限＋期限切れ」件数を数える。 */
function countExpiryForClinic(clinic) {
  var alerts = getExpiryAlerts(EXPIRY_BADGE_DAYS, clinic);
  var count = 0;
  alerts.items.forEach(function (it) {
    if (it.clinic === clinic && it.status !== '通常') count++;
  });
  return count;
}
