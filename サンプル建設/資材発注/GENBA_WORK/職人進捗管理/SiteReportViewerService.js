/**
 * 職人向け：指定現場の報告ログを読み取り専用で返す（閲覧 Web 用）。
 * シートの新規作成は行わない（ensureSheet は使わない）。
 */
const SiteReportViewerService = (() => {
  /** 走査行数（ログが大きい現場では6ヶ月分を拾うため多め。getRange 1回の読み取り幅） */
  const SCAN_ROWS = 6000;
  /** 直近この期間より古い行は除外（約6ヶ月＝183日） */
  const VIEWER_LOOKBACK_MS = 183 * 24 * 60 * 60 * 1000;
  /** 報告種別ごとの最大件数（半年で日次×複数でも足りる程度に上限） */
  const MAX_ENTRIES_PER_TYPE = 220;
  /** 1件あたり返す写真URLの上限（多すぎると JSON・ブラウザが重い） */
  const MAX_IMAGES_PER_ENTRY = 20;
  /** 同じ現場の閲覧結果を短時間キャッシュ（秒） */
  const VIEWER_CACHE_TTL_SEC = 120;

  const logSheetTabMatchesReportType = (tabName, reportType) => {
    const t = String(reportType || '').trim();
    const n = String(tabName || '').trim();
    if (!t || !n) return false;
    if (n === t) return true;
    if (n === 'Log_' + t) return true;
    return false;
  };

  const getViewerSpreadsheet = () => {
    const configuredId =
      (APP_CONFIG.spreadsheetId && String(APP_CONFIG.spreadsheetId).trim()) ||
      (PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
    if (!configuredId) {
      throw new Error('SPREADSHEET_ID が未設定です。');
    }
    return SpreadsheetApp.openById(configuredId);
  };

  const getSheetByGid = (ss, gid) => {
    const id = String(gid);
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i += 1) {
      if (String(sheets[i].getSheetId()) === id) return sheets[i];
    }
    return null;
  };

  /**
   * 報告ログシートを解決（読み取りのみ・作成しない）
   * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
   */
  const resolveLogSheetForRead = reportType => {
    const type = String(reportType || '').trim();
    if (!type) return null;
    let target = APP_CONFIG.getLogSheetName(type);
    const ss = getViewerSpreadsheet();
    const manualFb =
      APP_CONFIG.logSheetFallbackByType && APP_CONFIG.logSheetFallbackByType[type];

    const tryByName = name => {
      const n = String(name || '').trim();
      if (!n) return null;
      return ss.getSheetByName(n) || null;
    };

    if (manualFb) {
      return tryByName(manualFb);
    }

    const numericTarget =
      typeof target === 'number' || /^\d+$/.test(String(target));
    if (numericTarget) {
      let sheet = getSheetByGid(ss, target);
      if (sheet && !logSheetTabMatchesReportType(sheet.getName(), type)) {
        const alt = tryByName(type) || tryByName('Log_' + type);
        if (alt) sheet = alt;
      }
      if (sheet) return sheet;
      return tryByName(type) || tryByName('Log_' + type);
    }

    return tryByName(String(target)) || tryByName(type) || tryByName('Log_' + type);
  };

  const findCol = (headers, matchers) => {
    const h = headers || [];
    for (let mi = 0; mi < matchers.length; mi += 1) {
      const m = matchers[mi];
      for (let i = 0; i < h.length; i += 1) {
        if (m(String(h[i] || '').trim())) return i;
      }
    }
    return -1;
  };

  const parseTs = v => {
    if (v instanceof Date) return v.getTime();
    const s = String(v || '').trim();
    if (!s) return 0;
    const d = new Date(s);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  };

  const summarizeJsonCol = (name, raw) => {
    const s = String(raw || '').trim();
    if (name === 'MetaJSON') {
      return s.length > 120 ? s.substring(0, 120) + '…' : s;
    }
    return s.length > 200 ? s.substring(0, 200) + '…' : s;
  };

  /**
   * ImagesJSON（saveReport 保存形式）から閲覧用の画像リストを生成。
   * img 用: uc?export=view（表示） / thumbnail（読み込み失敗時の差し替え用にクライアントへ両方渡す）
   */
  const parseImagesForViewer = rawJson => {
    try {
      const arr = JSON.parse(String(rawJson || '[]'));
      if (!Array.isArray(arr)) return [];
      return arr
        .map(item => {
          if (!item) return null;
          const id = String(item.id || '').trim();
          if (!id) return null;
          const url = String(item.url || '').trim();
          const name = String(item.name || '').trim() || '写真';
          const questionId = String(item.questionId || '').trim();
          const viewUrl =
            'https://drive.google.com/uc?export=view&id=' + encodeURIComponent(id);
          const thumbUrl =
            'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w1200';
          return {
            id,
            url: url || 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view',
            name,
            questionId,
            viewUrl,
            thumbUrl
          };
        })
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  };

  /**
   * @param {string} siteId
   * @param {string} [buildingOpt] 指定時は棟名が一致する行のみ
   * @returns {{ ok: boolean, siteId: string, siteName: string, buildingFilter: string, reports: Array, error?: string }}
   */
  const getSiteReports = (siteId, buildingOpt) => {
    const sid = String(siteId || '').trim();
    if (!sid) {
      return { ok: false, error: '現場IDがありません', siteId: '', siteName: '', buildingFilter: '', reports: [] };
    }
    if (APP_CONFIG.mockMode) {
      return {
        ok: true,
        siteId: sid,
        siteName: '（モック）',
        buildingFilter: String(buildingOpt || '').trim(),
        viewerLookbackDays: 183,
        scanRowsPerSheet: SCAN_ROWS,
        maxEntriesPerReportType: MAX_ENTRIES_PER_TYPE,
        reports: []
      };
    }

    const wantBuilding = String(buildingOpt || '').trim();
    const cacheKey = ('vr_' + sid + '_' + wantBuilding).substring(0, 250);
    try {
      const cache = CacheService.getScriptCache();
      const cached = cache.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.ok) return parsed;
      }
    } catch (e) {
      Logger.log('SiteReportViewerService cache get: ' + e);
    }

    const siteRow = MasterDataService.findSiteById(sid);
    const siteName = siteRow ? String(siteRow.name || '').trim() : '';

    const filterByBuilding = !!wantBuilding;
    const wantNorm = filterByBuilding ? UtilitiesEx.normalizeName(wantBuilding) : '';
    const cutoffMs = Date.now() - VIEWER_LOOKBACK_MS;

    const reportTypes = APP_CONFIG.defaultFormTypes || [];
    const reports = [];

    for (let t = 0; t < reportTypes.length; t += 1) {
      const reportType = reportTypes[t];
      let sheet;
      try {
        sheet = resolveLogSheetForRead(reportType);
      } catch (err) {
        Logger.log('SiteReportViewerService: resolve skip %s: %s', reportType, err);
        sheet = null;
      }
      if (!sheet) continue;

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) continue;

      const lastCol = sheet.getLastColumn();
      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      const startRow = Math.max(2, lastRow - SCAN_ROWS + 1);
      const numRows = lastRow - startRow + 1;
      const displayMatrix = sheet
        .getRange(startRow, 1, lastRow, lastCol)
        .getDisplayValues();
      const valueMatrix = sheet.getRange(startRow, 1, lastRow, lastCol).getValues();

      const siteCol = findCol(headers, [
        h => h === '現場ID' || h === 'SiteId',
        h => /現場ID/i.test(h)
      ]);
      if (siteCol < 0) continue;

      const buildingCol = findCol(headers, [
        h => h === '棟名' || h === 'BuildingName',
        h => h === '棟'
      ]);

      const folderIdCol = findCol(headers, [
        h => h === 'DriveFolderId',
        h => /DriveFolderId/i.test(h),
        h => h === 'フォルダID'
      ]);

      const tsCol = findCol(headers, [
        h => h === '送信日時' || h === 'Timestamp',
        h => /送信日時|Timestamp|タイムスタンプ/i.test(h)
      ]);

      const entries = [];

      for (let r = lastRow; r >= startRow; r -= 1) {
        const localIdx = r - startRow;
        const dispRow = displayMatrix[localIdx];
        const valRow = valueMatrix[localIdx];
        if (!dispRow) continue;
        const rowSite = String(dispRow[siteCol] || '').trim();
        if (rowSite !== sid) continue;

        if (filterByBuilding && buildingCol >= 0) {
          const rowB = UtilitiesEx.normalizeName(dispRow[buildingCol]);
          if (rowB !== wantNorm) continue;
        }

        let rowTs = 0;
        if (tsCol >= 0 && valRow) {
          const rawTs = valRow[tsCol] != null ? valRow[tsCol] : dispRow[tsCol];
          rowTs = parseTs(rawTs);
        }
        if (rowTs > 0 && rowTs < cutoffMs) continue;

        const fields = {};
        let imagesParsed = [];
        let imagesTruncated = false;
        let imagesTotalCount = 0;
        let folderId = '';

        for (let c = 0; c < headers.length; c += 1) {
          const hn = String(headers[c] || '').trim();
          if (!hn) continue;
          if (hn === 'ImagesJSON') {
            const full = parseImagesForViewer(valRow[c]);
            const imagesTotal = full.length;
            imagesParsed = full.slice(0, MAX_IMAGES_PER_ENTRY);
            imagesTruncated = imagesTotal > imagesParsed.length;
            imagesTotalCount = imagesTotal;
            continue;
          }
          let val = dispRow[c] != null ? String(dispRow[c]) : '';
          if (hn === 'MetaJSON') {
            val = summarizeJsonCol(hn, valRow[c]);
          }
          fields[hn] = val;
          if (folderIdCol >= 0 && c === folderIdCol) {
            folderId = String(valRow[c] || '').trim();
          }
        }

        const ts =
          fields['送信日時'] ||
          fields['Timestamp'] ||
          fields['タイムスタンプ'] ||
          '';
        const folderUrl = folderId
          ? 'https://drive.google.com/drive/folders/' + encodeURIComponent(folderId)
          : '';

        const sortKey = rowTs > 0 ? rowTs : parseTs(ts);

        entries.push({
          sortKey: sortKey,
          fields: fields,
          images: imagesParsed,
          imagesTotal: imagesTotalCount,
          imagesTruncated: imagesTruncated,
          folderUrl: folderUrl
        });

        if (entries.length >= MAX_ENTRIES_PER_TYPE) break;
      }

      entries.sort((a, b) => b.sortKey - a.sortKey);

      if (entries.length) {
        reports.push({
          reportType: reportType,
          sheetName: sheet.getName(),
          entries: entries.map(e => ({
            submittedAtMs: e.sortKey || 0,
            fields: e.fields,
            images: e.images || [],
            imagesTotal: e.imagesTotal || (e.images || []).length,
            imagesTruncated: !!e.imagesTruncated,
            folderUrl: e.folderUrl || ''
          }))
        });
      }
    }

    const out = {
      ok: true,
      siteId: sid,
      siteName: siteName,
      buildingFilter: wantBuilding,
      viewerLookbackDays: 183,
      scanRowsPerSheet: SCAN_ROWS,
      maxEntriesPerReportType: MAX_ENTRIES_PER_TYPE,
      reports: reports
    };
    try {
      const serialized = JSON.stringify(out);
      if (serialized.length < 95000) {
        CacheService.getScriptCache().put(cacheKey, serialized, VIEWER_CACHE_TTL_SEC);
      }
    } catch (e) {
      Logger.log('SiteReportViewerService cache put: ' + e);
    }
    return out;
  };

  /**
   * 請負業者名に一致するログ行から、施工業者×現場の組み合わせ一覧を返す（閲覧の選択 UI 用）。
   * 各ログシート末尾から最大 SCAN_ROWS 行を走査する（日付による除外はしない）。
   */
  const getTeamSitePairs = teamNameRaw => {
    const raw = String(teamNameRaw || '').trim();
    if (!raw) {
      return {
        ok: false,
        error: '請負業者名がありません',
        teamNameQuery: '',
        pairs: []
      };
    }
    if (APP_CONFIG.mockMode) {
      return {
        ok: true,
        teamNameQuery: raw,
        pairs: [
          {
            companyName: '（モック）施工業者',
            siteId: 'SITE-001',
            siteName: '（モック）工事現場'
          }
        ]
      };
    }

    const teamNorm = UtilitiesEx.normalizeName(raw);
    if (!teamNorm) {
      return { ok: false, error: '請負業者名が無効です', teamNameQuery: raw, pairs: [] };
    }

    const cacheKey = ('vrtp_' + teamNorm).substring(0, 200);
    try {
      const cache = CacheService.getScriptCache();
      const cached = cache.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.ok) return parsed;
      }
    } catch (e) {
      Logger.log('SiteReportViewerService getTeamSitePairs cache get: ' + e);
    }

    const dedupe = {};
    const reportTypes = APP_CONFIG.defaultFormTypes || [];

    for (let t = 0; t < reportTypes.length; t += 1) {
      const reportType = reportTypes[t];
      let sheet;
      try {
        sheet = resolveLogSheetForRead(reportType);
      } catch (err) {
        sheet = null;
      }
      if (!sheet) continue;

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) continue;

      const lastCol = sheet.getLastColumn();
      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      const startRow = Math.max(2, lastRow - SCAN_ROWS + 1);
      const displayMatrix = sheet
        .getRange(startRow, 1, lastRow, lastCol)
        .getDisplayValues();

      const teamCol = findCol(headers, [
        h => h === '請負業者名' || h === 'TeamName',
        h => /請負業者/i.test(h)
      ]);
      const companyCol = findCol(headers, [
        h => h === '施工業者名' || h === 'CompanyName',
        h => /施工業者/i.test(h)
      ]);
      const siteCol = findCol(headers, [
        h => h === '現場ID' || h === 'SiteId',
        h => /現場ID/i.test(h)
      ]);
      const siteNameCol = findCol(headers, [
        h => h === '工事現場名' || h === 'SiteName',
        h => /工事現場名/i.test(h)
      ]);

      if (teamCol < 0 || companyCol < 0 || siteCol < 0) continue;

      for (let r = lastRow; r >= startRow; r -= 1) {
        const localIdx = r - startRow;
        const dispRow = displayMatrix[localIdx];
        if (!dispRow) continue;
        const rowTeam = String(dispRow[teamCol] || '').trim();
        if (UtilitiesEx.normalizeName(rowTeam) !== teamNorm) continue;

        const company = String(dispRow[companyCol] || '').trim();
        const siteId = String(dispRow[siteCol] || '').trim();
        if (!siteId || !/^SITE-\d+$/i.test(siteId)) continue;

        const siteName =
          siteNameCol >= 0
            ? String(dispRow[siteNameCol] || '').trim()
            : '';

        const key =
          String(siteId).toUpperCase() +
          '\t' +
          UtilitiesEx.normalizeName(company);
        if (!dedupe[key]) {
          dedupe[key] = {
            companyName: company,
            siteId: String(siteId).trim(),
            siteName: siteName
          };
        }
      }
    }

    const pairs = Object.keys(dedupe).map(k => dedupe[k]);
    pairs.sort((a, b) => {
      const ca = UtilitiesEx.normalizeName(a.companyName);
      const cb = UtilitiesEx.normalizeName(b.companyName);
      let c = ca.localeCompare(cb, 'ja');
      if (c !== 0) return c;
      return UtilitiesEx.normalizeName(a.siteName).localeCompare(
        UtilitiesEx.normalizeName(b.siteName),
        'ja'
      );
    });

    const out = {
      ok: true,
      teamNameQuery: raw,
      pairs: pairs.slice(0, 500),
      scanRowsPerSheet: SCAN_ROWS
    };

    try {
      const serialized = JSON.stringify(out);
      if (serialized.length < 95000) {
        CacheService.getScriptCache().put(cacheKey, serialized, 90);
      }
    } catch (e) {
      Logger.log('SiteReportViewerService getTeamSitePairs cache put: ' + e);
    }
    return out;
  };

  return {
    getSiteReports,
    getTeamSitePairs
  };
})();
