/**
 * 棚卸しスプレッドシート 医院別分割 ＋ 管理方式列追加ロジック
 * ------------------------------------------------------------------
 * 目的（今日やること①②）:
 *   ① 既存のカテゴリ別シート（医院が横並び）を、医院ごとの縦型シートへ分割・集約する
 *   ② 各医院シートに「管理方式（数量管理／発注トリガー管理）」等の記入列を追加し、
 *      管理方式にプルダウン（入力規則）を設定する
 *
 * 安全設計:
 *   - 元のカテゴリシート（診療室・バー・薬・ＤＨ 等）は読み取りのみ。一切変更しない。
 *   - 出力は「NIS_在庫」等の新規シート。既存の同名出力シートがあれば削除して作り直す。
 *
 * 実行方法:
 *   clasp push 後、スプレッドシートを開き直すと「棚卸しツール」メニューが出る。
 *   「① 医院別シートを生成（管理方式列つき）」を選択して実行。
 *   （初回はGASの認可ダイアログが出るので許可してください）
 *
 * 注意:
 *   医院横並び分割の対象は、医院（NIS/MDC/KDC/PV）が横並びになっている4シートのみ。
 *   全医院共通在庫／各項目合計 はレイアウトが異なるため自動分割の対象外（元シートのまま残る）。
 *   「オペ関連(ＰＶ)」「ハンドピース」「訪問部」は上記4シートとレイアウトが異なるため、
 *   専用ロジック（collectOpeRelatedRows / collectHandpieceRows_ / collectHoumonRows_）で個別に取り込む。
 *   「ハンドピース」は他シートと異なり、管理方式・発注基準数が医院ごとに記入済みの
 *   状態でシートに入っているため、スタッフ記入欄として空欄にせず、その値をそのまま
 *   各医院シートへ転記する（「取り扱いなし」の行も除外せずそのまま反映する）。
 *   「訪問部」は独立した5番目の医院（拠点）として扱い、他医院と品名・メーカーが完全一致
 *   する商品は既存商品と統合する（詳細はcollectHoumonRows_のコメントと要件定義書18.5参照）。
 */

// ===== 設定 =====

// 医院コード（アプリ全体で使う医院一覧。②商品マスタ生成やWeb画面はこちらを使う）
var CLINICS = ['NIS', 'MDC', 'KDC', 'PV', '訪問部'];

// 医院横並び4シート（診療室・バー・薬・ＤＨ）専用の医院コード。
// 「① 医院別シートを生成」と「削除した資材を復旧」は、この4医院の分だけを対象にする
// （既にスタッフが管理方式を記入済みのため、再実行で上書きされないよう「訪問部」を含めない。
//   訪問部は addHoumonSheet という完全に独立した安全な追加専用の仕組みで取り込む）。
var LEGACY_CLINICS = ['NIS', 'MDC', 'KDC', 'PV'];

// 出力シート名のプレフィックス（この文字列で始まるシートを「出力シート」とみなす）
var OUTPUT_SUFFIX = '_在庫';

// 管理方式プルダウンの選択肢
var KANRI_HOSHIKI = ['数量管理', '発注トリガー管理'];

// 管理方式列の入力規則で許可する値（プルダウンの選択肢）。
// 「取り扱いなし」も正式な状態として選べるようにする（行削除せず最下部に残す方針のため）。
// これを含めておかないと、setValuesで「取り扱いなし」を書き込む際に入力規則に弾かれて
// 例外（「数量管理 または 発注トリガー管理 を選択してください」）になる。
var KANRI_DROPDOWN = ['数量管理', '発注トリガー管理', '取り扱いなし'];

/**
 * 管理方式列に3択（数量管理／発注トリガー管理／取り扱いなし）の入力規則を設定する。
 * 生成時・復旧時・Webツール保存時に共通で使う。既存シートの2択規則を上書きして貼り直すため、
 * 「取り扱いなし」の書き込みが弾かれなくなる。
 * @param {Sheet} sheet
 * @param {number} modeCol0 管理方式列のインデックス（0始まり）
 * @param {number} numDataRows データ行数（ヘッダー除く）
 */
function applyKanriValidation_(sheet, modeCol0, numDataRows) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(KANRI_DROPDOWN, true)
    .setAllowInvalid(false)
    .setHelpText('数量管理／発注トリガー管理／取り扱いなし から選択してください')
    .build();
  var rows = Math.max(numDataRows, 1) + 50; // 追記用に余裕を持たせる
  sheet.getRange(2, modeCol0 + 1, rows, 1).setDataValidation(rule);
}

// 出力シートのヘッダー（この順で各医院シートに書き出す）
var OUT_HEADERS = [
  'カテゴリ', '発注先', 'メーカー', '品名',
  '税抜価格', '税込価格', '現在庫数', '備考', '賞味期限',
  '管理方式', '発注基準数', '発注トリガー条件'
];
// 記入列（スタッフが埋める空欄列）のインデックス（0始まり）
var COL_KANRI   = 9;  // 管理方式
var COL_KIJUN   = 10; // 発注基準数
var COL_TRIGGER = 11; // 発注トリガー条件

/**
 * 分割対象シートの構造定義。
 * 実ファイル「全院共通棚卸し のコピー.xlsx」を精査して確定した列位置（1始まり）。
 *   headerRow : 列見出しの行
 *   dataStart : データ開始行
 *   common    : 全医院共通の列 { supplier=発注先, maker=メーカー, name=品名, priceExTax=税抜 }
 *               （存在しない項目は null）
 *   blocks    : 医院ごとの列 { qty=個数, priceIncTax=税込, note=備考, expiry=賞味期限 }
 */
