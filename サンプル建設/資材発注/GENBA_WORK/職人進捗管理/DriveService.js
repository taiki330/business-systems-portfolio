/**
 * Handles Drive folder creation and file uploads.
 */
const DriveService = (() => {
  /** 同一実行内で同じ親＋フォルダ名の解決を繰り返さない（getFolderById / getFoldersByName 削減） */
  const folderSessionCache = new Map();
  const sessionFolderKey = (parentId, sanitized) => `${parentId}\u0001${sanitized}`;

  const getSessionFolder = (parentId, sanitized) => {
    const k = sessionFolderKey(parentId, sanitized);
    if (!folderSessionCache.has(k)) return null;
    const folder = folderSessionCache.get(k);
    try {
      folder.getName();
      return folder;
    } catch (e) {
      folderSessionCache.delete(k);
      return null;
    }
  };

  const setSessionFolder = (parentId, sanitized, folder) => {
    folderSessionCache.set(sessionFolderKey(parentId, sanitized), folder);
  };

  const rememberFolder = (parentId, sanitized, folder, cache, cacheKey) => {
    setSessionFolder(parentId, sanitized, folder);
    cache.put(cacheKey, folder.getId(), 21600);
  };

  const stripSiteIdSuffix = name =>
    String(name || '').replace(/\s+__SITE-\d+\s*$/i, '').trim();

  /** 親の直下の同名フォルダをすべて取得（1件目だけ採用バグの調査用） */
  const collectFoldersByName_ = (parent, sanitized) => {
    const out = [];
    const it = parent.getFoldersByName(sanitized);
    while (it.hasNext()) {
      out.push(it.next());
    }
    return out;
  };

  const ensureFolder = (parent, name) => {
    const sanitized = UtilitiesEx.sanitizeName(name);
    const parentId = parent.getId();
    const sessionHit = getSessionFolder(parentId, sanitized);
    if (sessionHit) return sessionHit;

    const cache = CacheService.getScriptCache();
    const cacheKey = `folderId_${parentId}_${sanitized}`;

    const cachedId = cache.get(cacheKey);
    if (cachedId) {
      try {
        const folder = DriveApp.getFolderById(cachedId);
        setSessionFolder(parentId, sanitized, folder);
        return folder;
      } catch (e) {
        Logger.log(
          `DriveService.ensureFolder: cache id invalid parent=${parentId} key=${cacheKey} err=${e}`
        );
      }
    }

    const iterator = parent.getFoldersByName(sanitized);
    if (iterator.hasNext()) {
      const folder = iterator.next();
      rememberFolder(parentId, sanitized, folder, cache, cacheKey);
      return folder;
    }

    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      const doubleCheckSession = getSessionFolder(parentId, sanitized);
      if (doubleCheckSession) return doubleCheckSession;

      const doubleCheckId = cache.get(cacheKey);
      if (doubleCheckId) {
        try {
          const folder = DriveApp.getFolderById(doubleCheckId);
          setSessionFolder(parentId, sanitized, folder);
          return folder;
        } catch (e) {
          Logger.log(`DriveService.ensureFolder: doubleCheck id invalid err=${e}`);
        }
      }

      const retryIterator = parent.getFoldersByName(sanitized);
      if (retryIterator.hasNext()) {
        const existing = retryIterator.next();
        rememberFolder(parentId, sanitized, existing, cache, cacheKey);
        return existing;
      }

      const newFolder = parent.createFolder(sanitized);
      rememberFolder(parentId, sanitized, newFolder, cache, cacheKey);
      return newFolder;
    } catch (e) {
      const retryIterator = parent.getFoldersByName(sanitized);
      if (retryIterator.hasNext()) {
        const existing = retryIterator.next();
        rememberFolder(parentId, sanitized, existing, cache, cacheKey);
        return existing;
      }
      const created = parent.createFolder(sanitized);
      rememberFolder(parentId, sanitized, created, cache, cacheKey);
      return created;
    } finally {
      lock.releaseLock();
    }
  };

  const ensureSiteFolder = site => {
    throw new Error('ensureSiteFolder は非推奨です。ensureReportFolder / SiteDriveFolderGuard を使用してください。');
  };

  const shouldQuarantineOnFailure_ = () =>
    (APP_CONFIG.DRIVE_GUARD_FAILURE_MODE || 'block') === 'quarantine';

  const isQuarantineErrorCode_ = code => {
    const guard = SiteDriveFolderGuard.SITE_DRIVE_GUARD_CODES;
    const master = MasterDataService.CODES;
    const targets = [
      guard.NOT_SET,
      guard.INVALID,
      guard.MISMATCH,
      master.NOT_IN_MASTER,
      master.MASTER_ACCESS_DENIED,
      master.MASTER_READ_FAILED
    ];
    return targets.indexOf(code) >= 0;
  };

  const buildReportFolderResult_ = (folder, extra) =>
    Object.assign(
      {
        folder,
        folderId: folder.getId(),
        folderUrl: folder.getUrl(),
        isQuarantine: false,
        quarantineReason: '',
        quarantineFolderUrl: '',
        quarantineCaseFolderId: '',
        intendedPath: '',
        driveFolderIdFromMaster: '',
        actualFolderName: '',
        _quarantineCtx: null
      },
      extra || {}
    );

  const buildNormalIntendedPath_ = (siteName, buildingName, reportType, workerName, submittedAtIso) => {
    const bn = (buildingName || '').trim();
    const bnSeg =
      bn && bn !== '該当なし' && bn !== '（現場名に含む）' ? bn : '';
    const timezone = Session.getScriptTimeZone ? Session.getScriptTimeZone() : 'Asia/Tokyo';
    const submittedDate = submittedAtIso ? new Date(submittedAtIso) : new Date();
    const dateSegment = Utilities.formatDate(
      submittedDate,
      timezone,
      'yyyy-MM-dd_HH-mm-ss-SSS'
    );
    const safeWorkerName = UtilitiesEx.sanitizeName(workerName || '不明');
    return [siteName || '', '08_職人報告', bnSeg, reportType || '', `${dateSegment}_${safeWorkerName}`]
      .filter(Boolean)
      .join('/');
  };

  const resolveQuarantineErrorCode_ = (check, siteForPath) => {
    if (check && check.errorCode) {
      if (
        check.errorCode === SiteDriveFolderGuard.SITE_DRIVE_GUARD_CODES.NOT_SET &&
        siteForPath.code &&
        siteForPath.code !== MasterDataService.CODES.OK
      ) {
        return siteForPath.code;
      }
      return check.errorCode;
    }
    return siteForPath.code || SiteDriveFolderGuard.SITE_DRIVE_GUARD_CODES.NOT_SET;
  };

  const createQuarantineReportFolderFromFailure_ = (
    check,
    siteForPath,
    reportType,
    workerName,
    submittedAtIso,
    buildingName,
    reportSiteName
  ) => {
    const errorCode = resolveQuarantineErrorCode_(check, siteForPath);
    const ctx = SiteDriveQuarantine.createQuarantineReportFolder_({
      errorCode,
      reason: (check && check.reason) || errorCode,
      siteId: siteForPath.id,
      siteName: reportSiteName || siteForPath.name,
      reportSiteName: reportSiteName || siteForPath.name,
      masterSiteName: siteForPath.masterSiteName || siteForPath.name,
      driveFolderId: siteForPath.driveFolderId || '',
      actualFolderName: (check && check.actualFolderName) || '',
      reportType,
      buildingName,
      workerName,
      submittedAt: submittedAtIso
    });
    const photosFolder = DriveApp.getFolderById(ctx.photosFolderId);
    Logger.log(
      '[DRIVE_ROOT_AUDIT][職人][ensureReportFolder] quarantine siteId=%s errorCode=%s photosFolderId=%s',
      siteForPath.id,
      errorCode,
      ctx.photosFolderId
    );
    return buildReportFolderResult_(photosFolder, {
      isQuarantine: true,
      quarantineReason: errorCode,
      quarantineFolderUrl: ctx.quarantineFolderUrl,
      quarantineCaseFolderId: ctx.quarantineCaseFolderId,
      intendedPath: ctx.intendedPath,
      driveFolderIdFromMaster: ctx.driveFolderIdFromMaster,
      actualFolderName: ctx.actualFolderName,
      _quarantineCtx: ctx
    });
  };

  /**
   * @param {object} site id / name / driveFolderId（省略可）
   * @param {string} [masterDriveFolderIdOpt] ReportService 等で resolveSiteForReport 済みの C列フォルダID。
   *   指定時は再解決せず、これを現場の親フォルダとして必ず優先する。
   */
  const ensureReportFolder = (
    site,
    reportType,
    workerName,
    submittedAtIso,
    buildingName,
    masterDriveFolderIdOpt
  ) => {
    if (APP_CONFIG.mockMode) {
      return buildReportFolderResult_({ getId: () => 'mock-folder', getUrl: () => '#' });
    }

    const reportSiteName = (site && site.name) || '';

    const fromCaller =
      masterDriveFolderIdOpt != null && String(masterDriveFolderIdOpt).trim()
        ? String(masterDriveFolderIdOpt).trim()
        : '';
    const fromSiteObj = site && String(site.driveFolderId || '').trim();
    const preResolvedMasterId = fromCaller || fromSiteObj;

    let siteForPath;
    let masterFolderId;

    if (preResolvedMasterId) {
      masterFolderId = preResolvedMasterId;
      siteForPath = {
        id: (site && site.id) || '',
        name: (site && site.name) || '',
        driveFolderId: masterFolderId,
        status: (site && site.status) || '',
        code: (site && site.code) || MasterDataService.CODES.OK,
        masterSiteName: (site && site.masterSiteName) || (site && site.name) || ''
      };
      Logger.log(
        'DriveService.ensureReportFolder: 親フォルダIDは呼び出し元の解決結果を使用 folderId=%s siteId=%s name=%s',
        masterFolderId,
        siteForPath.id,
        siteForPath.name
      );
    } else {
      const resolved = MasterDataService.resolveSiteForReport({
        siteId: site && site.id,
        siteName: site && site.name
      });
      siteForPath = {
        id: resolved.id,
        name: resolved.name,
        driveFolderId: resolved.driveFolderId,
        status: resolved.status,
        code: resolved.code,
        masterSiteName: resolved.masterSiteName
      };
      masterFolderId = String(siteForPath.driveFolderId || '').trim();
      Logger.log(
        'DriveService.ensureReportFolder: resolveSiteForReport で親フォルダIDを取得 folderId=%s',
        masterFolderId || '(なし)'
      );
    }
    siteForPath.driveFolderId = masterFolderId;

    const guardCheck = SiteDriveFolderGuard.checkSiteDriveFolderForReport_(siteForPath);
    if (!guardCheck.ok) {
      if (shouldQuarantineOnFailure_() && isQuarantineErrorCode_(resolveQuarantineErrorCode_(guardCheck, siteForPath))) {
        return createQuarantineReportFolderFromFailure_(
          guardCheck,
          siteForPath,
          reportType,
          workerName,
          submittedAtIso,
          buildingName,
          reportSiteName
        );
      }
      SiteDriveFolderGuard.assertSiteDriveFolderForReport_(siteForPath);
    }

    const siteFolder = guardCheck.folder;

    Logger.log(
      '[DRIVE_ROOT_AUDIT][職人][ensureReportFolder] siteId=%s siteName=%s driveFolderId=%s getFolderByIdSuccess=true calledEnsureSiteFolder=false resolvedSiteFolderId=%s reportType=%s',
      siteForPath.id,
      siteForPath.name,
      masterFolderId || '(empty)',
      siteFolder.getId(),
      reportType
    );

    // 親は常に「その現場のフォルダ」。その下に 棟 → 報告種別 →（日付＋報告者は毎回新規）。
    // マスタの現場フォルダ～報告種別までの経路は ScriptCache で再利用し、prepare のタイムアウトを抑える。
    const bn = (buildingName || '').trim();
    const bnKey =
      bn && bn !== '該当なし' && bn !== '（現場名に含む）'
        ? UtilitiesEx.sanitizeName(bn).substring(0, 48)
        : '_';
    const rtKey = UtilitiesEx.sanitizeName(String(reportType || '')).substring(0, 48);
    // マスタ未採番・名前のみの衝突で「別現場の 08_職人報告 以下」をキャッシュ共有していたのを防ぐ
    // masterFolderId 優先、次に 現場ID 全体、最後に名前（フル正規化の長め）
    const mIdKey = String(masterFolderId || '').trim();
    const idKey = String((siteForPath && siteForPath.id) || '').trim();
    const nameKey = UtilitiesEx.sanitizeName(
      String((siteForPath && siteForPath.name) || '')
    ).substring(0, 120);
    const pathKeySiteSig = mIdKey
      ? `m_${mIdKey}`
      : idKey
        ? `i_${idKey}_${nameKey}`.substring(0, 130)
        : `n_${nameKey}__${Utilities.getUuid().replace(/-/g, '').slice(0, 12)}`;
    const pathCacheKey = `rpp4_${pathKeySiteSig.substring(0, 140)}_${bnKey}_${rtKey}`.substring(0, 248);
    const pathCache = CacheService.getScriptCache();
    const cachedParentId = pathCache.get(pathCacheKey);
    let currentFolder;
    let usedPathCache = false;
    if (cachedParentId) {
      try {
        currentFolder = DriveApp.getFolderById(cachedParentId);
        currentFolder.getName();
        usedPathCache = true;
      } catch (e) {
        Logger.log('DriveService.ensureReportFolder: 親経路キャッシュ無効 ' + e);
      }
    }
    if (!usedPathCache) {
      currentFolder = siteFolder;
      // 08_職人報告 フォルダを経由する（DB側が事前作成、なければ作成）
      currentFolder = ensureFolder(currentFolder, '08_職人報告');
      if (bn && bn !== '該当なし' && bn !== '（現場名に含む）') {
        currentFolder = ensureFolder(currentFolder, bn);
      }
      if (reportType) {
        currentFolder = ensureFolder(currentFolder, reportType);
      }
      try {
        pathCache.put(pathCacheKey, currentFolder.getId(), 21600);
      } catch (pe) {
        Logger.log('DriveService.ensureReportFolder: pathCache.put ' + pe);
      }
    }

    // 日付の階層（この送信分だけのサブフォルダ。毎回新規）
    const timezone = Session.getScriptTimeZone ? Session.getScriptTimeZone() : 'Asia/Tokyo';
    const submittedDate = submittedAtIso ? new Date(submittedAtIso) : new Date();
    // 同時に送られた写真を入れる。秒だけだと同秒の別報告でサブフォルダ名が衝突し、
    // 別セッションの写真が同じ子フォルダに混在することがあったためミリ秒を付与。
    const dateSegment = Utilities.formatDate(
      submittedDate,
      timezone,
      "yyyy-MM-dd_HH-mm-ss-SSS"
    );
    const safeWorkerName = UtilitiesEx.sanitizeName(workerName || '不明');
    const uniqueFolderName = `${dateSegment}_${safeWorkerName}`;
    const leafFolder = ensureFolder(currentFolder, uniqueFolderName);
    return buildReportFolderResult_(leafFolder, {
      intendedPath: buildNormalIntendedPath_(
        siteForPath.name,
        buildingName,
        reportType,
        workerName,
        submittedAtIso
      ),
      driveFolderIdFromMaster: masterFolderId,
      actualFolderName: guardCheck.folderName || ''
    });
  };

  const decodeBase64 = data => {
    if (!data) return Utilities.newBlob('');
    const payload = data.includes(',')
      ? data.split(',')[1]
      : data;
    const bytes = Utilities.base64Decode(payload);
    return Utilities.newBlob(bytes);
  };

  const saveReportImages = ({
    site,
    masterDriveFolderId,
    reportType,
    workerName,
    submittedAt,
    files,
    questionLabels,
    buildingName,
    isResend
  }) => {
    if (!files || !files.length) {
      return { files: [], folderId: '' };
    }
    if (APP_CONFIG.mockMode) {
      return {
        files: (files || []).map((file, index) => ({
          id: `mock-${index}`,
          url: '#',
          name: file.fileName || `${file.questionId || 'image'}_${index + 1}.jpg`,
          questionId: file.questionId
        })),
        folderId: 'mock-folder'
      };
    }
    const folderResult = ensureReportFolder(
      site,
      reportType,
      workerName,
      submittedAt,
      buildingName,
      masterDriveFolderId
    );
    const targetFolder = folderResult.folder;
    const labelCounters = {};
    const labels = questionLabels || {};
    const namePrefix = isResend ? '再送_' : '';
    const savedFiles = files.map((file, index) => {
      const blob = decodeBase64(file.data);
      const label = labels[file.questionId] || file.questionLabel || reportType || 'report';
      const baseName = UtilitiesEx.sanitizeName(label || `image_${index + 1}`);
      labelCounters[baseName] = (labelCounters[baseName] || 0) + 1;
      const fileName = `${namePrefix}${baseName}_${labelCounters[baseName]}.jpg`;
      blob.setName(fileName);
      blob.setContentType(file.mimeType || 'image/jpeg');
      const created = targetFolder.createFile(blob);
      return {
        id: created.getId(),
        url: created.getUrl(),
        name: created.getName(),
        questionId: file.questionId
      };
    });
    return {
      files: savedFiles,
      folderId: folderResult.folderId,
      isQuarantine: folderResult.isQuarantine,
      quarantineReason: folderResult.quarantineReason,
      quarantineFolderUrl: folderResult.quarantineFolderUrl,
      quarantineCaseFolderId: folderResult.quarantineCaseFolderId,
      intendedPath: folderResult.intendedPath,
      driveFolderIdFromMaster: folderResult.driveFolderIdFromMaster,
      actualFolderName: folderResult.actualFolderName,
      _quarantineCtx: folderResult._quarantineCtx
    };
  };

  /**
   * 差し戻し再送: 元報告の画像を同名で差し替える。
   * 元ファイルをゴミ箱に移動し、同じフォルダに同名で新ファイルを作成。
   * 再送対象外の画像はそのまま保持する。
   */
  const replaceReportImages = ({ originalImages, driveFolderId, newFiles, questionLabels }) => {
    if (!newFiles || !newFiles.length) {
      return { files: originalImages || [], folderId: driveFolderId };
    }

    const folder = DriveApp.getFolderById(driveFolderId);

    // 再送画像を questionId でグループ化
    const newFilesByQid = {};
    newFiles.forEach(file => {
      const qId = file.questionId || '';
      if (!newFilesByQid[qId]) newFilesByQid[qId] = [];
      newFilesByQid[qId].push(file);
    });

    // 元画像を questionId でグループ化（インデックスも保持）
    const originalByQid = {};
    (originalImages || []).forEach((img, idx) => {
      const qId = img.questionId || '';
      if (!originalByQid[qId]) originalByQid[qId] = [];
      originalByQid[qId].push({ img, idx });
    });

    // 結果配列を元画像のコピーで初期化
    const updatedImages = (originalImages || []).map(img => ({ ...img }));

    // 差し替え済みインデックスを追跡
    const replacedIndices = new Set();

    const labels = questionLabels || {};

    Object.keys(newFilesByQid).forEach(qId => {
      const newGroup = newFilesByQid[qId];
      const origGroup = originalByQid[qId] || [];

      // 元画像をゴミ箱に移動
      origGroup.forEach(({ img }) => {
        try {
          DriveApp.getFileById(img.id).setTrashed(true);
        } catch (_) {
          // 既に削除済みの場合はスキップ
        }
      });

      // ファイル名のベース名を決定（元画像があればそのパターンを継承）
      let baseName;
      if (origGroup.length > 0) {
        // 元画像名から _N.jpg を除去してベース名を取得
        const origName = origGroup[0].img.name || '';
        baseName = origName.replace(/_\d+\.jpg$/i, '');
      } else {
        // 元画像がない場合はラベルからベース名を生成
        const label = labels[qId] || qId || 'image';
        baseName = UtilitiesEx.sanitizeName(label);
      }

      // 新画像を同フォルダに同名パターンでアップロード
      newGroup.forEach((file, fileIdx) => {
        const blob = decodeBase64(file.data);
        const fileName = `${baseName}_${fileIdx + 1}.jpg`;
        blob.setName(fileName);
        blob.setContentType(file.mimeType || 'image/jpeg');
        const created = folder.createFile(blob);

        const newEntry = {
          id: created.getId(),
          url: created.getUrl(),
          name: created.getName(),
          questionId: qId
        };

        // 元画像のインデックスがあればそこを上書き、なければ末尾に追加
        if (fileIdx < origGroup.length) {
          const targetIdx = origGroup[fileIdx].idx;
          updatedImages[targetIdx] = newEntry;
          replacedIndices.add(targetIdx);
        } else {
          updatedImages.push(newEntry);
        }
      });

      // 元画像が再送より多い場合、余った分を null マーク（後で除去）
      for (let i = newGroup.length; i < origGroup.length; i++) {
        updatedImages[origGroup[i].idx] = null;
        replacedIndices.add(origGroup[i].idx);
      }
    });

    // null エントリを除去
    const finalImages = updatedImages.filter(img => img !== null);

    return {
      files: finalImages,
      folderId: driveFolderId
    };
  };

  /**
   * 並列バッチアップロード用: フォルダを1回だけ作成して folderId を返す。
   * フロントエンドが画像アップロード前に呼び出す。
   */
  const createReportFolderForBatch = ({ site, reportType, workerName, submittedAt, buildingName }) => {
    if (APP_CONFIG.mockMode) {
      return {
        folderId: 'mock-folder',
        folderUrl: '#',
        isQuarantine: false,
        quarantineReason: '',
        quarantineFolderUrl: '',
        quarantineCaseFolderId: ''
      };
    }
    const result = ensureReportFolder(
      site,
      reportType,
      workerName,
      submittedAt,
      buildingName,
      site && site.driveFolderId
    );
    return {
      folderId: result.folderId,
      folderUrl: result.folderUrl,
      isQuarantine: result.isQuarantine,
      quarantineReason: result.quarantineReason,
      quarantineFolderUrl: result.quarantineFolderUrl,
      quarantineCaseFolderId: result.quarantineCaseFolderId,
      intendedPath: result.intendedPath,
      driveFolderIdFromMaster: result.driveFolderIdFromMaster,
      actualFolderName: result.actualFolderName
    };
  };

  /**
   * 並列バッチアップロード用: 指定フォルダに画像バッチを保存する。
   * フロントエンドから複数並列で呼び出される。
   */
  const uploadPhotoBatch = ({ files, folderId, questionLabels, namePrefix }) => {
    if (!files || !files.length) return { files: [] };
    if (APP_CONFIG.mockMode) {
      return {
        files: files.map((file, idx) => ({
          id: `mock-${idx}`,
          url: '#',
          name: `mock_${idx + 1}.jpg`,
          questionId: file.questionId
        }))
      };
    }
    const folder = DriveApp.getFolderById(folderId);
    const labels = questionLabels || {};
    const prefix = namePrefix || '';
    const labelCounters = {};
    const savedFiles = files.map((file, index) => {
      const blob = decodeBase64(file.data);
      const label = labels[file.questionId] || file.questionLabel || `image_${index + 1}`;
      const baseName = UtilitiesEx.sanitizeName(label);
      labelCounters[baseName] = (labelCounters[baseName] || 0) + 1;
      const fileName = `${prefix}${baseName}_${labelCounters[baseName]}.jpg`;
      blob.setName(fileName);
      blob.setContentType(file.mimeType || 'image/jpeg');
      const created = folder.createFile(blob);
      return {
        id: created.getId(),
        url: created.getUrl(),
        name: created.getName(),
        questionId: file.questionId
      };
    });
    return { files: savedFiles };
  };

  /**
   * アップロード失敗時のロールバック: 作成済みフォルダをゴミ箱に移動する。
   */
  const deleteReportFolder = folderId => {
    if (!folderId || APP_CONFIG.mockMode) return;
    try {
      DriveApp.getFolderById(folderId).setTrashed(true);
    } catch (_) {}
  };

  return {
    ensureSiteFolder,
    saveReportImages,
    replaceReportImages,
    createReportFolderForBatch,
    uploadPhotoBatch,
    deleteReportFolder
  };
})();
