const SOURCE_SS_ID = 'SAMPLE_ID_035'; // コピー元（ファイルID）
const SOURCE_SHEET_ID = 1384964720; // コピー元シートID（gidの数値）
const TARGET_SS_ID = 'SAMPLE_ID_039'; // コピー先
const TARGET_SHEET_ID = 724630771; // コピー先シートID（gidの数値）
const SOURCE_COLUMN = 7; // G列
const TARGET_BG_COLOR = '#ccffcc'; // 取得したい背景色のカラーコード（薄い緑色: #ccffcc）

/**
 * 手動実行用（既存：データを初期化してから同期）
 */
function runSyncSites() {
    syncSites();
}

/**
 * 新規：手動実行用（初期化せずにB3から上書き）
 */
function runSyncSitesWithoutClear() {
    const records = getSourceRecords();
    const targetSheet = getTargetSheet();
    writeWithoutClearTarget(targetSheet, records);
}

/**
 * 新規：手動実行用（既存データの末尾に追記）
 */
function runSyncSitesAppend() {
    const records = getSourceRecords();
    const targetSheet = getTargetSheet();
    appendTarget(targetSheet, records);
}

/**
 * メニュー表示
 */
function onOpen() {
    SpreadsheetApp.getUi()
        .createMenu('現場名マスタ同期')
        .addItem('同期（初期化して書き込み）', 'runSyncSites')
        .addItem('手動同期（初期化せず上書き）', 'runSyncSitesWithoutClear') // 追加
        .addItem('手動同期（末尾に追記）', 'runSyncSitesAppend') // 追加
        .addItem('編集トリガーをインストール', 'installOnEditTrigger')
        .addToUi();
}

/**
 * インストール型 onEdit トリガー作成（初回のみ実行）
 */
function installOnEditTrigger() {
    const functionName = 'syncSitesOnEdit';
    // 重複作成防止
    ScriptApp.getProjectTriggers()
        .filter(t => t.getHandlerFunction() === functionName)
        .forEach(t => ScriptApp.deleteTrigger(t));

    ScriptApp.newTrigger(functionName)
        .forSpreadsheet(SpreadsheetApp.openById(SOURCE_SS_ID))
        .onEdit()
        .create();
}

function syncSitesOnEdit(e) {
    if (e && !shouldSync(e)) return;
    syncSites();
}

function shouldSync(e) {
    const sheet = e.range.getSheet();
    const editedCol = e.range.getColumn();
    const editedRow = e.range.getRow();
    return (
        e.source.getId() === SOURCE_SS_ID &&
        sheet.getSheetId() === SOURCE_SHEET_ID &&
        editedCol === SOURCE_COLUMN &&
        editedRow >= 2
    );
}

/**
 * 既存の同期処理（初期化あり）
 */
function syncSites() {
    const records = getSourceRecords();
    const targetSheet = getTargetSheet();
    overwriteTarget(targetSheet, records);
}

/**
 * 共通処理：コピー元のデータを取得
 */
function getSourceRecords() {
    const sourceSs = SpreadsheetApp.openById(SOURCE_SS_ID);
    const sourceSheet = sourceSs.getSheetById(SOURCE_SHEET_ID);
    if (!sourceSheet) throw new Error(`SOURCE_SHEET_ID (${SOURCE_SHEET_ID}) が見つかりません。`);
    return fetchSourceValues(sourceSheet);
}

/**
 * 共通処理：コピー先のシートを取得
 */
function getTargetSheet() {
    const targetSs = SpreadsheetApp.openById(TARGET_SS_ID);
    const targetSheet = targetSs.getSheetById(TARGET_SHEET_ID);
    if (!targetSheet) throw new Error(`TARGET_SHEET_ID (${TARGET_SHEET_ID}) が見つかりません。`);
    return targetSheet;
}

function fetchSourceValues(sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const range = sheet.getRange(2, SOURCE_COLUMN, lastRow - 1, 1);
    const values = range.getValues();
    const backgrounds = range.getBackgrounds();

    const targetValues = [];
    for (let i = 0; i < values.length; i++) {
        const val = values[i][0];
        const bg = backgrounds[i][0];

        if (val !== '' && bg === TARGET_BG_COLOR) {
            targetValues.push([val]);
        }
    }
    return targetValues;
}

/**
 * 書き込み方1（既存）：一度初期化してから書き込む
 */
function overwriteTarget(sheet, values) {
    const lastRow = sheet.getLastRow();
    if (lastRow >= 3) sheet.getRange(3, 2, lastRow - 2, 1).clearContent();

    if (!values || values.length === 0) return;
    sheet.getRange(3, 2, values.length, 1).setValues(values);
}

/**
 * 書き込み方2（新規）：初期化せずにB3から上書きする
 */
function writeWithoutClearTarget(sheet, values) {
    if (!values || values.length === 0) return;
    // clearContent() を行わず、そのまま書き込みます
    sheet.getRange(3, 2, values.length, 1).setValues(values);
}

/**
 * 書き込み方3（新規）：既存データの末尾に追記する
 */
function appendTarget(sheet, values) {
    if (!values || values.length === 0) return;

    // B列の最終行を調べて、その次の行から書き込みます
    const lastRow = sheet.getLastRow();
    const startRow = lastRow < 2 ? 3 : lastRow + 1; // 最小でも3行目からスタート

    sheet.getRange(startRow, 2, values.length, 1).setValues(values);
}