const CONFIG = Object.freeze({
  // ソース設定（複数シート対応）
  SOURCE_SHEETS: [
    { spreadsheetId: 'SAMPLE_ID_024', sheetName: '2025年', label: '2025年度' },
    { spreadsheetId: 'SAMPLE_ID_024', sheetName: '2026年合計【枠・楔】', label: '2026年度' }
  ],

  // ヘッダー検索設定
  HEADER_SEARCH_MAX: 10,
  KEY_HEADER: '現場名', // ソースの現場名カラムヘッダー

  // ソース列定義（ヘッダー名とデフォルト列番号）
  SOURCE_COL_HEADERS: {
    SITE_ID: { name: '現場ID', names: ['現場ID'], defaultIdx: 52 },       // AZ列: IDの書き戻し先（データ領域から離す）
    ASSEMBLY_START: { name: '組立開始予定', names: ['組立開始予定', '組始'], defaultIdx: 9 },   // I列
    ASSEMBLY_END: { name: '組立終了予定', names: ['組立終了予定', '組終'], defaultIdx: 10 },    // J列
    DISMANTLE_START: { name: '解体開始予定', names: ['解体開始予定', '解始'], defaultIdx: 11 }, // K列
    DISMANTLE_END: { name: '解体終了予定', names: ['解体終了予定', '解終'], defaultIdx: 12 },   // L列
  },

  // 宛先1: 管理シート（稼働現場リスト・データベース）— ダッシュボード Config.SOURCE_SPREADSHEET_ID と同一にすること
  DEST_SPREADSHEET_ID: 'SAMPLE_ID_011',
  DEST_SHEET_ID: 1304971549, // 稼働現場リスト
  DB_SHEET_ID: 1796205624,   // データベース（蓄積用）
  DEST_HEADER_ROW: 1,
  DEST_DATA_START_ROW: 2,

  // 宛先2: 職人シート（職人進捗管理）— シート名「現場一覧」優先、無ければ gid で解決
  WORKER_SPREADSHEET_ID: 'SAMPLE_ID_019', // 先方納品・実運用中の職人進捗管理（本番）
  WORKER_SHEET_NAME: '現場一覧',
  WORKER_SHEET_ID: 16994545, // フォールバック gid（コピー後は WORKER_SHEET_NAME を優先）
  /** 現場一覧の列（A=1 …） */
  WORKER_COLUMNS: Object.freeze({
    ID: 1,
    NAME: 2,
    FOLDER: 3,
    STATUS: 4
  }),
  DEFAULT_WORKER_STATUS: '稼働中',

  // 宛先列定義（固定）
  DEST_COLUMNS: {
    SITE_NAME: 1,        // A列: 現場名
    SITE_ID: 2,          // B列: 現場ID
    ASSEMBLY_START: 5,   // E列: 組始
    ASSEMBLY_END: 6,     // F列: 組終
    DISMANTLE_START: 7,  // G列: 解体開始
    DISMANTLE_END: 8,    // H列: 解体終了
    DRIVE_FOLDER: 3     // C列: DriveフォルダID
  },

  // データベースシート列定義（34列構造のうち書き込み対象のみ）
  DB_COLUMNS: {
    SITE_NAME: 1,           // A列: 現場名
    ZONE_NAME: 2,           // B列: 工区名
    LAST_UPDATED: 3,        // C列: 最終更新日時
    LAST_UPDATER: 4,        // D列: 最終更新者
    ASSEMBLY_START: 14,     // N列: 組立開始予定日
    ASSEMBLY_END: 15,       // O列: 組立終了予定日
    DISMANTLE_START: 16,    // P列: 解体開始予定日
    DISMANTLE_END: 17,      // Q列: 解体終了予定日
    DISMANTLE_EDU: 18,      // R列: 解体前教育予定日
  },

  // ID採番設定
  ID_PREFIX: 'SITE-',
  ID_PADDING: 3,

  // 色設定
  COLORS: {
    ADD_OR_UPDATE: '#ccffcc',
    DELETE: '#ff0000',
  },

  // Drive設定
  DRIVE_ROOT_ID: 'SAMPLE_ID_018',
  SITE_SUB_FOLDERS: [
    '00_工程表',
    '01_現調',
    '02_仮設計画',
    '03_送り出し教育',
    '04_解体前教育',
    '05_点検',
    '06_巡回',
    '07_衛生協議会'
  ],
  REPORT_FOLDER_NAME: '08_職人報告',
  REPORT_SUB_FOLDERS: [
    '始業前報告',
    '午後報告',
    '終業前報告',
    '中間報告'
  ],

  /**
   * reconcileSheets_ / syncOperatingListToWorkerSheet_ 末尾で
   * createMissingFolders_ を自動実行するか。
   * Phase2a: 通常同期でのルート増殖防止のため false（手動補完のみ）。
   */
  AUTO_CREATE_MISSING_FOLDERS_ON_RECONCILE: false
});

/** ScriptLock の待機上限（ms）。同期全体・フォルダ一括作成は長めに取る */
const MASTER_SYNC_LOCK_TIMEOUT_MS = 300000;

/** withMasterSyncScriptLock_ 用の再入深度（0 のときだけ ScriptLock を取得） */
var masterSyncLockDepth_ = 0;

/** 此花下水処理場 ID重複調査用：監視対象現場名 */
var KONOHANA_TARGET_NAME_ = '此花下水処理場';
/** @type {string|null} */
var konohanaNormNameCache_ = null;

/**
 * 此花監視用：正規化現場名（キャッシュ）
 * @returns {string}
 */
function getKonohanaNormName_() {
  if (!konohanaNormNameCache_) {
    konohanaNormNameCache_ = normalizeSiteName(KONOHANA_TARGET_NAME_);
  }
  return konohanaNormNameCache_;
}

/**
 * 此花監視用：現場名が此花下水処理場（正規化一致）か
 * @param {*} name
 * @returns {boolean}
 */
function isKonohanaName_(name) {
  return normalizeSiteName(String(name || '')) === getKonohanaNormName_();
}

/**
 * 此花監視用：稼働現場リストから此花に紐づく既知SITE-ID候補を収集
 * @param {{ byName: Map, byId: Map }} destData
 * @returns {string[]}
 */
function getKonohanaKnownIdsFromDestData_(destData) {
  const ids = [];
  const norm = getKonohanaNormName_();
  const byNameHit = destData && destData.byName ? destData.byName.get(norm) : null;
  if (byNameHit && byNameHit.id) {
    const id = String(byNameHit.id).trim();
    if (id) ids.push(id);
  }
  if (destData && destData.byId) {
    destData.byId.forEach(function(rec, id) {
      if (rec.siteName === norm && ids.indexOf(id) < 0) ids.push(id);
    });
  }
  return ids;
}

/**
 * 此花監視用：ログ出力すべきか（名前・IDのいずれかが此花関連）
 * @param {Object} fields
 * @returns {boolean}
 */
function shouldLogKonohana_(fields) {
  fields = fields || {};
  if (isKonohanaName_(fields.cleanSiteName)) return true;
  if (isKonohanaName_(fields.sourceName)) return true;
  if (isKonohanaName_(fields.oldName)) return true;
  if (isKonohanaName_(fields.newName)) return true;
  if (isKonohanaName_(fields.siteName)) return true;
  if (isKonohanaName_(fields.existingSiteName)) return true;

  const knownIds = fields.konohanaKnownIds || [];
  const idFields = [fields.sourceId, fields.siteId, fields.existingByNameId, fields.deleteSiteId];
  for (let i = 0; i < idFields.length; i++) {
    const id = idFields[i] ? String(idFields[i]).trim() : '';
    if (id && knownIds.indexOf(id) >= 0) return true;
  }
  return false;
}

/**
 * 此花監視用：キー値ペアを1ブロックで Logger 出力
 * @param {string} tag
 * @param {Object<string, *>} kv
 */
function logKonohanaDetail_(tag, kv) {
  const lines = Object.keys(kv).map(function(key) {
    return key + ': ' + kv[key];
  });
  Logger.log('[' + tag + ']\n' + lines.join('\n'));
}

/**
 * 同一プロジェクト内の「マスタ同期」系処理を直列化する。
 * GAS の ScriptLock は再入不可のため、ネスト時は深度カウンタで二重取得を避ける。
 * @param {function(): *} fn
 * @param {number} [timeoutMs]
 * @returns {*}
 */
function withMasterSyncScriptLock_(fn, timeoutMs) {
  const lock = LockService.getScriptLock();
  const timeout = timeoutMs != null ? timeoutMs : MASTER_SYNC_LOCK_TIMEOUT_MS;
  let acquiredHere = false;
  if (masterSyncLockDepth_ === 0) {
    lock.waitLock(timeout);
    acquiredHere = true;
  }
  masterSyncLockDepth_++;
  try {
    return fn();
  } finally {
    masterSyncLockDepth_--;
    if (acquiredHere) {
      lock.releaseLock();
    }
  }
}

/**
 * メイン同期関数
 * 複数シートから緑背景の現場を検出し、ID採番・工期同期・フォルダ作成を行う
 * 管理シートと職人シートの両方を更新する
 */
function syncSitesWithSchedule() {
  const syncStartedAt = new Date();
  const tz = Session.getScriptTimeZone();
  Logger.log(
    '[SYNC_START] syncSitesWithSchedule start: %s',
    Utilities.formatDate(syncStartedAt, tz, 'yyyy-MM-dd HH:mm:ss')
  );

  withMasterSyncScriptLock_(() => {
    // 実行単位でフォルダキャッシュを捨てる（並行実行で古いキャッシュを踏まない）
    folderCache_ = null;

    // 0. ソースシートの緑色行にIDを採番（両シート横断で整合性を確保）
    assignSiteIdsToSourceSheets();

    // 1. 管理シートへの同期
    const destSheet = getDestSheet_();
    ensureDestHeaders_(destSheet);

    // 2. 職人シートへの同期（追加）
    const workerSheet = getWorkerSheet_();

    const sources = CONFIG.SOURCE_SHEETS;
    const totals = { added: 0, updated: 0, deleted: 0, renamed: 0, conflictSkipped: 0 };

    // 宛先の既存データを取得（現場名・IDの双方向検索用）
    const destData = getDestData_(destSheet); // { byName, byId }
    // 職人シートの既存データを取得（重複追加防止用）
    const workerData = getWorkerSheetData_(workerSheet); // { byName, byId }

    sources.forEach((sourceCfg) => {
      try {
        const sourceSheet = getSheet_(sourceCfg.spreadsheetId, sourceCfg.sheetName);

        // 管理シートと職人シートの両方に同期
        const result = syncSingleSource_(sourceSheet, destSheet, workerSheet, destData, workerData);

        totals.added += result.added;
        totals.updated += result.updated;
        totals.deleted += result.deleted;
        totals.renamed += result.renamed;
        totals.conflictSkipped += result.conflictSkipped || 0;
        Logger.log('同期完了 (%s): 追加 %s, 更新 %s, リネーム %s, ID名前競合スキップ %s', sourceCfg.label, result.added, result.updated, result.renamed, result.conflictSkipped || 0);
      } catch (e) {
        Logger.log('ソースシート読み込みエラー (%s): %s', sourceCfg.label, e.message);
      }
    });

    Logger.log('全ソース合計: 追加 %s, 更新 %s, リネーム %s, ID名前競合スキップ %s', totals.added, totals.updated, totals.renamed, totals.conflictSkipped);

    // 3. 同名重複行の削除（旧IDで残っているゴミ行を除去）
    const canonicalNameToId = buildCanonicalNameToId_();
    cleanupDuplicatesByName_(destSheet, canonicalNameToId, '稼働現場リスト', CONFIG.DEST_COLUMNS.SITE_NAME, CONFIG.DEST_COLUMNS.SITE_ID, CONFIG.DEST_DATA_START_ROW);
    cleanupDuplicatesByName_(workerSheet, canonicalNameToId, 'Master_Sites', 2, 1, 2);

    // 4. 双方向 Reconcile（片方にしかない現場を補完）
    reconcileSheets_(destSheet, workerSheet);

    // 5. 稼働現場リストを正として現場一覧へ最終反映（手動追記・表記ゆれの吸収）
    ensureWorkerHeaders_(workerSheet);
    pushDestToWorkerFull_(destSheet, workerSheet);
  });

  const syncEndedAt = new Date();
  Logger.log(
    '[SYNC_END] syncSitesWithSchedule end: %s (elapsed %ss)',
    Utilities.formatDate(syncEndedAt, tz, 'yyyy-MM-dd HH:mm:ss'),
    Math.round((syncEndedAt.getTime() - syncStartedAt.getTime()) / 1000)
  );
}

/**
 * 単一ソースシートの同期処理
 */
function syncSingleSource_(sourceSheet, destSheet, workerSheet, destData, workerData) {
  // ヘッダー位置を特定（見つからない場合はデフォルト値を使用）
  const keyColIdx = getColumnIndexByHeader_(sourceSheet, CONFIG.KEY_HEADER, 7); // デフォルトG列
  const siteIdColIdx = getColumnIndexByHeader_(sourceSheet, CONFIG.SOURCE_COL_HEADERS.SITE_ID.name, CONFIG.SOURCE_COL_HEADERS.SITE_ID.defaultIdx);
  const dateColIndices = {
    assemblyStart: getColumnIndexByHeaders_(sourceSheet, CONFIG.SOURCE_COL_HEADERS.ASSEMBLY_START.names, CONFIG.SOURCE_COL_HEADERS.ASSEMBLY_START.defaultIdx),
    assemblyEnd: getColumnIndexByHeaders_(sourceSheet, CONFIG.SOURCE_COL_HEADERS.ASSEMBLY_END.names, CONFIG.SOURCE_COL_HEADERS.ASSEMBLY_END.defaultIdx),
    dismantleStart: getColumnIndexByHeaders_(sourceSheet, CONFIG.SOURCE_COL_HEADERS.DISMANTLE_START.names, CONFIG.SOURCE_COL_HEADERS.DISMANTLE_START.defaultIdx),
    dismantleEnd: getColumnIndexByHeaders_(sourceSheet, CONFIG.SOURCE_COL_HEADERS.DISMANTLE_END.names, CONFIG.SOURCE_COL_HEADERS.DISMANTLE_END.defaultIdx),
  };

  const lastRow = sourceSheet.getLastRow();
  const dataStartRow = Math.max(4, sourceSheet.getFrozenRows() + 1);

  if (lastRow < dataStartRow) return { added: 0, updated: 0, deleted: 0, renamed: 0, conflictSkipped: 0 };

  const numRows = lastRow - dataStartRow + 1;
  const allIndices = [keyColIdx, siteIdColIdx, ...Object.values(dateColIndices)];
  const minCol = Math.min(...allIndices);
  const maxCol = Math.max(...allIndices);

  const dataRange = sourceSheet.getRange(dataStartRow, minCol, numRows, maxCol - minCol + 1);
  const values = dataRange.getValues();
  const backgrounds = dataRange.getBackgrounds();

  // 相対インデックス
  const relKeyIdx = keyColIdx - minCol;
  const relSiteIdIdx = siteIdColIdx - minCol;
  const relDateIndices = {
    assemblyStart: dateColIndices.assemblyStart - minCol,
    assemblyEnd: dateColIndices.assemblyEnd - minCol,
    dismantleStart: dateColIndices.dismantleStart - minCol,
    dismantleEnd: dateColIndices.dismantleEnd - minCol,
  };

  let added = 0;
  let updated = 0;
  let deleted = 0;
  let renamed = 0;
  let conflictSkipped = 0;

  const rowsToDelete = [];
  const konohanaKnownIds = getKonohanaKnownIdsFromDestData_(destData);
  const sourceSheetName = sourceSheet.getName();

  values.forEach((row, idx) => {
    const siteName = row[relKeyIdx];
    if (!siteName) return;

    const cleanSiteName = normalizeSiteName(siteName);
    const sourceId = row[relSiteIdIdx] ? row[relSiteIdIdx].toString().trim() : '';
    const rowBackground = backgrounds[idx][relKeyIdx];

    if (isSyncTargetSourceRow_(rowBackground)) {
      // --- 緑色：追加・更新・リネーム ---
      const siteData = {
        siteName: cleanSiteName,
        assemblyStart: row[relDateIndices.assemblyStart],
        assemblyEnd: row[relDateIndices.assemblyEnd],
        dismantleStart: row[relDateIndices.dismantleStart],
        dismantleEnd: row[relDateIndices.dismantleEnd],
      };

      if (sourceId) {
        // ソースにIDがある → IDベースで検索
        const existingById = destData.byId.get(sourceId);

        if (existingById && existingById.siteName !== cleanSiteName) {
          // IDは同じだが名前が異なる → 自動リネームせずスキップ（SITE-ID競合）
          if (shouldLogKonohana_({
            cleanSiteName: cleanSiteName,
            sourceName: siteName,
            sourceId: sourceId,
            existingSiteName: existingById.siteName,
            konohanaKnownIds: konohanaKnownIds
          })) {
            logKonohanaDetail_('KONOHANA_RENAME_CANDIDATE', {
              sourceSheet: sourceSheetName,
              sourceRow: dataStartRow + idx,
              sourceName: siteName,
              cleanSiteName: cleanSiteName,
              sourceId: sourceId,
              'existingById.rowNumber': existingById.rowNumber,
              'existingById.siteName': existingById.siteName,
              'existingById.folderId': existingById.folderId || '',
              action: 'renameSite_ skipped due to SITE-ID name conflict (guard active)'
            });
          }
          logKonohanaDetail_('SITE_ID_NAME_CONFLICT_SKIP', {
            sourceSheet: sourceSheetName,
            sourceRow: dataStartRow + idx,
            sourceName: siteName,
            cleanSiteName: cleanSiteName,
            sourceId: sourceId,
            'existingById.rowNumber': existingById.rowNumber,
            'existingById.siteName': existingById.siteName,
            'existingById.folderId': existingById.folderId || '',
            reason: 'same SITE-ID but different site name. renameSite_ skipped.'
          });
          conflictSkipped++;
        } else if (existingById) {
          // IDも名前も同じ → 工期のみ更新
          updateSiteRow_(destSheet, existingById.rowNumber, siteData);
          // Master_Sitesに未登録なら追加（更新パスで漏れるケースを補完）
          if (!workerData.byId.has(sourceId) && !workerData.byName.has(cleanSiteName)) {
            appendWorkerSiteRow_(workerSheet, siteData, sourceId);
            const updateFolderId = existingById.folderId || '';
            if (updateFolderId) workerSheet.getRange(workerSheet.getLastRow(), 3).setValue(updateFolderId);
            workerData.byId.set(sourceId, cleanSiteName);
            workerData.byName.set(cleanSiteName, sourceId);
          }
          updated++;
        } else {
          // IDはあるが宛先にIDで見つからない → 名前でフォールバック検索
          const existingByName = destData.byName.get(cleanSiteName);
          if (existingByName) {
            // 名前で見つかった → 既存行のIDを正しいIDに更新（新行追加しない）
            if (shouldLogKonohana_({
              cleanSiteName: cleanSiteName,
              sourceName: siteName,
              sourceId: sourceId,
              existingByNameId: existingByName.id,
              konohanaKnownIds: konohanaKnownIds
            })) {
              logKonohanaDetail_('KONOHANA_ID_FIX_CANDIDATE', {
                sourceSheet: sourceSheetName,
                sourceRow: dataStartRow + idx,
                sourceName: siteName,
                cleanSiteName: cleanSiteName,
                sourceId: sourceId,
                'existingByName.rowNumber': existingByName.rowNumber,
                'existingByName.id': existingByName.id || '',
                'existingByName.folderId': existingByName.folderId || '',
                action: 'このあと稼働現場リストB列を ' + (existingByName.id || '(空)') + ' から ' + sourceId + ' に書き換える'
              });
            }
            Logger.log('[ID修正] "%s": %s → %s', cleanSiteName, existingByName.id, sourceId);
            destSheet.getRange(existingByName.rowNumber, CONFIG.DEST_COLUMNS.SITE_ID).setValue(sourceId);
            updateSiteRow_(destSheet, existingByName.rowNumber, siteData);
            if (existingByName.id) destData.byId.delete(String(existingByName.id).trim());
            destData.byName.set(cleanSiteName, { rowNumber: existingByName.rowNumber, id: sourceId });
            destData.byId.set(sourceId, { rowNumber: existingByName.rowNumber, siteName: cleanSiteName });
            // 職人シートも同様にIDを更新
            const oldWorkerId = workerData.byName.get(cleanSiteName);
            if (oldWorkerId && oldWorkerId !== sourceId) {
              const wLastRow = workerSheet.getLastRow();
              const wNames = workerSheet.getRange(2, 2, wLastRow - 1, 1).getValues();
              for (let wi = 0; wi < wNames.length; wi++) {
                if (normalizeSiteName(wNames[wi][0]) === cleanSiteName) {
                  workerSheet.getRange(wi + 2, 1).setValue(sourceId);
                  break;
                }
              }
              workerData.byId.delete(oldWorkerId);
              workerData.byId.set(sourceId, cleanSiteName);
              workerData.byName.set(cleanSiteName, sourceId);
            }
            updated++;
          } else {
            // 完全に新規
            appendSiteRow_(destSheet, siteData, sourceId);
            const destNewRow = destSheet.getLastRow();
            let workerNewRow = -1;
            if (!workerData.byId.has(sourceId) && !workerData.byName.has(cleanSiteName)) {
              appendWorkerSiteRow_(workerSheet, siteData, sourceId);
              workerNewRow = workerSheet.getLastRow();
              workerData.byId.set(sourceId, cleanSiteName);
              workerData.byName.set(cleanSiteName, sourceId);
            }
            const folderId = ensureSiteFolder_(cleanSiteName);
            if (folderId) {
              destSheet.getRange(destNewRow, 3).setValue(folderId);        // C列: DriveフォルダID
              // Drive処理中に別スクリプトが行追加してもIDで正しい行を特定する
              if (workerNewRow > 0) {
                const safeWorkerRow = findWorkerRowBySiteId_(workerSheet, sourceId);
                if (safeWorkerRow > 0) workerSheet.getRange(safeWorkerRow, 3).setValue(folderId); // C列: DriveフォルダID
              }
            }
            destData.byName.set(cleanSiteName, { rowNumber: destNewRow, id: sourceId });
            destData.byId.set(sourceId, { rowNumber: destNewRow, siteName: cleanSiteName });
            added++;
          }
        }
      } else {
        // ソースにIDがない → 従来の名前ベース検索
        const existingByName = destData.byName.get(cleanSiteName);

        if (existingByName) {
          updateSiteRow_(destSheet, existingByName.rowNumber, siteData);
          // IDが宛先にあればソースに書き戻す（SITE-xxx形式のみ）
          const idToWrite = existingByName.id ? existingByName.id.toString().trim() : '';
          if (idToWrite && /^SITE-\d+$/.test(idToWrite)) {
            sourceSheet.getRange(dataStartRow + idx, siteIdColIdx).setValue(idToWrite);
          } else if (idToWrite) {
            Logger.log('[スキップ] B列の値がSITE-xxx形式でないためAZ列に書かない: "%s" (現場名: "%s")', idToWrite, cleanSiteName);
          }
          updated++;
        } else {
          const newId = generateNextId_(destSheet);
          appendSiteRow_(destSheet, siteData, newId);
          const destNewRow2 = destSheet.getLastRow();
          let workerNewRow2 = -1;
          // 職人シートに未登録の場合のみ追加
          if (!workerData.byId.has(newId) && !workerData.byName.has(cleanSiteName)) {
            appendWorkerSiteRow_(workerSheet, siteData, newId);
            workerNewRow2 = workerSheet.getLastRow();
            workerData.byId.set(newId, cleanSiteName);
            workerData.byName.set(cleanSiteName, newId);
          }
          const folderId2 = ensureSiteFolder_(cleanSiteName);
          if (folderId2) {
            destSheet.getRange(destNewRow2, 3).setValue(folderId2);           // C列: DriveフォルダID
            // Drive処理中に別スクリプトが行追加してもIDで正しい行を特定する
            if (workerNewRow2 > 0) {
              const safeWorkerRow2 = findWorkerRowBySiteId_(workerSheet, newId);
              if (safeWorkerRow2 > 0) workerSheet.getRange(safeWorkerRow2, 3).setValue(folderId2); // C列: DriveフォルダID
            }
          }
          // ソースシートにIDを書き戻す
          sourceSheet.getRange(dataStartRow + idx, siteIdColIdx).setValue(newId);
          destData.byName.set(cleanSiteName, { rowNumber: destSheet.getLastRow(), id: newId });
          destData.byId.set(newId, { rowNumber: destSheet.getLastRow(), siteName: cleanSiteName });
          added++;
        }
      }
    } else if (isDeleteTargetSourceRow_(rowBackground)) {
      // --- 赤色：削除 ---
      const existing = destData.byName.get(cleanSiteName);
      if (existing) {
        rowsToDelete.push(existing.rowNumber);
        deleteFromWorkerSheet_(workerSheet, cleanSiteName);
        destData.byName.delete(cleanSiteName);
        if (existing.id) destData.byId.delete(existing.id.toString().trim());
        deleted++;
      }
    }
  });

  // 管理シートから行を削除（下の行から順に削除してズレを防止）
  if (rowsToDelete.length > 0) {
    rowsToDelete.sort((a, b) => b - a).forEach(rowNum => {
      destSheet.deleteRow(rowNum);
    });
  }

  return { added, updated, deleted, renamed, conflictSkipped };
}

