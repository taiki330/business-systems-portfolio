/**
 * 故障報告から修理完了・返却までの流れ
 * ------------------------------------------------------------------
 * 運用（ヒアリングどおり）:
 *   医院で故障 → 本部（PV）に実機を集める → 一定台数たまったらまとめて修理に出す
 *   → 戻ってきたら各医院に返す。
 *
 * 現行スプレッドシートでは「後2個不具合でたら修理依頼する」というメモが
 * 対応状況欄に書かれるだけで、たまった台数を誰も数えていなかった。
 * その結果 KDC の M122171B は 2025/9/4 の報告からずっと止まっている。
 * ここでは案件の状態を数えて、閾値に達したら本部の画面に出す。
 *
 * 状態の持ち方:
 *   修理案件の状態を正とし、機器（本体台帳）の状態はそれに追随させる。
 *   台帳の備考と履歴シートの対応状況が食い違うという現行の問題を、
 *   「1箇所でしか状態を変えない」ことで構造的に防ぐ。
 */

var REPAIR_COLS = {
  id: '案件ID', kind: '対象種別', deviceId: '機器ID', target: '対象表記', clinic: '所属医院',
  faultDate: '故障日', symptom: '症状', reportDate: '報告日', reporter: '報告者', status: '状態',
  orderDate: '修理依頼日', cause: '原因', action: '対応区分', cost: '費用(税抜)', doneDate: '完了日',
  note: '備考', flag: '要確認', updatedAt: '更新日時', updatedBy: '更新者'
};

/**
 * 修理案件を全件読む。
 * @return {{idx:Object, rows:Array<Array>, items:Array<Object>}}
 */
function loadRepairs_() {
  var data = readSheet_(SHEETS.repairs);
  if (!data || data.length < 2) return { idx: null, rows: [], items: [] };

  var idx = headerIndex_(data[0], REPAIR_COLS, SHEETS.repairs);
  var items = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var id = toStr(row[idx.id]);
    if (id === '') continue;
    items.push({
      sheetRow: r + 1,
      id: id,
      kind: toStr(row[idx.kind]),
      deviceId: toStr(row[idx.deviceId]),
      target: toStr(row[idx.target]),
      clinic: toStr(row[idx.clinic]),
      faultDate: formatDate_(row[idx.faultDate]),
      symptom: toStr(row[idx.symptom]),
      reportDate: formatDate_(row[idx.reportDate]),
      reporter: toStr(row[idx.reporter]),
      status: toStr(row[idx.status]),
      orderDate: formatDate_(row[idx.orderDate]),
      cause: toStr(row[idx.cause]),
      action: toStr(row[idx.action]),
      cost: row[idx.cost] === '' ? '' : Number(row[idx.cost]),
      doneDate: formatDate_(row[idx.doneDate]),
      note: toStr(row[idx.note]),
      flag: toStr(row[idx.flag])
    });
  }
  return { idx: idx, rows: data, items: items };
}

/** 案件IDで取り出す。無ければ null。 */
function findRepair_(loaded, caseId) {
  for (var i = 0; i < loaded.items.length; i++) {
    if (loaded.items[i].id === caseId) return loaded.items[i];
  }
  return null;
}

/** その機器に未完了の案件があれば返す（二重報告を防ぐため） */
function findOpenRepairForDevice_(loaded, deviceId) {
  for (var i = 0; i < loaded.items.length; i++) {
    var r = loaded.items[i];
    if (r.deviceId !== deviceId) continue;
    if (r.status === REPAIR_STATUS.done || r.status === REPAIR_STATUS.scrapped) continue;
    return r;
  }
  return null;
}

// ===== ① 故障報告（各医院） =====

/**
 * 現場から故障を報告する。
 * @param {string} clinic 報告する医院
 * @param {{deviceId:string, symptom:string, symptomOther:string, faultDate:string,
 *          reporter:string, note:string}} input
 * @return {{ok:boolean, caseId:string, poolCount:number, threshold:number, reached:boolean}}
 */