var SOURCE_CONFIG = {
  '診療室': {
    headerRow: 2, dataStart: 3,
    common: { supplier: null, maker: 1, name: 2, priceExTax: 3 },
    blocks: {
      NIS: { qty: 4,  priceIncTax: 6,  note: 7,  expiry: 8  },
      MDC: { qty: 10, priceIncTax: 11, note: 12, expiry: 13 },
      KDC: { qty: 15, priceIncTax: 16, note: 17, expiry: 18 },
      PV:  { qty: 20, priceIncTax: 21, note: 22, expiry: 23 }
    }
  },
  'バー': {
    headerRow: 2, dataStart: 3,
    common: { supplier: null, maker: 1, name: 2, priceExTax: 3 },
    blocks: {
      NIS: { qty: 4,  priceIncTax: 5,  note: 6,  expiry: 7  },
      MDC: { qty: 9,  priceIncTax: 10, note: 11, expiry: 12 },
      KDC: { qty: 14, priceIncTax: 15, note: 16, expiry: 17 },
      PV:  { qty: 19, priceIncTax: 20, note: 21, expiry: 22 }
    }
  },
  '薬': {
    headerRow: 3, dataStart: 4,
    common: { supplier: 1, maker: 3, name: 2, priceExTax: 4 },
    blocks: {
      NIS: { qty: 5,  priceIncTax: 6,  note: 7,  expiry: 8  },
      MDC: { qty: 10, priceIncTax: 11, note: 12, expiry: 13 },
      KDC: { qty: 15, priceIncTax: 16, note: 17, expiry: 18 },
      PV:  { qty: 20, priceIncTax: 21, note: 22, expiry: 23 }
    }
  },
  'ＤＨ': {
    headerRow: 3, dataStart: 4,
    common: { supplier: null, maker: 1, name: 2, priceExTax: 3 },
    blocks: {
      NIS: { qty: 4,  priceIncTax: 5,  note: 6,  expiry: 7  },
      MDC: { qty: 9,  priceIncTax: 10, note: 11, expiry: 12 },
      KDC: { qty: 14, priceIncTax: 15, note: 16, expiry: 17 },
      PV:  { qty: 19, priceIncTax: 20, note: 21, expiry: 22 }
    }
  }
};

// カテゴリシートを処理する順番（出力の並び順）
var SOURCE_ORDER = ['診療室', 'バー', '薬', 'ＤＨ'];

/**
 * 「オペ関連(ＰＶ)」シートの設定。
 * 他4シートと異なり医院横並びではなく、PV単独・時系列（四半期スナップショット）の構造。
 *   A=メーカー, B=規格（任意）, C=品名, D〜N=時系列在庫数（11時点）,
 *   O=定価（税込み）, P=購入価格（40%off）, Q=総額, R=使用期限
 * 現在庫数は、各行ごとに D〜N を右（最新時点）から見て最初に値が入っている列を採用する
 * （最新の 2026.8 列は未記入＝次回集計欄のため、実データとしては使えない）。
 *
 * 価格の採用ルール（2026-08-22 ヒアリングで確定）:
 *   P列「購入価格（40%off）」に値が入っていればその金額を、空欄なら O列「定価（税込み）」を
 *   その資材の金額として採用する。実際に医院が支払っている仕入れ値を資産評価に使うため。
 *   どちらも税込金額（購入価格＝定価×0.6 で実データが一致することを確認済み）。
 */
var OPE_PV_CONFIG = {
  sheetName: 'オペ関連(ＰＶ)',
  headerRow: 1, dataStart: 2,
  colMaker: 1, colSpec: 2, colName: 3,
  colStockFirst: 4, colStockLast: 14, // D(4) 〜 N(14)
  colPriceIncTax: 15,      // O 定価（税込み）
  colPurchasePrice: 16,    // P 購入価格（40%off）。入っていればこちらを優先する
  colExpiry: 18            // R 使用期限
};

/**
 * オペ関連(ＰＶ)シートの1行から、その資材の金額（税込）を取り出す。
 * 購入価格が入っていればそれを、無ければ定価を返す（どちらも空なら ''）。
 * @param {Array} row シートから読んだ1行分の値
 * @return {(number|string)} 金額、または '' （未設定）
 */
function opePriceOf_(row) {
  var purchase = cell(row, OPE_PV_CONFIG.colPurchasePrice);
  if (toStr(purchase) !== '') return purchase;
  return cell(row, OPE_PV_CONFIG.colPriceIncTax);
}

/**
 * 「ハンドピース」シートの設定。
 * 他4シートと異なり、医院ごとの「管理方式」「発注基準数」が既に記入済みの横並び構造。
 *   A=メーカー, B=品名,
 *   C,D=NIS(管理方式,発注基準数), E,F=MDC, G,H=KDC, I,J=PV
 */
var HANDPIECE_CONFIG = {
  sheetName: 'ハンドピース',
  headerRow: 2, dataStart: 3,
  colMaker: 1, colName: 2,
  blocks: {
    NIS: { mode: 3,  kijun: 4  },
    MDC: { mode: 5,  kijun: 6  },
    KDC: { mode: 7,  kijun: 8  },
    PV:  { mode: 9,  kijun: 10 }
  }
};

/**
 * 「訪問部」シートの設定。
 * 他4シートと異なり医院横並びではなく、訪問部単独の縦型構造（項目/メーカー/品名/
 * 税抜価格/残個数/税込価格/在庫最大個数/ラストいくつで発注か/発注数量/備考）。
 *   在庫最大個数（G列）は取り込まない（ヒアリングにより無視すると確定済み）。
 *   「ラストいくつで発注か」（H列）は自由記述が大半のため、発注トリガー条件として
 *   そのまま転記し、管理方式の既定値は「発注トリガー管理」とする（第18.5参照）。
 */