/**
 * 宛先シートの既存データを取得
 * @returns {{ byName: Map<string, {rowNumber, id, folderId}>, byId: Map<string, {rowNumber, siteName, folderId}> }}
 */
function getDestData_(sheet) {
  const byName = new Map();
  const byId = new Map();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DEST_DATA_START_ROW) return { byName, byId };

  const numRows = lastRow - CONFIG.DEST_DATA_START_ROW + 1;
  const values = sheet.getRange(CONFIG.DEST_DATA_START_ROW, CONFIG.DEST_COLUMNS.SITE_NAME, numRows, 3).getValues();

  values.forEach((row, idx) => {
    const siteName = row[0];
    const siteId = row[1];
    const folderId = row[2] ? row[2].toString().trim() : '';
    const rowNumber = CONFIG.DEST_DATA_START_ROW + idx;
    if (siteName) {
      const cleanName = normalizeSiteName(siteName);
      byName.set(cleanName, { rowNumber, id: siteId, folderId });
      if (siteId) {
        byId.set(siteId.toString().trim(), { rowNumber, siteName: cleanName, folderId });
      }
    }
  });
  return { byName, byId };
}

/**
 * 現場名のリネーム処理（全連携先を一括更新）
 */
function renameSite_(destSheet, workerSheet, oldName, newName, siteId, destRowNumber) {
  Logger.log('リネーム: "%s" → "%s" (ID: %s)', oldName, newName, siteId);

  if (shouldLogKonohana_({ oldName: oldName, newName: newName, siteId: siteId })) {
    logKonohanaDetail_('KONOHANA_RENAME_EXECUTED', {
      oldName: oldName,
      newName: newName,
      siteId: siteId,
      destRow: destRowNumber,
      workerSheetAffected: 'true (renameInWorkerSheet_ will run)',
      databaseAffected: 'true (renameDatabaseEntry_ will run)'
    });
  }

  // 1. 管理シート: 現場名を更新
  destSheet.getRange(destRowNumber, CONFIG.DEST_COLUMNS.SITE_NAME).setValue(newName);

  // 2. データベースシート: 現場名を更新
  renameDatabaseEntry_(oldName, newName);

  // 3. 職人シート: 現場名を更新（IDで検索して正しい行を更新）
  renameInWorkerSheet_(workerSheet, oldName, newName, siteId);

  // 4. Driveフォルダ: リネーム
  renameSiteFolder_(oldName, newName);
}

/**
 * データベースシートの現場名を更新
 */
function renameDatabaseEntry_(oldName, newName) {
  const dbSheet = getSheetById_(CONFIG.DEST_SPREADSHEET_ID, CONFIG.DB_SHEET_ID);
  const lastRow = dbSheet.getLastRow();
  if (lastRow < 2) return;

  const names = dbSheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  for (let i = 0; i < names.length; i++) {
    if (names[i] && normalizeSiteName(names[i]) === normalizeSiteName(oldName)) {
      dbSheet.getRange(i + 2, 1).setValue(newName);
      Logger.log('DB現場名更新: 行 %s', i + 2);
      return;
    }
  }
}

/**
 * 職人シートの現場名を更新（A列IDで検索優先、見つからない場合はB列名前で検索）
 * IDで検索することで、名前が重複・混在しているケースでの誤更新を防ぐ。
 */
function renameInWorkerSheet_(sheet, oldName, newName, siteId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // まずIDで検索（A列）
  if (siteId) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] && ids[i][0].toString().trim() === siteId) {
        sheet.getRange(i + 2, 2).setValue(newName);
        Logger.log('職人シート現場名更新 (ID検索): 行 %s', i + 2);
        return;
      }
    }
  }

  // IDで見つからない場合は名前で検索（B列）
  const values = sheet.getRange(1, 2, lastRow, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] && normalizeSiteName(values[i][0]) === normalizeSiteName(oldName)) {
      sheet.getRange(i + 1, 2).setValue(newName);
      Logger.log('職人シート現場名更新 (名前検索): 行 %s', i + 1);
      return;
    }
  }
}

/**
 * Driveフォルダのリネーム
 */
function renameSiteFolder_(oldName, newName) {
  try {
    const rootFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_ID);
    const oldKey = DriveManager_folderKeyFromSiteName(oldName);
    const newKey = DriveManager_folderKeyFromSiteName(newName);
    const folders = rootFolder.getFoldersByName(oldKey);
    if (folders.hasNext()) {
      folders.next().setName(newKey);
      Logger.log('Driveフォルダリネーム: "%s" → "%s"', oldKey, newKey);
      if (folderCache_) {
        const cachedId = folderCache_.get(oldKey) || '';
        folderCache_.delete(oldKey);
        if (cachedId) folderCache_.set(newKey, cachedId);
      }
    } else {
      Logger.log('Driveフォルダが見つかりません: %s', oldKey);
    }
  } catch (e) {
    Logger.log('Driveフォルダリネームエラー: %s', e.toString());
  }
}

/**
 * 現場行を更新
 */
function updateSiteRow_(sheet, rowNumber, site) {
  const cols = CONFIG.DEST_COLUMNS;
  // 更新時は有効な日付のみ書き込む（空で既存日付を消さない）
  setScheduleDateCellIfValid_(sheet, rowNumber, cols.ASSEMBLY_START, site.assemblyStart);
  setScheduleDateCellIfValid_(sheet, rowNumber, cols.ASSEMBLY_END, site.assemblyEnd);
  setScheduleDateCellIfValid_(sheet, rowNumber, cols.DISMANTLE_START, site.dismantleStart);
  setScheduleDateCellIfValid_(sheet, rowNumber, cols.DISMANTLE_END, site.dismantleEnd);

  // データベースシートの工期も同期
  ensureDatabaseEntry_(site, null, false);
}

/**
 * 新規現場行を追加（稼働現場リスト ＋ データベース）
 */
function appendSiteRow_(sheet, site, newId) {
  const cols = CONFIG.DEST_COLUMNS;
  const lastRow = sheet.getLastRow();
  const newRow = lastRow + 1;

  if (newRow > sheet.getMaxRows()) {
    sheet.insertRowAfter(lastRow);
  }

  // 1. 稼働現場リストへの書き込み
  sheet.getRange(newRow, cols.SITE_NAME).setValue(site.siteName);
  sheet.getRange(newRow, cols.SITE_ID).setValue(newId);
  sheet.getRange(newRow, cols.ASSEMBLY_START).setValue(site.assemblyStart || '');
  sheet.getRange(newRow, cols.ASSEMBLY_END).setValue(site.assemblyEnd || '');
  sheet.getRange(newRow, cols.DISMANTLE_START).setValue(site.dismantleStart || '');
  sheet.getRange(newRow, cols.DISMANTLE_END).setValue(site.dismantleEnd || '');

  // 2. データベースシートへの追記（存在しない場合のみ）
  ensureDatabaseEntry_(site, newId);
}

/**
 * データベースシート（34列構造）に現場を追記・工期を更新
 * 新規行: 現場名 + 工区名(空) + メタ情報 + 工期を書き込む
 * 既存行: 工期データを上書き更新する
 */
/**
 * 工期セルへ書き込む。
 * - 空（未入力）はスキップして既存値を保持（空で上書きして消さない）
 * - 非空の値は必ず書き込む（日付に解釈できれば Date、できなければ生値のまま）
 *   ※ 以前は new Date() で解釈できない文字列日付を取りこぼしていたため修正
 */
function setScheduleDateCellIfValid_(sheet, rowNumber, col, value) {
  if (value === '' || value === null || value === undefined) return;
  let toWrite = value;
  if (!(value instanceof Date)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) toWrite = d;
  }
  sheet.getRange(rowNumber, col).setValue(toWrite);
}

function ensureDatabaseEntry_(site, newId, allowEmptyOverwrite) {
  if (allowEmptyOverwrite === undefined) allowEmptyOverwrite = true;
  const dbSheet = getSheetById_(CONFIG.DEST_SPREADSHEET_ID, CONFIG.DB_SHEET_ID);
  const dbCols = CONFIG.DB_COLUMNS;
  const lastRow = dbSheet.getLastRow();
  let targetRow = -1;

  if (lastRow >= 2) {
    const names = dbSheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const targetNorm = normalizeSiteName(site.siteName);
    const idx = names.findIndex(n => n && normalizeSiteName(n) === targetNorm);
    if (idx !== -1) {
      targetRow = idx + 2;
    }
  }

  if (targetRow === -1) {
    // 新規行を追加
    targetRow = lastRow + 1;
    if (targetRow > dbSheet.getMaxRows()) dbSheet.insertRowAfter(lastRow);
    dbSheet.getRange(targetRow, dbCols.SITE_NAME).setValue(site.siteName);
    dbSheet.getRange(targetRow, dbCols.ZONE_NAME).setValue(''); // 親行（工区なし）
  }

  // メタ情報を更新
  dbSheet.getRange(targetRow, dbCols.LAST_UPDATED).setValue(new Date());
  dbSheet.getRange(targetRow, dbCols.LAST_UPDATER).setValue('System');

  // 工期データを更新（更新時は有効な日付のみ。空で既存日付を消さない）
  const writeDate = (col, val) => {
    if (allowEmptyOverwrite) {
      dbSheet.getRange(targetRow, col).setValue(val || '');
      return;
    }
    setScheduleDateCellIfValid_(dbSheet, targetRow, col, val);
  };
  writeDate(dbCols.ASSEMBLY_START, site.assemblyStart);
  writeDate(dbCols.ASSEMBLY_END, site.assemblyEnd);
  writeDate(dbCols.DISMANTLE_START, site.dismantleStart);
  writeDate(dbCols.DISMANTLE_END, site.dismantleEnd);

  // 解体前教育予定日 = 解体開始 - 7日（自動計算）
  if (site.dismantleStart) {
    const dismantleDate = new Date(site.dismantleStart);
    if (!isNaN(dismantleDate.getTime())) {
      dismantleDate.setDate(dismantleDate.getDate() - 7);
      dbSheet.getRange(targetRow, dbCols.DISMANTLE_EDU).setValue(dismantleDate);
    }
  }
}

/**
 * 次のIDを生成（ScriptLock 内で最大番号を読み取り、重複採番を防ぐ）
 * syncSitesWithSchedule 全体がロック済みのときは再入のみ（追加の待機なし）
 */
function generateNextId_(sheet) {
  return withMasterSyncScriptLock_(() => {
    const lastRow = sheet.getLastRow();
    let maxNum = 0;

    if (lastRow >= CONFIG.DEST_DATA_START_ROW) {
      const ids = sheet.getRange(CONFIG.DEST_DATA_START_ROW, CONFIG.DEST_COLUMNS.SITE_ID, lastRow - CONFIG.DEST_DATA_START_ROW + 1, 1).getValues().flat();
      ids.forEach(id => {
        if (typeof id === 'string' && id.startsWith(CONFIG.ID_PREFIX)) {
          const num = parseInt(id.replace(CONFIG.ID_PREFIX, ''), 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      });
    }

    const nextNum = maxNum + 1;
    return CONFIG.ID_PREFIX + String(nextNum).padStart(CONFIG.ID_PADDING, '0');
  });
}

/**
 * ヘッダー名から列インデックスを検索
 * 見つからない場合はデフォルト値を返す
 */
function getColumnIndexByHeader_(sheet, headerName, defaultIdx) {
  const maxSearchRow = Math.min(sheet.getLastRow(), CONFIG.HEADER_SEARCH_MAX);
  const data = sheet.getRange(1, 1, maxSearchRow, sheet.getLastColumn()).getValues();

  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const idx = row.indexOf(headerName);
    if (idx !== -1) return idx + 1;
  }

  Logger.log('ヘッダー "%s" が見つかりませんでした。デフォルト値 %s を使用します。', headerName, defaultIdx);
  return defaultIdx;
}

/** 複数ヘッダー名候補から列を解決（先に見つかったものを優先） */
function getColumnIndexByHeaders_(sheet, headerNames, defaultIdx) {
  const names = Array.isArray(headerNames) ? headerNames : [headerNames];
  for (let i = 0; i < names.length; i++) {
    const idx = getColumnIndexByHeader_(sheet, names[i], -1);
    if (idx !== -1) return idx;
  }
  Logger.log('ヘッダー %s が見つかりませんでした。デフォルト値 %s を使用します。', JSON.stringify(names), defaultIdx);
  return defaultIdx;
}

// フォルダ名→IDのキャッシュ用（Map: サニタイズ後フォルダ名 → DriveフォルダID）
var folderCache_ = null;

/**
 * フォルダ名をDrive使用可能な文字列に変換する。
 * 職人管理側の UtilitiesEx.sanitizeName と同じルールを使い、フォルダ名の不一致を防ぐ。
 * @param {string} name
 * @returns {string}
 */
function sanitizeName_(name) {
  return String(name || '')
    .replace(/[\\/#$%*?:<>|"]/g, '-')
    .trim() || 'untitled';
}

/**
 * 職人シートからsiteIdで行番号を検索する。
 * folderId書き込み時に getLastRow() 依存の行番号ズレを防ぐため使用する。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} siteId
 * @returns {number} 見つかった行番号（1始まり）。見つからない場合は -1。
 */
function findWorkerRowBySiteId_(sheet, siteId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] && ids[i][0].toString().trim() === siteId) {
      return i + 2;
    }
  }
  return -1;
}

/**
 * 現場フォルダを作成・取得する（高速スキップ版）
 * ScriptLock 内でキャッシュ参照・作成し、別実行とのフォルダ二重作成を抑止する
 * @returns {string|null} DriveフォルダID（失敗時はnull）
 */
