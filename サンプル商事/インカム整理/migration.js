/**
 * 現行シート → 正規化シートへの移行
 * ------------------------------------------------------------------
 * 移行元（すべて読み取り専用。1セルも書き換えない）:
 *   PV / NIS / KDC / MDC        … 医院別の本体台帳 ＋ イヤホン在庫・支給表
 *   インカム本体管理【担当：PV松田】 … 全院横断の故障・修理履歴
 *   イヤホン管理【担当：PV松田】     … 全院横断のイヤホン故障履歴
 *
 * 医院別の故障履歴シート（PV/NIS/KDC/MDC ごとの4枚）は読み込まない。
 * 内容は横断シートと同じものを二度書きしたもので、既にズレが生じている
 * （例: NIS SN00003 の原因が横断シートでは「経年劣化」、医院別シートでは
 *  「オーディオIC不良」）。この二重入力をやめることが今回の目的そのものなので、
 * 横断シートを唯一の出所として扱い、差分は移行レポートで人に確認してもらう。
 *
 * 移行方針:
 *   自動で「直さない」。判断がつかない行は消さずに取り込み、要確認列に理由を書く。
 *   現場が1度だけ目視で確認すれば、以後は正しいデータで運用できる状態にする。
 */

// 医院別シートの「使用者」欄に付いている丸数字（①〜⑳）。院内の呼び名（管理番号）として切り出す。
var CIRCLED_NUMBER_RE = /^([①-⑳])\s*(.*)$/;

/** 移行の集計結果。レポート表示に使う。 */
var _migrationStats = null;

/**
 * メニュー「② 現行データを移行」から実行する。
 * 既に移行済み（本体台帳にデータがある）の場合は、二重登録を防ぐため中止する。
 */
function runMigration() {
  var existing = readSheet_(SHEETS.devices);
  if (existing && existing.length > 1) {
    notify_('② 現行データの移行',
      '「' + SHEETS.devices + '」に既にデータが ' + (existing.length - 1) + ' 件あります。\n' +
      '二重登録を防ぐため中止しました。\n\n' +
      'やり直す場合はメニューの「移行をやり直す（管理シートを空にして再移行）」を使ってください。');
    return null;
  }
  var stats = migrateAll_();
  notify_('② 現行データの移行', formatMigrationSummary_(stats));
  return stats;
}

/**
 * 管理シート（設定を除く）を空にしてから移行し直す。
 * 移行ロジックを調整しながら結果を確かめる開発・検証用。
 * 移行元シートには一切触れないので、何度実行しても現行データは無傷。
 */
function rerunMigration() {
  [SHEETS.devices, SHEETS.repairs, SHEETS.history, SHEETS.earStock, SHEETS.earIssue]
    .forEach(function (name) {
      var sheet = getSheet_(name);
      if (!sheet) return;
      var last = sheet.getLastRow();
      if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
    });
  invalidateCache_();

  var stats = migrateAll_();
  notify_('移行のやり直し', formatMigrationSummary_(stats));
  return stats;
}

/**
 * 移行本体。医院別シートから機器・イヤホンを、横断シートから修理案件を取り込み、
 * 最後に両者を突き合わせて機器の状態を確定させる。
 * @return {Object} 集計結果
 */
