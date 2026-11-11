/**
 * 本体台帳の読み書き
 * ------------------------------------------------------------------
 * 「誰が何番を持っていて、今どういう状態か」を返すのがこのファイルの仕事。
 *
 * 現行スプレッドシートでは、貸し借りが備考欄の日本語（PV側「MDCに借りている」／
 * MDC側「プリベン貸出中」）で二重に書かれていて、片方を直し忘れると分からなくなっていた。
 * 台帳は1機体1行にし、「所属医院（持ち主）」と「現在地医院（今ある場所）」の
 * 2列で表す。借りている側の画面にも、貸主側の同じ1行が見える。
 */

// 本体台帳の列。列名を変えたら headerIndex_ が例外を出すので気付ける。
var DEVICE_COLS = {
  id: '機器ID', kind: '種別', clinic: '所属医院', mno: '管理番号', model: '品番',
  serial: 'シリアルナンバー', serialRaw: 'シリアル表記',
  buyDate: '購入日', buyRaw: '購入日表記', warranty: '保証期限',
  status: '状態', user: '使用者', location: '現在地医院', lastRepair: '最終修理日',
  note: '備考', flag: '要確認', updatedAt: '更新日時', updatedBy: '更新者'
};

/**
 * 本体台帳を全件読む（1回の getValues() で済ませる）。
 * @return {{idx:Object, rows:Array<Array>, items:Array<Object>}}
 */
function loadDevices_() {
  var data = readSheet_(SHEETS.devices);
  if (!data || data.length < 2) return { idx: null, rows: [], items: [] };

  var idx = headerIndex_(data[0], DEVICE_COLS, SHEETS.devices);
  var items = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var id = toStr(row[idx.id]);
    if (id === '') continue;
    items.push({
      sheetRow: r + 1, // シート上の行番号（1始まり）。書き戻しに使う
      id: id,
      kind: toStr(row[idx.kind]),
      clinic: toStr(row[idx.clinic]),
      mno: toStr(row[idx.mno]),
      model: toStr(row[idx.model]),
      serial: toStr(row[idx.serial]),
      serialRaw: toStr(row[idx.serialRaw]),
      buyDate: formatDate_(row[idx.buyDate]),
      buyRaw: toStr(row[idx.buyRaw]),
      warranty: formatDate_(row[idx.warranty]),
      warrantyValue: (row[idx.warranty] instanceof Date) ? row[idx.warranty] : null,
      status: toStr(row[idx.status]),
      user: toStr(row[idx.user]),
      location: toStr(row[idx.location]),
      lastRepair: formatDate_(row[idx.lastRepair]),
      note: toStr(row[idx.note]),
      flag: toStr(row[idx.flag])
    });
  }
  return { idx: idx, rows: data, items: items };
}

/**
 * 画面に出す1台分の表示情報を足す。
 * 貸し借りの向きは、所属医院と現在地医院の関係から毎回計算する
 * （備考の文章に頼らないので、片側だけ直し忘れる事故が起きない）。
 */
function decorateDevice_(d, viewerClinic) {
  var lent = d.location !== '' && d.location !== d.clinic;
  return {
    id: d.id, kind: d.kind, clinic: d.clinic, mno: d.mno, model: d.model,
    serial: d.serial, serialRaw: d.serialRaw,
    buyDate: d.buyDate, buyRaw: d.buyRaw, warranty: d.warranty,
    status: d.status, user: d.user, location: d.location,
    lastRepair: d.lastRepair, note: d.note, flag: d.flag,
    // 自院から見た関係。'' / '貸出中' / '借用中'
    relation: !lent ? '' : (d.clinic === viewerClinic ? '貸出中' : '借用中'),
    label: deviceLabel_(d)
  };
}

/** 一覧やプルダウンに出す短い呼び名。「①（MODEL-B / SN00001B）」のような形。 */
function deviceLabel_(d) {
  var head = d.mno !== '' ? d.mno : (d.user !== '' ? d.user : d.id);
  var detail = [d.model, d.serial || d.serialRaw].filter(function (v) { return v !== ''; }).join(' / ');
  return detail ? head + '（' + detail + '）' : head;
}

