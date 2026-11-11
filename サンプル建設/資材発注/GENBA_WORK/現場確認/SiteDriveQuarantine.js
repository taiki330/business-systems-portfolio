/**
 * 保存先不整合時の隔離フォルダ作成・meta.txt 出力
 */
var SiteDriveQuarantine = (function() {

  function normalizeSiteIdForFolder_(siteId) {
    var id = String(siteId || '').trim().toUpperCase();
    return /^SITE-\d+$/i.test(id) ? id : 'SITE-UNKNOWN';
  }

  function buildQuarantineFolderName_(siteId, siteName, submittedAt) {
    var idPart = normalizeSiteIdForFolder_(siteId);
    var namePart = SiteNameUtils.sanitizeName(SiteNameUtils.normalizeSiteName(siteName) || 'untitled');
    if (namePart.length > 48) {
      namePart = namePart.slice(0, 48);
    }
    var ts = Utilities.formatDate(
      submittedAt || new Date(),
      Session.getScriptTimeZone(),
      'yyyyMMdd_HHmmss'
    );
    return 'genba-check_' + idPart + '_' + namePart + '_' + ts;
  }

  function ensureQuarantineRootFolder_() {
    var config = getConfig();
    var root = DriveApp.getFolderById(config.DRIVE_ROOT_ID);
    return DriveService.findOrCreateFolderAtRootAllowed_(root, config.QUARANTINE_ROOT_FOLDER_NAME);
  }

  function createQuarantineFolder_(details) {
    var config = getConfig();
    var submittedAt = details.submittedAt ? new Date(details.submittedAt) : new Date();
    var quarantineRoot = ensureQuarantineRootFolder_();
    var monthName = Utilities.formatDate(submittedAt, Session.getScriptTimeZone(), 'yyyy-MM');
    var monthFolder = DriveService.findOrCreateFolder_(quarantineRoot, monthName);
    var caseName = buildQuarantineFolderName_(details.siteId, details.siteName, submittedAt);
    var caseFolder = monthFolder.createFolder(caseName);
    var photosName = config.QUARANTINE_PHOTOS_SUBFOLDER_NAME || '写真';
    var photosFolder = caseFolder.createFolder(photosName);

    Logger.log(
      '[DRIVE_ROOT_AUDIT][現場確認][quarantine] action=create caseFolder=%s folderId=%s errorCode=%s siteName=%s',
      caseName,
      caseFolder.getId(),
      details.errorCode || '',
      details.siteName || ''
    );

    return {
      caseFolder: caseFolder,
      photosFolder: photosFolder,
      quarantineFolderUrl: caseFolder.getUrl(),
      caseFolderName: caseName,
      caseFolderId: caseFolder.getId(),
      photosFolderId: photosFolder.getId(),
      photosFolderName: photosName
    };
  }

  function writeQuarantineMeta_(caseFolder, meta) {
    if (!caseFolder) {
      Logger.log('[DRIVE_ROOT_AUDIT][現場確認][quarantine] meta skip reason=no_case_folder');
      return;
    }
    try {
      var lines = [
      'system: ' + (meta.system || 'genba-check'),
      'errorCode: ' + (meta.errorCode || ''),
      'reason: ' + (meta.reason || ''),
      'siteName: ' + (meta.siteName || ''),
      'masterSiteName: ' + (meta.masterSiteName || ''),
      'siteId: ' + (meta.siteId || ''),
      'driveFolderId: ' + (meta.driveFolderId || ''),
      'actualFolderName: ' + (meta.actualFolderName || ''),
      'phaseNumber: ' + (meta.phaseNumber != null ? meta.phaseNumber : ''),
      'phaseName: ' + (meta.phaseName || ''),
      'subFolderName: ' + (meta.subFolderName || ''),
      'buildingName: ' + (meta.buildingName || ''),
      'submittedAt: ' + (meta.submittedAt || ''),
      'intendedPath: ' + (meta.intendedPath || ''),
      'quarantineFolderUrl: ' + (meta.quarantineFolderUrl || ''),
      'originalMode: ' + (meta.originalMode || ''),
      'savedFileCount: ' + (meta.savedFileCount != null ? meta.savedFileCount : 0),
      'exceptionMessage: ' + (meta.exceptionMessage || ''),
      'spreadsheetId: ' + (meta.spreadsheetId || ''),
      'masterSheetName: ' + (meta.masterSheetName || '')
      ];
      caseFolder.createFile('meta.txt', lines.join('\n'), MimeType.PLAIN_TEXT);
    } catch (e) {
      Logger.log(
        '[DRIVE_ROOT_AUDIT][現場確認][quarantine] meta write failed error=%s',
        String(e.message || e)
      );
    }
  }

  /**
   * @param {Object} details
   * @returns {Object} resolvePhaseFolder 互換 + isQuarantine
   */
  function createQuarantineContext_(details) {
    var config = getConfig();
    var submittedAt = new Date();
    var created = createQuarantineFolder_(details);
    var siteId = normalizeSiteIdForFolder_(details.siteId);
    var masterSiteName = details.masterSiteName || details.siteName || '';
    var subFolderName = details.subFolderName || '';
    var intendedPath = masterSiteName + (subFolderName ? '/' + subFolderName : '');

    return {
      siteFolder: created.caseFolder,
      targetFolder: created.photosFolder,
      siteFolderId: created.caseFolderId,
      siteFolderName: created.caseFolderName,
      targetFolderId: created.photosFolderId,
      targetFolderName: created.photosFolderName,
      isTemporary: false,
      isQuarantine: true,
      quarantineReason: details.errorCode || '',
      quarantineFolderUrl: created.quarantineFolderUrl,
      siteId: siteId,
      driveFolderId: details.driveFolderId || '',
      masterSiteName: masterSiteName,
      actualFolderName: details.actualFolderName || '',
      intendedPath: intendedPath,
      phaseNumber: details.phaseNumber,
      phaseName: details.phaseName || '',
      subFolderName: subFolderName,
      buildingName: details.buildingName || '',
      submittedAt: submittedAt.toISOString(),
      _quarantineMeta: {
        system: 'genba-check',
        errorCode: details.errorCode || '',
        reason: details.reason || '',
        siteName: details.siteName || '',
        masterSiteName: masterSiteName,
        siteId: siteId,
        driveFolderId: details.driveFolderId || '',
        actualFolderName: details.actualFolderName || '',
        phaseNumber: details.phaseNumber,
        phaseName: details.phaseName || '',
        subFolderName: subFolderName,
        buildingName: details.buildingName || '',
        submittedAt: submittedAt.toISOString(),
        intendedPath: intendedPath,
        quarantineFolderUrl: created.quarantineFolderUrl,
        originalMode: config.DRIVE_GUARD_FAILURE_MODE || 'quarantine',
        exceptionMessage: details.exceptionMessage || '',
        spreadsheetId: details.spreadsheetId || '',
        masterSheetName: details.masterSheetName || ''
      },
      _quarantineCaseFolder: created.caseFolder
    };
  }

  function finalizeQuarantineSave_(folderContext, savedFileCount) {
    try {
      if (!folderContext || !folderContext.isQuarantine) {
        return;
      }
      var meta = folderContext._quarantineMeta || {};
      meta.savedFileCount = savedFileCount != null ? savedFileCount : 0;
      meta.quarantineFolderUrl = String(folderContext.quarantineFolderUrl || meta.quarantineFolderUrl || '');

      var caseFolder = null;
      try {
        if (folderContext._quarantineCaseFolder) {
          caseFolder = folderContext._quarantineCaseFolder;
        } else if (folderContext.siteFolderId) {
          caseFolder = DriveApp.getFolderById(String(folderContext.siteFolderId));
        }
      } catch (folderErr) {
        Logger.log(
          '[DRIVE_ROOT_AUDIT][現場確認][quarantine] finalize caseFolder resolve failed error=%s siteFolderId=%s',
          String(folderErr.message || folderErr),
          String(folderContext.siteFolderId || '')
        );
      }

      writeQuarantineMeta_(caseFolder, meta);
    } catch (e) {
      Logger.log(
        '[DRIVE_ROOT_AUDIT][現場確認][quarantine] finalizeQuarantineSave_ failed (ignored) error=%s',
        String(e.message || e)
      );
    }
  }

  /**
   * Folder オブジェクトへ再アクセスせず、文字列・boolean・数値のみのサマリーを返す。
   */
  function summarizeFolderContext_(ctx) {
    if (!ctx) {
      return {
        siteFolderId: '',
        siteFolderName: '',
        targetFolderId: '',
        targetFolderName: '',
        isTemporary: false,
        isQuarantine: false,
        quarantineReason: '',
        quarantineFolderUrl: '',
        siteId: '',
        driveFolderId: ''
      };
    }
    return {
      siteFolderId: String(ctx.siteFolderId || ''),
      siteFolderName: String(ctx.siteFolderName || ''),
      targetFolderId: String(ctx.targetFolderId || ''),
      targetFolderName: String(ctx.targetFolderName || ''),
      isTemporary: ctx.isTemporary === true,
      isQuarantine: ctx.isQuarantine === true,
      quarantineReason: String(ctx.quarantineReason || ''),
      quarantineFolderUrl: String(ctx.quarantineFolderUrl || ''),
      siteId: String(ctx.siteId || ''),
      driveFolderId: String(ctx.driveFolderId || '')
    };
  }

  return {
    buildQuarantineFolderName_: buildQuarantineFolderName_,
    ensureQuarantineRootFolder_: ensureQuarantineRootFolder_,
    createQuarantineFolder_: createQuarantineFolder_,
    writeQuarantineMeta_: writeQuarantineMeta_,
    createQuarantineContext_: createQuarantineContext_,
    finalizeQuarantineSave_: finalizeQuarantineSave_,
    summarizeFolderContext_: summarizeFolderContext_
  };
})();
