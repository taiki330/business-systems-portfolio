/**
 * 履歴ログ
 * ------------------------------------------------------------------
 * 追記専用。書き換えも削除もしない。
 *
 * 現行スプレッドシートでは「誰がいつ状態を変えたか」がどこにも残らず、
 * 備考欄の文章が書き換わるだけだった。台帳の値が想定と違ったときに
 * さかのぼって確かめられるよう、状態を変える操作は必ずここに1行残す。
 */

/**
 * 履歴を1行追記する。
 * ログの失敗で本来の操作まで巻き添えにしないよう、例外は握りつぶして記録に留める
 * （故障報告そのものは通っているのに画面がエラーになる、という状況を避けるため）。
 * @param {{clinic:string, targetKind:string, targetId:string, action:string,
 *          before:(string|undefined), after:(string|undefined), memo:(string|undefined)}} entry
 */
function logHistory_(entry) {
  try {
    appendRows_(SHEETS.history, [[
      new Date(),
      currentUser_(),
      toStr(entry.clinic),
      toStr(entry.targetKind),
      toStr(entry.targetId),
      toStr(entry.action),
      toStr(entry.before),
      toStr(entry.after),
      toStr(entry.memo)
    ]]);
  } catch (e) {
    Logger.log('履歴の記録に失敗しました: ' + e.message + ' / ' + JSON.stringify(entry));
  }
}

/**
 * 履歴を新しい順に返す。
 * @param {string} [clinic] 医院で絞る場合。空なら全院（本部向け）
 * @param {number} [limit] 最大件数（既定200）
 * @return {{items:Array}}
 */
function getHistory(clinic, limit) {
  limit = Number(limit) > 0 ? Number(limit) : 200;

  var data = readSheet_(SHEETS.history);
  if (!data || data.length < 2) return { items: [] };

  var idx = headerIndex_(data[0], {
    at: '日時', user: '操作者', clinic: '医院', kind: '対象種別',
    id: '対象ID', action: '操作', before: '変更前', after: '変更後', memo: 'メモ'
  }, SHEETS.history);

  var items = [];
  // 新しいものから見たいので末尾から遡る。必要件数が集まった時点で打ち切る。
  for (var r = data.length - 1; r >= 1 && items.length < limit; r--) {
    var row = data[r];
    if (clinic && toStr(row[idx.clinic]) !== clinic) continue;
    items.push({
      at: formatDateTime_(row[idx.at]),
      user: toStr(row[idx.user]),
      clinic: toStr(row[idx.clinic]),
      kind: toStr(row[idx.kind]),
      id: toStr(row[idx.id]),
      action: toStr(row[idx.action]),
      before: toStr(row[idx.before]),
      after: toStr(row[idx.after]),
      memo: toStr(row[idx.memo])
    });
  }
  return { items: items };
}