/**
 * 医院の現況一覧を返す。
 * 自院が持ち主の機器に加え、他院から借りて今自院にある機器も含める
 * （現場が手元にある実機を全部確認できるようにするため）。
 * @param {string} clinic 医院コード
 * @param {boolean} [includeDiscarded] 破棄済みも含めるか（既定 false）
 * @return {{clinic:string, items:Array, summary:Object}}
 */
function getDeviceList(clinic, includeDiscarded) {
  assertClinic_(clinic);
  var loaded = loadDevices_();

  var items = [];
  var summary = { total: 0, inUse: 0, spare: 0, trouble: 0, lent: 0, borrowed: 0, flagged: 0 };

  loaded.items.forEach(function (d) {
    if (d.clinic !== clinic && d.location !== clinic) return;
    if (!includeDiscarded && d.status === DEVICE_STATUS.discarded) return;

    var view = decorateDevice_(d, clinic);
    items.push(view);

    summary.total++;
    if (d.status === DEVICE_STATUS.inUse) summary.inUse++;
    if (d.status === DEVICE_STATUS.spare) summary.spare++;
    if ([DEVICE_STATUS.reported, DEVICE_STATUS.pooled, DEVICE_STATUS.ordered,
         DEVICE_STATUS.returning].indexOf(d.status) >= 0) summary.trouble++;
    if (view.relation === '貸出中') summary.lent++;
    if (view.relation === '借用中') summary.borrowed++;
    if (d.flag !== '') summary.flagged++;
  });

  // 状態 → 管理番号 の順に並べる。困っている機器（故障・修理中）を上に出す。
  var order = [DEVICE_STATUS.reported, DEVICE_STATUS.pooled, DEVICE_STATUS.ordered,
               DEVICE_STATUS.returning, DEVICE_STATUS.inUse, DEVICE_STATUS.spare,
               DEVICE_STATUS.discarded];
  items.sort(function (a, b) {
    var diff = order.indexOf(a.status) - order.indexOf(b.status);
    if (diff !== 0) return diff;
    return String(a.mno || a.user).localeCompare(String(b.mno || b.user), 'ja');
  });

  return { clinic: clinic, items: items, summary: summary };
}

/**
 * 故障報告の対象に選べる機器を返す（破棄済みと、既に修理の流れに乗っている機器を除く）。
 * 現在その医院にある実機だけを対象にする。
 * @param {string} clinic
 * @return {Array<{id:string, label:string, status:string}>}
 */
function getReportableDevices(clinic) {
  assertClinic_(clinic);
  return loadDevices_().items
    .filter(function (d) {
      if (d.location !== clinic) return false;
      return ACTIVE_DEVICE_STATUSES.indexOf(d.status) >= 0;
    })
    .map(function (d) {
      return { id: d.id, label: deviceLabel_(d), status: d.status, user: d.user };
    })
    .sort(function (a, b) { return a.label.localeCompare(b.label, 'ja'); });
}

/** 機器IDで1台を取り出す。無ければ null。 */
function findDevice_(loaded, deviceId) {
  for (var i = 0; i < loaded.items.length; i++) {
    if (loaded.items[i].id === deviceId) return loaded.items[i];
  }
  return null;
}

/**
 * 機器の状態・使用者・現在地を更新し、履歴に残す。
 * 呼び出し側（repair.js など）はロックの中から呼ぶこと。
 * @param {Object} loaded loadDevices_ の結果
 * @param {Object} device 対象（loaded.items の要素）
 * @param {{status:(string|undefined), user:(string|undefined), location:(string|undefined),
 *          lastRepair:(Date|undefined), note:(string|undefined)}} patch 変更したい項目だけ
 * @param {string} action 履歴に残す操作名
 * @param {string} [memo]
 */
