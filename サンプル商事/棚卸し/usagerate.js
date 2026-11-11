/**
 * 資材の稼働率分析（サーバーサイド）
 * ------------------------------------------------------------------
 * 目的（2026-08-22 ヒアリングで確定）:
 *   「この資材は最近ほとんど動いていないのに在庫を持ちすぎでは？」を
 *   事務・理事長が年1回まとめて見直せるようにする。
 *
 *   現場のスタッフは在庫と期限しか見ない。使った履歴をさかのぼることは無い、
 *   というのが現場の結論だった。一方で、
 *     ・ドクターごとの流行りで急に使われなくなる資材がある
 *     ・ドクターが異動すると、その先生が好んで使っていた資材が余る
 *   ため、動きの落ちた資材の在庫を減らす判断材料は欲しい、という要望。
 *
 * 何を出すか:
 *   使用履歴（usage.js が1使用ごとに記録している）を月ごとに合計し、
 *     - 月別の使用数量（折れ線グラフ用の系列）
 *     - 期間合計・月平均
 *     - 最終使用日（何ヶ月動いていないか）
 *     - 現在庫／月平均 ＝ 在庫月数（何ヶ月分の在庫を抱えているか）
 *   を商品ごとに返す。「動いていない順」に並べれば、そのまま棚卸しの見直し表になる。
 *
 * 取消の扱い:
 *   使用履歴の「取消フラグ」が立っている行は、取り消された使用なので集計しない。
 *
 * 性能方針:
 *   使用履歴は行数が増え続けるシートなので、必要な列（使用日時・医院ID・商品ID・
 *   使用数量・取消フラグ）だけを1回で読み、メモリ上で集計する。
 *   古い履歴は historyarchive.js で年1回書き出して削除する運用のため、
 *   1ファイルに何年ぶんも溜め続ける前提は取らない。
 *
 * 依存:
 *   usage.js     … USAGE_HISTORY_SHEET / USAGE_HISTORY_HEADERS / assertSheetHeaders_
 *                  getInventorySheetOrThrow / inventoryHeaderIndex
 *   stock.js     … getMasterInfoMap / unitPriceExTax_ / numOrZero
 *   migration.js … CLINICS
 *   webapp.js    … toStr
 */

// 分析期間は直近12ヶ月に固定する。年1回の見直しのための画面なので、
// 期間を選ばせても判断は変わらず、選択肢があるぶん迷わせるだけだった。
var USAGE_RATE_MONTHS = 12;

/**
 * 稼働率分析の一覧を返す（直近12ヶ月固定）。
 *
 * 稼働率の定義:
 *   12ヶ月のうち、その資材が1回でも使われた月が何ヶ月あったかの割合。
 *   「毎月ちゃんと出ていく資材か、たまにしか動かない資材か」をひと目で比べるための指標。
 *   使用数量そのものではないため、少量ずつ毎月使う資材も正しく「動いている」と出る。
 *
 * @param {{clinic:(string|undefined)}} [opts]
 *        clinic … 医院コード。空・未指定なら全医院を合算する
 * @return {{clinic:string, months:number, monthKeys:Array<string>,
 *           items:Array, generatedAt:string, historyRows:number}}
 */