function ensureSiteFolder_(siteName) {
  return withMasterSyncScriptLock_(() => {
    try {
      // normalizeName（= normalizeSiteName）＋サニタイズでフォルダ名を統一（表記ゆれで二重作成しない）
      const folderKey = DriveManager_folderKeyFromSiteName(siteName);
      const rootFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_ID);

      // 初回実行時にキャッシュを作成（フォルダ名→IDのMap）
      if (folderCache_ === null) {
        folderCache_ = new Map();
        const folders = rootFolder.getFolders();
        while (folders.hasNext()) {
          const f = folders.next();
          folderCache_.set(f.getName(), f.getId());
        }
      }

      // キャッシュにあれば、フォルダIDを返して終了
      if (folderCache_.has(folderKey)) {
        Logger.log('スキップ（作成済み）: ' + folderKey);
        return folderCache_.get(folderKey);
      }

      // ロック取得後に Drive 上で同名を再確認（キャッシュと実体のズレ対策）
      const dupIt = rootFolder.getFoldersByName(folderKey);
      if (dupIt.hasNext()) {
        const existing = dupIt.next();
        folderCache_.set(folderKey, existing.getId());
        Logger.log('スキップ（Drive上に既存）: ' + folderKey);
        return existing.getId();
      }

      // キャッシュにない場合のみ作成
      const siteFolder = rootFolder.createFolder(folderKey);
      Logger.log('新規フォルダ作成: ' + folderKey);
      Logger.log(
        '[DRIVE_ROOT_AUDIT][大本DB][ensureSiteFolder_] createdNew=true siteName=%s folderKey=%s driveRootId=%s folderId=%s',
        siteName,
        folderKey,
        CONFIG.DRIVE_ROOT_ID,
        siteFolder.getId()
      );

      // 1-7のサブフォルダ作成
      CONFIG.SITE_SUB_FOLDERS.forEach(subName => {
        siteFolder.createFolder(subName);
      });

      // 08_職人報告フォルダと、その中の報告種別フォルダを作成
      const reportRoot = siteFolder.createFolder(CONFIG.REPORT_FOLDER_NAME);
      CONFIG.REPORT_SUB_FOLDERS.forEach(subName => {
        reportRoot.createFolder(subName);
      });

      // キャッシュに追加
      folderCache_.set(folderKey, siteFolder.getId());

      return siteFolder.getId();
    } catch (e) {
      Logger.log('フォルダ作成エラー: ' + e.toString());
      return null;
    }
  });
}

/**
 * 職人シートの既存データを取得（重複追加防止用）
 * 職人シート列構造: A=現場ID, B=現場名
 * @returns {{ byName: Map<string, string>, byId: Map<string, string> }}
 */
function getWorkerSheetData_(sheet) {
  const byName = new Map();
  const byId = new Map();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { byName, byId };

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  values.forEach(row => {
    const siteId = row[0] ? row[0].toString().trim() : '';
    const siteName = normalizeSiteName(row[1] ? row[1].toString() : '');
    if (siteId) byId.set(siteId, siteName);
    if (siteName) byName.set(siteName, siteId);
  });
  return { byName, byId };
}

/**
 * 職人シートへの行追加（A列: 現場ID, B列: 現場名）
 */
function appendWorkerSiteRow_(sheet, site, newId) {
  const lastRow = sheet.getLastRow();
  const newRow = lastRow + 1;
  const wc = CONFIG.WORKER_COLUMNS;
  const st = CONFIG.DEFAULT_WORKER_STATUS || '稼働中';

  sheet.getRange(newRow, wc.ID).setValue(newId);
  sheet.getRange(newRow, wc.NAME).setValue(site.siteName);
  sheet.getRange(newRow, wc.STATUS).setValue(st);
}

/**
 * 職人シートから現場を削除（B列: 現場名で検索）
 */
function deleteFromWorkerSheet_(sheet, siteName) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // B列（現場名）で検索して削除（下から順に処理してズレ防止）
  const values = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  const target = normalizeSiteName(siteName);
  for (let i = values.length - 1; i >= 0; i--) {
    if (normalizeSiteName(values[i][0]) === target) {
      sheet.deleteRow(i + 2); // ヘッダー行分+1
    }
  }
}

/**
 * 職人シートの重複行をクリーンアップする一回限りの関数。
 * 重複する現場（IDまたは名前が同じ）をまとめ、DriveフォルダIDがある行を優先して残す。
 * フォルダIDが複数の重複行に分散している場合は、残す行に書き込んで統合する。
 * GASエディタから runCleanupWorkerSheet() で実行する。
 */
function cleanupWorkerSheet() {
  const sheet = getWorkerSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('データなし。処理をスキップします。');
    return;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  // キー（ID優先、なければ名前）ごとに全行をグループ化
  const groupByKey = new Map(); // key → [{ sheetRow, siteId, siteName, folderId, status }]

  values.forEach((row, idx) => {
    const siteId   = row[0] ? row[0].toString().trim() : '';
    const siteName = row[1] ? row[1].toString().trim() : '';
    const folderId = row[2] ? row[2].toString().trim() : '';
    const status   = row[3] ? row[3].toString().trim() : '';
    const sheetRow = idx + 2;

    // IDも名前も空の行はスキップ（後で削除）
    if (!siteId && !siteName) {
      if (!groupByKey.has('__empty__')) groupByKey.set('__empty__', []);
      groupByKey.get('__empty__').push({ sheetRow, siteId, siteName, folderId, status });
      return;
    }

    // IDがあればIDをキーに、なければ名前をキーに
    const key = siteId || siteName;
    if (!groupByKey.has(key)) groupByKey.set(key, []);
    groupByKey.get(key).push({ sheetRow, siteId, siteName, folderId, status });
  });

  const rowsToDelete = [];
  const warnings = []; // フォルダID競合の警告リスト

  groupByKey.forEach((rows, key) => {
    // 空行グループはすべて削除
    if (key === '__empty__') {
      rows.forEach(r => rowsToDelete.push(r.sheetRow));
      return;
    }

    if (rows.length === 1) return; // 重複なし

    const withFolder = rows.filter(r => r.folderId);
    const uniqueFolderIds = [...new Set(withFolder.map(r => r.folderId))];

    if (uniqueFolderIds.length > 1) {
      // フォルダIDが複数種類ある → 自動削除せずスキップして警告を出す
      warnings.push({
        siteName: rows[0].siteName,
        siteId: rows[0].siteId,
        rows: rows.map(r => ({
          sheetRow: r.sheetRow,
          folderId: r.folderId,
          url: r.folderId
            ? 'https://drive.google.com/drive/folders/' + r.folderId
            : '（なし）'
        }))
      });
      return; // この現場はスキップ（手動確認が必要）
    }

    // フォルダIDが0種類か1種類のみ → 安全に自動処理
    const keepRow = withFolder.length > 0 ? withFolder[0] : rows[0];

    // 残す行にフォルダIDがなく、他の重複行にある場合は引き継ぐ
    if (!keepRow.folderId && uniqueFolderIds.length === 1) {
      keepRow.folderId = uniqueFolderIds[0];
      sheet.getRange(keepRow.sheetRow, 3).setValue(keepRow.folderId);
      Logger.log('フォルダID引き継ぎ: 行%s ← %s', keepRow.sheetRow,
        'https://drive.google.com/drive/folders/' + keepRow.folderId);
    }

    // 残す行以外をすべて削除対象に
    rows.forEach(r => {
      if (r.sheetRow !== keepRow.sheetRow) rowsToDelete.push(r.sheetRow);
    });
  });

  // 下から順に削除してズレを防止
  rowsToDelete.sort((a, b) => b - a).forEach(rowNum => {
    sheet.deleteRow(rowNum);
  });

  Logger.log('クリーンアップ完了: %s行を削除しました。', rowsToDelete.length);

  // フォルダID競合の警告を出力（手動確認が必要な現場）
  if (warnings.length > 0) {
    Logger.log('=== 要手動確認: フォルダIDが複数あるため自動削除をスキップした現場 (%s件) ===', warnings.length);
    warnings.forEach(w => {
      Logger.log('現場名: %s (ID: %s)', w.siteName, w.siteId);
      w.rows.forEach(r => Logger.log('  行%s: %s', r.sheetRow, r.url));
    });
    Logger.log('上記の現場はシートを直接確認して、正しいフォルダIDの行だけを残してください。');
  }
}

function runCleanupWorkerSheet() {
  cleanupWorkerSheet();
}

/**
 * 職人シートの不正データを検出して報告する診断関数。
 * ① A列が SITE-xxx 形式でない行（住所行など）
 * ② B列（現場名）が同じで異なるIDを持つ行（同名重複）
 * データの削除は行わない。GASエディタから runAuditWorkerSheet() で実行。
 */
function auditWorkerSheet() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;
  const DRIVE_FOLDER_URL_BASE = 'https://drive.google.com/drive/folders/';

  const sheet = getWorkerSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('データなし。処理をスキップします。');
    return;
  }

  // 列: A=現場ID, B=現場名, C=DriveフォルダID, D=ステータス
  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  // ① 無効ID行の検出（A列が SITE-xxx 形式でない）
  const invalidIdRows = [];
  values.forEach((row, idx) => {
    const siteId   = row[0] ? row[0].toString().trim() : '';
    const siteName = row[1] ? row[1].toString().trim() : '';
    const folderId = row[2] ? row[2].toString().trim() : '';
    const sheetRow = idx + 2;

    if (!SITE_ID_PATTERN.test(siteId)) {
      invalidIdRows.push({
        sheetRow,
        siteId,
        siteName,
        folderUrl: folderId ? DRIVE_FOLDER_URL_BASE + folderId : '（なし）'
      });
    }
  });

  Logger.log('=== 監査結果: 無効ID行（SITE-xxx 形式でない） %s件 ===', invalidIdRows.length);
  invalidIdRows.forEach(r => {
    Logger.log('  行%s: ID=%s | 現場名=%s | フォルダ=%s', r.sheetRow, r.siteId, r.siteName, r.folderUrl);
  });

  // ② 同名現場の重複検出（B列が同じで異なるIDを持つ行）
  const nameToRows = new Map(); // siteName → [{ sheetRow, siteId, folderUrl }]
  values.forEach((row, idx) => {
    const siteId   = row[0] ? row[0].toString().trim() : '';
    const siteName = row[1] ? row[1].toString().trim() : '';
    const folderId = row[2] ? row[2].toString().trim() : '';
    const sheetRow = idx + 2;

    if (!siteName) return;
    if (!nameToRows.has(siteName)) nameToRows.set(siteName, []);
    nameToRows.get(siteName).push({
      sheetRow,
      siteId,
      folderUrl: folderId ? DRIVE_FOLDER_URL_BASE + folderId : '（なし）'
    });
  });

  const duplicateGroups = [];
  nameToRows.forEach((rows, siteName) => {
    const uniqueIds = [...new Set(rows.map(r => r.siteId))];
    if (uniqueIds.length > 1) {
      duplicateGroups.push({ siteName, rows });
    }
  });

  Logger.log('=== 監査結果: 同名現場の重複 %s件 ===', duplicateGroups.length);
  duplicateGroups.forEach(g => {
    Logger.log('現場名: %s', g.siteName);
    g.rows.forEach(r => Logger.log('  行%s: %s | %s', r.sheetRow, r.siteId, r.folderUrl));
  });

  Logger.log('監査完了。削除は行っていません。');
}

function runAuditWorkerSheet() {
  auditWorkerSheet();
}

/**
 * 職人シートの不正データを自動修復する関数。
 * Step 1: 住所行の修正（SITE-xxx採番）＋同名重複の削除
 * Step 2: DriveルートフォルダをスキャンしてフォルダIDを補完
 * GASエディタから runRepairWorkerSheet() で実行。
 */
function repairWorkerSheet() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;
  const DRIVE_FOLDER_URL_BASE = 'https://drive.google.com/drive/folders/';

  const sheet = getWorkerSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('データなし。処理をスキップします。');
    return;
  }

  // ── Step 1: 住所行の修正 + 同名重複の削除 ─────────────────

  // 列: A=現場ID, B=現場名, C=DriveフォルダID, D=ステータス
  let values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  // 既存の最大SITE-xxx番号を取得（新規採番の基準）
  let maxIdNum = 0;
  values.forEach(row => {
    const siteId = row[0] ? row[0].toString().trim() : '';
    if (SITE_ID_PATTERN.test(siteId)) {
      const num = parseInt(siteId.replace(CONFIG.ID_PREFIX, ''), 10);
      if (!isNaN(num) && num > maxIdNum) maxIdNum = num;
    }
  });

  // 現場名ごとにグループ化
  const nameToRows = new Map(); // siteName → [{ dataIdx, siteId, folderId, isValidId }]
  values.forEach((row, idx) => {
    const siteId   = row[0] ? row[0].toString().trim() : '';
    const siteName = row[1] ? row[1].toString().trim() : '';
    const folderId = row[2] ? row[2].toString().trim() : '';
    const isValidId = SITE_ID_PATTERN.test(siteId);

    if (!siteName) return;
    if (!nameToRows.has(siteName)) nameToRows.set(siteName, []);
    nameToRows.get(siteName).push({ dataIdx: idx, siteId, folderId, isValidId });
  });

  // 書き換え指示（dataIdx → 新しいSITE-xxx ID）
  const idFixes = new Map();
  // 削除対象の行番号（シート行番号、ヘッダー行を考慮して+2）
  const rowsToDelete = new Set();

  nameToRows.forEach((rows, siteName) => {
    const validRows   = rows.filter(r => r.isValidId);
    const invalidRows = rows.filter(r => !r.isValidId);

    if (validRows.length === 0) {
      // SITE-xxx行がない → 住所行（先頭1行）に新規IDを採番、残りは削除
      maxIdNum++;
      const newId = CONFIG.ID_PREFIX + String(maxIdNum).padStart(CONFIG.ID_PADDING, '0');
      idFixes.set(invalidRows[0].dataIdx, newId);
      Logger.log('採番: 現場名="%s" → %s', siteName, newId);
      for (let i = 1; i < invalidRows.length; i++) {
        rowsToDelete.add(invalidRows[i].dataIdx + 2);
      }
    } else {
      // SITE-xxx行がある → 住所行はすべて削除
      invalidRows.forEach(r => rowsToDelete.add(r.dataIdx + 2));

      if (validRows.length > 1) {
        // SITE-xxx同士の重複 → フォルダIDがある行を優先して1行残す
        const withFolder = validRows.filter(r => r.folderId);
        const keepRow = withFolder.length > 0 ? withFolder[0] : validRows[0];
        validRows.forEach(r => {
          if (r.dataIdx !== keepRow.dataIdx) rowsToDelete.add(r.dataIdx + 2);
        });
      }
    }
  });

  // 住所行のA列をSITE-xxx IDで上書き
  idFixes.forEach((newId, dataIdx) => {
    sheet.getRange(dataIdx + 2, 1).setValue(newId);
  });

  // 削除対象行を下から順に削除
  const sortedDeletes = [...rowsToDelete].sort((a, b) => b - a);
  sortedDeletes.forEach(rowNum => sheet.deleteRow(rowNum));

  Logger.log('Step 1 完了: 採番 %s件, 削除 %s行', idFixes.size, sortedDeletes.length);

  // ── Step 2: Driveフォルダスキャンでフォルダ取得 ──────────────

  Logger.log('Driveフォルダをスキャン中...');
  const rootFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_ID);
  const folderMap = new Map(); // 現場名 → folderId

  const folders = rootFolder.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    folderMap.set(folder.getName(), folder.getId());
  }
  Logger.log('Driveフォルダ数: %s件', folderMap.size);

  // 最新のシートデータを再読み込み
  const newLastRow = sheet.getLastRow();
  if (newLastRow < 2) return;
  const updatedValues = sheet.getRange(2, 1, newLastRow - 1, 3).getValues();

  let folderFilled = 0;
  updatedValues.forEach((row, idx) => {
    const siteName = row[1] ? row[1].toString().trim() : '';
    const folderId = row[2] ? row[2].toString().trim() : '';

    if (!siteName || folderId) return; // 現場名なし or フォルダID既存はスキップ

    const matchedId = folderMap.get(siteName);
    if (matchedId) {
      sheet.getRange(idx + 2, 3).setValue(matchedId);
      Logger.log('フォルダID補完: "%s" → %s', siteName, DRIVE_FOLDER_URL_BASE + matchedId);
      folderFilled++;
    }
  });

  Logger.log('Step 2 完了: フォルダID補完 %s件', folderFilled);
  Logger.log('修復完了。runAuditWorkerSheet() で確認してください。');
}

function runRepairWorkerSheet() {
  repairWorkerSheet();
}

/**
 * Master_Sites にあって稼働現場リストにない現場を稼働現場リストに追記する。
 * repairWorkerSheet() で新規採番した SITE-116〜 の現場を稼働現場リストに反映するために使う。
 * GASエディタから runSyncWorkerOnlySites() で実行。
 */
function syncWorkerOnlySites() {
  // 1. Master_Sites を読み込み
  const workerSheet = getWorkerSheet_();
  const workerLastRow = workerSheet.getLastRow();
  if (workerLastRow < 2) {
    Logger.log('Master_Sites にデータなし。');
    return;
  }
  const workerValues = workerSheet.getRange(2, 1, workerLastRow - 1, 3).getValues();

  // 2. 稼働現場リストを読み込み → byId と byName の Map を構築
  const destSheet = getSheetById_(CONFIG.DEST_SPREADSHEET_ID, CONFIG.DEST_SHEET_ID);
  const destData = getDestData_(destSheet); // { byName, byId }

  // 3. Master_Sites の各行を確認し、稼働現場リストに存在しない行を追記
  let added = 0;
  workerValues.forEach(row => {
    const siteId   = row[0] ? row[0].toString().trim() : '';
    const siteName = row[1] ? row[1].toString().trim() : '';
    const folderId = row[2] ? row[2].toString().trim() : '';

    if (!siteId || !siteName) return;

    // 既に稼働現場リストにあればスキップ
    if (destData.byId.has(siteId) || destData.byName.has(siteName)) return;

    // 稼働現場リストに追記（A=現場名, B=現場ID, C=DriveフォルダID）
    const newRow = destSheet.getLastRow() + 1;
    destSheet.getRange(newRow, CONFIG.DEST_COLUMNS.SITE_NAME).setValue(siteName);
    destSheet.getRange(newRow, CONFIG.DEST_COLUMNS.SITE_ID).setValue(siteId);
    if (folderId) {
      // 現場管理SSの稼働現場リストにもC列がある場合のみ書き込む
      try { destSheet.getRange(newRow, 3).setValue(folderId); } catch (_) {}
    }

    // Mapを更新して同一実行内での重複を防止
    destData.byId.set(siteId, { rowNumber: newRow, siteName });
    destData.byName.set(siteName, { rowNumber: newRow, id: siteId });

    // データベースシートにも追記（工期は不明なため空で登録）
    ensureDatabaseEntry_({ siteName, assemblyStart: '', assemblyEnd: '', dismantleStart: '', dismantleEnd: '' });

    Logger.log('稼働現場リストに追記: %s | %s', siteId, siteName);
    added++;
  });

  Logger.log('syncWorkerOnlySites 完了: %s件を追記しました。', added);
}

function runSyncWorkerOnlySites() {
  syncWorkerOnlySites();
}

function getWorkerSheet_() {
  return MasterDb_getWorkerProgressSheet(
    CONFIG.WORKER_SPREADSHEET_ID,
    CONFIG.WORKER_SHEET_NAME,
    CONFIG.WORKER_SHEET_ID
  );
}

