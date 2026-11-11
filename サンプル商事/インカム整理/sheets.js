/**
 * スプレッドシート入出力の共通ヘルパー
 * ------------------------------------------------------------------
 * 速度の方針（重要）:
 *   前回のアプリ化が「重すぎて開かない」で頓挫しているため、
 *   シートアクセスは必ず「1シート＝1回の getValues()」に揃える。
 *   ループの中で getValue() / setValue() / appendRow() を呼ばない。
 *   同じ実行内で同じシートを何度も読まないよう readSheet_ が結果を覚える。
 *
 *   CacheService（実行をまたぐキャッシュ）はあえて使っていない。
 *   台帳は全院で100行程度しかなく1回の読み取りが十分速い一方、
 *   キャッシュを挟むと「他の人が今さっき更新した状態が見えない」という
 *   在庫系で最も避けたい不具合を招くため、正確さを優先している。
 */

// 実行内キャッシュ。シート名 → 二次元配列。書き込み時は invalidateCache_ で捨てる。
var _sheetCache = {};

/**
 * このアプリが使うスプレッドシートを返す。
 * このプロジェクトはスタンドアロン（スプレッドシートに紐付いていない独立プロジェクト）
 * なので、getActiveSpreadsheet() は使えない（Webアプリ・トリガー実行時は常に null）。
 * 優先順位: スクリプトプロパティ SPREADSHEET_ID → config.js の既定値。
 * どちらも無い場合だけ getActiveSpreadsheet() を試す（Apps Scriptエディタで
 * 直接この関数を実行したときの保険）。
 */
function getSS_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') ||
    DEFAULT_SPREADSHEET_ID;
  if (id) return SpreadsheetApp.openById(id);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error(
      'スプレッドシートに接続できません。config.js の DEFAULT_SPREADSHEET_ID、' +
      'またはスクリプトプロパティ SPREADSHEET_ID に「全院インカム管理」のIDを設定してください。');
  }
  return ss;
}

/**
 * シートを取得する。無ければ null。
 * @param {string} name
 * @return {Sheet|null}
 */
function getSheet_(name) {
  return getSS_().getSheetByName(name);
}

/**
 * シートを取得する。無ければ、作り方を案内する例外を投げる。
 * @param {string} name
 * @return {Sheet}
 */
function getSheetOrThrow_(name) {
  var sheet = getSheet_(name);
  if (!sheet) {
    throw new Error('「' + name + '」シートが見つかりません。スプレッドシートのメニュー ' +
      '「インカム管理ツール → ① 管理シートを作成」を先に実行してください。');
  }
  return sheet;
}

/**
 * シート全体を二次元配列で読む（ヘッダー行を含む）。
 * 同じ実行内で2回目以降は読み直さない。
 * @param {string} name シート名
 * @return {Array<Array>|null} シートが無い、または空なら null
 */
function readSheet_(name) {
  if (_sheetCache.hasOwnProperty(name)) return _sheetCache[name];

  var sheet = getSheet_(name);
  var values = null;
  if (sheet) {
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow >= 1 && lastCol >= 1) {
      values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    }
  }
  _sheetCache[name] = values;
  return values;
}

/** 書き込み後にキャッシュを捨てる。省略すると同一実行内で古い値を読んでしまう。 */
function invalidateCache_(name) {
  if (name) delete _sheetCache[name];
  else _sheetCache = {};
}

/**
 * ヘッダー行から「列名 → 0始まりのindex」のマップを作る。
 * 期待する列が無ければ、どのシートのどの列かが分かる例外を投げる
 * （列を1つ消しただけで意味不明なエラーになるのを防ぐ）。
 * @param {Array} headerRow ヘッダー行
 * @param {Object<string,string>} spec {キー: 列名} の対応
 * @param {string} sheetName エラーメッセージ用
 * @return {Object<string,number>}
 */
function headerIndex_(headerRow, spec, sheetName) {
  var pos = {};
  for (var i = 0; i < headerRow.length; i++) {
    pos[toStr(headerRow[i])] = i;
  }
  var idx = {};
  Object.keys(spec).forEach(function (key) {
    var label = spec[key];
    if (!pos.hasOwnProperty(label)) {
      throw new Error('「' + sheetName + '」シートに列「' + label + '」が見つかりません。' +
        'ヘッダー行を編集していないかご確認ください。');
    }
    idx[key] = pos[label];
  });
  return idx;
}

/**
 * 指定シートの次のIDを採番する（例: INC-0001）。
 * 既存の最大連番＋1を返す。行を削除しても番号が使い回されないよう、
 * 「行数＋1」ではなく既存IDの最大値から求める。
 * @param {Array<Array>} data シート全体の値（ヘッダー含む）。null可
 * @param {number} idCol ID列のindex（0始まり）
 * @param {string} prefix 'INC-' など
 * @return {string}
 */