function migrateAll_() {
  // 出力先が無いと始まらないので、先に作っておく（作成済みなら何もしない）
  setupSheetsQuiet_();

  var stats = {
    devices: 0, repeaters: 0, skippedBorrowRows: 0,
    repairs: 0, earStock: 0, earIssue: 0,
    flaggedDevices: 0, flaggedRepairs: 0, flaggedEarIssue: 0,
    notes: []
  };

  // ---- 1. 医院別シートから機器・イヤホンを読む ----
  var devices = [];   // {clinic, kind, mno, model, serial, serialRaw, ...}
  var earStock = [];
  var earIssue = [];

  CLINICS.forEach(function (clinic) {
    var data = readSheet_(clinic);
    if (!data) {
      stats.notes.push('シート「' + clinic + '」が見つからないため読み飛ばしました。');
      return;
    }
    parseClinicSheet_(clinic, data, devices, earStock, earIssue, stats);
  });

  // ---- 2. 重複シリアルを検出して印を付ける ----
  flagDuplicateSerials_(devices);

  // ---- 3. 機器IDを採番する（要確認フラグの集計は、この後の突き合わせで
  //         フラグが増えることがあるため、書き出し直前にまとめて数える） ----
  var now = new Date();
  var user = currentUser_();
  devices.forEach(function (d, i) {
    d.id = 'INC-' + padLeft_(i + 1, 4);
    if (d.kind === '中継器') stats.repeaters++;
  });

  // ---- 4. 横断シートから修理案件を読み、機器と突き合わせる ----
  var repairs = [];
  parseLegacyRepairSheet_(findLegacySheet_('インカム本体管理'), '本体', devices, repairs, stats);
  parseLegacyRepairSheet_(findLegacySheet_('イヤホン管理'), 'イヤホン', devices, repairs, stats);

  // ---- 5. 未完了の修理案件がある機器は、その状態を機器側にも反映する ----
  applyOpenRepairsToDevices_(devices, repairs);

  // ---- 6. 書き出し ----
  var deviceRows = devices.map(function (d) {
    if (d.flags.length) stats.flaggedDevices++;
    return deviceToRow_(d, now, user);
  });
  appendRows_(SHEETS.devices, deviceRows);
  stats.devices = deviceRows.length;

  var repairRows = repairs.map(function (r, i) {
    r.id = 'REP-' + padLeft_(i + 1, 4);
    if (r.flags.length) stats.flaggedRepairs++;
    return repairToRow_(r, now, user);
  });
  appendRows_(SHEETS.repairs, repairRows);
  stats.repairs = repairRows.length;

  appendRows_(SHEETS.earStock, earStock.map(function (s) {
    return [s.clinic, s.model, s.total, s.note, now];
  }));
  stats.earStock = earStock.length;

  var earIssueRows = earIssue.map(function (e, i) {
    if (e.flags.length) stats.flaggedEarIssue++;
    return ['EAR-' + padLeft_(i + 1, 4), e.clinic, e.staff, e.model, e.date,
            e.status, e.note, e.flags.join(' / ')];
  });
  appendRows_(SHEETS.earIssue, earIssueRows);
  stats.earIssue = earIssueRows.length;

  logHistory_({
    clinic: '', targetKind: '移行', targetId: '',
    action: '現行データを移行',
    memo: '機器 ' + stats.devices + '件 / 修理案件 ' + stats.repairs + '件 / ' +
          'イヤホン支給 ' + stats.earIssue + '件'
  });

  _migrationStats = stats;
  return stats;
}

// ===== 医院別シートの読み取り =====

/**
 * 医院別シート（PV/NIS/KDC/MDC）を解析する。
 * このシートは1枚に「本体台帳」「中継器」「イヤホン在庫数」「イヤホン支給表」が
 * 縦に並んだ構成なので、行番号ではなく見出し行を手がかりに区切りを見つける
 * （行を1本足しただけで壊れる作りにしないため）。
 */
function parseClinicSheet_(clinic, data, devices, earStock, earIssue, stats) {
  var headerRow = findRowIndex_(data, function (row) {
    return rowHasText_(row, 'シリアルナンバー') && rowHasText_(row, '品番');
  });
  if (headerRow < 0) {
    stats.notes.push('シート「' + clinic + '」に本体台帳の見出し行（品番・シリアルナンバー）が見つかりませんでした。');
    return;
  }

  var col = labelColumns_(data[headerRow]);
  var cModel   = pickCol_(col, ['品番']);
  var cSerial  = pickCol_(col, ['シリアルナンバー']);
  var cBuy     = pickCol_(col, ['購入日']);
  var cWarr    = pickCol_(col, ['保証期間', '保証期間（12カ月）']);
  var cUser    = pickCol_(col, ['使用者']);
  var cNote    = pickCol_(col, ['備考']);
  var cMno     = pickCol_(col, ['インカムNO']); // PVのみ存在

  var r = headerRow + 1;
  for (; r < data.length; r++) {
    var row = data[r];
    if (rowHasText_(row, 'イヤホン総在庫数') || rowHasText_(row, '支給スタッフ名')) break;
    if (isBlankRow_(row)) continue;

    var d = parseDeviceRow_(clinic, row, {
      model: cModel, serial: cSerial, buy: cBuy, warranty: cWarr,
      user: cUser, note: cNote, mno: cMno
    });
    if (!d) continue;

    // 他院から借りている側の行は、貸主側シートの行と同じ機体を指す重複記載。
    // 台帳は1機体1行にするため、借主側の行は取り込まない（貸主側で現在地を表現する）。
    if (d.borrowedCopy) {
      stats.skippedBorrowRows++;
      stats.notes.push(clinic + ' の「' + d.noteRaw + '」の行は、貸主側の台帳と同じ機体のため取り込みませんでした。');
      continue;
    }
    devices.push(d);
  }

  // イヤホン在庫数
  var stockRow = findRowIndex_(data, function (row) { return rowHasText_(row, 'イヤホン総在庫数'); });
  if (stockRow >= 0) {
    var cells = data[stockRow].map(toStr);
    var at = cells.indexOf('イヤホン総在庫数');
    var total = Number(cells[at + 1]);
    var note = cells.slice(at + 2).filter(function (v) { return v !== ''; }).join(' ');
    var model = (note.match(/EME-[0-9A-Za-z]+/) || [''])[0];
    earStock.push({
      clinic: clinic, model: model,
      total: isNaN(total) ? '' : total,
      note: note
    });
  }

  // イヤホン支給表
  var issueHeader = findRowIndex_(data, function (row) { return rowHasText_(row, '支給スタッフ名'); });
  if (issueHeader >= 0) {
    parseEarIssueTable_(clinic, data, issueHeader, earStock, earIssue);
  }
}