var HOUMON_CONFIG = {
  sheetName: '訪問部',
  dataStart: 8,
  colMaker: 2, colName: 3, colPriceExTax: 4, colStock: 5, colPriceIncTax: 6,
  colKijun: 8,  // ラストいくつで発注か → 発注トリガー条件へ転記
  colNote: 10
};

// 「その医院では取り扱いなし」と判定する備考キーワード。
// 実データの表記揺れ（取扱無し／取り扱い無し／PV取扱無し／取り扱いなし 等）を
// すべて拾えるよう、この文字列を含む備考の行は該当医院シートから除外する。
var NOT_HANDLED_KEYWORDS = ['取扱', '取り扱'];


// ===== メニュー =====

/**
 * スプレッドシートを開いたときのメニュー。
 *
 * 日常の操作はすべてWebアプリ側で行うため、ここに出すのはバックアップだけにしている。
 *
 * ▼ かつてここにあった「棚卸しツール」「データ取り込み」メニューは、
 *   2026-08-22に本番データが揃った時点で外した（セットアップ用の使い切りのため）。
 *   一度きりの作業なのに毎日目に入る場所へ置いておくと、押し間違いで
 *   本番データを壊す事故につながる。特に①②は医院別シート・商品マスタを
 *   作り直すため、スタッフの記入内容や印刷済みQRの商品IDが失われる。
 *
 *   関数そのものは各ファイルに残してある。もう一度どうしても必要になったときは、
 *   Apps Scriptエディタで関数を選んで実行する（＝開発者が意図しないと動かせない）。
 *
 *     generateClinicSheets          … ① 医院別シートを生成            （migration.js）
 *     checkHoumonStatus             … 訪問部の状態を調べる（下見）      （houmon.js）
 *     addHoumonSheet                … 訪問部_在庫を作る（管理方式設定用）（migration.js）
 *     previewHoumonDeploy           … 上の下見（書き込みなし）          （houmon.js）
 *     deployHoumonToOperations      … 訪問部を運用データへ載せる        （houmon.js）
 *     generateMasterAndInventory    … ② 商品マスタ・医院別在庫を生成    （master.js）
 *     recoverRemovedItems           … 削除した資材を復旧                （migration.js）
 *     importPriceExTaxToMaster      … 商品マスタに税抜価格を取り込む    （masterprice.js）
 *     importOpePriceToMaster        … オペ関連の金額を取り込む          （opeprice.js）
 *     previewExpiryImport           … 上の下見（書き込みなし）          （expiryimport.js）
 *     importExpiryFromClinicSheets  … 使用期限を取り込む                （expiryimport.js）
 *     resetStockForClinics          … 在庫数をリセットする              （stockreset.js）
 *     previewMakerIntoSupplier      … 上の下見（書き込みなし）          （suppliermerge.js）
 *     mergeMakerIntoSupplier        … メーカー列を発注先へ統合          （suppliermerge.js）
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();

  ui.createMenu('バックアップ')
    .addItem('今すぐバックアップを取る', 'backupNow')
    .addItem('バックアップの状態を確認', 'showBackupStatus')
    .addSeparator()
    .addItem('毎日の自動バックアップを有効にする', 'setupDailyBackup')
    .addItem('自動バックアップを停止する', 'disableDailyBackup')
    .addToUi();
}

/**
 * 使い切りツール（上のリストの関数）の実行結果を知らせる。
 *
 * Apps Script エディタから関数を直接実行すると SpreadsheetApp.getUi() が
 * 「Cannot call SpreadsheetApp.getUi() from this context.」で落ちるため、
 * 結果は必ず実行ログに出し、ダイアログは「出せたら出す」扱いにする。
 * こうしておけば、スプレッドシート経由でもエディタ経由でも同じ関数が動く。
 *
 * @param {string} title 見出し
 * @param {string} body  本文
 */
function maintenanceReport_(title, body) {
  var text = title + '\n' + body;
  Logger.log(text);
  try { console.log(text); } catch (e) { /* console が無い環境は無視 */ }
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert(title, body, ui.ButtonSet.OK);
  } catch (e) {
    /* エディタ実行などUIが使えない場面：実行ログだけで完了 */
  }
}


// ===== メイン処理 =====

/**
 * 医院ごとの縦型シートを生成する。
 * 元のカテゴリシートは変更せず、LEGACY_CLINICS（NIS/MDC/KDC/PV）の数だけ出力シートを作る。
 *
 * ⚠ 安全上の注意：この関数は対象医院シート（NIS_在庫 等）を毎回削除して作り直す。
 *   スタッフが既に管理方式を記入済みの状態で再実行すると、その入力内容が失われる
 *   （2026-07-31に発生した事故と同種の被害が再発する）。新しいカテゴリ・医院を追加する場合は、
 *   この関数を再実行するのではなく、collectHandpieceRows_ / addHoumonSheet のような
 *   「追加専用」の非破壊な仕組みを別途用意すること。
 *   「訪問部」（5番目の医院）は意図的にこの関数の対象外にしている。訪問部の取り込みは
 *   addHoumonSheet（このファイル内）で行う。こちらはNIS/MDC/KDC/PVの
 *   シートには一切触れない、独立した安全な処理。
 */
function generateClinicSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  // 対象シートの存在チェック（推測で処理せず、無ければ止める）
  var missing = [];
  SOURCE_ORDER.forEach(function (n) {
    if (!ss.getSheetByName(n)) missing.push(n);
  });
  if (missing.length) {
    ui.alert('次のシートが見つかりません:\n' + missing.join(' , ') +
             '\n\nシート名が想定と異なる可能性があります。処理を中止しました。');
    return;
  }

  // 安全ガード：この関数は医院別シートを削除して作り直すため、スタッフが記入済みの
  // 管理方式・発注基準数・発注トリガー条件は全て失われる（2026-07-31に発生した事故と同種）。
  // 記入済みの内容がある場合は、無確認では絶対に実行させない。
  var entered = countEnteredClinicRows_(ss);
  if (entered.total > 0) {
    var proceed = ui.alert(
      '⚠ 記入済みのデータが消えます',
      '既存の医院別シートに、スタッフが記入した内容が見つかりました。\n\n' + entered.detail +
      '\n\nこの処理はシートを削除して作り直すため、上記の記入内容は全て失われ、元に戻せません。\n' +
      '（2026-07-31に同種のデータ消失が発生しています）\n\n' +
      '実行する前に必ず「ファイル → コピーを作成」でバックアップを取ってください。\n\n' +
      '本当に作り直しますか？',
      ui.ButtonSet.YES_NO
    );
    if (proceed !== ui.Button.YES) {
      ui.alert('中止しました。医院別シートは変更していません。');
      return;
    }
    // 二段階確認：件数を手入力させ、勢いで「はい」を押しただけの誤操作を弾く。
    var typed = ui.prompt(
      '最終確認',
      '失われる記入件数「' + entered.total + '」を半角数字で入力すると実行します。\n' +
      '（中止する場合はキャンセル）',
      ui.ButtonSet.OK_CANCEL
    );
    if (typed.getSelectedButton() !== ui.Button.OK ||
        String(typed.getResponseText()).trim() !== String(entered.total)) {
      ui.alert('中止しました。医院別シートは変更していません。');
      return;
    }
  }

  // 各医院の行を集める: { NIS: [ [row...], ... ], MDC: [...], ... }
  var collected = {};
  var excluded = {}; // 取り扱いなしで除外した件数
  LEGACY_CLINICS.forEach(function (c) { collected[c] = []; excluded[c] = 0; });

  SOURCE_ORDER.forEach(function (sheetName) {
    var cfg = SOURCE_CONFIG[sheetName];
    var sheet = ss.getSheetByName(sheetName);
    var lastRow = sheet.getLastRow();
    if (lastRow < cfg.dataStart) return;

    var lastCol = sheet.getLastColumn();
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues(); // 0始まり配列

    for (var r = cfg.dataStart - 1; r < values.length; r++) {
      var row = values[r];
      var name = cellStr(row, cfg.common.name);
      if (name === '') continue; // 品名が無い行はスキップ

      var maker      = cell(row, cfg.common.maker);
      var supplier   = cell(row, cfg.common.supplier);
      var priceExTax = cell(row, cfg.common.priceExTax);

      LEGACY_CLINICS.forEach(function (clinic) {
        var b = cfg.blocks[clinic];
        if (!b) return;
        // その医院の備考が「取り扱いなし」なら、この医院シートからは省く
        if (isNotHandled(cellStr(row, b.note))) { excluded[clinic]++; return; }
        var outRow = [
          sheetName,               // カテゴリ
          supplier,                // 発注先
          maker,                   // メーカー
          name,                    // 品名
          priceExTax,              // 税抜価格
          cell(row, b.priceIncTax),// 税込価格
          cell(row, b.qty),        // 現在庫数（その医院の個数）
          cell(row, b.note),       // 備考
          cell(row, b.expiry),     // 賞味期限
          '',                      // 管理方式（スタッフ記入・プルダウン）
          '',                      // 発注基準数（スタッフ記入）
          ''                       // 発注トリガー条件（スタッフ記入）
        ];
        collected[clinic].push(outRow);
      });
    }
  });

  // 「オペ関連(ＰＶ)」（PV単独・時系列シート）をPVへ追加で取り込む
  var opeResult = collectOpeRelatedRows(ss);
  if (opeResult.rows.length) {
    collected.PV = collected.PV.concat(opeResult.rows);
  }

  // 「ハンドピース」（管理方式・発注基準数が記入済みの横並びシート）を各医院へ追加で取り込む
  var handpieceResult = collectHandpieceRows_(ss);
  var handpieceCount = 0;
  LEGACY_CLINICS.forEach(function (clinic) {
    var rows = handpieceResult.rowsByClinic[clinic];
    collected[clinic] = collected[clinic].concat(rows);
    handpieceCount += rows.length;
  });

  // 医院ごとに出力シートを作成
  LEGACY_CLINICS.forEach(function (clinic) {
    writeClinicSheet(ss, clinic, collected[clinic]);
  });

  ui.alert('完了しました。\n\n' +
    LEGACY_CLINICS.map(function (c) {
      return '・' + c + OUTPUT_SUFFIX + '：' + collected[c].length + '件' +
             '（取扱なしで除外 ' + (excluded[c] || 0) + '件）';
    }).join('\n') +
    '\n\n' + (opeResult.found
      ? '「' + OPE_PV_CONFIG.sheetName + '」から ' + opeResult.rows.length + ' 件をPV_在庫へ追加しました。'
      : '「' + OPE_PV_CONFIG.sheetName + '」シートが見つからなかったため、その分の取り込みはスキップしました。') +
    '\n\n' + (handpieceResult.found
      ? '「' + HANDPIECE_CONFIG.sheetName + '」から ' + handpieceCount + ' 件を各医院シートへ追加しました' +
        '（管理方式・発注基準数は記入済みの値をそのまま反映、取り扱いなしも含む）。'
      : '「' + HANDPIECE_CONFIG.sheetName + '」シートが見つからなかったため、その分の取り込みはスキップしました。') +
    '\n\n各シートの「管理方式」列はプルダウンから選択できます。\n' +
    '「発注基準数」（数量管理商品のみ）は各医院スタッフにご記入いただく欄です。\n' +
    '「発注トリガー条件」は記入不要です（発注トリガー管理は、対象商品の前にQRを置いておくだけの運用のため）。\n\n' +
    '「訪問部」は対象外です（初回のみ・データ消失リスクのないメニュー「訪問部を追加で取り込む」から行ってください）。');
}