function getUsageRateOverview(opts) {
  opts = opts || {};
  var clinic = toStr(opts.clinic);
  if (clinic !== '' && CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  var months = USAGE_RATE_MONTHS;

  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var monthKeys = recentMonthKeys_(months, tz);
  var monthPos = {};
  monthKeys.forEach(function (k, i) { monthPos[k] = i; });

  var usage = aggregateUsageByProductMonth_(clinic, monthPos, tz);
  var stockByProduct = stockByProductForClinic_(clinic);
  var masterMap = getMasterInfoMap(); // stock.js

  // 対象は「その医院（全医院なら全体）の在庫に載っている数量管理商品」。
  // 履歴にしか出てこない商品（すでに取り扱いをやめた等）も、動きの記録として拾う。
  var productIds = {};
  Object.keys(stockByProduct).forEach(function (pid) { productIds[pid] = true; });
  Object.keys(usage.byProduct).forEach(function (pid) { productIds[pid] = true; });

  var items = [];
  Object.keys(productIds).forEach(function (pid) {
    var m = masterMap[pid] || {};
    var series = usage.byProduct[pid] || zeroSeries_(months);
    var total = 0;
    series.forEach(function (v) { total += v; });

    var stock = stockByProduct.hasOwnProperty(pid) ? stockByProduct[pid] : null;
    var perMonth = total / months;
    var unitPrice = unitPriceExTax_(m); // stock.js
    var activeMonths = activeMonthCount_(series);

    items.push({
      productId: pid,
      name: m.name || (usage.nameByProduct[pid] || ''),
      category: m.category || '',
      supplier: m.supplier || '',
      series: series,
      total: total,
      perMonth: Math.round(perMonth * 100) / 100,
      // 稼働率＝12ヶ月中、使われた月の割合（％）。画面の並び順もこの値で決める。
      activeMonths: activeMonths,
      activeRate: Math.round((activeMonths / months) * 100),
      lastUsedMonth: usage.lastMonthByProduct[pid] || '',
      idleMonths: idleMonthsFromSeries_(series),
      stock: stock,
      // 在庫月数＝今の在庫が何ヶ月分か。使用が0なら「使い切る見込みが立たない」ので null。
      stockMonths: (stock !== null && perMonth > 0) ? Math.round((stock / perMonth) * 10) / 10 : null,
      // 動かない在庫がいくらぶん寝ているか。見直しの優先順位づけに使う。
      idleValuation: (stock !== null && unitPrice !== null) ? Math.round(unitPrice * stock) : null
    });
  });

  // 稼働率の低い順に並べる。同率なら、寝ている在庫金額が大きいほうを上にする
  // （どちらも動いていないなら、金額が大きいほうから見直したいため）。
  // そのまま上から見ていけば在庫の見直し候補になる並び。
  items.sort(function (a, b) {
    if (a.activeRate !== b.activeRate) return a.activeRate - b.activeRate;
    return (b.idleValuation || 0) - (a.idleValuation || 0);
  });

  return {
    clinic: clinic,
    months: months,
    monthKeys: monthKeys,
    items: items,
    historyRows: usage.scannedRows,
    generatedAt: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm')
  };
}

/** 系列のうち、1回でも使われた月が何ヶ月あったかを数える（稼働率の分子）。 */
function activeMonthCount_(series) {
  var n = 0;
  series.forEach(function (v) { if (v > 0) n++; });
  return n;
}

/** 今月を末尾にした 'yyyy-MM' の配列を、古い順に months 個作る。 */
function recentMonthKeys_(months, tz) {
  var now = new Date();
  var keys = [];
  for (var i = months - 1; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(Utilities.formatDate(d, tz, 'yyyy-MM'));
  }
  return keys;
}

function zeroSeries_(months) {
  var a = [];
  for (var i = 0; i < months; i++) a.push(0);
  return a;
}

/**
 * 使用履歴を読み、商品ごとの月別使用数量を集計する。
 * @param {string} clinic 空文字なら全医院を合算
 * @param {Object} monthPos 'yyyy-MM' -> 系列内の位置
 * @param {string} tz
 * @return {{byProduct:Object, nameByProduct:Object, lastMonthByProduct:Object, scannedRows:number}}
 */
function aggregateUsageByProductMonth_(clinic, monthPos, tz) {
  var out = { byProduct: {}, nameByProduct: {}, lastMonthByProduct: {}, scannedRows: 0 };
  var months = Object.keys(monthPos).length;

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USAGE_HISTORY_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return out;
  assertSheetHeaders_(sheet, USAGE_HISTORY_HEADERS); // usage.js：列ズレのまま集計しない

  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(2, 1, lastRow - 1, USAGE_HISTORY_HEADERS.length).getValues();
  out.scannedRows = values.length;

  var cDate = USAGE_HISTORY_HEADERS.indexOf('使用日時');
  var cClinic = USAGE_HISTORY_HEADERS.indexOf('医院ID');
  var cProduct = USAGE_HISTORY_HEADERS.indexOf('商品ID');
  var cName = USAGE_HISTORY_HEADERS.indexOf('品名');
  var cQty = USAGE_HISTORY_HEADERS.indexOf('使用数量');
  var cCanceled = USAGE_HISTORY_HEADERS.indexOf('取消フラグ');

  values.forEach(function (row) {
    if (toStr(row[cCanceled]) !== '') return; // 取り消された使用は集計しない
    if (clinic !== '' && toStr(row[cClinic]) !== clinic) return;

    var pid = toStr(row[cProduct]);
    if (pid === '') return;

    var d = row[cDate];
    if (!(d instanceof Date) || isNaN(d.getTime())) return;
    var key = Utilities.formatDate(d, tz, 'yyyy-MM');
    if (!monthPos.hasOwnProperty(key)) return; // 期間外

    var qty = Number(row[cQty]);
    if (isNaN(qty) || qty <= 0) return;

    if (!out.byProduct[pid]) out.byProduct[pid] = zeroSeries_(months);
    out.byProduct[pid][monthPos[key]] += qty;

    if (!out.nameByProduct[pid]) out.nameByProduct[pid] = toStr(row[cName]);
    if (!out.lastMonthByProduct[pid] || key > out.lastMonthByProduct[pid]) {
      out.lastMonthByProduct[pid] = key;
    }
  });

  return out;
}

/**
 * 医院別在庫から 商品ID -> 現在庫数 を作る（数量管理のみ）。
 * clinic が空文字なら全医院の合計。発注トリガー管理は在庫数を持たないため除く。
 */
function stockByProductForClinic_(clinic) {
  var sheet = getInventorySheetOrThrow(); // usage.js
  var lastRow = sheet.getLastRow();
  var out = {};
  if (lastRow < 2) return out;

  var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var idx = inventoryHeaderIndex(values[0]);
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (clinic !== '' && toStr(row[idx.clinic]) !== clinic) continue;
    if (toStr(row[idx.mode]) !== '数量管理') continue;
    var pid = toStr(row[idx.productId]);
    if (pid === '') continue;
    out[pid] = (out[pid] || 0) + numOrZero(row[idx.stock]); // order.js
  }
  return out;
}

/**
 * 系列の末尾から、使用0が何ヶ月続いているかを数える。
 * 全期間0なら期間の月数（＝この期間ずっと動いていない）を返す。
 */
function idleMonthsFromSeries_(series) {
  var idle = 0;
  for (var i = series.length - 1; i >= 0; i--) {
    if (series[i] > 0) break;
    idle++;
  }
  return idle;
}
