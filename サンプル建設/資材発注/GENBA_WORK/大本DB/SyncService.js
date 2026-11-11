/**
 * 稼働現場リスト（大元DB）→ 現場一覧（職人進捗管理）の一方向同期
 * CONFIG・getDestSheet_・getWorkerSheet_・withMasterSyncScriptLock_・createMissingFolders_
 * は 稼働現場と職人報告のマスタを同期.js 側で定義済みであること。
 */

/**
 * 現場一覧の1行目ヘッダ（未設定時のみ）
 * A:現場ID B:現場名 C:DriveフォルダID D:ステータス
 * @param {GoogleAppsScript.Spreadsheet.Sheet} workerSheet
 */
function ensureWorkerHeaders_(workerSheet) {
  const first = workerSheet.getRange(1, 1).getValue();
  if (first) return;
  workerSheet.getRange(1, 1, 1, 4).setValues([
    ['現場ID', '現場名', 'DriveフォルダID', 'ステータス']
  ]);
}

/**
 * 稼働現場リストを正として現場一覧へ上書き反映（ID優先、無ければ正規化現場名で突合）
 * @param {GoogleAppsScript.Spreadsheet.Sheet} destSheet
 * @param {GoogleAppsScript.Spreadsheet.Sheet} workerSheet
 */
function pushDestToWorkerFull_(destSheet, workerSheet) {
  ensureWorkerHeaders_(workerSheet);

  const SITE_ID_PATTERN = /^SITE-\d+$/;
  const defStatus = CONFIG.DEFAULT_WORKER_STATUS || '稼働中';
  const wc = CONFIG.WORKER_COLUMNS;

  const byId = new Map();
  const byNormName = new Map();

  const wLast = workerSheet.getLastRow();
  if (wLast >= 2) {
    const wvals = workerSheet.getRange(2, 1, wLast, 4).getValues();
    wvals.forEach((row, idx) => {
      const id = row[0] ? String(row[0]).trim() : '';
      const nm = row[1] ? String(row[1]).trim() : '';
      const folder = row[2] ? String(row[2]).trim() : '';
      const st = row[3] ? String(row[3]).trim() : '';
      const rowNum = idx + 2;
      const rec = { rowNum, id, name: nm, folder, status: st };
      if (id) byId.set(id, rec);
      const nn = normalizeSiteName(nm);
      if (nn) byNormName.set(nn, rec);
    });
  }

  const destLast = destSheet.getLastRow();
  if (destLast < CONFIG.DEST_DATA_START_ROW) return;

  const dvals = destSheet.getRange(
    CONFIG.DEST_DATA_START_ROW,
    1,
    destLast - CONFIG.DEST_DATA_START_ROW + 1,
    3
  ).getValues();

    dvals.forEach(row => {
    const siteName = row[0] ? String(row[0]).trim() : '';
    const siteId = row[1] ? String(row[1]).trim() : '';
    const folderId = row[2] ? String(row[2]).trim() : '';
    if (!siteName || !siteId || !SITE_ID_PATTERN.test(siteId)) return;

    const norm = normalizeSiteName(siteName);
    let existing = byId.get(siteId) || (norm ? byNormName.get(norm) : null);

    if (existing && existing.id && existing.id !== siteId) {
      Logger.log(
        'pushDestToWorker: 名寄せ衝突のためスキップ 表示名=%s destId=%s 既存行ID=%s',
        siteName,
        siteId,
        existing.id
      );
      return;
    }

    if (existing) {
      workerSheet.getRange(existing.rowNum, wc.ID).setValue(siteId);
      workerSheet.getRange(existing.rowNum, wc.NAME).setValue(siteName);
      if (folderId) {
        workerSheet.getRange(existing.rowNum, wc.FOLDER).setValue(folderId);
      }
      if (!existing.status || String(existing.status).trim() === '') {
        workerSheet.getRange(existing.rowNum, wc.STATUS).setValue(defStatus);
      }
      const upd = {
        rowNum: existing.rowNum,
        id: siteId,
        name: siteName,
        folder: folderId || existing.folder,
        status: existing.status || defStatus
      };
      byId.set(siteId, upd);
      if (norm) byNormName.set(norm, upd);
    } else {
      const newRow = workerSheet.getLastRow() + 1;
      workerSheet.getRange(newRow, wc.ID).setValue(siteId);
      workerSheet.getRange(newRow, wc.NAME).setValue(siteName);
      workerSheet.getRange(newRow, wc.FOLDER).setValue(folderId);
      workerSheet.getRange(newRow, wc.STATUS).setValue(defStatus);
      const rec = {
        rowNum: newRow,
        id: siteId,
        name: siteName,
        folder: folderId,
        status: defStatus
      };
      byId.set(siteId, rec);
      if (norm) byNormName.set(norm, rec);
    }
  });
}

/**
 * 稼働現場リスト → 現場一覧 の反映（C列空フォルダの自動作成は CONFIG フラグで制御）
 * ScriptLock は呼び出し元で取得済みでなくても、ここで withMasterSyncScriptLock_ する。
 */
function syncOperatingListToWorkerSheet_() {
  withMasterSyncScriptLock_(() => {
    folderCache_ = null;
    const destSheet = getDestSheet_();
    const workerSheet = getWorkerSheet_();
    ensureWorkerHeaders_(workerSheet);
    pushDestToWorkerFull_(destSheet, workerSheet);
    if (CONFIG.AUTO_CREATE_MISSING_FOLDERS_ON_RECONCILE) {
      createMissingFolders_(destSheet, workerSheet);
      pushDestToWorkerFull_(destSheet, workerSheet);
    } else {
      Logger.log(
        'syncOperatingListToWorkerSheet_: createMissingFolders_ スキップ（CONFIG.AUTO_CREATE_MISSING_FOLDERS_ON_RECONCILE=false）'
      );
    }
  });
}

/**
 * メニュー・トリガー用: 同期ボタン相当
 */
function runSyncOperatingListToWorker() {
  syncOperatingListToWorkerSheet_();
}