function nextId_(data, idCol, prefix) {
  var max = 0;
  if (data) {
    for (var r = 1; r < data.length; r++) {
      var id = toStr(data[r][idCol]);
      if (id.indexOf(prefix) !== 0) continue;
      var n = parseInt(id.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return prefix + padLeft_(max + 1, 4);
}

function padLeft_(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

// ===== 値の正規化 =====

/** null/undefined を空文字にし、前後の空白を落とす */
function toStr(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

/**
 * シリアルナンバーを突き合わせ用に正規化する。
 * 現行データには「SN00005　B」（全角スペース）「SN00006B」「SN00007 B」が混在し、
 * 同じ機体が別物に見えてしまうため、空白を全部落として大文字に揃える。
 * 「シリアルナンバー消えてる」「不明」など実体のない値は空文字を返す。
 * @param {*} v
 * @return {string} 正規化済みシリアル。不明なら ''
 */
function normalizeSerial_(v) {
  var s = toStr(v);
  if (s === '') return '';
  if (/消えて|不明|なし|無し/.test(s)) return '';
  return s.replace(/[\s　]/g, '').toUpperCase();
}

/**
 * シリアルを突き合わせるためのキー。
 * 台帳側は「SN00008 B」、修理履歴側は「SN00008」のように末尾のBの有無が揺れており、
 * さらに「MOO4585B」のように数字の0を英字Oで書いた表記も混ざっている。
 * 比較のときだけこれらを吸収する（保存する値そのものは原文どおり残す）。
 * @param {*} v
 * @return {string}
 */
function serialMatchKey_(v) {
  var s = normalizeSerial_(v);
  if (s === '') return '';
  // 先頭の「M」に続く英字Oを数字0として読み替える
  s = s.replace(/^M[O0]+/, function (head) { return 'M' + head.slice(1).replace(/O/g, '0'); });
  return s.replace(/B$/, '');
}

/** 疎な配列を空文字で埋める（setValues は穴あきの配列を受け付けないため） */
function fillBlanks_(row, length) {
  for (var i = 0; i < length; i++) {
    if (row[i] === undefined || row[i] === null) row[i] = '';
  }
  return row;
}

/** 備考を安全に連結する（どちらかが空でも余計な区切り文字を作らない） */
function joinNote_(a, b) {
  a = toStr(a); b = toStr(b);
  if (a === '') return b;
  if (b === '') return a;
  return a + ' / ' + b;
}

/**
 * 日付らしき値を Date にする。確実に日付と言えない場合は null。
 *
 * 現行シートの購入日には「2019年3月以前」「2015.8月頃」「2021/8/17より以前」
 * のような概算表記が大量にあり、これを具体的な日付として保存すると
 * 保証期限の計算などで嘘の結果を出してしまう。年月日が揃っていて、かつ
 * 概算を示す語（以前・頃・より・約・不明・〜）を含まない場合だけ Date にする。
 * 元の表記は呼び出し側で別列（購入日表記など）にそのまま残す。
 * @param {*} v
 * @return {Date|null}
 */
function parseDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;

  var s = toStr(v);
  if (s === '') return null;
  // 概算・不明を示す表記が入っていたら日付として扱わない
  if (/以前|以降|頃|ごろ|より|約|不明|未定|期限切れ|[~〜]/.test(s)) return null;

  var m = s.match(/(\d{4})\s*[年\/\.\-]\s*(\d{1,2})\s*[月\/\.\-]\s*(\d{1,2})/);
  if (!m) return null;

  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  var date = new Date(y, mo - 1, d);
  // 2月30日のような存在しない日付は Date が繰り上げるので弾く
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** その日の0時ちょうどの Date を返す（日数差の計算で時刻の影響を消すため） */
function startOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * 2つの日付の差を日数で返す（to - from）。
 * @param {Date} from
 * @param {Date} to
 * @return {number}
 */
function daysBetween_(from, to) {
  return Math.round((startOfDay_(to).getTime() - startOfDay_(from).getTime()) / 86400000);
}

/** Date を 'yyyy/MM/dd' の文字列にする。Dateでなければ空文字。画面表示用。 */
function formatDate_(v) {
  if (!(v instanceof Date) || isNaN(v.getTime())) return '';
  return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM/dd');
}

/** Date を 'yyyy/MM/dd HH:mm' にする。履歴ログの表示用。 */
function formatDateTime_(v) {
  if (!(v instanceof Date) || isNaN(v.getTime())) return '';
  return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

// ===== 書き込み =====

/**
 * 書き込み処理を排他ロックで包む。
 * 複数の医院が同時に故障報告を送ると、採番の重複や上書きが起きるため必須。
 * @param {function():*} fn
 * @return {*} fn の戻り値
 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * シート末尾に複数行をまとめて追記する（appendRow のループより格段に速い）。
 * @param {string} sheetName
 * @param {Array<Array>} rows
 */
function appendRows_(sheetName, rows) {
  if (!rows || !rows.length) return;
  var sheet = getSheetOrThrow_(sheetName);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  invalidateCache_(sheetName);
}

/**
 * 1行分の値をまとめて書き戻す。
 * @param {string} sheetName
 * @param {number} rowNumber シート上の行番号（1始まり）
 * @param {Array} rowValues 行全体の値
 */
function writeRow_(sheetName, rowNumber, rowValues) {
  var sheet = getSheetOrThrow_(sheetName);
  sheet.getRange(rowNumber, 1, 1, rowValues.length).setValues([rowValues]);
  invalidateCache_(sheetName);
}

/**
 * 操作しているユーザーのメールアドレスを返す。取得できなければ '不明'。
 * ウェブアプリの実行者設定やアクセス範囲によっては空になることがあるため、
 * 取得できない前提で呼び出し側は扱う（履歴ログの記録用）。
 */
function currentUser_() {
  try {
    return Session.getActiveUser().getEmail() || '不明';
  } catch (e) {
    return '不明';
  }
}

/** 医院コードを検証する。不正なら例外。 */
function assertClinic_(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院コードです: ' + clinic);
  return clinic;
}