/**
 * 医院別シートの1行を機器に変換する。データ行でなければ null。
 */
function parseDeviceRow_(clinic, row, c) {
  var model     = cell_(row, c.model);
  var serialRaw = cell_(row, c.serial);
  var userRaw   = cell_(row, c.user);
  var noteRaw   = cell_(row, c.note);
  var buyRaw    = cell_(row, c.buy);
  var warrRaw   = cell_(row, c.warranty);
  var mnoRaw    = cell_(row, c.mno);

  var flags = [];
  var kind = '本体';

  // 中継器の行は品番欄に「中継器」と書かれ、その隣に機種名が入る形になっている
  if (model === '中継器') {
    kind = '中継器';
    if (/^DJ/i.test(serialRaw)) {
      model = serialRaw;
    } else {
      model = '';
      if (serialRaw !== '' && serialRaw.indexOf('[merged]') < 0) noteRaw = joinNote_(noteRaw, serialRaw);
    }
    serialRaw = '';
  }

  // 品番もシリアルも無ければデータ行ではない（見出しや注記の行）
  if (model === '' && serialRaw === '' && kind !== '中継器') return null;
  // 現行シートに紛れ込んでいる「[merged] 購入履歴無し」などの結合セル由来の値を落とす
  if (buyRaw.indexOf('[merged]') >= 0) { noteRaw = joinNote_(noteRaw, buyRaw.replace('[merged] ', '')); buyRaw = ''; }
  if (warrRaw.indexOf('[merged]') >= 0) warrRaw = '';
  if (userRaw.indexOf('[merged]') >= 0) userRaw = '';

  // 院内の呼び名（管理番号）。PVは専用列、他院は使用者欄の先頭の丸数字。
  var mno = mnoRaw;
  var user = userRaw;
  if (mno === '') {
    var m = userRaw.match(CIRCLED_NUMBER_RE);
    if (m) { mno = m[1]; user = m[2]; }
  }

  var serial = normalizeSerial_(serialRaw);
  if (serial === '' && serialRaw !== '' && kind === '本体') {
    flags.push('シリアルナンバー不明（原文: ' + serialRaw + '）');
  }

  var buyDate = parseDate_(buyRaw);
  var warranty = parseDate_(warrRaw);
  if (warranty === null && warrRaw !== '' && warrRaw !== '期限切れ') {
    flags.push('保証期間の表記を日付として読めません（原文: ' + warrRaw + '）');
  }

  // ---- 状態と現在地を、備考の日本語から読み取る ----
  var status = DEVICE_STATUS.inUse;
  var location = clinic;
  var borrowedCopy = false;

  if (/借りて(いる|る)/.test(noteRaw)) {
    // 「NISに借りている」＝この機体の持ち主は他院。貸主側シートに同じ機体の行がある。
    borrowedCopy = true;
  } else if (/貸出|貸し出/.test(noteRaw)) {
    var borrower = detectClinic_(noteRaw);
    if (borrower && borrower !== clinic) {
      location = borrower;
    } else {
      flags.push('貸出先の医院を特定できません（原文: ' + noteRaw + '）');
    }
  }

  if (/破棄|廃棄/.test(noteRaw)) {
    status = DEVICE_STATUS.discarded;
  } else if (user === '' || /^予備$/.test(user) || /在庫/.test(user)) {
    status = DEVICE_STATUS.spare;
  }

  // 備考に不具合の記述があるのに、状態が使用中/予備のまま残っている行を拾っておく。
  // 修理案件との突き合わせ（applyOpenRepairsToDevices_）で解消しなければ要確認に残る。
  var hasTrouble = /聞こえない|充電ができない|雑音|不具合|修理依頼中/.test(noteRaw);

  return {
    clinic: clinic, kind: kind, mno: mno, model: model,
    serial: serial, serialRaw: serialRaw,
    buyDate: buyDate, buyRaw: buyRaw, warranty: warranty,
    status: status, user: user, location: location,
    lastRepair: parseLastRepairDate_(noteRaw),
    note: noteRaw, noteRaw: noteRaw,
    flags: flags, hasTrouble: hasTrouble, borrowedCopy: borrowedCopy
  };
}