function applyDevicePatch_(loaded, device, patch, action, memo) {
  var idx = loaded.idx;
  var row = loaded.rows[device.sheetRow - 1];
  var before = device.status + (device.user ? '／' + device.user : '') +
               (device.location !== device.clinic ? '（' + device.location + '）' : '');

  if (patch.hasOwnProperty('status')) {
    if (DEVICE_STATUS_LIST.indexOf(patch.status) < 0) {
      throw new Error('不明な状態です: ' + patch.status);
    }
    row[idx.status] = patch.status;
    device.status = patch.status;
  }
  if (patch.hasOwnProperty('user')) {
    row[idx.user] = patch.user;
    device.user = patch.user;
  }
  if (patch.hasOwnProperty('location')) {
    assertClinic_(patch.location);
    row[idx.location] = patch.location;
    device.location = patch.location;
  }
  if (patch.hasOwnProperty('lastRepair')) {
    row[idx.lastRepair] = patch.lastRepair || '';
  }
  if (patch.hasOwnProperty('note')) {
    row[idx.note] = patch.note;
    device.note = patch.note;
  }

  row[idx.updatedAt] = new Date();
  row[idx.updatedBy] = currentUser_();

  writeRow_(SHEETS.devices, device.sheetRow, row);

  var after = device.status + (device.user ? '／' + device.user : '') +
              (device.location !== device.clinic ? '（' + device.location + '）' : '');
  logHistory_({
    clinic: device.clinic, targetKind: '機器', targetId: device.id,
    action: action, before: before, after: after, memo: memo
  });
}

/**
 * 使用者・状態を画面から変更する（配置替え・貸出の解消など）。
 * 故障や修理に関わる状態はこの関数では変えられない。誤操作で修理案件と
 * 台帳の状態がずれるのを防ぐため、それらは repair.js の各操作からのみ動かす。
 * @param {string} clinic 操作している医院
 * @param {string} deviceId
 * @param {string} user 新しい使用者（空なら予備扱い）
 * @return {{ok:boolean, device:Object}}
 */
function updateDeviceUser(clinic, deviceId, user) {
  assertClinic_(clinic);
  user = toStr(user);

  return withLock_(function () {
    var loaded = loadDevices_();
    var device = findDevice_(loaded, deviceId);
    if (!device) throw new Error('機器が見つかりません: ' + deviceId);
    if (device.location !== clinic && device.clinic !== clinic) {
      throw new Error('この機器は ' + clinic + ' の管理外です。');
    }
    if (ACTIVE_DEVICE_STATUSES.indexOf(device.status) < 0) {
      throw new Error('「' + device.status + '」の機器は使用者を変更できません。' +
        '修理の手続きが終わってから変更してください。');
    }

    applyDevicePatch_(loaded, device, {
      user: user,
      status: user === '' ? DEVICE_STATUS.spare : DEVICE_STATUS.inUse
    }, '使用者を変更');

    return { ok: true, device: decorateDevice_(device, clinic) };
  });
}

/**
 * 機器を台帳に追加する。
 * 故障機を修理せず新品に入れ替える（現行データにも複数ある「購入」の対応）ときや、
 * 増設したときに使う。保証期間はメーカー保証12カ月なので、購入日から自動で計算する。
 * @param {string} clinic 所属医院
 * @param {{kind:string, mno:string, model:string, serial:string, buyDate:string,
 *          user:string, note:string, warrantyMonths:(number|string)}} input
 * @return {{ok:boolean, id:string, label:string}}
 */