/**
 * 工程表2シートのAZ列を走査し、SITE-IDの競合を色カテゴリ付きでログ出力する。
 * - [SYNC_SYNC_CONFLICT] 黄緑×黄緑（要修正）
 * - [SYNC_IGNORE_DUPLICATE] 黄緑×対象外（情報）
 * - [IGNORE_IGNORE_DUPLICATE] 対象外同士（サマリ）
 * 書き込みは一切行わない。GASエディタから runAuditSourceConflicts() で実行。
 */
function auditSourceConflicts() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;

  // idMap: siteId → [entry]
  const idMap = new Map();

  CONFIG.SOURCE_SHEETS.forEach(sourceCfg => {
    const sheet = getSheet_(sourceCfg.spreadsheetId, sourceCfg.sheetName);
    const siteIdColIdx = getColumnIndexByHeader_(sheet, CONFIG.SOURCE_COL_HEADERS.SITE_ID.name, CONFIG.SOURCE_COL_HEADERS.SITE_ID.defaultIdx);
    const keyColIdx    = getColumnIndexByHeader_(sheet, CONFIG.KEY_HEADER, 7);

    const lastRow = sheet.getLastRow();
    const dataStartRow = Math.max(4, sheet.getFrozenRows() + 1);
    if (lastRow < dataStartRow) return;

    const numRows = lastRow - dataStartRow + 1;
    const minCol = Math.min(keyColIdx, siteIdColIdx);
    const maxCol = Math.max(keyColIdx, siteIdColIdx);
    const values = sheet.getRange(dataStartRow, minCol, numRows, maxCol - minCol + 1).getValues();
    const backgrounds = sheet.getRange(dataStartRow, keyColIdx, numRows, 1).getBackgrounds();
    const relKeyIdx    = keyColIdx - minCol;
    const relSiteIdIdx = siteIdColIdx - minCol;

    values.forEach((row, idx) => {
      const siteId   = row[relSiteIdIdx] ? row[relSiteIdIdx].toString().trim() : '';
      const siteName = row[relKeyIdx]    ? row[relKeyIdx].toString().trim()    : '';
      if (!SITE_ID_PATTERN.test(siteId) || !siteName) return;

      const rawBackground = backgrounds[idx][0];
      const backgroundColor = normalizeColor_(rawBackground);
      const colorCategory = classifySourceRowColor_(rawBackground);
      const isSyncTarget = colorCategory === 'SYNC';

      if (!idMap.has(siteId)) idMap.set(siteId, []);
      idMap.get(siteId).push({
        siteId: siteId,
        label: sourceCfg.label,
        sheetName: sourceCfg.sheetName,
        rowNumber: dataStartRow + idx,
        siteName: siteName,
        backgroundColor: backgroundColor,
        colorCategory: colorCategory,
        isSyncTarget: isSyncTarget
      });
    });
  });

  let syncSyncCount = 0;
  let syncIgnoreCount = 0;
  let ignoreIgnoreCount = 0;
  const ignoreIgnoreSiteIds = [];

  /**
   * @param {Object} e
   */
  function logAuditEntry_(e) {
    Logger.log(
      '  - siteId=%s sheetName=%s rowNumber=%s siteName=%s backgroundColor=%s colorCategory=%s isSyncTarget=%s',
      e.siteId,
      e.sheetName,
      e.rowNumber,
      e.siteName,
      e.backgroundColor,
      e.colorCategory,
      e.isSyncTarget
    );
  }

  idMap.forEach(function(entries, siteId) {
    if (entries.length < 2) return;

    const syncEntries = entries.filter(function(e) { return e.isSyncTarget; });
    const nonSyncEntries = entries.filter(function(e) { return !e.isSyncTarget; });

    // 黄緑×黄緑: 同期対象が2件以上かつ、同シート重複 or 同期対象間で現場名不一致
    if (syncEntries.length >= 2) {
      const syncNormNames = new Set(syncEntries.map(function(e) {
        return normalizeSiteName(e.siteName);
      }));
      const syncByLabel = new Map();
      syncEntries.forEach(function(e) {
        if (!syncByLabel.has(e.label)) syncByLabel.set(e.label, []);
        syncByLabel.get(e.label).push(e);
      });
      const hasIntraSheetSyncDup = Array.from(syncByLabel.values()).some(function(rows) {
        return rows.length >= 2;
      });
      const hasSyncNameConflict = syncNormNames.size > 1;

      if (hasIntraSheetSyncDup || hasSyncNameConflict) {
        Logger.log('[SYNC_SYNC_CONFLICT] %s', siteId);
        syncEntries.forEach(logAuditEntry_);
        syncSyncCount++;
      }
    }

    // 黄緑×対象外
    if (syncEntries.length >= 1 && nonSyncEntries.length >= 1) {
      Logger.log('[SYNC_IGNORE_DUPLICATE] %s', siteId);
      entries.forEach(logAuditEntry_);
      syncIgnoreCount++;
    }

    // 対象外×対象外
    if (syncEntries.length === 0 && nonSyncEntries.length >= 2) {
      ignoreIgnoreCount++;
      ignoreIgnoreSiteIds.push(siteId);
    }
  });

  if (ignoreIgnoreCount > 0) {
    Logger.log('[IGNORE_IGNORE_DUPLICATE] 件数: %s', ignoreIgnoreCount);
    Logger.log('[IGNORE_IGNORE_DUPLICATE] siteId一覧: %s', ignoreIgnoreSiteIds.join(', '));
  }

  Logger.log(
    '監査完了 — SYNC_SYNC: %s件, SYNC_IGNORE: %s件, IGNORE_IGNORE: %s件',
    syncSyncCount,
    syncIgnoreCount,
    ignoreIgnoreCount
  );
}

function runAuditSourceConflicts() {
  auditSourceConflicts();
}

/**
 * auditSourceConflicts() で検出した競合行のAZ列を空白にクリアする。
 * ① 同シート内重複 → 2行目以降の重複行をクリア（先頭行を正とする）
 * ② クロスシート競合 → 2026年度シートの行をクリア（2025年度を正とする）
 * GASエディタから runFixSourceConflicts() で実行。
 */
function fixSourceConflicts() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;
  const LABEL_2025 = '2025年度';
  const LABEL_2026 = '2026年度';

  // シートオブジェクトとsiteIdColIdxをラベルで保持
  const sheetMap = new Map(); // label → { sheet, siteIdColIdx, dataStartRow }
  // idMap: siteId → [{ label, rowNum, siteName, sheet, siteIdColIdx }]
  const idMap = new Map();

  CONFIG.SOURCE_SHEETS.forEach(sourceCfg => {
    const sheet = getSheet_(sourceCfg.spreadsheetId, sourceCfg.sheetName);
    const siteIdColIdx = getColumnIndexByHeader_(sheet, CONFIG.SOURCE_COL_HEADERS.SITE_ID.name, CONFIG.SOURCE_COL_HEADERS.SITE_ID.defaultIdx);
    const keyColIdx    = getColumnIndexByHeader_(sheet, CONFIG.KEY_HEADER, 7);

    const lastRow = sheet.getLastRow();
    const dataStartRow = Math.max(4, sheet.getFrozenRows() + 1);
    sheetMap.set(sourceCfg.label, { sheet, siteIdColIdx, dataStartRow });
    if (lastRow < dataStartRow) return;

    const minCol = Math.min(keyColIdx, siteIdColIdx);
    const maxCol = Math.max(keyColIdx, siteIdColIdx);
    const values = sheet.getRange(dataStartRow, minCol, lastRow - dataStartRow + 1, maxCol - minCol + 1).getValues();
    const relKeyIdx    = keyColIdx - minCol;
    const relSiteIdIdx = siteIdColIdx - minCol;

    values.forEach((row, idx) => {
      const siteId   = row[relSiteIdIdx] ? row[relSiteIdIdx].toString().trim() : '';
      const siteName = row[relKeyIdx]    ? row[relKeyIdx].toString().trim()    : '';
      if (!SITE_ID_PATTERN.test(siteId) || !siteName) return;

      if (!idMap.has(siteId)) idMap.set(siteId, []);
      idMap.get(siteId).push({ label: sourceCfg.label, rowNum: dataStartRow + idx, siteName, sheet, siteIdColIdx });
    });
  });

  let cleared = 0;

  idMap.forEach((entries, siteId) => {
    // ① 同シート内重複: 同じラベルに2件以上ある場合、2件目以降をクリア
    const byLabel = new Map();
    entries.forEach(e => {
      if (!byLabel.has(e.label)) byLabel.set(e.label, []);
      byLabel.get(e.label).push(e);
    });
    byLabel.forEach((rows, label) => {
      if (rows.length > 1) {
        rows.slice(1).forEach(r => {
          r.sheet.getRange(r.rowNum, r.siteIdColIdx).setValue('');
          Logger.log('[同シート重複クリア] %s (%s) 行%s: %s', siteId, label, r.rowNum, r.siteName);
          cleared++;
        });
      }
    });

    // ② クロスシート競合: 同じIDで異なる現場名 → 2026年度の行をクリア
    const uniqueNames = [...new Set(entries.map(e => e.siteName))];
    if (uniqueNames.length > 1) {
      entries
        .filter(e => e.label === LABEL_2026)
        .forEach(r => {
          // 既に①でクリア済みでもsetValue('')は副作用なし
          r.sheet.getRange(r.rowNum, r.siteIdColIdx).setValue('');
          Logger.log('[クロス競合クリア] %s (%s) 行%s: %s', siteId, r.label, r.rowNum, r.siteName);
          cleared++;
        });
    }
  });

  Logger.log('fixSourceConflicts 完了: %s箇所をクリアしました。', cleared);
  Logger.log('次に syncSitesWithSchedule() を実行すると、クリアした行に新規IDが採番されます。');
}

function runFixSourceConflicts() {
  fixSourceConflicts();
}

/**
 * データベースシートと稼働現場リストの重複行を削除する。
 * 同じ現場名が複数行ある場合、現場IDが入っている行を優先して残す。
 * IDがない重複行は下から順に削除する。GASエディタから runDeduplicateManagementSheets() で実行。
 */
function deduplicateManagementSheets() {
  // ── データベースシート (A=現場名) ──────────────────────────────
  const dbSheet = getSheetById_(CONFIG.DEST_SPREADSHEET_ID, CONFIG.DB_SHEET_ID);
  const dbDeleted = deduplicateSheet_(dbSheet, CONFIG.DB_COLUMNS.SITE_NAME, null);
  Logger.log('データベース: %s行を削除しました。', dbDeleted);

  // ── 稼働現場リスト (A=現場名, B=現場ID) ─────────────────────────
  const destSheet = getSheetById_(CONFIG.DEST_SPREADSHEET_ID, CONFIG.DEST_SHEET_ID);
  const destDeleted = deduplicateSheet_(destSheet, CONFIG.DEST_COLUMNS.SITE_NAME, CONFIG.DEST_COLUMNS.SITE_ID);
  Logger.log('稼働現場リスト: %s行を削除しました。', destDeleted);

  Logger.log('deduplicateManagementSheets 完了。');
}

/**
 * 指定シートの重複行を削除するユーティリティ。
 * @param {Sheet} sheet 対象シート
 * @param {number} nameCol 現場名の列番号（1始まり）
 * @param {number|null} idCol 現場IDの列番号（優先判定に使用、nullなら無視）
 * @returns {number} 削除した行数
 */
function deduplicateSheet_(sheet, nameCol, idCol) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const SITE_ID_PATTERN = /^SITE-\d+$/;
  const numCols = idCol ? Math.max(nameCol, idCol) : nameCol;
  const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

  // nameMap: siteName → { keepIdx: dataIdx, hasId: boolean }
  const nameMap = new Map();
  const rowsToDelete = []; // dataIdx（0始まり）を収集

  values.forEach((row, idx) => {
    const siteName = row[nameCol - 1] ? row[nameCol - 1].toString().trim() : '';
    if (!siteName) return;

    // SITE-xxx 形式かどうかで判定（郵便番号・現場名などを除外）
    const hasId = idCol
      ? SITE_ID_PATTERN.test(row[idCol - 1] ? row[idCol - 1].toString().trim() : '')
      : false;

    if (!nameMap.has(siteName)) {
      nameMap.set(siteName, { keepIdx: idx, hasId });
    } else {
      const kept = nameMap.get(siteName);
      if (!kept.hasId && hasId) {
        // 既存保持行よりIDがある今の行の方が優先 → 既存を削除対象に変更
        rowsToDelete.push(kept.keepIdx);
        nameMap.set(siteName, { keepIdx: idx, hasId });
      } else {
        // 今の行は捨てる
        rowsToDelete.push(idx);
      }
    }
  });

  // 下から順に削除（行番号ズレを防止）
  const sheetRowsToDelete = rowsToDelete.map(idx => idx + 2); // シート行番号（ヘッダー+1）
  sheetRowsToDelete.sort((a, b) => b - a).forEach(rowNum => sheet.deleteRow(rowNum));

  return sheetRowsToDelete.length;
}

function runDeduplicateManagementSheets() {
  deduplicateManagementSheets();
}

/**
 * 稼働現場リストを Master_Sites の内容で完全再構築する。
 * 行1（ヘッダー）・行2（入力行）を保持し、行3以降を全削除してから書き直す。
 * 実行後に syncSitesWithSchedule() を走らせると工期データ（E〜H列）が補完される。
 * GASエディタから runRebuildDestSheetFromMaster() で実行。
 */
function rebuildDestSheetFromMaster() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;
  const PRESERVED_ROWS = 2; // 行1=ヘッダー, 行2=「新規現場を入力」を保持

  // 1. Master_Sites を読み込み（A=現場ID, B=現場名, C=DriveフォルダID）
  const workerSheet = getWorkerSheet_();
  const workerLastRow = workerSheet.getLastRow();
  if (workerLastRow < 2) {
    Logger.log('Master_Sites にデータなし。');
    return;
  }
  const workerValues = workerSheet.getRange(2, 1, workerLastRow - 1, 3).getValues();

  // 2. SITE-xxx IDを持つ行のみ抽出し、SITE番号順にソート
  const sites = workerValues
    .map(row => ({
      siteId:   row[0] ? row[0].toString().trim() : '',
      siteName: row[1] ? row[1].toString().trim() : '',
      folderId: row[2] ? row[2].toString().trim() : '',
    }))
    .filter(s => SITE_ID_PATTERN.test(s.siteId) && s.siteName)
    .sort((a, b) => {
      return parseInt(a.siteId.replace(CONFIG.ID_PREFIX, ''), 10)
           - parseInt(b.siteId.replace(CONFIG.ID_PREFIX, ''), 10);
    });

  Logger.log('Master_Sitesから %s件の現場を取得', sites.length);

  // 3. 稼働現場リストの行3以降をすべて削除
  const destSheet = getSheetById_(CONFIG.DEST_SPREADSHEET_ID, CONFIG.DEST_SHEET_ID);
  const lastRow = destSheet.getLastRow();
  if (lastRow > PRESERVED_ROWS) {
    destSheet.deleteRows(PRESERVED_ROWS + 1, lastRow - PRESERVED_ROWS);
    Logger.log('%s行を削除しました。', lastRow - PRESERVED_ROWS);
  }

  // 4. Master_Sites のデータを書き込み（A=現場名, B=現場ID, C=DriveフォルダID）
  if (sites.length > 0) {
    const newData = sites.map(s => [s.siteName, s.siteId, s.folderId || '']);
    destSheet.getRange(PRESERVED_ROWS + 1, 1, newData.length, 3).setValues(newData);
  }

  Logger.log('rebuildDestSheetFromMaster 完了: %s件を書き込みました。', sites.length);
  Logger.log('次に syncSitesWithSchedule() を実行して工期データ（E〜H列）を補完してください。');
}

function runRebuildDestSheetFromMaster() {
  rebuildDestSheetFromMaster();
}

/**
 * ソースシート（2025年・2026年）のAZ列エントリを Master_Sites と照合し、
 * 「同じIDだが現場名が異なる」行を報告する（削除は行わない）。
 * GASエディタから runAuditSourceVsMaster() で実行。
 */
function auditSourceVsMaster() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;

  // Master_Sites の ID→名前 Map を構築
  const workerSheet = getWorkerSheet_();
  const workerLastRow = workerSheet.getLastRow();
  const masterMap = new Map(); // siteId → siteName
  if (workerLastRow >= 2) {
    workerSheet.getRange(2, 1, workerLastRow - 1, 2).getValues().forEach(row => {
      const id   = row[0] ? row[0].toString().trim() : '';
      const name = row[1] ? row[1].toString().trim() : '';
      if (SITE_ID_PATTERN.test(id) && name) masterMap.set(id, name);
    });
  }
  Logger.log('Master_Sites: %s件', masterMap.size);

  let mismatchCount = 0;

  CONFIG.SOURCE_SHEETS.forEach(sourceCfg => {
    const sheet = getSheet_(sourceCfg.spreadsheetId, sourceCfg.sheetName);
    const siteIdColIdx = getColumnIndexByHeader_(sheet, CONFIG.SOURCE_COL_HEADERS.SITE_ID.name, CONFIG.SOURCE_COL_HEADERS.SITE_ID.defaultIdx);
    const keyColIdx    = getColumnIndexByHeader_(sheet, CONFIG.KEY_HEADER, 7);

    const lastRow = sheet.getLastRow();
    const dataStartRow = Math.max(4, sheet.getFrozenRows() + 1);
    if (lastRow < dataStartRow) return;

    const minCol = Math.min(keyColIdx, siteIdColIdx);
    const maxCol = Math.max(keyColIdx, siteIdColIdx);
    const values = sheet.getRange(dataStartRow, minCol, lastRow - dataStartRow + 1, maxCol - minCol + 1).getValues();
    const relKeyIdx    = keyColIdx - minCol;
    const relSiteIdIdx = siteIdColIdx - minCol;

    values.forEach((row, idx) => {
      const siteId   = row[relSiteIdIdx] ? row[relSiteIdIdx].toString().trim() : '';
      const siteName = row[relKeyIdx]    ? row[relKeyIdx].toString().trim()    : '';
      if (!SITE_ID_PATTERN.test(siteId) || !siteName) return;

      const masterName = masterMap.get(siteId);
      if (masterName && masterName !== siteName) {
        Logger.log('[不整合] %s (%s) 行%s: AZ列="%s" / Master_Sites="%s"',
          siteId, sourceCfg.label, dataStartRow + idx, siteName, masterName);
        mismatchCount++;
      }
    });
  });

  Logger.log('監査完了: Master_Sites との不整合 %s件', mismatchCount);
}

function runAuditSourceVsMaster() {
  auditSourceVsMaster();
}

/**
 * ソースシートのAZ列で「Master_Sitesの現場名と異なる」エントリをクリアする。
 * auditSourceVsMaster() で事前に不整合を確認してから実行すること。
 * GASエディタから runFixSourceVsMaster() で実行。
 */