function reportFault(clinic, input) {
  assertClinic_(clinic);
  input = input || {};

  var symptom = toStr(input.symptom);
  if (symptom === '') throw new Error('症状を選んでください。');
  if (symptom === 'その他') {
    var other = toStr(input.symptomOther);
    if (other === '') throw new Error('症状（その他）の内容を入力してください。');
    symptom = other;
  }

  var reporter = toStr(input.reporter);
  if (reporter === '') throw new Error('報告者のお名前を入力してください。');

  var faultDate = parseDate_(input.faultDate) || new Date();

  return withLock_(function () {
    var devicesLoaded = loadDevices_();
    var device = findDevice_(devicesLoaded, toStr(input.deviceId));
    if (!device) throw new Error('機器が見つかりません。画面を開き直してください。');
    if (device.location !== clinic) {
      throw new Error('この機器は現在 ' + device.location + ' にあります。' +
        '手元にある機器を選んでください。');
    }

    var repairsLoaded = loadRepairs_();
    var open = findOpenRepairForDevice_(repairsLoaded, device.id);
    if (open) {
      throw new Error('この機器は既に「' + open.status + '」で受付済みです（案件 ' + open.id + '）。' +
        '重ねて報告する必要はありません。');
    }

    var data = readSheet_(SHEETS.repairs);
    var caseId = nextId_(data, REPAIR_HEADERS.indexOf('案件ID'), 'REP-');
    var now = new Date();
    var user = currentUser_();

    var row = [];
    row[REPAIR_HEADERS.indexOf('案件ID')]     = caseId;
    row[REPAIR_HEADERS.indexOf('対象種別')]   = device.kind;
    row[REPAIR_HEADERS.indexOf('機器ID')]     = device.id;
    row[REPAIR_HEADERS.indexOf('対象表記')]   = deviceLabel_(device);
    row[REPAIR_HEADERS.indexOf('所属医院')]   = device.clinic;
    row[REPAIR_HEADERS.indexOf('故障日')]     = faultDate;
    row[REPAIR_HEADERS.indexOf('症状')]       = symptom;
    row[REPAIR_HEADERS.indexOf('報告日')]     = now;
    row[REPAIR_HEADERS.indexOf('報告者')]     = reporter;
    row[REPAIR_HEADERS.indexOf('状態')]       = REPAIR_STATUS.reported;
    row[REPAIR_HEADERS.indexOf('備考')]       = toStr(input.note);
    row[REPAIR_HEADERS.indexOf('更新日時')]   = now;
    row[REPAIR_HEADERS.indexOf('更新者')]     = user;
    appendRows_(SHEETS.repairs, [fillBlanks_(row, REPAIR_HEADERS.length)]);

    applyDevicePatch_(devicesLoaded, device, { status: DEVICE_STATUS.reported },
      '故障報告', caseId + '：' + symptom);

    logHistory_({
      clinic: clinic, targetKind: '修理案件', targetId: caseId,
      action: '故障報告', after: REPAIR_STATUS.reported,
      memo: deviceLabel_(device) + '／' + symptom + '（報告者: ' + reporter + '）'
    });

    var pool = getRepairPool();
    return {
      ok: true, caseId: caseId,
      poolCount: pool.total, threshold: pool.threshold, reached: pool.reached
    };
  });
}

// ===== ② 修理待ちプール（本部） =====

/**
 * まとめ出し待ちの案件一覧と、閾値に達しているかを返す。
 * 数えるのは本体・中継器のみ。イヤホンは修理に出さず破棄・買い替えの運用なので含めない。
 * @return {{items:Array, total:number, threshold:number, reached:boolean, byClinic:Array}}
 */
function getRepairPool() {
  var repairs = loadRepairs_();
  var devicesLoaded = loadDevices_();

  var items = [];
  var countByClinic = {};

  repairs.items.forEach(function (r) {
    if (r.kind === 'イヤホン') return;
    if (POOLING_STATUSES.indexOf(r.status) < 0) return;

    var device = r.deviceId ? findDevice_(devicesLoaded, r.deviceId) : null;
    items.push({
      id: r.id, clinic: r.clinic, status: r.status,
      label: device ? deviceLabel_(device) : r.target,
      deviceId: r.deviceId,
      symptom: r.symptom, faultDate: r.faultDate, reportDate: r.reportDate,
      reporter: r.reporter, note: r.note, flag: r.flag,
      // 本部にまだ届いていない機器は、先に集める必要があるので画面で区別する
      atHq: r.status === REPAIR_STATUS.pooled
    });
    if (r.clinic) countByClinic[r.clinic] = (countByClinic[r.clinic] || 0) + 1;
  });

  // 古い報告ほど上に出す（放置されている案件を目立たせるため）
  items.sort(function (a, b) { return String(a.reportDate).localeCompare(String(b.reportDate)); });

  var threshold = getRepairThreshold();
  var byClinic = CLINICS.map(function (c) {
    var count = countByClinic[c] || 0;
    var t = getRepairThreshold(c);
    return { clinic: c, count: count, threshold: t, reached: count >= t && count > 0 };
  });

  return {
    items: items,
    total: items.length,
    threshold: threshold,
    reached: items.length >= threshold && items.length > 0,
    byClinic: byClinic
  };
}

/**
 * 実機が本部に届いたことを登録する（医院 → 本部）。
 * @param {Array<string>} caseIds
 * @return {{ok:boolean, updated:number}}
 */