/** 備考の「2024年3月6日　最終修理」から最終修理日を拾う */
function parseLastRepairDate_(note) {
  var m = note.match(/(\d{4})\s*[年\/\.]\s*(\d{1,2})\s*[月\/\.]\s*(\d{1,2})\s*日?\s*(?:最終)?修理/);
  if (!m) return null;
  return parseDate_(m[1] + '/' + m[2] + '/' + m[3]);
}

/** 文字列から医院を特定する。「プリベン」はPVの通称。 */
function detectClinic_(text) {
  if (/プリベン/.test(text)) return 'PV';
  for (var i = 0; i < CLINICS.length; i++) {
    if (text.indexOf(CLINICS[i]) >= 0) return CLINICS[i];
  }
  return '';
}

/** イヤホン支給表を読む */
function parseEarIssueTable_(clinic, data, headerRow, earStock, earIssue) {
  var col = labelColumns_(data[headerRow]);
  var cStaff  = pickCol_(col, ['支給スタッフ名']);
  var cStatus = pickCol_(col, ['状態']);
  var cNote   = pickCol_(col, ['備考']);
  var cDate   = pickCol_(col, ['使用日', '購入日']);

  // その医院の在庫行から拾った型番を、支給行に型番が書かれていない場合の既定にする
  var defaultModel = '';
  earStock.forEach(function (s) { if (s.clinic === clinic) defaultModel = s.model; });

  for (var r = headerRow + 1; r < data.length; r++) {
    var row = data[r];
    if (isBlankRow_(row)) continue;
    var staff = cell_(row, cStaff);
    if (staff === '') continue;

    var statusRaw = cell_(row, cStatus);
    var note = cell_(row, cNote);
    var flags = [];

    var status = '';
    if (statusRaw === '支給') status = '支給中';
    else if (statusRaw === '貸出中') status = '貸出中';
    else if (statusRaw !== '') flags.push('状態「' + statusRaw + '」を判別できません');
    else if (/支給/.test(note)) {
      // PVシートの「歯科A院イヤホン支給」「NISイヤホン支給」は状態欄が空で、備考側に書かれている
      status = '支給中';
      flags.push('状態欄が空で、備考「' + note + '」から支給中と判断しました');
    } else {
      flags.push('状態が空欄です');
    }

    earIssue.push({
      clinic: clinic, staff: staff,
      model: (note.match(/EME-[0-9A-Za-z]+/) || [defaultModel])[0],
      date: parseDate_(cell_(row, cDate)),
      status: status,
      note: joinNote_(note, parseDate_(cell_(row, cDate)) ? '' : ('使用日原文: ' + cell_(row, cDate))),
      flags: flags
    });
  }
}

// ===== 横断シート（修理履歴）の読み取り =====

/**
 * シート名の一部から移行元シートを探す。
 * 実際のシート名には「【担当：PV松田】」のような注記が付いているため、
 * 完全一致ではなく部分一致で探す。
 */
function findLegacySheet_(keyword) {
  var sheets = getSS_().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.indexOf(keyword) >= 0 && Object.keys(SHEETS).every(function (k) { return SHEETS[k] !== name; })) {
      return name;
    }
  }
  return '';
}