function fixSourceVsMaster() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;

  // Master_Sites の ID→名前 Map を構築
  const workerSheet = getWorkerSheet_();
  const workerLastRow = workerSheet.getLastRow();
  const masterMap = new Map(); // siteId → siteName
  if (workerLastRow >= 2) {
    workerSheet.getRange(2, 1, workerLastRow - 1, 2).getValues().forEach(row => {
      const id   = row[0] ? row[0].toString().trim() : '';
      const name = row[1] ? row[1].toString().trim() : '';
      if (SITE_ID_PATTERN.test(id) && name) masterMap.set(id, name);
    });
  }

  let cleared = 0;

  CONFIG.SOURCE_SHEETS.forEach(sourceCfg => {
    const sheet = getSheet_(sourceCfg.spreadsheetId, sourceCfg.sheetName);
    const siteIdColIdx = getColumnIndexByHeader_(sheet, CONFIG.SOURCE_COL_HEADERS.SITE_ID.name, CONFIG.SOURCE_COL_HEADERS.SITE_ID.defaultIdx);
    const keyColIdx    = getColumnIndexByHeader_(sheet, CONFIG.KEY_HEADER, 7);

    const lastRow = sheet.getLastRow();
    const dataStartRow = Math.max(4, sheet.getFrozenRows() + 1);
    if (lastRow < dataStartRow) return;

    const minCol = Math.min(keyColIdx, siteIdColIdx);
    const maxCol = Math.max(keyColIdx, siteIdColIdx);
    const values = sheet.getRange(dataStartRow, minCol, lastRow - dataStartRow + 1, maxCol - minCol + 1).getValues();
    const relKeyIdx    = keyColIdx - minCol;
    const relSiteIdIdx = siteIdColIdx - minCol;

    values.forEach((row, idx) => {
      const siteId   = row[relSiteIdIdx] ? row[relSiteIdIdx].toString().trim() : '';
      const siteName = row[relKeyIdx]    ? row[relKeyIdx].toString().trim()    : '';
      if (!SITE_ID_PATTERN.test(siteId) || !siteName) return;

      const masterName = masterMap.get(siteId);
      if (masterName && masterName !== siteName) {
        sheet.getRange(dataStartRow + idx, siteIdColIdx).setValue('');
        Logger.log('[クリア] %s (%s) 行%s: "%s" (Master: "%s")',
          siteId, sourceCfg.label, dataStartRow + idx, siteName, masterName);
        cleared++;
      }
    });
  });

  Logger.log('fixSourceVsMaster 完了: %s箇所をクリアしました。', cleared);
  Logger.log('次に syncSitesWithSchedule() を実行してリネームが0件になることを確認してください。');
}

function runFixSourceVsMaster() {
  fixSourceVsMaster();
}

/**
 * 稼働現場リストのB列（SITE_ID）でSITE-xxx形式でない値を検出する。
 * AZ列に住所が書き込まれる根本原因の特定に使う。
 * GASエディタから runAuditDestSiteIds() で実行。
 */
function auditDestSiteIds() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;
  const destSheet = getDestSheet_();
  const lastRow = destSheet.getLastRow();
  if (lastRow < CONFIG.DEST_DATA_START_ROW) {
    Logger.log('データなし。');
    return;
  }
  const values = destSheet.getRange(CONFIG.DEST_DATA_START_ROW, 1, lastRow - CONFIG.DEST_DATA_START_ROW + 1, 2).getValues();
  let invalidCount = 0;
  values.forEach((row, idx) => {
    const siteName = row[0] ? row[0].toString().trim() : '';
    const siteId   = row[1] ? row[1].toString().trim() : '';
    if (!siteName) return;
    if (siteId && !SITE_ID_PATTERN.test(siteId)) {
      Logger.log('[不正B列] 行%s: 現場名="%s" / B列="%s"', CONFIG.DEST_DATA_START_ROW + idx, siteName, siteId);
      invalidCount++;
    }
  });
  Logger.log('監査完了: 不正B列 %s件', invalidCount);
}

function runAuditDestSiteIds() {
  auditDestSiteIds();
}

/**
 * 稼働現場リストのB列でSITE-xxx形式でない値をクリアする。
 * runAuditDestSiteIds() で不正を確認してから実行すること。
 * GASエディタから runFixDestSiteIds() で実行。
 */
function fixDestSiteIds() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;
  const destSheet = getDestSheet_();
  const lastRow = destSheet.getLastRow();
  if (lastRow < CONFIG.DEST_DATA_START_ROW) {
    Logger.log('データなし。');
    return;
  }
  const values = destSheet.getRange(CONFIG.DEST_DATA_START_ROW, 1, lastRow - CONFIG.DEST_DATA_START_ROW + 1, 2).getValues();
  let cleared = 0;
  values.forEach((row, idx) => {
    const siteName = row[0] ? row[0].toString().trim() : '';
    const siteId   = row[1] ? row[1].toString().trim() : '';
    if (!siteName) return;
    if (siteId && !SITE_ID_PATTERN.test(siteId)) {
      destSheet.getRange(CONFIG.DEST_DATA_START_ROW + idx, 2).setValue('');
      Logger.log('[クリア] 行%s: "%s" (B列: "%s")', CONFIG.DEST_DATA_START_ROW + idx, siteName, siteId);
      cleared++;
    }
  });
  Logger.log('fixDestSiteIds 完了: %s件クリア。', cleared);
  if (cleared > 0) Logger.log('次に runClearInvalidSourceAZEntries() → syncSitesWithSchedule() を実行してください。');
}

function runFixDestSiteIds() {
  fixDestSiteIds();
}

/**
 * ソースシート（2025年・2026年）のAZ列で SITE-xxx 形式でない非空セルをクリアする。
 * GASエディタから runClearInvalidSourceAZEntries() で実行。
 */
function clearInvalidSourceAZEntries() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;
  let totalCleared = 0;

  CONFIG.SOURCE_SHEETS.forEach(sourceCfg => {
    const sheet = getSheet_(sourceCfg.spreadsheetId, sourceCfg.sheetName);
    const siteIdColIdx = getColumnIndexByHeader_(sheet, CONFIG.SOURCE_COL_HEADERS.SITE_ID.name, CONFIG.SOURCE_COL_HEADERS.SITE_ID.defaultIdx);

    const lastRow = sheet.getLastRow();
    const dataStartRow = Math.max(4, sheet.getFrozenRows() + 1);
    if (lastRow < dataStartRow) return;

    const values = sheet.getRange(dataStartRow, siteIdColIdx, lastRow - dataStartRow + 1, 1).getValues();
    let cleared = 0;

    values.forEach((row, idx) => {
      const cellVal = row[0] ? row[0].toString().trim() : '';
      if (cellVal && !SITE_ID_PATTERN.test(cellVal)) {
        sheet.getRange(dataStartRow + idx, siteIdColIdx).setValue('');
        Logger.log('[クリア] %s 行%s: "%s"', sourceCfg.label, dataStartRow + idx, cellVal);
        cleared++;
      }
    });

    Logger.log('%s: %s件クリアしました。', sourceCfg.label, cleared);
    totalCleared += cleared;
  });

  Logger.log('clearInvalidSourceAZEntries 完了: 合計 %s件クリア。', totalCleared);
}

function runClearInvalidSourceAZEntries() {
  clearInvalidSourceAZEntries();
}

/**
 * Driveルートフォルダ内のサブフォルダを Master_Sites と照合し、
 * 孤立フォルダ（名前がMaster_Sitesに存在しない）を報告・削除する。
 * 中身が空の孤立フォルダのみゴミ箱移動する。中身がある場合は警告のみ。
 * GASエディタから runAuditAndCleanDriveRootFolders() で実行。
 */
function auditAndCleanDriveRootFolders() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;

  // Master_Sites の現場名セットを構築
  const workerSheet = getWorkerSheet_();
  const workerLastRow = workerSheet.getLastRow();
  const masterNames = new Set();
  if (workerLastRow >= 2) {
    workerSheet.getRange(2, 1, workerLastRow - 1, 2).getValues().forEach(row => {
      const id   = row[0] ? row[0].toString().trim() : '';
      const name = row[1] ? row[1].toString().trim() : '';
      if (SITE_ID_PATTERN.test(id) && name) masterNames.add(name);
    });
  }
  Logger.log('Master_Sites 登録現場数: %s件', masterNames.size);

  // Driveルートフォルダを走査
  const rootFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_ID);
  const subFolders = rootFolder.getFolders();

  let totalFolders = 0;
  let deletedFolders = 0;
  let warningFolders = 0;

  while (subFolders.hasNext()) {
    const folder = subFolders.next();
    const folderName = folder.getName();
    totalFolders++;

    if (masterNames.has(folderName)) continue; // 正常なフォルダ → スキップ

    // 孤立フォルダ: 中身を確認
    const hasFiles = folder.getFiles().hasNext();
    const hasSubFolders = folder.getFolders().hasNext();
    const isEmpty = !hasFiles && !hasSubFolders;

    if (isEmpty) {
      folder.setTrashed(true);
      Logger.log('[削除] 孤立フォルダ（空）: "%s"', folderName);
      deletedFolders++;
    } else {
      Logger.log('[警告] 孤立フォルダ（中身あり・手動確認要）: "%s"', folderName);
      warningFolders++;
    }
  }

  Logger.log('完了: 合計 %s件, 削除 %s件, 要確認 %s件', totalFolders, deletedFolders, warningFolders);
}

function runAuditAndCleanDriveRootFolders() {
  auditAndCleanDriveRootFolders();
}

// ============================================================
// DriveフォルダID 横断監査（読み取り専用）
// ============================================================

/** @const */
var AUDIT_SITE_ID_PATTERN_ = /^SITE-\d+$/i;

/**
 * フォルダ名末尾の __SITE-xxx を除去（職人進捗 DriveService と同等）
 * @param {string} name
 * @returns {string}
 */
function auditStripSiteIdSuffix_(name) {
  return String(name || '').replace(/\s+__SITE-\d+\s*$/i, '').trim();
}

/**
 * フォルダ名末尾から SITE-ID を抽出
 * @param {string} folderName
 * @returns {string}
 */
function auditExtractSiteIdFromFolderName_(folderName) {
  const m = String(folderName || '').match(/\s+__(SITE-\d+)\s*$/i);
  return m ? m[1].toUpperCase() : '';
}

/**
 * L0〜L4 でフォルダ名と現場名の一致を判定
 * @returns {{ ok: boolean, level: string }}
 */
function auditEvaluateFolderNameMatch_(folderName, siteName, siteId) {
  const fn = String(folderName || '');
  const sn = String(siteName || '');
  if (!fn || !sn) return { ok: false, level: 'none' };

  if (fn.trim() === sn.trim()) return { ok: true, level: 'L0' };

  if (normalizeSiteName(fn) === normalizeSiteName(sn)) return { ok: true, level: 'L1' };

  if (
    DriveManager_folderKeyFromSiteName(fn) === DriveManager_folderKeyFromSiteName(sn)
  ) {
    return { ok: true, level: 'L2' };
  }

  const suffixId = auditExtractSiteIdFromFolderName_(fn);
  const idNorm = siteId ? String(siteId).trim().toUpperCase() : '';
  if (suffixId && idNorm && suffixId === idNorm) return { ok: true, level: 'L3' };

  if (normalizeSiteName(auditStripSiteIdSuffix_(fn)) === normalizeSiteName(sn)) {
    return { ok: true, level: 'L4' };
  }

  return { ok: false, level: 'none' };
}

/**
 * @param {{ siteIdFilter?: string|null }} options
 * @returns {Array<{source:string,siteId:string,siteName:string,folderId:string,sheetRow:number}>}
 */
function auditLoadMasterSitesRows_(options) {
  const opts = options || {};
  const filter = opts.siteIdFilter
    ? String(opts.siteIdFilter).trim().toUpperCase()
    : '';
  const workerSheet = getWorkerSheet_();
  const lastRow = workerSheet.getLastRow();
  const out = [];
  if (lastRow < 2) return out;

  const values = workerSheet.getRange(2, 1, lastRow - 1, 4).getValues();
  values.forEach((row, idx) => {
    const siteId = row[0] ? row[0].toString().trim() : '';
    const siteName = row[1] ? row[1].toString().trim() : '';
    const folderId = row[2] ? row[2].toString().trim() : '';
    if (!AUDIT_SITE_ID_PATTERN_.test(siteId)) return;
    if (filter && siteId.toUpperCase() !== filter) return;
    out.push({
      source: 'Master_Sites',
      siteId: siteId,
      siteName: siteName,
      folderId: folderId,
      sheetRow: 2 + idx
    });
  });
  return out;
}

/**
 * @param {{ siteIdFilter?: string|null }} options
 * @returns {Array<{source:string,siteId:string,siteName:string,folderId:string,sheetRow:number}>}
 */
function auditLoadDestSiteRows_(options) {
  const opts = options || {};
  const filter = opts.siteIdFilter
    ? String(opts.siteIdFilter).trim().toUpperCase()
    : '';
  const destSheet = getDestSheet_();
  const lastRow = destSheet.getLastRow();
  const out = [];
  if (lastRow < CONFIG.DEST_DATA_START_ROW) return out;

  const numRows = lastRow - CONFIG.DEST_DATA_START_ROW + 1;
  const values = destSheet.getRange(
    CONFIG.DEST_DATA_START_ROW,
    1,
    numRows,
    3
  ).getValues();

  values.forEach((row, idx) => {
    const siteName = row[0] ? row[0].toString().trim() : '';
    const siteId = row[1] ? row[1].toString().trim() : '';
    const folderId = row[2] ? row[2].toString().trim() : '';
    if (!AUDIT_SITE_ID_PATTERN_.test(siteId)) return;
    if (filter && siteId.toUpperCase() !== filter) return;
    out.push({
      source: '稼働現場リスト',
      siteId: siteId,
      siteName: siteName,
      folderId: folderId,
      sheetRow: CONFIG.DEST_DATA_START_ROW + idx
    });
  });
  return out;
}

/**
 * @param {string} folderId
 * @param {Map<string, object>} folderCache
 * @returns {{ status: string, folderName?: string, error?: string }}
 */
function auditResolveFolder_(folderId, folderCache) {
  if (!folderId) return { status: 'empty' };
  if (folderCache.has(folderId)) return folderCache.get(folderId);

  let result;
  try {
    const folder = DriveApp.getFolderById(folderId);
    result = { status: 'ok', folderName: folder.getName() };
  } catch (e) {
    result = { status: 'invalid', error: e.toString() };
  }
  folderCache.set(folderId, result);
  return result;
}

/**
 * Master_Sites / 稼働現場リストの DriveフォルダID を横断監査（読み取り専用）。
 * @param {{ siteIdFilter?: string, verbose?: boolean }} [options]
 * @returns {object} 監査結果サマリ
 */