/**
 * 「訪問部」シートを読み、管理方式設定用の「訪問部_在庫」を作る（独立・非破壊）。
 * NIS_在庫／MDC_在庫／KDC_在庫／PV_在庫や元のカテゴリシートには一切触れず、
 * 「訪問部_在庫」と確認用の「訪問部_商品統合結果」の2シートだけを作り直す。
 * 何度でも安全に再実行できる（他医院のスタッフ入力データへの影響ゼロ）。
 *
 * これを実行すると、訪問部ホームの「管理方式を設定」画面に訪問部の資材が並び、
 * 資材ごとに管理方式・発注基準数を決められるようになる。
 * 決めたあと運用データ（商品マスタ・医院別在庫）へ載せるのは
 * houmon.js の deployHoumonToOperations。
 *
 * ※ 以前は addHoumonSheet_ という名前だった。末尾が「_」の関数は Apps Script エディタの
 *   実行対象プルダウンに出ないため、エディタから実行できなかった。名前から「_」を外している。
 */
function addHoumonSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var houmonResult = collectHoumonRows_(ss);
  if (!houmonResult.found) {
    maintenanceReport_('訪問部の取り込み',
      '「' + HOUMON_CONFIG.sheetName + '」シートが見つかりませんでした。処理を中止しました。');
    return;
  }

  writeClinicSheet(ss, HOUMON_CONFIG.sheetName, houmonResult.rows);
  writeSheet(ss, '訪問部_商品統合結果', ['品名', '発注先', '判定', '採用カテゴリ'], houmonResult.report);

  var matched = houmonResult.report.filter(function (r) { return r[2].indexOf('一致') === 0; }).length;
  var created = houmonResult.report.length - matched;

  maintenanceReport_('訪問部の取り込み', '完了しました。\n' +
    '・訪問部' + OUTPUT_SUFFIX + '：' + houmonResult.rows.length + '件\n' +
    '　（既存商品と一致 ' + matched + '件／新規登録 ' + created + '件）\n' +
    '内訳は「訪問部_商品統合結果」シートをご確認ください。\n\n' +
    '管理方式は既定で「発注トリガー管理」としています。\n' +
    '訪問部ホームの「管理方式を設定」画面から資材ごとに変更してください。\n' +
    '設定後、運用データへ載せるには deployHoumonToOperations（houmon.js）を実行します。\n\n' +
    '※ NIS/MDC/KDC/PVの医院別シートには一切触れていません。');
}

/**
 * 「オペ関連(ＰＶ)」シートを読み、PV_在庫の行フォーマットに変換して返す。
 * シートが見つからない場合は found:false を返す（他の処理は止めない＝非致命的）。
 */
function collectOpeRelatedRows(ss) {
  var cfg = OPE_PV_CONFIG;
  var sheet = ss.getSheetByName(cfg.sheetName);
  if (!sheet) return { found: false, rows: [] };

  var lastRow = sheet.getLastRow();
  if (lastRow < cfg.dataStart) return { found: true, rows: [] };

  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();

  var rows = [];
  for (var r = cfg.dataStart - 1; r < values.length; r++) {
    var row = values[r];
    var baseName = cellStr(row, cfg.colName);
    if (baseName === '') continue;

    var spec = cellStr(row, cfg.colSpec).replace(/\n/g, ' ');
    var name = spec ? baseName + '（' + spec + '）' : baseName;
    var maker = cell(row, cfg.colMaker);

    // 現在庫数：D〜N を右（最新時点）から見て最初に値が入っている列を採用
    var stock = '';
    for (var c = cfg.colStockLast; c >= cfg.colStockFirst; c--) {
      var v = cell(row, c);
      if (v !== '' && v !== null) { stock = v; break; }
    }

    rows.push([
      cfg.sheetName,             // カテゴリ
      '',                        // 発注先（このシートには無し）
      maker,                     // メーカー
      name,                      // 品名（規格があれば併記）
      '',                        // 税抜価格（このシートには無し）
      opePriceOf_(row),          // 税込価格（購入価格が入っていればそれ、無ければ定価）
      stock,                     // 現在庫数（直近の記入済み時点）
      '',                        // 備考
      cell(row, cfg.colExpiry),  // 賞味期限（使用期限）
      '',                        // 管理方式（スタッフ記入）
      '',                        // 発注基準数（スタッフ記入）
      ''                         // 発注トリガー条件（スタッフ記入）
    ]);
  }
  return { found: true, rows: rows };
}

/**
 * 「ハンドピース」シートを読み、医院ごとの出力行フォーマットに変換して返す。
 * このシートは他4シートと違い管理方式・発注基準数が既に記入済みのため、
 * スタッフ記入欄として空欄にせず、その値をそのまま転記する
 * （管理方式が「取り扱いなし」の行も除外せずそのまま反映する）。
 * シートが見つからない場合は found:false を返す（他の処理は止めない＝非致命的）。
 */
