/**
 * 職人報告: 保存先不整合時の隔離フォルダ作成・meta.txt 出力
 */
const SiteDriveQuarantine = (() => {
  const normalizeSiteIdForFolder_ = siteId => {
    const id = String(siteId || '').trim().toUpperCase();
    return /^SITE-\d+$/i.test(id) ? id : 'SITE-UNKNOWN';
  };

  const findOrCreateChildFolder_ = (parentFolder, name) => {
    const sanitized = UtilitiesEx.sanitizeName(name);
    const iterator = parentFolder.getFoldersByName(sanitized);
    if (iterator.hasNext()) {
      return iterator.next();
    }
    return parentFolder.createFolder(sanitized);
  };

  const buildQuarantineFolderName_ = details => {
    const prefix = APP_CONFIG.QUARANTINE_FOLDER_PREFIX || 'shokunin';
    const idPart = normalizeSiteIdForFolder_(details.siteId);
    let namePart = UtilitiesEx.sanitizeName(
      UtilitiesEx.normalizeSiteName(details.reportSiteName || details.siteName || '') || 'untitled'
    );
    const maxLen = APP_CONFIG.QUARANTINE_MAX_SITE_NAME_LEN || 48;
    if (namePart.length > maxLen) {
      namePart = namePart.slice(0, maxLen);
    }
    const submittedAt = details.submittedAt ? new Date(details.submittedAt) : new Date();
    const ts = Utilities.formatDate(
      submittedAt,
      Session.getScriptTimeZone(),
      'yyyyMMdd_HHmmss'
    );
    const workerPart = UtilitiesEx.sanitizeName(details.workerName || '不明').substring(0, 32);
    return `${prefix}_${idPart}_${namePart}_${ts}_${workerPart}`;
  };

  const ensureQuarantineRootFolder_ = () => {
    const rootId = APP_CONFIG.rootDriveFolderId;
    if (!rootId) {
      throw new Error('rootDriveFolderId is not configured.');
    }
    const root = DriveApp.getFolderById(String(rootId).trim());
    const quarantineName = APP_CONFIG.QUARANTINE_ROOT_FOLDER_NAME || '99_要確認_保存先不整合';
    return findOrCreateChildFolder_(root, quarantineName);
  };

  const createQuarantineReportFolder_ = details => {
    const submittedAt = details.submittedAt ? new Date(details.submittedAt) : new Date();
    const quarantineRoot = ensureQuarantineRootFolder_();
    const monthName = Utilities.formatDate(submittedAt, Session.getScriptTimeZone(), 'yyyy-MM');
    const monthFolder = findOrCreateChildFolder_(quarantineRoot, monthName);
    const caseName = buildQuarantineFolderName_(details);
    const caseFolder = monthFolder.createFolder(caseName);
    const photosName = APP_CONFIG.QUARANTINE_PHOTOS_SUBFOLDER_NAME || '写真';
    const photosFolder = caseFolder.createFolder(photosName);

    Logger.log(
      '[DRIVE_ROOT_AUDIT][職人][quarantine] action=create caseFolder=%s folderId=%s errorCode=%s siteName=%s',
      caseName,
      caseFolder.getId(),
      details.errorCode || '',
      details.reportSiteName || details.siteName || ''
    );

    const masterSiteName = details.masterSiteName || '';
    const reportType = details.reportType || '';
    const buildingName = details.buildingName || '';
    const bn =
      buildingName && buildingName !== '該当なし' && buildingName !== '（現場名に含む）'
        ? buildingName
        : '';
    const intendedPath = [
      masterSiteName || details.reportSiteName || '',
      '08_職人報告',
      bn,
      reportType,
      '(隔離)'
    ]
      .filter(Boolean)
      .join('/');

    const quarantineFolderUrl = caseFolder.getUrl();
    const ctx = {
      photosFolderId: photosFolder.getId(),
      photosFolderUrl: photosFolder.getUrl(),
      quarantineCaseFolderId: caseFolder.getId(),
      quarantineFolderUrl,
      isQuarantine: true,
      quarantineReason: String(details.errorCode || ''),
      intendedPath,
      driveFolderIdFromMaster: String(details.driveFolderId || ''),
      actualFolderName: String(details.actualFolderName || ''),
      _quarantineMeta: {
        system: 'shokunin',
        errorCode: details.errorCode || '',
        reason: details.reason || '',
        siteId: normalizeSiteIdForFolder_(details.siteId),
        reportSiteName: details.reportSiteName || details.siteName || '',
        masterSiteName,
        driveFolderId: details.driveFolderId || '',
        actualFolderName: details.actualFolderName || '',
        reportType,
        buildingName,
        workerName: details.workerName || '',
        submittedAt: submittedAt.toISOString(),
        intendedPath,
        quarantineFolderUrl,
        originalMode: APP_CONFIG.DRIVE_GUARD_FAILURE_MODE || 'quarantine',
        savedFileCount: 0
      },
      _quarantineCaseFolderId: caseFolder.getId()
    };

    return ctx;
  };

  const writeQuarantineMeta_ = (caseFolder, meta) => {
    if (!caseFolder) {
      Logger.log('[DRIVE_ROOT_AUDIT][職人][quarantine] meta skip reason=no_case_folder');
      return;
    }
    try {
      const lines = [
        'system: ' + (meta.system || 'shokunin'),
        'errorCode: ' + (meta.errorCode || ''),
        'reason: ' + (meta.reason || ''),
        'siteId: ' + (meta.siteId || ''),
        'reportSiteName: ' + (meta.reportSiteName || ''),
        'masterSiteName: ' + (meta.masterSiteName || ''),
        'driveFolderId: ' + (meta.driveFolderId || ''),
        'actualFolderName: ' + (meta.actualFolderName || ''),
        'reportType: ' + (meta.reportType || ''),
        'buildingName: ' + (meta.buildingName || ''),
        'workerName: ' + (meta.workerName || ''),
        'submittedAt: ' + (meta.submittedAt || ''),
        'intendedPath: ' + (meta.intendedPath || ''),
        'quarantineFolderUrl: ' + (meta.quarantineFolderUrl || ''),
        'savedFileCount: ' + (meta.savedFileCount != null ? meta.savedFileCount : 0),
        'originalMode: ' + (meta.originalMode || '')
      ];
      caseFolder.createFile('meta.txt', lines.join('\n'), MimeType.PLAIN_TEXT);
    } catch (e) {
      Logger.log(
        '[DRIVE_ROOT_AUDIT][職人][quarantine] meta write failed error=%s',
        String(e.message || e)
      );
    }
  };

  const finalizeQuarantineSave_ = (ctx, savedFileCount) => {
    try {
      if (!ctx || !ctx.isQuarantine) {
        return;
      }
      const meta = Object.assign({}, ctx._quarantineMeta || {});
      meta.savedFileCount = savedFileCount != null ? savedFileCount : 0;
      meta.quarantineFolderUrl = ctx.quarantineFolderUrl || meta.quarantineFolderUrl || '';

      let caseFolder = null;
      try {
        const caseId = ctx._quarantineCaseFolderId || ctx.quarantineCaseFolderId;
        if (caseId) {
          caseFolder = DriveApp.getFolderById(String(caseId));
        }
      } catch (folderErr) {
        Logger.log(
          '[DRIVE_ROOT_AUDIT][職人][quarantine] finalize caseFolder resolve failed error=%s',
          String(folderErr.message || folderErr)
        );
      }

      writeQuarantineMeta_(caseFolder, meta);
    } catch (e) {
      Logger.log(
        '[DRIVE_ROOT_AUDIT][職人][quarantine] finalizeQuarantineSave_ failed (ignored) error=%s',
        String(e.message || e)
      );
    }
  };

  const summarizeQuarantineContext_ = ctx => {
    if (!ctx) {
      return {
        photosFolderId: '',
        photosFolderUrl: '',
        quarantineCaseFolderId: '',
        quarantineFolderUrl: '',
        isQuarantine: false,
        quarantineReason: '',
        intendedPath: '',
        driveFolderIdFromMaster: '',
        actualFolderName: ''
      };
    }
    return {
      photosFolderId: String(ctx.photosFolderId || ''),
      photosFolderUrl: String(ctx.photosFolderUrl || ''),
      quarantineCaseFolderId: String(ctx.quarantineCaseFolderId || ''),
      quarantineFolderUrl: String(ctx.quarantineFolderUrl || ''),
      isQuarantine: ctx.isQuarantine === true,
      quarantineReason: String(ctx.quarantineReason || ''),
      intendedPath: String(ctx.intendedPath || ''),
      driveFolderIdFromMaster: String(ctx.driveFolderIdFromMaster || ''),
      actualFolderName: String(ctx.actualFolderName || '')
    };
  };

  return {
    ensureQuarantineRootFolder_,
    buildQuarantineFolderName_,
    createQuarantineReportFolder_,
    writeQuarantineMeta_,
    finalizeQuarantineSave_,
    summarizeQuarantineContext_
  };
})();