function auditSiteDriveFolderIntegrity_(options) {
  const opts = options || {};
  const verbose = !!opts.verbose;
  const siteIdFilter = opts.siteIdFilter
    ? String(opts.siteIdFilter).trim().toUpperCase()
    : '';

  Logger.log('=== auditSiteDriveFolderIntegrity 開始 ===');
  Logger.log('実行日時: %s', Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss"));
  if (siteIdFilter) Logger.log('siteIdFilter: %s', siteIdFilter);
  Logger.log('Driveルート: %s', CONFIG.DRIVE_ROOT_ID);
  Logger.log(
    'Master_Sites: %s / %s',
    CONFIG.WORKER_SPREADSHEET_ID,
    CONFIG.WORKER_SHEET_NAME
  );
  Logger.log(
    '稼働現場リスト: %s / gid=%s',
    CONFIG.DEST_SPREADSHEET_ID,
    CONFIG.DEST_SHEET_ID
  );

  const filterOpts = siteIdFilter ? { siteIdFilter: siteIdFilter } : {};
  const masterRows = auditLoadMasterSitesRows_(filterOpts);
  const destRows = auditLoadDestSiteRows_(filterOpts);
  Logger.log('読込行数: Master_Sites=%s, 稼働現場リスト=%s', masterRows.length, destRows.length);

  const folderCache = new Map();
  const stats = {
    OK: 0,
    MISMATCH: 0,
    SHARED_ID: 0,
    CROSS_SHEET_CONFLICT: 0,
    EMPTY_ID: 0,
    INVALID_ID: 0
  };

  const mismatchEntries = [];
  const emptyEntries = [];
  const invalidEntries = [];
  /** @type {Map<string, Array>} folderId → 行エントリ */
  const folderIdToEntries = new Map();
  /** @type {Map<string, { master?: object, dest?: object }>} */
  const siteIdBySheet = new Map();

  const allRows = masterRows.concat(destRows);

  allRows.forEach(entry => {
    const sheetKey = entry.source === 'Master_Sites' ? 'master' : 'dest';
    if (!siteIdBySheet.has(entry.siteId)) siteIdBySheet.set(entry.siteId, {});
    siteIdBySheet.get(entry.siteId)[sheetKey] = {
      folderId: entry.folderId,
      sheetRow: entry.sheetRow,
      siteName: entry.siteName,
      source: entry.source
    };

    if (!entry.folderId) {
      stats.EMPTY_ID++;
      emptyEntries.push(entry);
      return;
    }

    const resolved = auditResolveFolder_(entry.folderId, folderCache);
    if (resolved.status === 'invalid') {
      stats.INVALID_ID++;
      invalidEntries.push(Object.assign({}, entry, { error: resolved.error || '' }));
      return;
    }

    const folderName = resolved.folderName || '';
    const match = auditEvaluateFolderNameMatch_(folderName, entry.siteName, entry.siteId);

    if (match.ok) {
      stats.OK++;
      if (verbose) {
        Logger.log(
          'OK | %s | %s 行%s | %s | matchLevel=%s | folderId=%s',
          entry.siteId,
          entry.source,
          entry.sheetRow,
          entry.siteName,
          match.level,
          entry.folderId
        );
      }
    } else {
      stats.MISMATCH++;
      mismatchEntries.push(
        Object.assign({}, entry, { folderName: folderName, matchLevel: match.level })
      );
    }

    if (!folderIdToEntries.has(entry.folderId)) {
      folderIdToEntries.set(entry.folderId, []);
    }
    folderIdToEntries.get(entry.folderId).push(
      Object.assign({}, entry, { folderName: folderName })
    );
  });

  const sharedGroups = [];
  folderIdToEntries.forEach((entries, folderId) => {
    const uniqueSiteIds = [];
    const seen = new Set();
    entries.forEach(e => {
      const id = e.siteId.toUpperCase();
      if (!seen.has(id)) {
        seen.add(id);
        uniqueSiteIds.push(id);
      }
    });
    if (uniqueSiteIds.length < 2) return;

    const folderName = (entries[0] && entries[0].folderName) || '';
    const dedupedSites = [];
    const siteSeen = new Set();
    entries.forEach(e => {
      const key = e.siteId + '\u0001' + e.source;
      if (siteSeen.has(key)) return;
      siteSeen.add(key);
      dedupedSites.push(e);
    });
    sharedGroups.push({
      folderId: folderId,
      folderName: folderName,
      sites: dedupedSites
    });
  });
  stats.SHARED_ID = sharedGroups.length;

  const crossConflicts = [];
  siteIdBySheet.forEach((sheets, siteId) => {
    if (!sheets.master || !sheets.dest) return;
    const masterFid = String(sheets.master.folderId || '').trim();
    const destFid = String(sheets.dest.folderId || '').trim();
    if (masterFid === destFid) return;
    stats.CROSS_SHEET_CONFLICT++;
    crossConflicts.push({
      siteId: siteId,
      master: sheets.master,
      dest: sheets.dest
    });
  });

  if (sharedGroups.length > 0) {
    Logger.log('');
    Logger.log('--- [CRITICAL] 同一フォルダIDを複数SITE-IDが共有 ---');
    sharedGroups.forEach(g => {
      Logger.log('SHARED_ID | folderId=%s | folderName=%s', g.folderId, g.folderName);
      g.sites.forEach(s => {
        Logger.log(
          '  - %s | %s 行%s | %s',
          s.siteId,
          s.source,
          s.sheetRow,
          s.siteName
        );
      });
    });
  }

  if (mismatchEntries.length > 0) {
    Logger.log('');
    Logger.log('--- [ERROR] フォルダ名不一致 ---');
    mismatchEntries.forEach(e => {
      Logger.log('MISMATCH | %s | %s 行%s', e.siteId, e.source, e.sheetRow);
      Logger.log('  sheetName: %s', e.siteName);
      Logger.log('  folderId: %s', e.folderId);
      Logger.log('  folderName: %s', e.folderName);
      Logger.log('  matchLevel: %s', e.matchLevel);
      Logger.log('  url: https://drive.google.com/drive/folders/%s', e.folderId);
    });
  }

  if (crossConflicts.length > 0) {
    Logger.log('');
    Logger.log('--- [WARN] シート間フォルダID不一致 ---');
    crossConflicts.forEach(c => {
      Logger.log('CROSS_SHEET_CONFLICT | %s', c.siteId);
      Logger.log(
        '  Master_Sites: %s (行%s, %s)',
        c.master.folderId || '(空)',
        c.master.sheetRow,
        c.master.siteName
      );
      Logger.log(
        '  稼働現場リスト: %s (行%s, %s)',
        c.dest.folderId || '(空)',
        c.dest.sheetRow,
        c.dest.siteName
      );
    });
  }

  if (emptyEntries.length > 0) {
    Logger.log('');
    Logger.log('--- [WARN] フォルダID未設定 ---');
    emptyEntries.forEach(e => {
      Logger.log(
        'EMPTY_ID | %s | %s 行%s | %s',
        e.siteId,
        e.source,
        e.sheetRow,
        e.siteName
      );
    });
  }

  if (invalidEntries.length > 0) {
    Logger.log('');
    Logger.log('--- [WARN] 無効フォルダID ---');
    invalidEntries.forEach(e => {
      Logger.log(
        'INVALID_ID | %s | %s 行%s | folderId=%s | %s',
        e.siteId,
        e.source,
        e.sheetRow,
        e.folderId,
        e.error || ''
      );
    });
  }

  Logger.log('');
  Logger.log('--- 集計 ---');
  Logger.log('OK: %s', stats.OK);
  Logger.log('MISMATCH: %s', stats.MISMATCH);
  Logger.log('SHARED_ID: %s', stats.SHARED_ID);
  Logger.log('CROSS_SHEET_CONFLICT: %s', stats.CROSS_SHEET_CONFLICT);
  Logger.log('EMPTY_ID: %s', stats.EMPTY_ID);
  Logger.log('INVALID_ID: %s', stats.INVALID_ID);
  Logger.log('=== 完了 ===');

  return {
    stats: stats,
    sharedGroups: sharedGroups,
    mismatchEntries: mismatchEntries,
    crossConflicts: crossConflicts,
    emptyEntries: emptyEntries,
    invalidEntries: invalidEntries
  };
}

/**
 * GASエディタから実行: DriveフォルダID横断監査（読み取り専用）
 * @param {{ siteIdFilter?: string, verbose?: boolean }} [options]
 */
function runAuditSiteDriveFolderIntegrity(options) {
  return auditSiteDriveFolderIntegrity_(options);
}

// ユーティリティ
function getSheet_(id, name) {
  const ss = SpreadsheetApp.openById(id);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

/**
 * 【診断専用】同期パイプラインのどこで工期が落ちるかを確定する。
 * ソースシート（2026年合計など）の対象現場行について、
 *  - 現場名セルの背景色（緑=同期対象か）
 *  - I/J/K/L の解決列番号と実際の値
 * を出し、さらに稼働現場リストの E〜H の現状値も出す。
 * GASエディタで debugSourceScheduleSite() を実行（下の定数を書き換え）。
 */
var DEBUG_SOURCE_SITE = 'ラミアール三ツ沢';
function debugSourceScheduleSite() {
  const siteName = DEBUG_SOURCE_SITE;
  const L = [];
  const targetNorm = normalizeSiteName(siteName);
  L.push('対象現場: "' + siteName + '" 正規化: "' + targetNorm + '"');
  L.push('同期対象の緑色: ' + CONFIG.COLORS.ADD_OR_UPDATE);
  L.push('');

  // ---- ソースシート群 ----
  CONFIG.SOURCE_SHEETS.forEach(function(sc) {
    L.push('=== ソース: ' + sc.label + ' (' + sc.sheetName + ') ===');
    var sheet;
    try { sheet = getSheet_(sc.spreadsheetId, sc.sheetName); }
    catch (e) { L.push('  シート取得失敗: ' + e.message); return; }

    var keyColIdx = getColumnIndexByHeader_(sheet, CONFIG.KEY_HEADER, 7);
    var idColIdx = getColumnIndexByHeader_(sheet, CONFIG.SOURCE_COL_HEADERS.SITE_ID.name, CONFIG.SOURCE_COL_HEADERS.SITE_ID.defaultIdx);
    var cAS = getColumnIndexByHeaders_(sheet, CONFIG.SOURCE_COL_HEADERS.ASSEMBLY_START.names, CONFIG.SOURCE_COL_HEADERS.ASSEMBLY_START.defaultIdx);
    var cAE = getColumnIndexByHeaders_(sheet, CONFIG.SOURCE_COL_HEADERS.ASSEMBLY_END.names, CONFIG.SOURCE_COL_HEADERS.ASSEMBLY_END.defaultIdx);
    var cDS = getColumnIndexByHeaders_(sheet, CONFIG.SOURCE_COL_HEADERS.DISMANTLE_START.names, CONFIG.SOURCE_COL_HEADERS.DISMANTLE_START.defaultIdx);
    var cDE = getColumnIndexByHeaders_(sheet, CONFIG.SOURCE_COL_HEADERS.DISMANTLE_END.names, CONFIG.SOURCE_COL_HEADERS.DISMANTLE_END.defaultIdx);
    L.push('  解決列: 現場名=' + keyColIdx + ' ID列=' + idColIdx + ' / 組始=' + cAS + ' 組終=' + cAE + ' 解始=' + cDS + ' 解終=' + cDE + '（列番号は1始まり。I=9 J=10 K=11 L=12）');

    var lastRow = sheet.getLastRow();
    var dataStartRow = Math.max(4, sheet.getFrozenRows() + 1);
    var found = 0;
    for (var r = dataStartRow; r <= lastRow; r++) {
      var nm = sheet.getRange(r, keyColIdx).getValue();
      if (normalizeSiteName(nm ? nm.toString() : '') !== targetNorm) continue;
      found++;
      var bg = normalizeColor_(sheet.getRange(r, keyColIdx).getBackground());
      var isGreen = isAddOrUpdateColor_(bg);
      var srcId = (idColIdx > 0 && idColIdx <= sheet.getLastColumn()) ? sheet.getRange(r, idColIdx).getValue() : '(列なし)';
      L.push('  行' + r + ' 現場名="' + nm + '"');
      L.push('    ソース現場ID(AZ列): ' + JSON.stringify(srcId));
      L.push('    背景色=' + bg + ' → ' + (isGreen ? '緑（同期対象）' : '★緑でない＝同期スキップ（#ccffcc系以外の色の可能性）'));
      L.push('    I/組始=' + JSON.stringify(sheet.getRange(r, cAS).getValue()));
      L.push('    J/組終=' + JSON.stringify(sheet.getRange(r, cAE).getValue()));
      L.push('    K/解始=' + JSON.stringify(sheet.getRange(r, cDS).getValue()));
      L.push('    L/解終=' + JSON.stringify(sheet.getRange(r, cDE).getValue()));
    }
    if (found === 0) L.push('  → このシートに「' + siteName + '」は見つかりません');
    L.push('');
  });

  // ---- 稼働現場リスト（同期先）----
  L.push('=== 稼働現場リスト（同期先 E〜H） ===');
  var destSheet = getDestSheet_();
  var dcols = CONFIG.DEST_COLUMNS;
  var dlast = destSheet.getLastRow();
  var dvals = destSheet.getRange(CONFIG.DEST_DATA_START_ROW, 1, dlast - CONFIG.DEST_DATA_START_ROW + 1, 8).getValues();
  var dh = 0;
  dvals.forEach(function(row, i) {
    if (normalizeSiteName((row[dcols.SITE_NAME-1]||'').toString()) !== targetNorm) return;
    dh++;
    L.push('  行' + (i + CONFIG.DEST_DATA_START_ROW) + ' 現場名="' + row[dcols.SITE_NAME-1] + '" 現場ID(B列)=' + JSON.stringify(row[dcols.SITE_ID-1]) +
      ' | E組始=' + JSON.stringify(row[dcols.ASSEMBLY_START-1]) +
      ' F組終=' + JSON.stringify(row[dcols.ASSEMBLY_END-1]) +
      ' G解始=' + JSON.stringify(row[dcols.DISMANTLE_START-1]) +
      ' H解終=' + JSON.stringify(row[dcols.DISMANTLE_END-1]));
  });
  if (dh === 0) L.push('  → 稼働現場リストに「' + siteName + '」なし');

  var out = L.join('\n');
  Logger.log(out);
  return out;
}

function getSheetById_(spreadsheetId, sheetId) {
  return MasterDb_getSheetById(spreadsheetId, sheetId);
}

function getDestSheet_() {
  return getSheetById_(CONFIG.DEST_SPREADSHEET_ID, CONFIG.DEST_SHEET_ID);
}

function normalizeColor_(color) {
  return color ? color.toLowerCase().replace(/\s/g, '') : '';
}

/**
 * 同期対象の「緑」背景か。
 * コード上は #ccffcc だが、Sheets のパレット緑は #b6d7a8 / #d9ead3 等になりがちなので許容する。
 */
function isAddOrUpdateColor_(color) {
  const c = normalizeColor_(color);
  if (!c || c === '#ffffff' || c === '#fff') return false;
  if (c === CONFIG.COLORS.ADD_OR_UPDATE) return true;
  const ALLOWED = [
    '#ccffcc', '#b6d7a8', '#d9ead3', '#93c47d', '#6aa84f',
    '#00ff00', '#00b050', '#92d050', '#c6efce', '#e2efda', '#a9d08e'
  ];
  if (ALLOWED.indexOf(c) >= 0) return true;
  const m = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
  if (m) {
    const r = parseInt(m[1], 16);
    const g = parseInt(m[2], 16);
    const b = parseInt(m[3], 16);
    if (g >= 170 && g > r + 25 && g > b + 25) return true;
  }
  return false;
}

/**
 * 工程表ソース行が同期対象（稼働中・黄緑）か。
 * @param {string} backgroundColor
 * @returns {boolean}
 */
function isSyncTargetSourceRow_(backgroundColor) {
  return isAddOrUpdateColor_(backgroundColor);
}

/**
 * 工程表ソース行が削除指示（赤）か。
 * @param {string} backgroundColor
 * @returns {boolean}
 */
function isDeleteTargetSourceRow_(backgroundColor) {
  return normalizeColor_(backgroundColor) === normalizeColor_(CONFIG.COLORS.DELETE);
}

/**
 * 工程表ソース行の色カテゴリ（監査・分類用）。
 * @param {string} backgroundColor
 * @returns {'SYNC'|'DELETE'|'IGNORE'}
 */
function classifySourceRowColor_(backgroundColor) {
  if (isSyncTargetSourceRow_(backgroundColor)) return 'SYNC';
  if (isDeleteTargetSourceRow_(backgroundColor)) return 'DELETE';
  return 'IGNORE';
}

function ensureDestHeaders_(sheet) {
  // 稼働現場リスト: A現場名 B現場ID C Drive E〜H 工期
  const c = CONFIG.DEST_COLUMNS;
  const headers = [
    { col: c.SITE_NAME, label: '現場名' },
    { col: c.SITE_ID, label: '現場ID' },
    { col: c.DRIVE_FOLDER, label: 'DriveフォルダID' },
    { col: 4, label: '' },
    { col: c.ASSEMBLY_START, label: '組立開始' },
    { col: c.ASSEMBLY_END, label: '組立終了' },
    { col: c.DISMANTLE_START, label: '解体開始' },
    { col: c.DISMANTLE_END, label: '解体終了' }
  ];
  headers.forEach(({ col, label }) => {
    if (!label) return;
    const cell = sheet.getRange(1, col);
    if (!cell.getValue()) cell.setValue(label);
  });
}

/**
 * 稼働現場リストと現場一覧の双方向 Reconcile。
 * 名寄せキーは normalizeName（= normalizeSiteName）で統一。
 */
function reconcileSheets_(destSheet, workerSheet) {
  ensureWorkerHeaders_(workerSheet);
  const wc = CONFIG.WORKER_COLUMNS;
  const defStatus = CONFIG.DEFAULT_WORKER_STATUS || '稼働中';

  const destLastRow = destSheet.getLastRow();
  const destById = new Map();
  const destByNormName = new Map();
  if (destLastRow >= CONFIG.DEST_DATA_START_ROW) {
    const destValues = destSheet.getRange(
      CONFIG.DEST_DATA_START_ROW,
      1,
      destLastRow - CONFIG.DEST_DATA_START_ROW + 1,
      3
    ).getValues();
    destValues.forEach((row, idx) => {
      const nameRaw = row[0] ? row[0].toString().trim() : '';
      const id = row[1] ? row[1].toString().trim() : '';
      const folderId = row[2] ? row[2].toString().trim() : '';
      const rowNumber = CONFIG.DEST_DATA_START_ROW + idx;
      const norm = normalizeSiteName(nameRaw);
      if (norm) destByNormName.set(norm, { id, folderId, row: rowNumber, displayName: nameRaw });
      if (id) destById.set(id, { name: nameRaw, folderId, row: rowNumber, norm });
    });
  }

  const workerLastRow = workerSheet.getLastRow();
  const workerById = new Map();
  const workerByNormName = new Map();
  if (workerLastRow >= 2) {
    const workerValues = workerSheet.getRange(2, 1, workerLastRow - 1, 3).getValues();
    workerValues.forEach((row, idx) => {
      const id = row[0] ? row[0].toString().trim() : '';
      const nameRaw = row[1] ? row[1].toString().trim() : '';
      const folderId = row[2] ? row[2].toString().trim() : '';
      const rowNumber = 2 + idx;
      const norm = normalizeSiteName(nameRaw);
      if (id) workerById.set(id, { name: nameRaw, folderId, row: rowNumber, norm });
      if (norm) workerByNormName.set(norm, { id, folderId, row: rowNumber, displayName: nameRaw });
    });
  }

  let addedToWorker = 0;
  let addedToDest = 0;
  let updatedWorkerFolderId = 0;
  let updatedDestFolderId = 0;
  let conflictCount = 0;

  destById.forEach((entry, id) => {
    const { name, folderId: destFolderId, norm } = entry;
    const nameKey = norm || normalizeSiteName(name);
    const workerEntry =
      workerById.get(id) || (nameKey ? workerByNormName.get(nameKey) : null);
    if (!workerEntry) {
      const newRow = workerSheet.getLastRow() + 1;
      workerSheet.getRange(newRow, wc.ID).setValue(id);
      workerSheet.getRange(newRow, wc.NAME).setValue(name);
      if (destFolderId) workerSheet.getRange(newRow, wc.FOLDER).setValue(destFolderId);
      workerSheet.getRange(newRow, wc.STATUS).setValue(defStatus);
      addedToWorker++;
      Logger.log('reconcile → 現場一覧追加: %s / %s', id, name);
    } else if (destFolderId && !workerEntry.folderId) {
      workerSheet.getRange(workerEntry.row, wc.FOLDER).setValue(destFolderId);
      updatedWorkerFolderId++;
      Logger.log('reconcile → 現場一覧 フォルダID補完: %s / %s → %s', id, name, destFolderId);
    }
  });

  workerById.forEach((entry, id) => {
    const { name, folderId: workerFolderId, norm } = entry;
    const nameKey = norm || normalizeSiteName(name);
    const destEntry =
      destById.get(id) || (nameKey ? destByNormName.get(nameKey) : null);
    if (!destEntry) {
      const newRow = destSheet.getLastRow() + 1;
      destSheet.getRange(newRow, CONFIG.DEST_COLUMNS.SITE_NAME).setValue(name);
      destSheet.getRange(newRow, CONFIG.DEST_COLUMNS.SITE_ID).setValue(id);
      if (workerFolderId) destSheet.getRange(newRow, CONFIG.DEST_COLUMNS.DRIVE_FOLDER).setValue(workerFolderId);
      addedToDest++;
      Logger.log('reconcile → 稼働現場リスト追加: %s / %s', id, name);
    } else if (workerFolderId && !destEntry.folderId) {
      destSheet.getRange(destEntry.row, CONFIG.DEST_COLUMNS.DRIVE_FOLDER).setValue(workerFolderId);
      updatedDestFolderId++;
      Logger.log('reconcile → 稼働現場リスト フォルダID補完: %s / %s → %s', id, name, workerFolderId);
    } else if (workerFolderId && destEntry.folderId && workerFolderId !== destEntry.folderId) {
      destSheet.getRange(destEntry.row, CONFIG.DEST_COLUMNS.DRIVE_FOLDER).setValue(workerFolderId);
      updatedDestFolderId++;
      conflictCount++;
      Logger.log(
        'reconcile → 稼働現場リスト フォルダID更新（コンフリクト）: %s / %s | 旧: %s → 新: %s',
        id,
        name,
        destEntry.folderId,
        workerFolderId
      );
    }
  });

  Logger.log(
    'reconcile完了: 現場一覧追加 %s件, 稼働現場リスト追加 %s件, 現場一覧 フォルダID補完 %s件, 稼働現場リスト フォルダID更新 %s件（うちコンフリクト %s件）',
    addedToWorker,
    addedToDest,
    updatedWorkerFolderId,
    updatedDestFolderId,
    conflictCount
  );

  if (CONFIG.AUTO_CREATE_MISSING_FOLDERS_ON_RECONCILE) {
    createMissingFolders_(destSheet, workerSheet);
  } else {
    Logger.log(
      'reconcileSheets_: createMissingFolders_ スキップ（CONFIG.AUTO_CREATE_MISSING_FOLDERS_ON_RECONCILE=false）。' +
        '対象確認: runCreateMissingFoldersDryRun / 作成: runCreateMissingFoldersExecute'
    );
  }
}

/**
 * 稼働現場リストとMaster_Sitesを双方向で一括 Reconcile する。
 * 既存の差分を解消するためのスタンドアロン実行用。
 * GASエディタから runReconcileSheets を選択して実行する。
 */
function runReconcileSheets() {
  withMasterSyncScriptLock_(() => {
    folderCache_ = null;
    const destSheet = getDestSheet_();
    const workerSheet = getWorkerSheet_();
    reconcileSheets_(destSheet, workerSheet);
    ensureWorkerHeaders_(workerSheet);
    pushDestToWorkerFull_(destSheet, workerSheet);
  });
}

/**
 * DriveフォルダIDが未設定の現場に対してフォルダを作成し、両シートに書き込む。
 * 通常同期では CONFIG.AUTO_CREATE_MISSING_FOLDERS_ON_RECONCILE=false のため自動実行されない。
 * 手動: runCreateMissingFoldersDryRun（確認） / runCreateMissingFoldersExecute（作成）
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} destSheet
 * @param {GoogleAppsScript.Spreadsheet.Sheet} workerSheet
 * @param {{ dryRun?: boolean }} [options]
 * @returns {{ dryRun: boolean, targetCount: number, createdCount: number, targets: Array<{siteId:string,siteName:string,destRow:number}> }}
 */
function createMissingFolders_(destSheet, workerSheet, options) {
  const opts = options || {};
  const dryRun = opts.dryRun === true;

  return withMasterSyncScriptLock_(() => {
    const summary = {
      dryRun: dryRun,
      targetCount: 0,
      createdCount: 0,
      targets: []
    };

    const destLastRow = destSheet.getLastRow();
    if (destLastRow < CONFIG.DEST_DATA_START_ROW) {
      Logger.log(
        '[DRIVE_ROOT_AUDIT][大本DB][createMissingFolders_] end dryRun=%s targetCount=0 createdCount=0 (no data)',
        dryRun
      );
      return summary;
    }
    const destValues = destSheet.getRange(
      CONFIG.DEST_DATA_START_ROW,
      1,
      destLastRow - CONFIG.DEST_DATA_START_ROW + 1,
      3
    ).getValues();

    const workerLastRow = workerSheet.getLastRow();
    const workerRowById = new Map();
    if (workerLastRow >= 2) {
      workerSheet.getRange(2, 1, workerLastRow - 1, 1).getValues().forEach((row, idx) => {
        const id = row[0] ? row[0].toString().trim() : '';
        if (id) workerRowById.set(id, 2 + idx);
      });
    }

    Logger.log(
      '[DRIVE_ROOT_AUDIT][大本DB][createMissingFolders_] start dryRun=%s',
      dryRun
    );

    destValues.forEach((row, idx) => {
      const siteName = row[0] ? row[0].toString().trim() : '';
      const siteId = row[1] ? row[1].toString().trim() : '';
      const folderId = row[2] ? row[2].toString().trim() : '';
      const destRow = CONFIG.DEST_DATA_START_ROW + idx;
      if (!siteName) {
        Logger.log(
          '[DRIVE_ROOT_AUDIT][大本DB][createMissingFolders_] skip reason=no_site_name row=%s',
          destRow
        );
        return;
      }
      if (!siteId) {
        Logger.log(
          '[DRIVE_ROOT_AUDIT][大本DB][createMissingFolders_] skip reason=no_site_id siteName=%s row=%s',
          siteName,
          destRow
        );
        return;
      }
      if (folderId) {
        return;
      }

      summary.targetCount++;
      summary.targets.push({ siteId: siteId, siteName: siteName, destRow: destRow });

      Logger.log(
        '[DRIVE_ROOT_AUDIT][大本DB][createMissingFolders_] target siteId=%s siteName=%s reason=dest_C_column_empty row=%s dryRun=%s willCallEnsureSiteFolder_=%s',
        siteId,
        siteName,
        destRow,
        dryRun,
        !dryRun
      );

      if (dryRun) {
        return;
      }

      const newFolderId = ensureSiteFolder_(siteName);
      Logger.log(
        '[DRIVE_ROOT_AUDIT][大本DB][createMissingFolders_] ensureSiteFolder_ done siteId=%s siteName=%s folderId=%s',
        siteId,
        siteName,
        newFolderId || '(null)'
      );
      destSheet.getRange(destRow, CONFIG.DEST_COLUMNS.DRIVE_FOLDER).setValue(newFolderId);

      if (siteId && workerRowById.has(siteId)) {
        workerSheet.getRange(workerRowById.get(siteId), CONFIG.WORKER_COLUMNS.FOLDER).setValue(
          newFolderId
        );
      }
      summary.createdCount++;
      Logger.log('フォルダ作成: %s / %s → %s', siteId, siteName, newFolderId);
    });

    if (dryRun) {
      Logger.log(
        'フォルダ補完 dryRun: 対象 %s件（作成は runCreateMissingFoldersExecute で実行）',
        summary.targetCount
      );
    } else {
      Logger.log('フォルダ補完完了: %s件', summary.createdCount);
    }
    Logger.log(
      '[DRIVE_ROOT_AUDIT][大本DB][createMissingFolders_] end dryRun=%s targetCount=%s createdCount=%s',
      dryRun,
      summary.targetCount,
      summary.createdCount
    );
    return summary;
  });
}

/**
 * C列空の現場フォルダ補完: 対象一覧のみ（Drive 作成・シート書込なし）
 * GASエディタから runCreateMissingFoldersDryRun を実行。
 */
function runCreateMissingFoldersDryRun() {
  folderCache_ = null;
  const result = createMissingFolders_(getDestSheet_(), getWorkerSheet_(), { dryRun: true });
  Logger.log(
    'runCreateMissingFoldersDryRun 完了: 対象 %s件。作成する場合は runCreateMissingFoldersExecute を実行してください。',
    result && result.targetCount != null ? result.targetCount : 0
  );
  return result;
}

/**
 * C列空の現場フォルダ補完: 管理者確認後の本実行（Drive 作成 + C列書込）
 * GASエディタから runCreateMissingFoldersExecute を実行。
 */
function runCreateMissingFoldersExecute() {
  folderCache_ = null;
  const result = createMissingFolders_(getDestSheet_(), getWorkerSheet_(), { dryRun: false });
  Logger.log(
    'runCreateMissingFoldersExecute 完了: 作成 %s件（対象 %s件）',
    result && result.createdCount != null ? result.createdCount : 0,
    result && result.targetCount != null ? result.targetCount : 0
  );
  return result;
}

/**
 * @deprecated runCreateMissingFoldersExecute を使用してください。
 */
function runCreateMissingFolders() {
  Logger.log('runCreateMissingFolders: runCreateMissingFoldersExecute に委譲します');
  return runCreateMissingFoldersExecute();
}

/**
 * 両ソースシート（2025年・2026年）の緑色行にSITE-IDを採番してAZ列に書き込む。
 * 同名現場は両シートで同じIDを共有する。
 * 既存IDはMaster_SitesおよびAZ列の値を優先する。
 */
function assignSiteIdsToSourceSheets() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;

  // Step 1: Master_Sitesから 現場名→ID の既存マップと最大ID番号を取得
  const workerSheet = getWorkerSheet_();
  const workerData = getWorkerSheetData_(workerSheet);

  const nameToId = new Map();
  let maxIdNum = 0;

  workerData.byId.forEach((_, siteId) => {
    const match = siteId.match(/^SITE-(\d+)$/);
    if (match) maxIdNum = Math.max(maxIdNum, parseInt(match[1], 10));
  });
  workerData.byName.forEach((siteId, siteName) => {
    if (siteId && SITE_ID_PATTERN.test(siteId)) {
      nameToId.set(siteName, siteId);
    }
  });

  // Step 2: 両ソースシートの緑色行を収集し、AZ列に既存IDがあればnameToIdに登録
  const greenRows = [];

  CONFIG.SOURCE_SHEETS.forEach(sourceCfg => {
    const sheet = getSheet_(sourceCfg.spreadsheetId, sourceCfg.sheetName);
    const keyColIdx = getColumnIndexByHeader_(sheet, CONFIG.KEY_HEADER, 7);
    const siteIdColIdx = getColumnIndexByHeader_(sheet, CONFIG.SOURCE_COL_HEADERS.SITE_ID.name, CONFIG.SOURCE_COL_HEADERS.SITE_ID.defaultIdx);
    const dataStartRow = Math.max(4, sheet.getFrozenRows() + 1);
    const lastRow = sheet.getLastRow();

    if (lastRow < dataStartRow) return;

    const numRows = lastRow - dataStartRow + 1;
    const keyValues = sheet.getRange(dataStartRow, keyColIdx, numRows, 1).getValues();
    const backgrounds = sheet.getRange(dataStartRow, keyColIdx, numRows, 1).getBackgrounds();
    const azValues = sheet.getRange(dataStartRow, siteIdColIdx, numRows, 1).getValues();

    keyValues.forEach((row, idx) => {
      const siteName = normalizeSiteName(row[0] ? row[0].toString() : '');
      const rowBackground = backgrounds[idx][0];
      const currentId = azValues[idx][0] ? azValues[idx][0].toString().trim() : '';

      if (!siteName || !isSyncTargetSourceRow_(rowBackground)) return;

      // AZ列に有効なIDがあればnameToIdに登録し最大値を更新
      if (currentId && SITE_ID_PATTERN.test(currentId)) {
        if (!nameToId.has(siteName)) nameToId.set(siteName, currentId);
        const num = parseInt(currentId.replace('SITE-', ''), 10);
        maxIdNum = Math.max(maxIdNum, num);
      }

      greenRows.push({ sheet, rowIdx: dataStartRow + idx, siteName, currentId, siteIdColIdx });
    });
  });

  // Step 2.5: 同名で複数IDが存在する場合、番号が小さいIDに統一
  // nameToId に同名で異なるIDが登録されている緑色行を検出して上書き
  const nameToIds = new Map(); // siteName → Set of IDs
  greenRows.forEach(({ siteName, currentId }) => {
    if (!currentId || !SITE_ID_PATTERN.test(currentId)) return;
    if (!nameToIds.has(siteName)) nameToIds.set(siteName, new Set());
    nameToIds.get(siteName).add(currentId);
  });
  nameToIds.forEach((ids, siteName) => {
    if (ids.size <= 1) return;
    // 最小番号のIDを正規IDとして採用
    const canonicalId = [...ids].reduce((min, id) => {
      const numMin = parseInt(min.replace('SITE-', ''), 10);
      const numId = parseInt(id.replace('SITE-', ''), 10);
      return numId < numMin ? id : min;
    });
    const oldIds = [...ids].filter(id => id !== canonicalId);
    Logger.log('[競合解決] "%s": %s → %s（廃止: %s）', siteName, [...ids].join(', '), canonicalId, oldIds.join(', '));
    nameToId.set(siteName, canonicalId);
  });

  // Step 3: IDが未設定 or 競合により上書きが必要な行に採番して書き込む
  let assignedCount = 0;
  let skippedCount = 0;

  greenRows.forEach(({ sheet, rowIdx, siteName, currentId, siteIdColIdx }) => {
    const canonicalId = nameToId.get(siteName);
    // 有効なIDがあり、かつ正規IDと一致している → スキップ
    if (currentId && SITE_ID_PATTERN.test(currentId) && currentId === canonicalId) {
      skippedCount++;
      return;
    }

    // 同名現場がnameToIdになければ新採番
    if (!nameToId.has(siteName)) {
      maxIdNum++;
      const newId = CONFIG.ID_PREFIX + String(maxIdNum).padStart(CONFIG.ID_PADDING, '0');
      nameToId.set(siteName, newId);
      Logger.log('[新規採番] "%s" → %s', siteName, newId);
    } else {
      Logger.log('[既存ID流用] "%s" → %s', siteName, nameToId.get(siteName));
    }

    sheet.getRange(rowIdx, siteIdColIdx).setValue(nameToId.get(siteName));
    assignedCount++;
  });

  Logger.log('assignSiteIdsToSourceSheets 完了: 採番・書き込み %s件、スキップ %s件', assignedCount, skippedCount);
}

/**
 * 【補完】ソースシート（2026年合計など）の AZ列(現場ID) が空・無効な行に、
 * 稼働現場リストB列のIDを「現場名一致」で書き込む。
 * これにより同期が名前ベースではなくIDベースで既存行を正しく更新できるようになる。
 *
 * - 対象: 現場名があり、AZが空 or SITE-xxx形式でない行（背景色は問わない）
 * - 稼働現場リストに同名がある場合のみ補完（無ければスキップ＝新規採番は syncSitesWithSchedule に任せる）
 * GASエディタから backfillSourceIdsFromDestList() を実行。
 */
function backfillSourceIdsFromDestList() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;

  // 1. 稼働現場リスト（DEST）の 現場名(正規化) → B列ID マップを構築
  const destSheet = getDestSheet_();
  const dLast = destSheet.getLastRow();
  const nameToDestId = new Map();
  if (dLast >= CONFIG.DEST_DATA_START_ROW) {
    const dNum = dLast - CONFIG.DEST_DATA_START_ROW + 1;
    const dVals = destSheet.getRange(CONFIG.DEST_DATA_START_ROW, CONFIG.DEST_COLUMNS.SITE_NAME, dNum, 2).getValues();
    dVals.forEach(row => {
      const nm = normalizeSiteName(row[0] ? row[0].toString() : '');
      const id = row[1] ? row[1].toString().trim() : '';
      if (!nm || !SITE_ID_PATTERN.test(id)) return;
      // 同名複数の場合は番号が小さいIDを優先（正規IDに寄せる）
      if (!nameToDestId.has(nm)) {
        nameToDestId.set(nm, id);
      } else {
        const cur = parseInt(nameToDestId.get(nm).replace('SITE-', ''), 10);
        const cand = parseInt(id.replace('SITE-', ''), 10);
        if (cand < cur) nameToDestId.set(nm, id);
      }
    });
  }
  Logger.log('稼働現場リストから取得したID件数: %s', nameToDestId.size);

  // 2. 各ソースシートのAZ列を補完
  let filled = 0;
  let already = 0;
  let noMatch = 0;
  const noMatchNames = [];

  CONFIG.SOURCE_SHEETS.forEach(sourceCfg => {
    let sheet;
    try { sheet = getSheet_(sourceCfg.spreadsheetId, sourceCfg.sheetName); }
    catch (e) { Logger.log('ソース取得失敗 (%s): %s', sourceCfg.label, e.message); return; }

    const keyColIdx = getColumnIndexByHeader_(sheet, CONFIG.KEY_HEADER, 7);
    const siteIdColIdx = getColumnIndexByHeader_(sheet, CONFIG.SOURCE_COL_HEADERS.SITE_ID.name, CONFIG.SOURCE_COL_HEADERS.SITE_ID.defaultIdx);
    const dataStartRow = Math.max(4, sheet.getFrozenRows() + 1);
    const lastRow = sheet.getLastRow();
    if (lastRow < dataStartRow) return;

    const numRows = lastRow - dataStartRow + 1;
    const keyValues = sheet.getRange(dataStartRow, keyColIdx, numRows, 1).getValues();
    const idValues = sheet.getRange(dataStartRow, siteIdColIdx, numRows, 1).getValues();

    keyValues.forEach((row, idx) => {
      const rawName = row[0] ? row[0].toString() : '';
      const siteName = normalizeSiteName(rawName);
      if (!siteName) return;

      const currentId = idValues[idx][0] ? idValues[idx][0].toString().trim() : '';
      if (SITE_ID_PATTERN.test(currentId)) { already++; return; } // 既に有効なIDがある

      const destId = nameToDestId.get(siteName);
      if (!destId) { noMatch++; noMatchNames.push(rawName); return; }

      sheet.getRange(dataStartRow + idx, siteIdColIdx).setValue(destId);
      filled++;
      Logger.log('[ID補完] %s 行%s "%s" → %s', sourceCfg.label, dataStartRow + idx, rawName, destId);
    });
  });

  Logger.log('=== backfillSourceIdsFromDestList 完了 ===');
  Logger.log('補完: %s件 / 既にID有り: %s件 / 稼働現場リストに無く未補完: %s件', filled, already, noMatch);
  if (noMatchNames.length > 0) {
    Logger.log('未補完（稼働現場リストに同名なし）: %s', noMatchNames.slice(0, 30).join(' | '));
  }
  return { filled, already, noMatch };
}

