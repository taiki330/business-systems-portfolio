/**
 * Provides read helpers for master sheets.
 * 
 * IMPORTANT: This service is read-only for site master data.
 * New site names from form submissions will NOT be automatically added to the master.
 * Site master data must be manually maintained in the Master_Sites sheet.
 */
const MasterDataService = (() => {
  const useMock = !!APP_CONFIG.mockMode;

  const CODES = Object.freeze({
    OK: 'OK',
    NOT_IN_MASTER: 'SITE_NOT_IN_MASTER',
    MASTER_ACCESS_DENIED: 'SITE_MASTER_ACCESS_DENIED',
    MASTER_READ_FAILED: 'SITE_MASTER_READ_FAILED'
  });

  let sitesCache;
  let workersCache;
  let contractorsCache;
  /** 現場一覧シートの列インデックス（0始まり）。invalidate と同時にクリアする */
  let sitesColumnMap;

  const parseSitesHeaderIndices = headers => {
    const idCol = headers.findIndex(
      h => h === '現場ID' || String(h).toLowerCase() === 'siteid'
    );
    const nameCol = headers.findIndex(
      h =>
        h === '現場名' ||
        String(h).toLowerCase() === 'sitename' ||
        h === '工事現場名'
    );
    const driveCol = headers.findIndex(
      h =>
        h === 'DriveフォルダID' ||
        String(h).toLowerCase() === 'drivefolderid' ||
        h === 'フォルダID'
    );
    const statusCol = headers.findIndex(
      h => h === 'ステータス' || String(h).toLowerCase() === 'status'
    );
    return { idCol, nameCol, driveCol, statusCol };
  };

  /**
   * 1行目に「DriveフォルダID」等の見出しがなくても、C列のように空見出しで ID だけ並んでいる列を拾う。
   * readTable は空ヘッダー列を行オブジェクトに載せないため、従来は driveCol 未検出 → フォールバック経路で
   * driveFolderId が常に空扱いになり、名前検索・キャッシュ共有で別現場に入る原因になっていた。
   */
  const inferDriveFolderColumnIndex = (sheet, headers, idCol, nameCol, statusCol) => {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return -1;
    const reserved = new Set([idCol, nameCol, statusCol].filter(i => i >= 0));
    for (let c = 0; c < headers.length; c += 1) {
      if (reserved.has(c)) continue;
      if (String(headers[c] || '').trim() !== '') continue;
      const v = String(sheet.getRange(2, c + 1).getValue() || '').trim();
      if (/^[a-zA-Z0-9_-]{20,100}$/.test(v)) return c;
    }
    return -1;
  };

  /**
   * getDataRange ではなく、現場ID・現場名・Drive・ステータス列にまたがる最小矩形だけ読む。
   */
  const loadSitesCacheFromSheet = () => {
    const sheet = SheetRepository.getSheet(APP_CONFIG.sheetNames.sites);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      sitesCache = [];
      sitesColumnMap = null;
      return;
    }
    const lastCol = sheet.getLastColumn();
    const headerCells = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const headers = headerCells.map(h => String(h || '').trim());
    let { idCol, nameCol, driveCol, statusCol } = parseSitesHeaderIndices(headers);
    if (driveCol < 0 && idCol >= 0) {
      const inferred = inferDriveFolderColumnIndex(sheet, headers, idCol, nameCol, statusCol);
      if (inferred >= 0) driveCol = inferred;
    }

    if (idCol < 0 || driveCol < 0) {
      const { rows } = SheetRepository.readTable(APP_CONFIG.sheetNames.sites);
      sitesCache = rows.map(row => ({
        id: String(row.現場ID || row.SiteId || '').trim(),
        name: row.現場名 || row.SiteName || '',
        driveFolderId: row.DriveフォルダID || row.DriveFolderId || row.フォルダID || '',
        status: row.ステータス || row.Status || ''
      }));
      sitesColumnMap = null;
      return;
    }

    const cols = [idCol, driveCol];
    if (nameCol >= 0) cols.push(nameCol);
    if (statusCol >= 0) cols.push(statusCol);
    const minCol = Math.min.apply(null, cols);
    const maxCol = Math.max.apply(null, cols);
    const numBlockRows = lastRow - 2 + 1;
    const numBlockCols = maxCol - minCol + 1;
    const block = sheet.getRange(2, minCol + 1, numBlockRows, numBlockCols).getValues();

    sitesColumnMap = { idCol, nameCol, driveCol, statusCol, minCol, maxCol };

    const cellAt = (row, c) => {
      if (c < minCol || c > maxCol) return '';
      return row[c - minCol];
    };

    sitesCache = [];
    for (let i = 0; i < block.length; i += 1) {
      const row = block[i];
      const id = String(cellAt(row, idCol) || '').trim();
      const name = nameCol >= 0 ? String(cellAt(row, nameCol) || '') : '';
      const driveFolderId = String(cellAt(row, driveCol) || '').trim();
      const status = statusCol >= 0 ? String(cellAt(row, statusCol) || '').trim() : '';
      const hasAny = [id, name, driveFolderId, status].some(v => v !== '');
      if (!hasAny) continue;
      sitesCache.push({ id, name, driveFolderId, status });
    }
  };

  const getSites = () => {
    if (useMock && typeof MockData !== 'undefined') {
      return (MockData.sites || []).map(site => ({ ...site }));
    }
    if (!sitesCache) {
      loadSitesCacheFromSheet();
    }
    return sitesCache;
  };

  const findSiteById = siteId => {
    if (!siteId) return null;
    return getSites().find(site => site.id === String(siteId).trim()) || null;
  };

  /**
   * @param {{ siteId?: string, siteName?: string }} p
   * @returns {{ id: string, name: string, driveFolderId: string, status: string, code: string, masterSiteName: string }}
   */
  const resolveSiteForReport = p => {
    const siteId = p && p.siteId;
    const siteName = (p && p.siteName) || '';
    Logger.log('検索する現場名: ' + siteName);

    const idTrim = siteId != null ? String(siteId).trim() : '';
    const normalizeSiteIdKey = id => {
      const t = String(id || '').trim().toUpperCase();
      return /^SITE-\d+$/.test(t) ? t : '';
    };
    const idFromPayload = normalizeSiteIdKey(idTrim);
    const idFromText = UtilitiesEx.extractSiteIdFromText(siteName);
    const lookupId = idFromPayload || idFromText;

    Logger.log(
      'resolveSiteForReport: SITE-IDキー=%s (payload=%s 文字列から=%s)',
      lookupId || '(なし)',
      idFromPayload || '-',
      idFromText || '-'
    );

    const normalizedFormSiteName = UtilitiesEx.normalizeName(String(siteName));
    const normalizedSheetSiteName = displayName =>
      UtilitiesEx.normalizeName(String(displayName == null ? '' : displayName));

    const finish = r => {
      const out = {
        id: String(r.id || '').trim(),
        name: String(r.name || '').trim(),
        driveFolderId: String(r.driveFolderId || '').trim(),
        status: String(r.status || '').trim(),
        code: String(r.code || CODES.OK),
        masterSiteName: String(r.masterSiteName != null ? r.masterSiteName : r.name || '').trim()
      };
      const fid = out.driveFolderId;
      if (fid) {
        Logger.log(
          'resolveSiteForReport: フォルダID取得 id=%s name=%s folderId=%s code=%s',
          out.id,
          out.name,
          fid,
          out.code
        );
      } else {
        Logger.log(
          'resolveSiteForReport: フォルダID未取得 id=%s code=%s SITE-IDキー=%s payload.id=%s 正規化現場名キー=%s',
          out.id,
          out.code,
          lookupId || '',
          idTrim,
          normalizedFormSiteName
        );
      }
      return out;
    };

    const findBySiteId = list => {
      if (!lookupId) return null;
      return list.find(s => normalizeSiteIdKey(s.id) === lookupId) || null;
    };

    const findByName = list => {
      if (!normalizedFormSiteName) return null;
      const hits = list.filter(
        s => normalizedSheetSiteName(s.name) === normalizedFormSiteName
      );
      return hits.find(s => String(s.driveFolderId || '').trim()) || hits[0] || null;
    };

    if (useMock && typeof MockData !== 'undefined') {
      const list = MockData.sites || [];
      const byId = findBySiteId(list);
      if (byId) {
        return finish({ ...byId, code: CODES.OK, masterSiteName: byId.name });
      }
      const byName = findByName(list);
      if (byName) {
        return finish({ ...byName, code: CODES.OK, masterSiteName: byName.name });
      }
      return finish({
        id: lookupId || idTrim || '',
        name: siteName,
        driveFolderId: '',
        status: 'unknown',
        code: CODES.NOT_IN_MASTER,
        masterSiteName: ''
      });
    }

    let sites;
    try {
      sites = getSites();
    } catch (e) {
      const msg = String(e.message || e);
      const isDenied = /permission|権限|access/i.test(msg);
      Logger.log('resolveSiteForReport: マスタ読取失敗 error=%s', msg);
      return finish({
        id: lookupId || idTrim || '',
        name: siteName,
        driveFolderId: '',
        status: 'unknown',
        code: isDenied ? CODES.MASTER_ACCESS_DENIED : CODES.MASTER_READ_FAILED,
        masterSiteName: ''
      });
    }

    const byId = findBySiteId(sites);
    if (byId) {
      return finish({ ...byId, code: CODES.OK, masterSiteName: byId.name });
    }
    const byName = findByName(sites);
    if (byName) {
      return finish({ ...byName, code: CODES.OK, masterSiteName: byName.name });
    }

    return finish({
      id: lookupId || idTrim || '',
      name: siteName,
      driveFolderId: '',
      status: 'unknown',
      code: CODES.NOT_IN_MASTER,
      masterSiteName: ''
    });
  };

  const updateSiteDriveFolderId = (siteId, folderId) => {
    if (useMock) return;
    if (!siteId || !folderId) return;
    // 複数ユーザーが同時に異なる現場フォルダを作成した際に
    // 別現場のフォルダIDで上書きされないようロックで保護する
    // ※ getDocumentLock は「スプレッドシートに紐づいたスクリプト」専用。スタンドアロンWebアプリでは null になる。
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = SheetRepository.getSheet(APP_CONFIG.sheetNames.sites);
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return;

      let idCol;
      let nameCol;
      let driveCol;
      if (
        sitesColumnMap &&
        sitesColumnMap.idCol >= 0 &&
        sitesColumnMap.driveCol >= 0
      ) {
        idCol = sitesColumnMap.idCol;
        nameCol = sitesColumnMap.nameCol;
        driveCol = sitesColumnMap.driveCol;
      } else {
        const lastCol = sheet.getLastColumn();
        const headers = sheet
          .getRange(1, 1, 1, lastCol)
          .getValues()[0]
          .map(h => String(h || '').trim());
        const parsed = parseSitesHeaderIndices(headers);
        idCol = parsed.idCol;
        nameCol = parsed.nameCol;
        driveCol = parsed.driveCol;
      }
      if (idCol < 0 || driveCol < 0) return;

      const idColNumRows = lastRow - 2 + 1;
      const idColValues = sheet.getRange(2, idCol + 1, idColNumRows, 1).getValues();
      for (let i = 0; i < idColValues.length; i += 1) {
        if (String(idColValues[i][0]).trim() === String(siteId).trim()) {
          sheet.getRange(i + 2, driveCol + 1).setValue(folderId);
          invalidateSites();
          return;
        }
      }

      // 現場IDで見つからなかった場合（新規追加等でIDが空欄で、siteIdに現場名が入っている場合）
      if (nameCol >= 0) {
        const normTarget = UtilitiesEx.normalizeSiteName(String(siteId));
        const nameColValues = sheet.getRange(2, nameCol + 1, idColNumRows, 1).getValues();
        for (let i = 0; i < nameColValues.length; i += 1) {
          if (
            UtilitiesEx.normalizeSiteName(String(nameColValues[i][0])) === normTarget
          ) {
            sheet.getRange(i + 2, driveCol + 1).setValue(folderId);
            invalidateSites();
            return;
          }
        }
      }
    } finally {
      lock.releaseLock();
    }
  };

  const invalidateSites = () => {
    sitesCache = null;
    sitesColumnMap = null;
  };

  /**
   * 業者マスタシートから請負業者→施工業者のマッピングデータを取得する。
   * フラットな行データを返し、マップへの変換はフロントエンド側で行う。
   */
  const getContractors = () => {
    if (useMock && typeof MockData !== 'undefined') {
      return (MockData.contractors || []).map(item => ({ ...item }));
    }
    if (!contractorsCache) {
      try {
        const { rows } = SheetRepository.readTable(APP_CONFIG.sheetNames.contractors);
        contractorsCache = rows.map(row => ({
          contractor: String(row['請負業者名'] || '').trim(),
          subcontractor: String(row['施工業者名'] || '').trim()
        })).filter(row => row.contractor !== '');
      } catch (error) {
        console.warn('業者マスタの読み込みに失敗しました:', error.message);
        contractorsCache = [];
      }
    }
    return contractorsCache;
  };

  const invalidateContractors = () => {
    contractorsCache = null;
  };

  return {
    CODES,
    getSites,
    findSiteById,
    resolveSiteForReport,
    updateSiteDriveFolderId,
    invalidateSites,
    getContractors,
    invalidateContractors
  };
})();