function collectHandpieceRows_(ss) {
  var cfg = HANDPIECE_CONFIG;
  var sheet = ss.getSheetByName(cfg.sheetName);

  var rowsByClinic = {};
  LEGACY_CLINICS.forEach(function (c) { rowsByClinic[c] = []; });
  if (!sheet) return { found: false, rowsByClinic: rowsByClinic };

  var lastRow = sheet.getLastRow();
  if (lastRow < cfg.dataStart) return { found: true, rowsByClinic: rowsByClinic };

  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();

  for (var r = cfg.dataStart - 1; r < values.length; r++) {
    var row = values[r];
    var name = cellStr(row, cfg.colName);
    if (name === '') continue;
    var maker = cell(row, cfg.colMaker);

    LEGACY_CLINICS.forEach(function (clinic) {
      var b = cfg.blocks[clinic];
      if (!b) return;
      var mode = cellStr(row, b.mode);
      if (mode === '') return; // 未記入の医院は対象外
      rowsByClinic[clinic].push([
        cfg.sheetName,       // カテゴリ
        '',                  // 発注先（このシートには無し）
        maker,                // メーカー
        name,                 // 品名
        '',                  // 税抜価格（このシートには無し）
        '',                  // 税込価格
        '',                  // 現在庫数（このシートには無し）
        '',                  // 備考
        '',                  // 賞味期限
        mode,                 // 管理方式（記入済みの値をそのまま転記）
        cell(row, b.kijun),   // 発注基準数（記入済みの値をそのまま転記）
        ''                   // 発注トリガー条件
      ]);
    });
  }
  return { found: true, rowsByClinic: rowsByClinic };
}

/**
 * 「訪問部」シートを読み、訪問部_在庫の出力行フォーマットに変換して返す。
 *
 * 商品の重複統合：他医院（診療室・バー・薬・ＤＨ・オペ関連(PV)・ハンドピース）に
 * 「メーカー＋品名」が完全一致する商品がある場合、その商品と同じ「カテゴリ」を
 * 割り当てる。②商品マスタ生成時のマッチングキーは「カテゴリ＋メーカー＋品名」の
 * ため、カテゴリを揃えることで自動的に同一商品として統合される（商品ID・QRを共有）。
 * 一致しない商品は、カテゴリ「訪問部」の新規商品として扱う。あいまい一致はしない
 * （表記揺れで一致しなかった場合は貴社にて確認のうえ手動で統合、第18.5参照）。
 *
 * 管理方式は、統合の有無に関わらず訪問部の医院別在庫としては既定で「発注トリガー管理」
 * とし、「ラストいくつで発注か」列の文言をそのまま発注トリガー条件へ転記する
 * （同じ商品でも医院ごとに管理方式が異なってよいという既存設計どおり。第9.3参照）。
 *
 * シート末尾の「合計」行・空行は品名が空のため自然にスキップされる。
 * シートが見つからない場合は found:false を返す（他の処理は止めない＝非致命的）。
 */
function collectHoumonRows_(ss) {
  var cfg = HOUMON_CONFIG;
  var sheet = ss.getSheetByName(cfg.sheetName);
  if (!sheet) return { found: false, rows: [], report: [] };

  var lastRow = sheet.getLastRow();
  if (lastRow < cfg.dataStart) return { found: true, rows: [], report: [] };

  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var categoryByNameMaker = buildCategoryLookup_(ss);

  var rows = [];
  var report = []; // 貴社確認用：品名・メーカー・判定（一致／新規）・採用カテゴリ
  for (var r = cfg.dataStart - 1; r < values.length; r++) {
    var row = values[r];
    var name = cellStr(row, cfg.colName);
    if (name === '') continue; // 品名の無い行（空行・合計行）はスキップ

    var maker = cell(row, cfg.colMaker);
    var lookupKey = normalizeKey('', maker, name); // カテゴリを含めないキーで既存商品を検索
    var existingCategory = categoryByNameMaker[lookupKey];
    var category = existingCategory || cfg.sheetName;

    rows.push([
      category,                     // カテゴリ（一致時は既存商品と同じにして自動統合）
      '',                           // 発注先（このシートには無し）
      maker,                        // メーカー
      name,                         // 品名
      cell(row, cfg.colPriceExTax), // 税抜価格
      cell(row, cfg.colPriceIncTax),// 税込価格
      cell(row, cfg.colStock),      // 現在庫数（参考値。発注トリガー管理のため②で「管理対象外」表示になる）
      cell(row, cfg.colNote),       // 備考
      '',                           // 賞味期限（このシートには無し）
      KANRI_HOSHIKI[1],             // 管理方式：既定は「発注トリガー管理」
      '',                           // 発注基準数（発注トリガー管理のため空欄）
      cellStr(row, cfg.colKijun)    // 発注トリガー条件（「ラストいくつで発注か」列の文言をそのまま）
    ]);
    report.push([name, maker, existingCategory ? '一致（商品を共有）' : '新規登録', category]);
  }
  return { found: true, rows: rows, report: report };
}

/**
 * 既存の医院横並びシート（診療室・バー・薬・ＤＨ）＋オペ関連(PV)＋ハンドピースから、
 * 「メーカー＋品名」→「カテゴリ」の対応表を作る（訪問部の商品統合判定に使う）。
 * カテゴリを含めないキーで引けるよう、値をそのままカテゴリ名として記録する。
 * 同じメーカー＋品名が複数シートにまたがって存在する場合は、最初に見つかったものを採用する。
 */