/**
 * ソースシートのAZ列から 現場名→正規ID のマップを構築する。
 * assignSiteIdsToSourceSheets() 実行後に呼ぶことで最新の正規IDを取得できる。
 */
function buildCanonicalNameToId_() {
  const SITE_ID_PATTERN = /^SITE-\d+$/;
  const result = new Map(); // siteName → 最小番号のID

  CONFIG.SOURCE_SHEETS.forEach(sourceCfg => {
    const sheet = getSheet_(sourceCfg.spreadsheetId, sourceCfg.sheetName);
    const keyColIdx = getColumnIndexByHeader_(sheet, CONFIG.KEY_HEADER, 7);
    const siteIdColIdx = getColumnIndexByHeader_(sheet, CONFIG.SOURCE_COL_HEADERS.SITE_ID.name, CONFIG.SOURCE_COL_HEADERS.SITE_ID.defaultIdx);
    const dataStartRow = Math.max(4, sheet.getFrozenRows() + 1);
    const lastRow = sheet.getLastRow();
    if (lastRow < dataStartRow) return;

    const numRows = lastRow - dataStartRow + 1;
    const keyValues = sheet.getRange(dataStartRow, keyColIdx, numRows, 1).getValues();
    const backgrounds = sheet.getRange(dataStartRow, keyColIdx, numRows, 1).getBackgrounds();
    const azValues = sheet.getRange(dataStartRow, siteIdColIdx, numRows, 1).getValues();

    keyValues.forEach((row, idx) => {
      const siteName = normalizeSiteName(row[0] ? row[0].toString() : '');
      const rowBackground = backgrounds[idx][0];
      const siteId = azValues[idx][0] ? azValues[idx][0].toString().trim() : '';
      if (!siteName || !isSyncTargetSourceRow_(rowBackground) || !SITE_ID_PATTERN.test(siteId)) return;

      // 同名で複数IDがある場合は番号が小さい方を採用
      if (!result.has(siteName)) {
        result.set(siteName, siteId);
      } else {
        const existing = result.get(siteName);
        const existingNum = parseInt(existing.replace('SITE-', ''), 10);
        const newNum = parseInt(siteId.replace('SITE-', ''), 10);
        if (newNum < existingNum) result.set(siteName, siteId);
      }
    });
  });

  return result;
}

/**
 * 宛先シートで同名現場が重複している行を削除する。
 * 正規IDと一致する行を残し、それ以外の重複行を削除する。
 * @param {Sheet} sheet - 対象シート
 * @param {Map} canonicalMap - 現場名→正規ID のマップ
 * @param {string} label - ログ用ラベル
 * @param {number} nameCol - 現場名の列番号（1始まり）
 * @param {number} idCol - 現場IDの列番号（1始まり）
 * @param {number} dataStartRow - データ開始行
 */
function cleanupDuplicatesByName_(sheet, canonicalMap, label, nameCol, idCol, dataStartRow) {
  const lastRow = sheet.getLastRow();
  if (lastRow < dataStartRow) return;

  const numRows = lastRow - dataStartRow + 1;
  const values = sheet.getRange(dataStartRow, Math.min(nameCol, idCol), numRows, Math.max(nameCol, idCol) - Math.min(nameCol, idCol) + 1).getValues();
  const nameOffset = nameCol - Math.min(nameCol, idCol);
  const idOffset = idCol - Math.min(nameCol, idCol);

  // 現場名ごとに行番号を収集
  const nameToRows = new Map(); // siteName → [{ rowNumber, siteId }]
  values.forEach((row, idx) => {
    const siteName = normalizeSiteName(row[nameOffset] ? row[nameOffset].toString() : '');
    const siteId = row[idOffset] ? row[idOffset].toString().trim() : '';
    if (!siteName) return;
    if (!nameToRows.has(siteName)) nameToRows.set(siteName, []);
    nameToRows.get(siteName).push({ rowNumber: dataStartRow + idx, siteId });
  });

  // 重複行を検出して削除（下から処理してズレ防止）
  const rowsToDelete = [];
  nameToRows.forEach((rows, siteName) => {
    if (rows.length <= 1) return;
    const canonicalId = canonicalMap.get(siteName);
    rows.forEach(({ rowNumber, siteId }) => {
      // 正規IDと一致する行は残す。一致しない重複行は削除対象
      if (siteId !== canonicalId) {
        if (isKonohanaName_(siteName)) {
          const allDuplicateRows = rows.map(function(r) {
            return 'row' + r.rowNumber + ':ID=' + (r.siteId || '(空)');
          }).join(', ');
          logKonohanaDetail_('KONOHANA_DUPLICATE_DELETE_CANDIDATE', {
            sheet: label,
            siteName: siteName,
            canonicalId: canonicalId === undefined ? '(undefined)' : (canonicalId || '(空)'),
            deleteRowNumber: rowNumber,
            deleteSiteId: siteId || '(空)',
            allDuplicateRows: allDuplicateRows,
            reason: 'siteId !== canonicalId（正規IDと不一致の重複行を削除予定）'
          });
        }
        rowsToDelete.push(rowNumber);
        Logger.log('[重複削除] %s 行%s: "%s" ID=%s（正規ID=%s）', label, rowNumber, siteName, siteId, canonicalId);
      }
    });
  });

  // 下から削除（行番号のズレを防ぐ）
  rowsToDelete.sort((a, b) => b - a).forEach(rowNumber => sheet.deleteRow(rowNumber));
  Logger.log('cleanupDuplicatesByName_ (%s): %s行削除', label, rowsToDelete.length);
}