function markArrivedAtHq(caseIds) {
  return updateCases_(caseIds, [REPAIR_STATUS.reported], REPAIR_STATUS.pooled,
    DEVICE_STATUS.pooled, '本部に到着', {}, function (device) {
      return { status: DEVICE_STATUS.pooled, location: HQ_CLINIC };
    });
}

/**
 * まとめてメーカーへ修理を依頼する。
 * @param {Array<string>} caseIds
 * @param {string} orderDate 依頼日（未指定なら今日）
 * @return {{ok:boolean, updated:number}}
 */
function orderRepair(caseIds, orderDate) {
  var date = parseDate_(orderDate) || new Date();
  return updateCases_(caseIds, [REPAIR_STATUS.reported, REPAIR_STATUS.pooled],
    REPAIR_STATUS.ordered, DEVICE_STATUS.ordered, '修理を依頼',
    { orderDate: date }, function () {
      return { status: DEVICE_STATUS.ordered, location: HQ_CLINIC };
    });
}

/**
 * 案件の状態をまとめて進める共通処理。
 * @param {Array<string>} caseIds
 * @param {Array<string>} allowedFrom 遷移元として許す状態
 * @param {string} toStatus 案件の新しい状態
 * @param {string} deviceStatus 機器の新しい状態（使わない場合は空）
 * @param {string} action 履歴に残す操作名
 * @param {Object} patch 案件側に書き込む追加項目 {orderDate:Date} など
 * @param {function(Object):Object} devicePatchFn 機器側のパッチを作る関数
 */
function updateCases_(caseIds, allowedFrom, toStatus, deviceStatus, action, patch, devicePatchFn) {
  if (!caseIds || !caseIds.length) throw new Error('対象が選ばれていません。');

  return withLock_(function () {
    var repairs = loadRepairs_();
    var devicesLoaded = loadDevices_();
    var now = new Date();
    var user = currentUser_();
    var updated = 0;

    caseIds.forEach(function (caseId) {
      var r = findRepair_(repairs, caseId);
      if (!r) throw new Error('案件が見つかりません: ' + caseId);
      if (allowedFrom.indexOf(r.status) < 0) {
        throw new Error('案件 ' + caseId + ' は「' + r.status + '」のため ' +
          action + ' に進められません。画面を開き直してください。');
      }

      var row = repairs.rows[r.sheetRow - 1];
      var before = r.status;
      row[repairs.idx.status] = toStatus;
      if (patch.orderDate) row[repairs.idx.orderDate] = patch.orderDate;
      row[repairs.idx.updatedAt] = now;
      row[repairs.idx.updatedBy] = user;
      writeRow_(SHEETS.repairs, r.sheetRow, row);
      r.status = toStatus;
      updated++;

      logHistory_({
        clinic: r.clinic, targetKind: '修理案件', targetId: caseId,
        action: action, before: before, after: toStatus
      });

      // 対応する機器の状態も合わせて動かす（イヤホンなど機器IDが無い案件は対象外）
      var device = r.deviceId ? findDevice_(devicesLoaded, r.deviceId) : null;
      if (device && deviceStatus) {
        applyDevicePatch_(devicesLoaded, device, devicePatchFn(device), action, caseId);
      }
    });

    return { ok: true, updated: updated };
  });
}

// ===== ③ 修理完了 =====

/**
 * 修理・購入・破棄の結果を登録して案件を閉じる。
 * 実機はまだ本部にあるので、機器は「返却待ち」にする。
 * 医院へ送り返したら completeReturn() で返却を確定する。
 * @param {string} caseId
 * @param {{action:string, cause:string, cost:(string|number), doneDate:string, note:string}} input
 * @return {{ok:boolean, deviceStatus:string}}
 */