function buildCategoryLookup_(ss) {
  var lookup = {};
  function add(category, maker, name) {
    if (!name) return;
    var key = normalizeKey('', maker, name);
    if (!(key in lookup)) lookup[key] = category;
  }

  SOURCE_ORDER.forEach(function (sheetName) {
    var cfg = SOURCE_CONFIG[sheetName];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < cfg.dataStart) return;
    var lastCol = sheet.getLastColumn();
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    for (var r = cfg.dataStart - 1; r < values.length; r++) {
      var row = values[r];
      var name = cellStr(row, cfg.common.name);
      if (name === '') continue;
      add(sheetName, cell(row, cfg.common.maker), name);
    }
  });

  if (ss.getSheetByName(OPE_PV_CONFIG.sheetName)) {
    collectOpeRelatedRows(ss).rows.forEach(function (r) {
      add(r[0], r[2], r[3]); // OUT_HEADERS順: カテゴリ,発注先,メーカー,品名
    });
  }

  var hpSheet = ss.getSheetByName(HANDPIECE_CONFIG.sheetName);
  if (hpSheet) {
    var hpCfg = HANDPIECE_CONFIG;
    var hpLastRow = hpSheet.getLastRow();
    if (hpLastRow >= hpCfg.dataStart) {
      var hpValues = hpSheet.getRange(1, 1, hpLastRow, hpSheet.getLastColumn()).getValues();
      for (var i = hpCfg.dataStart - 1; i < hpValues.length; i++) {
        var hpRow = hpValues[i];
        var hpName = cellStr(hpRow, hpCfg.colName);
        if (hpName === '') continue;
        add(hpCfg.sheetName, cell(hpRow, hpCfg.colMaker), hpName);
      }
    }
  }

  return lookup;
}

/**
 * 既存の医院別シートに残っている「スタッフ記入分」の行数を数える。
 * 管理方式・発注基準数・発注トリガー条件のいずれかが埋まっている行を1件とみなす。
 * generateClinicSheets が作り直してよいかの判断に使う（訪問部は対象外＝再生成されないため）。
 */
function countEnteredClinicRows_(ss) {
  var lines = [];
  var total = 0;
  LEGACY_CLINICS.forEach(function (clinic) {
    var sheet = ss.getSheetByName(clinic + OUTPUT_SUFFIX);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var vals = sheet.getRange(2, 1, lastRow - 1, OUT_HEADERS.length).getValues();
    var n = 0;
    vals.forEach(function (row) {
      if (String(row[COL_KANRI] == null ? '' : row[COL_KANRI]).trim() !== '' ||
          String(row[COL_KIJUN] == null ? '' : row[COL_KIJUN]).trim() !== '' ||
          String(row[COL_TRIGGER] == null ? '' : row[COL_TRIGGER]).trim() !== '') n++;
    });
    if (n > 0) {
      lines.push('・' + clinic + OUTPUT_SUFFIX + '：' + n + '件');
      total += n;
    }
  });
  return { total: total, detail: lines.join('\n') };
}

/**
 * 1医院分の出力シートを作成（既存があれば作り直す）。
 */
function writeClinicSheet(ss, clinic, rows) {
  var sheetName = clinic + OUTPUT_SUFFIX;

  var old = ss.getSheetByName(sheetName);
  if (old) ss.deleteSheet(old);
  var sheet = ss.insertSheet(sheetName);

  // ヘッダー
  sheet.getRange(1, 1, 1, OUT_HEADERS.length)
       .setValues([OUT_HEADERS])
       .setFontWeight('bold')
       .setBackground('#e8eef7');

  // データ本体
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, OUT_HEADERS.length).setValues(rows);
  }

  var lastDataRow = Math.max(rows.length + 1, 2);

  // ② 管理方式列にプルダウン（入力規則）を設定（取り扱いなしも選択肢に含める）
  var ruleRows = Math.max(rows.length, 1) + 50;
  applyKanriValidation_(sheet, COL_KANRI, rows.length);

  // 記入してほしい列を色付け（薄い黄色）で目立たせる
  var fillCols = [COL_KANRI, COL_KIJUN, COL_TRIGGER];
  fillCols.forEach(function (ci) {
    sheet.getRange(2, ci + 1, ruleRows, 1).setBackground('#fff7e0');
  });

  // 見やすさ調整
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, OUT_HEADERS.length);
  // 品名は広めに固定
  sheet.setColumnWidth(4, 260);
}


// ===== 復旧処理 =====

/**
 * 過去に「取り扱いなし」で医院別シートから削除された資材を、元シートから割り出して復旧する。
 * 非破壊：現在の医院別シートの既存行（入力済みの管理方式・発注基準）には一切触れず、
 *   「元データにあるのに現在のシートに無い資材」だけを『取り扱いなし』として末尾に追記する。
 * 何度実行しても、既にシートにある資材は二重に追加しない（カテゴリ＋メーカー＋品名で照合）。
 * 備考が元々「取扱なし」の行は生成時と同じく対象外（＝正しく除外されたまま）。
 */