/**
 * 横断の故障・修理履歴シートを読み、修理案件に変換する。
 * @param {string} sheetName 見つからなければ空文字
 * @param {string} defaultKind '本体' or 'イヤホン'
 */
function parseLegacyRepairSheet_(sheetName, defaultKind, devices, repairs, stats) {
  if (!sheetName) {
    stats.notes.push('横断の' + defaultKind + '履歴シートが見つからないため読み飛ばしました。');
    return;
  }
  var data = readSheet_(sheetName);
  if (!data) return;

  var headerRow = findRowIndex_(data, function (row) {
    return rowHasText_(row, '医院名') && rowHasText_(row, 'シリアルナンバー');
  });
  if (headerRow < 0) {
    stats.notes.push('シート「' + sheetName + '」に見出し行（医院名・シリアルナンバー）が見つかりませんでした。');
    return;
  }

  var col = labelColumns_(data[headerRow]);
  var c = {
    clinic:   pickCol_(col, ['医院名']),
    serial:   pickCol_(col, ['シリアルナンバー']),
    fault:    pickCol_(col, ['故障日']),
    symptom:  pickCol_(col, ['症状']),
    report:   pickCol_(col, ['報告日']),
    progress: pickCol_(col, ['対応状況']),
    order:    pickCol_(col, ['修理依頼日']),
    cause:    pickCol_(col, ['原因']),
    action:   pickCol_(col, ['修理or購入or破棄日']),
    cost:     pickCol_(col, ['費用']),
    done:     pickCol_(col, ['修理・購入・破棄完了日']),
    note:     pickCol_(col, ['備考'])
  };

  for (var r = headerRow + 1; r < data.length; r++) {
    var row = data[r];
    if (isBlankRow_(row)) continue;

    var clinic = cell_(row, c.clinic);
    var target = cell_(row, c.serial);
    // 医院名が空の行はシート冒頭の記入例（シリアルが ○○○○）。取り込まない。
    if (clinic === '' || /^[○◯]+$/.test(target)) continue;

    var flags = [];
    if (CLINICS.indexOf(clinic) < 0) {
      flags.push('医院名「' + clinic + '」を判別できません');
      clinic = '';
    }

    var kind = defaultKind;
    // 本体シートにイヤホン（EME-）の行が紛れ込んでいるので種別を直す
    if (defaultKind === '本体' && /EME-|イヤホン/.test(target)) {
      kind = 'イヤホン';
      flags.push('イヤホンの案件が本体の履歴シートに入っていました');
    }

    var device = (kind === 'イヤホン') ? null : matchDevice_(devices, clinic, target);
    if (kind !== 'イヤホン' && !device) {
      flags.push('台帳に該当する機器が見つかりません（破棄済みの可能性があります）');
    }

    var orderDate = parseDate_(cell_(row, c.order));
    var doneDate  = parseDate_(cell_(row, c.done));
    var action    = normalizeRepairAction_(cell_(row, c.action));
    var cost      = parseCost_(cell_(row, c.cost));

    var status;
    if (action === '破棄') status = REPAIR_STATUS.scrapped;
    else if (doneDate || (action && action !== '')) status = REPAIR_STATUS.done;
    else if (orderDate) status = REPAIR_STATUS.ordered;
    else status = REPAIR_STATUS.reported;

    // 完了扱いなのに完了日が読めない行は、あとで日付を入れてもらう必要がある
    if (status === REPAIR_STATUS.done && !doneDate) {
      flags.push('完了日を日付として読めません（原文: ' + cell_(row, c.done) + '）');
    }
    if (cell_(row, c.action) !== '' && action === '') {
      flags.push('対応区分「' + cell_(row, c.action) + '」を判別できません');
    }

    var notes = [];
    if (cell_(row, c.progress) !== '') notes.push('対応状況: ' + cell_(row, c.progress));
    if (cell_(row, c.cost) !== '' && cost === '') notes.push('費用原文: ' + cell_(row, c.cost));
    else if (/内|点検|送料/.test(cell_(row, c.cost))) notes.push('費用原文: ' + cell_(row, c.cost));
    if (cell_(row, c.note) !== '') notes.push(cell_(row, c.note));

    repairs.push({
      kind: kind,
      deviceId: device ? device.id : '',
      device: device,
      target: target,
      clinic: clinic,
      faultDate: parseDate_(cell_(row, c.fault)),
      symptom: cell_(row, c.symptom),
      reportDate: parseDate_(cell_(row, c.report)),
      reporter: '',
      status: status,
      orderDate: orderDate,
      cause: cell_(row, c.cause),
      action: action,
      cost: cost,
      doneDate: doneDate,
      note: notes.join(' / '),
      flags: flags
    });
  }
}