function addDevice(clinic, input) {
  assertClinic_(clinic);
  input = input || {};

  var model = toStr(input.model);
  if (model === '') throw new Error('品番を入力してください（例: MODEL-A）。');

  var kind = toStr(input.kind) || '本体';
  if (DEVICE_KINDS.indexOf(kind) < 0) throw new Error('不明な種別です: ' + kind);

  var serialRaw = toStr(input.serial);
  var serial = normalizeSerial_(serialRaw);
  var buyDate = parseDate_(input.buyDate);
  var user = toStr(input.user);

  // 保証期限は購入日＋保証月数。購入日が読めない場合は空のままにする
  // （現行データのように「2019年3月以前」しか分からない機体もあるため）。
  var months = Number(input.warrantyMonths);
  if (!(months > 0)) months = 12;
  var warranty = '';
  if (buyDate) {
    warranty = new Date(buyDate.getFullYear(), buyDate.getMonth() + months, buyDate.getDate());
  }

  return withLock_(function () {
    var data = readSheet_(SHEETS.devices);

    // 同じシリアルが既にあれば知らせる（現行データで実際に起きている取り違えを防ぐ）
    if (serial !== '') {
      var loaded = loadDevices_();
      for (var i = 0; i < loaded.items.length; i++) {
        if (loaded.items[i].serial !== '' &&
            serialMatchKey_(loaded.items[i].serial) === serialMatchKey_(serial) &&
            loaded.items[i].status !== DEVICE_STATUS.discarded) {
          throw new Error('同じシリアルナンバーの機器が既に登録されています（' +
            loaded.items[i].clinic + ' ' + deviceLabel_(loaded.items[i]) + '）。');
        }
      }
    }

    var id = nextId_(data, DEVICE_HEADERS.indexOf('機器ID'), 'INC-');
    var now = new Date();
    var row = [];
    row[DEVICE_HEADERS.indexOf('機器ID')]           = id;
    row[DEVICE_HEADERS.indexOf('種別')]             = kind;
    row[DEVICE_HEADERS.indexOf('所属医院')]         = clinic;
    row[DEVICE_HEADERS.indexOf('管理番号')]         = toStr(input.mno);
    row[DEVICE_HEADERS.indexOf('品番')]             = model;
    row[DEVICE_HEADERS.indexOf('シリアルナンバー')] = serial;
    row[DEVICE_HEADERS.indexOf('シリアル表記')]     = serialRaw;
    row[DEVICE_HEADERS.indexOf('購入日')]           = buyDate || '';
    row[DEVICE_HEADERS.indexOf('購入日表記')]       = toStr(input.buyDate);
    row[DEVICE_HEADERS.indexOf('保証期限')]         = warranty;
    row[DEVICE_HEADERS.indexOf('状態')]             = user === '' ? DEVICE_STATUS.spare : DEVICE_STATUS.inUse;
    row[DEVICE_HEADERS.indexOf('使用者')]           = user;
    row[DEVICE_HEADERS.indexOf('現在地医院')]       = clinic;
    row[DEVICE_HEADERS.indexOf('備考')]             = toStr(input.note);
    row[DEVICE_HEADERS.indexOf('更新日時')]         = now;
    row[DEVICE_HEADERS.indexOf('更新者')]           = currentUser_();
    appendRows_(SHEETS.devices, [fillBlanks_(row, DEVICE_HEADERS.length)]);

    logHistory_({
      clinic: clinic, targetKind: '機器', targetId: id,
      action: '機器を追加', after: model + (serial ? ' / ' + serial : ''),
      memo: toStr(input.note)
    });

    return { ok: true, id: id, label: model + (serial ? '（' + serial + '）' : '') };
  });
}

/**
 * 保証期限が近い／切れた機器を返す。
 * 現行データは大半が「期限切れ」の文字だけで日付が入っていないため、
 * 保証期限が日付として入っている機器だけが対象になる。
 * @param {string} [clinic] 医院で絞る場合
 * @param {number} [days] 何日以内を対象にするか
 * @return {Array<Object>}
 */
function getWarrantyAlerts(clinic, days) {
  days = Number(days) > 0 ? Number(days) : getWarrantyAlertDays();
  var today = new Date();

  return loadDevices_().items.filter(function (d) {
    if (d.status === DEVICE_STATUS.discarded) return false;
    if (clinic && d.clinic !== clinic && d.location !== clinic) return false;
    if (!d.warrantyValue) return false;
    return daysBetween_(today, d.warrantyValue) <= days;
  }).map(function (d) {
    return {
      id: d.id, clinic: d.clinic, label: deviceLabel_(d), user: d.user,
      warranty: d.warranty,
      daysLeft: daysBetween_(today, d.warrantyValue)
    };
  }).sort(function (a, b) { return a.daysLeft - b.daysLeft; });
}