function recoverRemovedItems() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  // 元シート・出力シートの存在チェック
  var missing = [];
  SOURCE_ORDER.forEach(function (n) { if (!ss.getSheetByName(n)) missing.push(n); });
  LEGACY_CLINICS.forEach(function (c) {
    if (!ss.getSheetByName(c + OUTPUT_SUFFIX)) missing.push(c + OUTPUT_SUFFIX);
  });
  if (missing.length) {
    ui.alert('次のシートが見つかりません:\n' + missing.join(' , ') +
             '\n\n先に「① 医院別シートを生成」を実行してください。処理を中止しました。');
    return;
  }

  var ok = ui.alert('削除した資材の復旧',
    '過去に「取り扱いなし」で消えた資材を、元データから割り出して\n' +
    '各医院シートの末尾に「取り扱いなし」として戻します。\n' +
    '入力済みの管理方式・発注基準は変更しません。\n\n実行しますか？',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  // 1) 元シートから本来あるべき資材（備考=取扱なしは除外）を医院別に集める
  var sourceRows = {};
  LEGACY_CLINICS.forEach(function (c) { sourceRows[c] = []; });
  collectSourceRows(ss, sourceRows);

  // 2) 医院ごとに、現在のシートに無いもの（＝過去に削除した資材）だけを追記
  var restored = {};
  var total = 0;
  LEGACY_CLINICS.forEach(function (clinic) {
    var sheet = ss.getSheetByName(clinic + OUTPUT_SUFFIX);
    var existingKeys = readExistingKeys(sheet);

    var toAdd = [];
    var seen = {};
    sourceRows[clinic].forEach(function (row) {
      var name = cellStr(row, 4); // OUT_HEADERS: 1=カテゴリ,3=メーカー,4=品名
      if (name === '') return;
      var key = recoveryKey(cellStr(row, 1), cellStr(row, 3), name);
      if (existingKeys[key]) return; // 既にシートにある
      if (seen[key]) return;         // 元データ内の重複は1件だけ戻す
      seen[key] = true;
      var out = row.slice();               // コピーして取り扱いなしに設定
      out[COL_KANRI] = '取り扱いなし';
      out[COL_KIJUN] = '';
      out[COL_TRIGGER] = '';
      toAdd.push(out);
    });

    if (toAdd.length) {
      var start = sheet.getLastRow() + 1;
      // 既存シートの入力規則に「取り扱いなし」が無いと弾かれるため、3択の規則を貼り直す
      applyKanriValidation_(sheet, COL_KANRI, (start - 1) + toAdd.length);
      sheet.getRange(start, 1, toAdd.length, OUT_HEADERS.length).setValues(toAdd);
    }
    restored[clinic] = toAdd.length;
    total += toAdd.length;
  });

  ui.alert('復旧が完了しました。\n\n' +
    LEGACY_CLINICS.map(function (c) {
      return '・' + c + OUTPUT_SUFFIX + '：' + (restored[c] || 0) + ' 件を復旧';
    }).join('\n') +
    '\n\n合計 ' + total + ' 件を「取り扱いなし」として各シートの末尾に戻しました。\n' +
    '管理方式ツールで再読み込みすると、一覧の最下部に表示されます。');
}

/**
 * 元シート（診療室・バー・薬・ＤＨ ＋ オペ関連PV）から、本来あるべき資材を医院別に集める。
 * generateClinicSheets と同じ抽出ルール（備考=取扱なしは除外）で、書き込みは行わない。
 * @param {Spreadsheet} ss
 * @param {Object} out  clinic -> [OUT_HEADERS形式の行配列, ...]（呼び出し側で初期化済み）
 */
function collectSourceRows(ss, out) {
  SOURCE_ORDER.forEach(function (sheetName) {
    var cfg = SOURCE_CONFIG[sheetName];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < cfg.dataStart) return;

    var lastCol = sheet.getLastColumn();
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();

    for (var r = cfg.dataStart - 1; r < values.length; r++) {
      var row = values[r];
      var name = cellStr(row, cfg.common.name);
      if (name === '') continue;

      var maker      = cell(row, cfg.common.maker);
      var supplier   = cell(row, cfg.common.supplier);
      var priceExTax = cell(row, cfg.common.priceExTax);

      LEGACY_CLINICS.forEach(function (clinic) {
        var b = cfg.blocks[clinic];
        if (!b) return;
        if (isNotHandled(cellStr(row, b.note))) return; // 備考=取扱なしは元々対象外
        out[clinic].push([
          sheetName, supplier, maker, name, priceExTax,
          cell(row, b.priceIncTax), cell(row, b.qty), cell(row, b.note),
          cell(row, b.expiry), '', '', ''
        ]);
      });
    }
  });

  // PV は「オペ関連(ＰＶ)」からも取り込む（生成時と同じ）
  var opeResult = collectOpeRelatedRows(ss);
  if (opeResult.rows.length) {
    out.PV = out.PV.concat(opeResult.rows);
  }

  // 「ハンドピース」からも取り込む（生成時と同じ）
  var handpieceResult = collectHandpieceRows_(ss);
  LEGACY_CLINICS.forEach(function (clinic) {
    out[clinic] = out[clinic].concat(handpieceResult.rowsByClinic[clinic]);
  });
}

/** 医院別シートの既存行のキー集合（カテゴリ＋メーカー＋品名）を返す。 */
function readExistingKeys(sheet) {
  var keys = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return keys;
  var lastCol = sheet.getLastColumn();
  var vals = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < vals.length; i++) {
    var name = cellStr(vals[i], 4); // 品名（OUT_HEADERSの4番目）
    if (name === '') continue;
    keys[recoveryKey(cellStr(vals[i], 1), cellStr(vals[i], 3), name)] = true;
  }
  return keys;
}

/** 復旧照合用キー（カテゴリ＋メーカー＋品名）。空白差・大小文字を無視して比較する。 */
function recoveryKey(category, maker, name) {
  return [category, maker, name].map(function (s) {
    return String(s == null ? '' : s).trim().toLowerCase();
  }).join('|');
}


// ===== ヘルパー =====

/** 1始まりの列番号で行配列から値を取得（列がnull/範囲外なら空文字） */
function cell(row, colIndex1) {
  if (!colIndex1) return '';
  var v = row[colIndex1 - 1];
  return (v === null || v === undefined) ? '' : v;
}

/** 値を文字列（trim）で取得 */
function cellStr(row, colIndex1) {
  var v = cell(row, colIndex1);
  return (v === '') ? '' : String(v).trim();
}

/** 備考が「その医院では取り扱いなし」を意味するか判定 */
function isNotHandled(note) {
  if (!note) return false;
  for (var i = 0; i < NOT_HANDLED_KEYWORDS.length; i++) {
    if (note.indexOf(NOT_HANDLED_KEYWORDS[i]) >= 0) return true;
  }
  return false;
}