/**
 * 修理履歴の行を台帳の機器に結び付ける。
 * シリアル → 管理番号（丸数字）の順に試す。現行データには
 * シリアル末尾の「B」の有無や、全角スペース混じりの表記ゆれがあるため、
 * 突き合わせ用のキーに正規化してから比較する。
 */
function matchDevice_(devices, clinic, target) {
  var key = serialMatchKey_(target);
  var i;
  if (key !== '') {
    for (i = 0; i < devices.length; i++) {
      if (devices[i].clinic !== clinic) continue;
      if (serialMatchKey_(devices[i].serial) === key) return devices[i];
    }
  }
  // 「インカム本体⑫ シリアルナンバー消えてる」のように丸数字だけが手がかりの行
  var m = target.match(/[①-⑳]/);
  if (m) {
    for (i = 0; i < devices.length; i++) {
      if (devices[i].clinic === clinic && devices[i].mno === m[0]) return devices[i];
    }
  }
  return null;
}

// シリアル突き合わせ用の serialMatchKey_ は sheets.js に定義（devices.js の addDevice でも使うため）。

/** 「修理」「購入」「破棄」「修理（補償）」などの表記を対応区分に揃える */
function normalizeRepairAction_(raw) {
  if (raw === '') return '';
  if (/修理/.test(raw) && /保証|補償/.test(raw)) return '修理（保証）';
  if (/修理/.test(raw)) return '修理';
  if (/購入/.test(raw)) return '購入';
  if (/破棄|廃棄/.test(raw)) return '破棄';
  return '';
}

/** 「￥6000＋税」「￥19120＋税（内￥2000点検費用）」から税抜金額を取り出す */
function parseCost_(raw) {
  if (raw === '') return '';
  var m = raw.replace(/,/g, '').match(/[￥¥]?\s*(\d+)/);
  if (!m) return '';
  return Number(m[1]);
}

// ===== 突き合わせと検査 =====

/**
 * 同じシリアルの機器が複数ある場合に印を付ける。
 * MDC の SN00004 B が⑨予備と⑩（別機器）の2行に入っており、
 * さらに横断シートでは⑩は SN00008 と記録されていて食い違っている。
 * どちらが正しいかは現物を見ないと決められないため、機械的には直さず両方に印を付ける。
 */
function flagDuplicateSerials_(devices) {
  var byKey = {};
  devices.forEach(function (d) {
    var key = serialMatchKey_(d.serial);
    if (key === '') return;
    (byKey[key] = byKey[key] || []).push(d);
  });
  Object.keys(byKey).forEach(function (key) {
    var group = byKey[key];
    if (group.length < 2) return;
    group.forEach(function (d) {
      var others = group.filter(function (o) { return o !== d; })
        .map(function (o) { return o.clinic + ' ' + (o.mno || o.user || ''); });
      d.flags.push('同じシリアルの機器が他にもあります（' + others.join('、') + '）');
    });
  });
}

/**
 * 未完了の修理案件を機器の状態に反映する。
 * 現行シートでは「機器の備考」と「履歴シートの対応状況」が別々に書かれていて
 * 食い違うことがあるため、履歴側（＝案件の進み具合）を正とする。
 */