function completeRepair(caseId, input) {
  input = input || {};
  var action = toStr(input.action);
  if (REPAIR_ACTIONS.indexOf(action) < 0) {
    throw new Error('対応区分を選んでください（' + REPAIR_ACTIONS.join(' / ') + '）。');
  }
  var doneDate = parseDate_(input.doneDate) || new Date();
  var cost = toStr(input.cost) === '' ? '' : Number(input.cost);
  if (cost !== '' && (isNaN(cost) || cost < 0)) {
    throw new Error('費用は0以上の数値で入力してください。');
  }

  return withLock_(function () {
    var repairs = loadRepairs_();
    var r = findRepair_(repairs, caseId);
    if (!r) throw new Error('案件が見つかりません: ' + caseId);
    if (r.status === REPAIR_STATUS.done || r.status === REPAIR_STATUS.scrapped) {
      throw new Error('案件 ' + caseId + ' は既に「' + r.status + '」です。');
    }

    var newStatus = (action === '破棄') ? REPAIR_STATUS.scrapped : REPAIR_STATUS.done;
    var row = repairs.rows[r.sheetRow - 1];
    row[repairs.idx.status]   = newStatus;
    row[repairs.idx.action]   = action;
    row[repairs.idx.cause]    = toStr(input.cause);
    row[repairs.idx.cost]     = cost;
    row[repairs.idx.doneDate] = doneDate;
    row[repairs.idx.note]     = joinNote_(r.note, toStr(input.note));
    row[repairs.idx.updatedAt] = new Date();
    row[repairs.idx.updatedBy] = currentUser_();
    writeRow_(SHEETS.repairs, r.sheetRow, row);

    logHistory_({
      clinic: r.clinic, targetKind: '修理案件', targetId: caseId,
      action: '修理完了を登録', before: r.status, after: newStatus,
      memo: action + (cost !== '' ? '／¥' + cost : '')
    });

    var deviceStatus = '';
    var devicesLoaded = loadDevices_();
    var device = r.deviceId ? findDevice_(devicesLoaded, r.deviceId) : null;
    if (device) {
      if (action === '破棄' || action === '購入') {
        // 購入＝古い機体は破棄して新品に入れ替える運用（現行データもその形）。
        // 入れ替えた新品は「機器を追加」から登録してもらう。
        deviceStatus = DEVICE_STATUS.discarded;
        applyDevicePatch_(devicesLoaded, device,
          { status: DEVICE_STATUS.discarded },
          action === '購入' ? '破棄（新品と入れ替え）' : '破棄', caseId);
      } else {
        deviceStatus = DEVICE_STATUS.returning;
        applyDevicePatch_(devicesLoaded, device,
          { status: DEVICE_STATUS.returning, location: HQ_CLINIC, lastRepair: doneDate },
          '修理完了', caseId);
      }
    }

    return { ok: true, deviceStatus: deviceStatus, needsReplacement: action === '購入' };
  });
}

/**
 * 修理から戻った機器を所属医院へ返したことを登録する。
 * 使用者が決まっていれば使用中、いなければ予備に戻す。
 * @param {Array<string>} deviceIds
 * @return {{ok:boolean, updated:number}}
 */
function completeReturn(deviceIds) {
  if (!deviceIds || !deviceIds.length) throw new Error('対象が選ばれていません。');

  return withLock_(function () {
    var devicesLoaded = loadDevices_();
    var updated = 0;

    deviceIds.forEach(function (deviceId) {
      var device = findDevice_(devicesLoaded, deviceId);
      if (!device) throw new Error('機器が見つかりません: ' + deviceId);
      if (device.status !== DEVICE_STATUS.returning) {
        throw new Error('機器 ' + deviceLabel_(device) + ' は「' + device.status +
          '」のため返却の登録ができません。');
      }
      applyDevicePatch_(devicesLoaded, device, {
        status: device.user === '' ? DEVICE_STATUS.spare : DEVICE_STATUS.inUse,
        location: device.clinic
      }, '医院へ返却');
      updated++;
    });

    return { ok: true, updated: updated };
  });
}

/** 返却待ちの機器一覧（本部が発送するための一覧） */
function getReturnQueue() {
  return loadDevices_().items
    .filter(function (d) { return d.status === DEVICE_STATUS.returning; })
    .map(function (d) {
      return { id: d.id, clinic: d.clinic, label: deviceLabel_(d), user: d.user,
               lastRepair: d.lastRepair };
    });
}

/** 修理依頼中の案件一覧（完了登録の対象） */
function getOrderedCases() {
  var devicesLoaded = loadDevices_();
  return loadRepairs_().items
    .filter(function (r) { return r.status === REPAIR_STATUS.ordered; })
    .map(function (r) {
      var device = r.deviceId ? findDevice_(devicesLoaded, r.deviceId) : null;
      return {
        id: r.id, clinic: r.clinic, deviceId: r.deviceId,
        label: device ? deviceLabel_(device) : r.target,
        symptom: r.symptom, orderDate: r.orderDate, faultDate: r.faultDate, note: r.note
      };
    })
    .sort(function (a, b) { return String(a.orderDate).localeCompare(String(b.orderDate)); });
}

/**
 * 医院の未完了案件（自院ぶん）。医院ホームの状況表示に使う。
 * @param {string} clinic
 */
function getOpenCasesForClinic(clinic) {
  assertClinic_(clinic);
  var devicesLoaded = loadDevices_();
  return loadRepairs_().items
    .filter(function (r) {
      if (r.clinic !== clinic) return false;
      return r.status !== REPAIR_STATUS.done && r.status !== REPAIR_STATUS.scrapped;
    })
    .map(function (r) {
      var device = r.deviceId ? findDevice_(devicesLoaded, r.deviceId) : null;
      return {
        id: r.id, status: r.status, symptom: r.symptom,
        label: device ? deviceLabel_(device) : r.target,
        reportDate: r.reportDate, orderDate: r.orderDate
      };
    });
}