/**
 * 稼働現場リストにあってMaster_Sitesにない現場を一括補完する一回限りの関数。
 * 今後は syncSingleSource_ の修正により自動補完されるが、
 * 既存の欠落分はこの関数で手動修復する。
 * GASエディタから runRepairMasterSitesFromDest() で実行する。
 */
function repairMasterSitesFromDest() {
  const destSheet = getDestSheet_();
  const workerSheet = getWorkerSheet_();

  const destData = getDestData_(destSheet);       // byName, byId
  const workerData = getWorkerSheetData_(workerSheet); // byName, byId

  let added = 0;
  destData.byId.forEach(({ siteName }, siteId) => {
    if (!siteId || !siteName) return;
    if (workerData.byId.has(siteId) || workerData.byName.has(siteName)) return;

    // Master_Sitesに追加
    appendWorkerSiteRow_(workerSheet, { siteName }, siteId);
    workerData.byId.set(siteId, siteName);
    workerData.byName.set(siteName, siteId);
    Logger.log('[repairMasterSitesFromDest] 追加: %s | %s', siteId, siteName);
    added++;
  });

  Logger.log('repairMasterSitesFromDest 完了: %s件追加', added);
}

function runRepairMasterSitesFromDest() {
  repairMasterSitesFromDest();
}

/**
 * SITE-005（青木住宅5号棟解体工事）とSITE-116（サンマークスだいにち(E棟)）の
 * IDと名前の対応が崩れた状態を修復する一回限りの関数。
 * renameInWorkerSheet_のバグ（名前検索）により発生した状態を直接修正する。
 * 実行後に syncSitesWithSchedule を再実行すること。
 */
function repairSite005And116() {
  const SITE_005_NAME = '青木住宅5号棟解体工事';
  const SITE_116_NAME = 'サンマークスだいにち(E棟)';

  const destSheet = getDestSheet_();
  const workerSheet = getWorkerSheet_();

  // --- 稼働現場リスト修正 ---
  const destLastRow = destSheet.getLastRow();
  const destData = destSheet.getRange(2, CONFIG.DEST_COLUMNS.SITE_ID, destLastRow - 1, 2).getValues();
  let site116DestRow = -1;
  let site005DestRow = -1;

  for (let i = 0; i < destData.length; i++) {
    const id = String(destData[i][0] || '').trim();
    if (id === 'SITE-116') site116DestRow = i + 2;
    if (id === 'SITE-005') site005DestRow = i + 2;
  }

  if (site116DestRow > 0) {
    destSheet.getRange(site116DestRow, CONFIG.DEST_COLUMNS.SITE_NAME).setValue(SITE_116_NAME);
    Logger.log('稼働現場リスト SITE-116 名前を "%s" に修正: 行%s', SITE_116_NAME, site116DestRow);
  }
  if (site005DestRow < 0) {
    const newRow = destSheet.getLastRow() + 1;
    destSheet.getRange(newRow, CONFIG.DEST_COLUMNS.SITE_NAME).setValue(SITE_005_NAME);
    destSheet.getRange(newRow, CONFIG.DEST_COLUMNS.SITE_ID).setValue('SITE-005');
    Logger.log('稼働現場リスト SITE-005 "%s" を追加: 行%s', SITE_005_NAME, newRow);
  } else {
    destSheet.getRange(site005DestRow, CONFIG.DEST_COLUMNS.SITE_NAME).setValue(SITE_005_NAME);
    Logger.log('稼働現場リスト SITE-005 名前を "%s" に修正: 行%s', SITE_005_NAME, site005DestRow);
  }

  // --- Master_Sites修正 ---
  const wLastRow = workerSheet.getLastRow();
  const wData = workerSheet.getRange(2, 1, wLastRow - 1, 2).getValues();
  let site116WRow = -1;
  let site005WRow = -1;

  for (let i = 0; i < wData.length; i++) {
    const id = String(wData[i][0] || '').trim();
    if (id === 'SITE-116') site116WRow = i + 2;
    if (id === 'SITE-005') site005WRow = i + 2;
  }

  if (site116WRow > 0) {
    workerSheet.getRange(site116WRow, 2).setValue(SITE_116_NAME);
    Logger.log('Master_Sites SITE-116 名前を "%s" に修正: 行%s', SITE_116_NAME, site116WRow);
  }
  if (site005WRow < 0) {
    const newRow = workerSheet.getLastRow() + 1;
    workerSheet.getRange(newRow, 1).setValue('SITE-005');
    workerSheet.getRange(newRow, 2).setValue(SITE_005_NAME);
    workerSheet.getRange(newRow, 4).setValue('稼働中');
    Logger.log('Master_Sites SITE-005 "%s" を追加: 行%s', SITE_005_NAME, newRow);
  } else {
    workerSheet.getRange(site005WRow, 2).setValue(SITE_005_NAME);
    Logger.log('Master_Sites SITE-005 名前を "%s" に修正: 行%s', SITE_005_NAME, site005WRow);
  }

  // --- ソースシートのAZ列修正 ---
  CONFIG.SOURCE_SHEETS.forEach(sourceCfg => {
    const sheet = getSheet_(sourceCfg.spreadsheetId, sourceCfg.sheetName);
    const keyColIdx = getColumnIndexByHeader_(sheet, CONFIG.KEY_HEADER, 7);
    const siteIdColIdx = getColumnIndexByHeader_(sheet, CONFIG.SOURCE_COL_HEADERS.SITE_ID.name, CONFIG.SOURCE_COL_HEADERS.SITE_ID.defaultIdx);
    const dataStartRow = Math.max(4, sheet.getFrozenRows() + 1);
    const lastRow = sheet.getLastRow();
    if (lastRow < dataStartRow) return;

    const numRows = lastRow - dataStartRow + 1;
    const names = sheet.getRange(dataStartRow, keyColIdx, numRows, 1).getValues();
    const azValues = sheet.getRange(dataStartRow, siteIdColIdx, numRows, 1).getValues();

    for (let i = 0; i < names.length; i++) {
      const name = String(names[i][0] || '').trim();
      const currentId = String(azValues[i][0] || '').trim();
      if (name === SITE_005_NAME && currentId !== 'SITE-005') {
        sheet.getRange(dataStartRow + i, siteIdColIdx).setValue('SITE-005');
        Logger.log('ソース(%s) "%s" AZ修正: %s → SITE-005', sourceCfg.label, name, currentId);
      }
      if (name === SITE_116_NAME && currentId !== 'SITE-116') {
        sheet.getRange(dataStartRow + i, siteIdColIdx).setValue('SITE-116');
        Logger.log('ソース(%s) "%s" AZ修正: %s → SITE-116', sourceCfg.label, name, currentId);
      }
    }
  });

  Logger.log('repairSite005And116 完了。次に syncSitesWithSchedule を実行してください。');
}

function runRepairSite005And116() {
  repairSite005And116();
}

/**
 * Drive 全体からフォルダ名の部分一致で検索し、フォルダID・フルパスを表示する。
 * SITE-136（東三国住宅...）のようにルート外に存在する可能性があるフォルダの調査用。
 *
 * 使い方:
 *   1. SEARCH_KEYWORD に検索したいキーワードを設定
 *   2. GASエディタで runSearchFolderByKeyword を選択して実行
 *   3. ログでフォルダID・名前・親フォルダ名を確認
 */
function runSearchFolderByKeyword() {
  const SEARCH_KEYWORD = '東三国'; // 調査したいキーワード（部分一致）

  Logger.log('=== Drive フォルダ検索: "%s" ===', SEARCH_KEYWORD);

  // DriveApp.searchFolders は Drive 全体を対象にした全文検索
  const query = 'title contains "' + SEARCH_KEYWORD + '" and mimeType = "application/vnd.google-apps.folder" and trashed = false';
  const iterator = DriveApp.searchFolders(query);

  let count = 0;
  while (iterator.hasNext()) {
    const folder = iterator.next();
    const parents = folder.getParents();
    const parentName = parents.hasNext() ? parents.next().getName() : '（親なし）';
    Logger.log('  ID: %s | 名前: %s | 親: %s', folder.getId(), folder.getName(), parentName);
    count++;
  }

  if (count === 0) {
    Logger.log('  → フォルダが見つかりませんでした');
  }
  Logger.log('=== 検索完了: %s件 ===', count);
}

/**
 * 指定現場が同期対象になっているか、各スプレッドシートに存在するかを診断する。
 * GASエディタで debugSiteSyncStatus('ラミアール三ツ沢') を実行し、ログを確認。
 *
 * @param {string} [siteName='ラミアール三ツ沢']
 */
function debugSiteSyncStatus(siteName) {
  siteName = siteName || 'ラミアール三ツ沢';
  const targetNorm = normalizeSiteName(siteName);
  const GREEN = CONFIG.COLORS.ADD_OR_UPDATE;
  const lines = [];
  const log = function(msg) {
    lines.push(msg);
    Logger.log(msg);
  };

  log('=== 現場同期診断: "' + siteName + '" (正規化: "' + targetNorm + '") ===');
  log('同期先 DEST_SPREADSHEET_ID: ' + CONFIG.DEST_SPREADSHEET_ID);
  log('職人先 WORKER_SPREADSHEET_ID: ' + CONFIG.WORKER_SPREADSHEET_ID);

  // --- ソース（工程表）---
  let sourceFound = false;
  CONFIG.SOURCE_SHEETS.forEach(function(sourceCfg) {
    try {
      const sheet = getSheet_(sourceCfg.spreadsheetId, sourceCfg.sheetName);
      const keyColIdx = getColumnIndexByHeader_(sheet, CONFIG.KEY_HEADER, 7);
      const siteIdColIdx = getColumnIndexByHeader_(sheet, CONFIG.SOURCE_COL_HEADERS.SITE_ID.name, CONFIG.SOURCE_COL_HEADERS.SITE_ID.defaultIdx);
      const dataStartRow = Math.max(4, sheet.getFrozenRows() + 1);
      const lastRow = sheet.getLastRow();
      log('');
      log('[ソース] ' + sourceCfg.label + ' / シート名="' + sourceCfg.sheetName + '" / データ開始行=' + dataStartRow);
      if (lastRow < dataStartRow) {
        log('  → データ行なし');
        return;
      }
      const numRows = lastRow - dataStartRow + 1;
      const names = sheet.getRange(dataStartRow, keyColIdx, numRows, 1).getValues();
      const backgrounds = sheet.getRange(dataStartRow, keyColIdx, numRows, 1).getBackgrounds();
      const siteIds = sheet.getRange(dataStartRow, siteIdColIdx, numRows, 1).getValues();
      const dateCols = {
        assemblyStart: getColumnIndexByHeaders_(sheet, CONFIG.SOURCE_COL_HEADERS.ASSEMBLY_START.names, CONFIG.SOURCE_COL_HEADERS.ASSEMBLY_START.defaultIdx),
        assemblyEnd: getColumnIndexByHeaders_(sheet, CONFIG.SOURCE_COL_HEADERS.ASSEMBLY_END.names, CONFIG.SOURCE_COL_HEADERS.ASSEMBLY_END.defaultIdx),
        dismantleStart: getColumnIndexByHeaders_(sheet, CONFIG.SOURCE_COL_HEADERS.DISMANTLE_START.names, CONFIG.SOURCE_COL_HEADERS.DISMANTLE_START.defaultIdx),
        dismantleEnd: getColumnIndexByHeaders_(sheet, CONFIG.SOURCE_COL_HEADERS.DISMANTLE_END.names, CONFIG.SOURCE_COL_HEADERS.DISMANTLE_END.defaultIdx),
      };
      names.forEach(function(row, idx) {
        const name = normalizeSiteName(row[0] ? row[0].toString() : '');
        if (name !== targetNorm) return;
        sourceFound = true;
        const color = normalizeColor_(backgrounds[idx][0]);
        const rowNum = dataStartRow + idx;
        const siteId = siteIds[idx][0] ? siteIds[idx][0].toString().trim() : '';
        log('  ✓ 行' + rowNum + ' に一致');
        log('    背景色: ' + color + (color === GREEN ? ' → 同期対象（緑）' : ' → 同期対象外（緑 #ccffcc 必須）'));
        log('    AZ列ID: ' + (siteId || '（未設定）'));
        Object.keys(dateCols).forEach(function(k) {
          const v = sheet.getRange(rowNum, dateCols[k]).getValue();
          if (v) log('    ' + k + ': ' + v);
        });
      });
      if (!sourceFound) {
        log('  → このシートに現場名が見つかりません（表記ゆれ・別タブの可能性）');
      }
    } catch (e) {
      log('[ソース] ' + sourceCfg.label + ' 読み込みエラー: ' + e.message);
    }
  });

  // --- 稼働現場リスト ---
  log('');
  log('[稼働現場リスト]');
  try {
    const destSheet = getDestSheet_();
    const destData = getDestData_(destSheet);
    const hit = destData.byName.get(targetNorm);
    if (hit) {
      log('  ✓ 登録あり 行' + hit.rowNumber + ' / ID=' + (hit.id || 'なし') + ' / フォルダID=' + (hit.folderId || 'なし'));
    } else {
      log('  ✗ 未登録（同期未実行 or 緑色未設定 or 旧DEST先にのみ書き込み済み）');
    }
  } catch (e) {
    log('  読み込みエラー: ' + e.message);
  }

  // --- 旧同期先（設定ミス時の残骸確認）---
  const LEGACY_DEST_ID = 'SAMPLE_ID_025';
  if (LEGACY_DEST_ID !== CONFIG.DEST_SPREADSHEET_ID) {
    log('');
    log('[旧同期先 ' + LEGACY_DEST_ID + ']');
    try {
      const legacySheet = getSheetById_(LEGACY_DEST_ID, CONFIG.DEST_SHEET_ID);
      const legacyData = getDestData_(legacySheet);
      const legacyHit = legacyData.byName.get(targetNorm);
      if (legacyHit) {
        log('  ⚠ 旧スプレッドシートにのみ存在 行' + legacyHit.rowNumber + ' / ID=' + legacyHit.id);
        log('  → 以前の同期はこちらに書き込まれていた可能性が高いです');
      } else {
        log('  → 旧同期先にも未登録');
      }
    } catch (e) {
      log('  確認スキップ: ' + e.message);
    }
  }

  // --- データベース ---
  log('');
  log('[データベース]');
  try {
    const dbSheet = getSheetById_(CONFIG.DEST_SPREADSHEET_ID, CONFIG.DB_SHEET_ID);
    const lastRow = dbSheet.getLastRow();
    let dbHit = false;
    if (lastRow >= 2) {
      const names = dbSheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      names.forEach(function(n, i) {
        if (n && normalizeSiteName(n) === targetNorm) {
          dbHit = true;
          log('  ✓ 行' + (i + 2) + ' に登録あり');
        }
      });
    }
    if (!dbHit) log('  ✗ 未登録');
  } catch (e) {
    log('  読み込みエラー: ' + e.message);
  }

  // --- 職人 現場一覧 ---
  log('');
  log('[職人進捗 現場一覧]');
  try {
    const workerSheet = getWorkerSheet_();
    const wLast = workerSheet.getLastRow();
    let wHit = false;
    if (wLast >= 2) {
      const wData = workerSheet.getRange(2, 1, wLast - 1, 2).getValues();
      wData.forEach(function(row, i) {
        if (normalizeSiteName(row[1]) === targetNorm) {
          wHit = true;
          log('  ✓ 行' + (i + 2) + ' / ID=' + row[0] + ' / 名前=' + row[1]);
        }
      });
    }
    if (!wHit) log('  ✗ 未登録');
  } catch (e) {
    log('  読み込みエラー: ' + e.message);
  }

  log('');
  log('=== 診断完了 ===');
  if (!sourceFound) {
    log('【対処】工程表のタブ名が「2026年合計【枠・楔】」か確認し、現場名セルを緑(#ccffcc)にして syncSitesWithSchedule を再実行');
  }
  return lines.join('\n');
}

/**
 * 関連する全スプレッドシートを横断して「稼働現場リスト/データベース/現場一覧」の
 * 実体（gid・行数・指定現場の有無）を一覧表示する。書き込みは一切しない。
 * GASエディタで auditAllSpreadsheets('ラミアール三ツ沢') を実行。
 *
 * @param {string} [siteName='ラミアール三ツ沢'] 存在を確認したい現場名
 */
function auditAllSpreadsheets(siteName) {
  siteName = siteName || 'ラミアール三ツ沢';
  const targetNorm = normalizeSiteName(siteName);
  const out = [];
  const log = function(m) { out.push(m); Logger.log(m); };

  // 確認対象の全スプレッドシート（用途ラベル付き）
  const books = [
    { id: 'SAMPLE_ID_026', label: '現場管理・報告フォーム（あなたが見ている画面）' },
    { id: 'SAMPLE_ID_011', label: 'ダッシュボードが読むファイル' },
    { id: 'SAMPLE_ID_027', label: '現場確認' },
    { id: 'SAMPLE_ID_025', label: '同期の旧書き込み先' },
    { id: 'SAMPLE_ID_019', label: '職人進捗管理（先方納品・実運用中の本番）' },
    { id: 'SAMPLE_ID_010', label: '職人進捗管理（旧本番・現在は未使用）' }
  ];

  const targetSheetNames = ['稼働現場リスト', 'データベース', '現場一覧'];

  log('=== 全スプレッドシート横断監査: "' + siteName + '"（正規化 "' + targetNorm + '"）===');

  books.forEach(function(book) {
    log('');
    log('■ ' + book.label);
    log('  ID: ' + book.id);
    let ss;
    try {
      ss = SpreadsheetApp.openById(book.id);
    } catch (e) {
      log('  ✗ 開けません（権限なし or 存在しない）: ' + e.message);
      return;
    }
    log('  ファイル名: ' + ss.getName());

    targetSheetNames.forEach(function(sheetName) {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) return;
      const gid = sheet.getSheetId();
      const lastRow = sheet.getLastRow();
      let found = '';
      if (lastRow >= 2) {
        // A列に現場名がある前提で全行スキャン
        const names = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < names.length; i++) {
          if (names[i][0] && normalizeSiteName(names[i][0]) === targetNorm) {
            found = ' / ★"' + siteName + '" を行' + (i + 2) + 'に発見';
            break;
          }
        }
        if (!found) found = ' / "' + siteName + '" なし';
      }
      log('    - シート "' + sheetName + '" gid=' + gid + ' 行数=' + lastRow + found);
    });
  });

  log('');
  log('=== 監査完了 ===');
  log('【読み方】★が付いたファイルにその現場が実在します。');
  log('ダッシュボードに出したいなら「ダッシュボードが読むファイル」に★が付く必要があります。');
  return out.join('\n');
}

function createTrigger() {
  const handler = 'syncSitesWithSchedule';
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === handler)
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger(handler).timeBased().everyHours(1).create();
  Logger.log('1時間おきのトリガーを作成しました');
}