function applyOpenRepairsToDevices_(devices, repairs) {
  var statusMap = {};
  statusMap[REPAIR_STATUS.reported] = DEVICE_STATUS.reported;
  statusMap[REPAIR_STATUS.pooled]   = DEVICE_STATUS.pooled;
  statusMap[REPAIR_STATUS.ordered]  = DEVICE_STATUS.ordered;

  var touched = {};
  repairs.forEach(function (r) {
    if (!r.device) return;
    var mapped = statusMap[r.status];
    if (!mapped) return;
    if (r.device.status === DEVICE_STATUS.discarded) {
      r.flags.push('対象の機器は台帳上「破棄」になっていますが、案件が未完了のままです');
      return;
    }
    r.device.status = mapped;
    // 本部に集めた後・修理依頼中の実機は本部にある。報告済（まだ医院にある）は動かさない。
    if (mapped === DEVICE_STATUS.pooled || mapped === DEVICE_STATUS.ordered) {
      r.device.location = HQ_CLINIC;
    }
    touched[r.device.id] = true;

    // 機器の備考が「修理依頼中」と言っているのに、履歴側に修理依頼日が無い場合は食い違い
    if (/修理依頼中/.test(r.device.noteRaw) && !r.orderDate) {
      r.device.flags.push('備考は「修理依頼中」ですが、履歴シートに修理依頼日がありません');
    }
  });

  // 備考に不具合の記述があるのに、対応する案件が1件も無い機器を拾う
  // （KDC の「電池を交換しても充電ができない」など、報告が履歴シートに載っていない機体）
  devices.forEach(function (d) {
    if (!d.hasTrouble) return;
    if (touched[d.id]) return;
    if (d.status === DEVICE_STATUS.discarded) return;
    d.flags.push('備考に不具合の記述がありますが、対応する修理案件が履歴シートにありません');
  });
}

// ===== 行への変換 =====

function deviceToRow_(d, now, user) {
  var row = [];
  row[DEVICE_HEADERS.indexOf('機器ID')]           = d.id;
  row[DEVICE_HEADERS.indexOf('種別')]             = d.kind;
  row[DEVICE_HEADERS.indexOf('所属医院')]         = d.clinic;
  row[DEVICE_HEADERS.indexOf('管理番号')]         = d.mno;
  row[DEVICE_HEADERS.indexOf('品番')]             = d.model;
  row[DEVICE_HEADERS.indexOf('シリアルナンバー')] = d.serial;
  row[DEVICE_HEADERS.indexOf('シリアル表記')]     = d.serialRaw;
  row[DEVICE_HEADERS.indexOf('購入日')]           = d.buyDate || '';
  row[DEVICE_HEADERS.indexOf('購入日表記')]       = d.buyRaw;
  row[DEVICE_HEADERS.indexOf('保証期限')]         = d.warranty || '';
  row[DEVICE_HEADERS.indexOf('状態')]             = d.status;
  row[DEVICE_HEADERS.indexOf('使用者')]           = d.user;
  row[DEVICE_HEADERS.indexOf('現在地医院')]       = d.location;
  row[DEVICE_HEADERS.indexOf('最終修理日')]       = d.lastRepair || '';
  row[DEVICE_HEADERS.indexOf('備考')]             = d.note;
  row[DEVICE_HEADERS.indexOf('要確認')]           = d.flags.join(' / ');
  row[DEVICE_HEADERS.indexOf('更新日時')]         = now;
  row[DEVICE_HEADERS.indexOf('更新者')]           = user;
  return fillBlanks_(row, DEVICE_HEADERS.length);
}

function repairToRow_(r, now, user) {
  var row = [];
  row[REPAIR_HEADERS.indexOf('案件ID')]     = r.id;
  row[REPAIR_HEADERS.indexOf('対象種別')]   = r.kind;
  row[REPAIR_HEADERS.indexOf('機器ID')]     = r.deviceId;
  row[REPAIR_HEADERS.indexOf('対象表記')]   = r.target;
  row[REPAIR_HEADERS.indexOf('所属医院')]   = r.clinic;
  row[REPAIR_HEADERS.indexOf('故障日')]     = r.faultDate || '';
  row[REPAIR_HEADERS.indexOf('症状')]       = r.symptom;
  row[REPAIR_HEADERS.indexOf('報告日')]     = r.reportDate || '';
  row[REPAIR_HEADERS.indexOf('報告者')]     = r.reporter;
  row[REPAIR_HEADERS.indexOf('状態')]       = r.status;
  row[REPAIR_HEADERS.indexOf('修理依頼日')] = r.orderDate || '';
  row[REPAIR_HEADERS.indexOf('原因')]       = r.cause;
  row[REPAIR_HEADERS.indexOf('対応区分')]   = r.action;
  row[REPAIR_HEADERS.indexOf('費用(税抜)')] = r.cost;
  row[REPAIR_HEADERS.indexOf('完了日')]     = r.doneDate || '';
  row[REPAIR_HEADERS.indexOf('備考')]       = r.note;
  row[REPAIR_HEADERS.indexOf('要確認')]     = r.flags.join(' / ');
  row[REPAIR_HEADERS.indexOf('更新日時')]   = now;
  row[REPAIR_HEADERS.indexOf('更新者')]     = user;
  return fillBlanks_(row, REPAIR_HEADERS.length);
}

// fillBlanks_ は sheets.js に定義。

// ===== レポート =====

/** メニュー「移行結果を確認（レポート）」 */
function showMigrationReport() {
  notify_('移行結果', formatMigrationReport_());
}

/**
 * 要確認列に印が付いた行を数え、内容を要約する。
 * 移行直後だけでなく、いつ実行しても現時点の「人が確認すべき件数」を返す。
 */
function formatMigrationReport_() {
  var lines = [];

  [{ name: SHEETS.devices, headers: DEVICE_HEADERS, label: '本体台帳' },
   { name: SHEETS.repairs, headers: REPAIR_HEADERS, label: '修理案件' },
   { name: SHEETS.earIssue, headers: EAR_ISSUE_HEADERS, label: 'イヤホン支給' }
  ].forEach(function (spec) {
    var data = readSheet_(spec.name);
    if (!data || data.length < 2) {
      lines.push('【' + spec.label + '】データなし');
      return;
    }
    var idx = headerIndex_(data[0], { flag: '要確認' }, spec.name);
    var reasons = {};
    var flagged = 0;
    for (var r = 1; r < data.length; r++) {
      var v = toStr(data[r][idx.flag]);
      if (v === '') continue;
      flagged++;
      v.split(' / ').forEach(function (one) {
        // 「（原文: ...）」の部分は行ごとに違うのでまとめて数えるために落とす
        var key = one.replace(/（.*?）/g, '（…）');
        reasons[key] = (reasons[key] || 0) + 1;
      });
    }
    lines.push('【' + spec.label + '】' + (data.length - 1) + '件中 ' + flagged + '件が要確認');
    Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; })
      .forEach(function (k) { lines.push('  ・' + k + '（' + reasons[k] + '件）'); });
  });

  return lines.join('\n');
}

function formatMigrationSummary_(stats) {
  if (!stats) return '移行は実行されませんでした。';
  var lines = [
    '本体台帳: ' + stats.devices + '件（うち中継器 ' + stats.repeaters + '件）',
    '修理案件: ' + stats.repairs + '件',
    'イヤホン在庫: ' + stats.earStock + '件 / イヤホン支給: ' + stats.earIssue + '件',
    '',
    '借用側の重複行として取り込まなかった行: ' + stats.skippedBorrowRows + '件',
    '要確認: 機器 ' + stats.flaggedDevices + '件 / 修理案件 ' + stats.flaggedRepairs +
      '件 / イヤホン支給 ' + stats.flaggedEarIssue + '件'
  ];
  if (stats.notes.length) lines.push('', '注意:', stats.notes.join('\n'));
  lines.push('', '※ 移行元のシートは1セルも変更していません。',
             '※ 内訳はメニュー「移行結果を確認（レポート）」で見られます。');
  return lines.join('\n');
}

// ===== 小さなヘルパー =====

/** 条件に合う最初の行のindexを返す。無ければ -1 */
function findRowIndex_(data, predicate) {
  for (var r = 0; r < data.length; r++) {
    if (predicate(data[r])) return r;
  }
  return -1;
}

/** 行のどこかに指定の文字列そのもののセルがあるか */
function rowHasText_(row, text) {
  for (var i = 0; i < row.length; i++) {
    if (toStr(row[i]) === text) return true;
  }
  return false;
}

function isBlankRow_(row) {
  for (var i = 0; i < row.length; i++) {
    if (toStr(row[i]) !== '') return false;
  }
  return true;
}

/** 見出し行から「ラベル → 列index」のマップを作る（先に出てきた方を優先） */
function labelColumns_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var label = toStr(headerRow[i]);
    if (label !== '' && !map.hasOwnProperty(label)) map[label] = i;
  }
  return map;
}

/** 候補のラベルを順に試して、最初に見つかった列indexを返す。無ければ -1 */
function pickCol_(map, labels) {
  for (var i = 0; i < labels.length; i++) {
    if (map.hasOwnProperty(labels[i])) return map[labels[i]];
  }
  return -1;
}

/** 行から指定indexの値を文字列で取り出す。index が -1 なら空文字 */
function cell_(row, index) {
  if (index < 0 || index >= row.length) return '';
  return toStr(row[index]);
}

// joinNote_ は sheets.js に定義。
