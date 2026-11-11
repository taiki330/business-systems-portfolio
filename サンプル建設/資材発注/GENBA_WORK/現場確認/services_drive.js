/**
 * Driveフォルダ関連の共通処理をまとめたサービス。
 */
var DriveService = (function() {

  function ensureSiteFolder(siteName, subFolders) {
    throw new Error('ensureSiteFolder は非推奨です。resolvePhaseFolder を使用してください。');
  }

  /**
   * @deprecated resolvePhaseFolder は C列参照のため本番経路では使用しない。
   */
  function findSiteFolder(siteName) {
    var config = getConfig();
    if (!config.DRIVE_ROOT_ID) {
      throw new Error('DRIVE_ROOT_ID is not configured.');
    }
    if (!siteName) return null;
    siteName = SiteNameUtils.normalizeSiteName(siteName);
    var parent = DriveApp.getFolderById(config.DRIVE_ROOT_ID);
    var iterator = parent.getFoldersByName(siteName);
    var found = iterator.hasNext() ? iterator.next() : null;
    Logger.log(
      '[DRIVE_ROOT_AUDIT][現場確認][findSiteFolder] siteName=%s driveRootId=%s found=%s folderId=%s',
      siteName,
      config.DRIVE_ROOT_ID,
      found ? 'yes' : 'no',
      found ? found.getId() : ''
    );
    return found;
  }

  function getSubFolderIfExists(parentFolder, name) {
    if (!parentFolder || !name) return null;
    var iterator = parentFolder.getFoldersByName(name);
    return iterator.hasNext() ? iterator.next() : null;
  }

  function ensureTemporaryPhaseFolder(phaseNumber, siteName) {
    var config = getConfig();
    if (!config.DRIVE_ROOT_ID) {
      throw new Error('DRIVE_ROOT_ID is not configured.');
    }
    if (!config.TEMP_FOLDER_NAME) {
      throw new Error('TEMP_FOLDER_NAME is not configured.');
    }
    if (!siteName) {
      throw new Error('siteName is required.');
    }
    siteName = SiteNameUtils.normalizeSiteName(siteName);
    var parent = DriveApp.getFolderById(config.DRIVE_ROOT_ID);
    var tempRoot = findOrCreateFolder(parent, config.TEMP_FOLDER_NAME);
    var tempPhaseName = (config.TEMP_PHASE_FOLDER_NAMES && config.TEMP_PHASE_FOLDER_NAMES[phaseNumber]) || ('phase_' + phaseNumber);
    var tempPhaseFolder = findOrCreateFolder(tempRoot, tempPhaseName);
    return findOrCreateFolder(tempPhaseFolder, siteName);
  }

  function buildTemporaryPhaseContext_(siteName, phaseNumber, phaseSubFolderName) {
    var tempFolder = ensureTemporaryPhaseFolder(phaseNumber, siteName);
    var destination = phaseSubFolderName ? findOrCreateFolder(tempFolder, phaseSubFolderName) : tempFolder;
    return enrichFolderContextIds_({
      siteFolder: tempFolder,
      targetFolder: destination,
      isTemporary: true,
      isQuarantine: false
    }, tempFolder, destination);
  }

  function resolveWebStagingFolder(siteName, phaseNumber, phaseSubFolderName) {
    var config = getConfig();
    var buckets = config.WEB_UPLOAD_STAGING_BUCKET_IDS || {};
    var bucketId = buckets[phaseNumber];
    if (bucketId && String(bucketId).trim()) {
      siteName = SiteNameUtils.normalizeSiteName(siteName);
      if (!siteName) {
        throw new Error('siteName is required.');
      }
      var bucketParent = DriveApp.getFolderById(String(bucketId).trim());
      var siteFolder = findOrCreateFolder(bucketParent, siteName);
      return {
        siteFolder: siteFolder,
        targetFolder: siteFolder,
        isTemporary: true,
        viaStagingBucket: true
      };
    }
    return buildTemporaryPhaseContext_(siteName, phaseNumber, phaseSubFolderName);
  }

  function isRootCreateAllowedName_(name) {
    var config = getConfig();
    var allowed = [config.TEMP_FOLDER_NAME, config.QUARANTINE_ROOT_FOLDER_NAME];
    return allowed.indexOf(name) !== -1;
  }

  function buildQuarantineDetails_(params) {
    return {
      errorCode: params.errorCode,
      reason: params.reason || '',
      siteName: params.siteName || '',
      masterSiteName: params.masterSiteName || params.siteName || '',
      siteId: params.siteId || '',
      driveFolderId: params.driveFolderId || '',
      actualFolderName: params.actualFolderName || '',
      phaseNumber: params.phaseNumber,
      phaseName: params.phaseName || '',
      subFolderName: params.subFolderName || '',
      buildingName: params.buildingName || '',
      exceptionMessage: params.exceptionMessage || '',
      spreadsheetId: params.spreadsheetId || '',
      masterSheetName: params.masterSheetName || ''
    };
  }

  function isMasterResolveFailureCode_(code) {
    var codes = SiteMasterResolver.CODES;
    return (
      code === codes.NOT_IN_MASTER ||
      code === codes.MASTER_ACCESS_DENIED ||
      code === codes.MASTER_READ_FAILED
    );
  }

  function buildQuarantineFromResolvedFailure_(resolved, siteName, phaseNumber, phaseSubFolderName, options) {
    Logger.log(
      '[DRIVE_ROOT_AUDIT][現場確認][quarantine] reason=%s siteName=%s spreadsheetId=%s',
      resolved.code || '',
      siteName,
      resolved.spreadsheetId || ''
    );
    return SiteDriveQuarantine.createQuarantineContext_(buildQuarantineDetails_({
      errorCode: resolved.code,
      reason: resolved.reason || resolved.code || '',
      siteName: siteName,
      masterSiteName: resolved.siteName || '',
      siteId: resolved.siteId || '',
      driveFolderId: resolved.driveFolderId || '',
      phaseNumber: phaseNumber,
      phaseName: options.phaseName || '',
      subFolderName: phaseSubFolderName || '',
      buildingName: options.buildingName || '',
      exceptionMessage: resolved.exceptionMessage || '',
      spreadsheetId: resolved.spreadsheetId || '',
      masterSheetName: resolved.masterSheetName || ''
    }));
  }

  function enrichFolderContextIds_(ctx, siteFolder, targetFolder) {
    if (!ctx) return ctx;
    try {
      if (siteFolder) {
        ctx.siteFolderId = siteFolder.getId();
        ctx.siteFolderName = siteFolder.getName();
      }
    } catch (e) {
      Logger.log('DriveService.enrichFolderContextIds_ siteFolder failed: ' + e);
    }
    try {
      if (targetFolder) {
        ctx.targetFolderId = targetFolder.getId();
        ctx.targetFolderName = targetFolder.getName();
      }
    } catch (e) {
      Logger.log('DriveService.enrichFolderContextIds_ targetFolder failed: ' + e);
    }
    return ctx;
  }

  function summarizeFolderContext_(ctx) {
    return SiteDriveQuarantine.summarizeFolderContext_(ctx);
  }

  function shouldQuarantineOnFailure_(forPhotoUpload) {
    var config = getConfig();
    return config.DRIVE_GUARD_FAILURE_MODE === 'quarantine' && forPhotoUpload === true;
  }

  /**
   * フェーズ別の保存先フォルダ（稼働現場リスト C列 + ガード済み現場フォルダ配下、未登録は TEMP）。
   * @param {Object} [options] { forPhotoUpload?, phaseName?, buildingName? }
   * @return {Object}
   */
  function resolvePhaseFolder(siteName, phaseNumber, phaseSubFolderName, options) {
    options = options || {};
    var forPhotoUpload = options.forPhotoUpload === true;
    var config = getConfig();
    Logger.log(
      '[DRIVE_ROOT_AUDIT][現場確認][resolvePhaseFolder] start siteName=%s driveRootId=%s phase=%s subFolder=%s mode=%s forPhotoUpload=%s',
      siteName,
      config.DRIVE_ROOT_ID,
      phaseNumber,
      phaseSubFolderName || '',
      config.DRIVE_GUARD_FAILURE_MODE || 'block',
      forPhotoUpload
    );

    var resolved = SiteMasterResolver.resolveSiteForDrive(siteName);
    if (!resolved.ok) {
      if (shouldQuarantineOnFailure_(forPhotoUpload) && isMasterResolveFailureCode_(resolved.code)) {
        return buildQuarantineFromResolvedFailure_(resolved, siteName, phaseNumber, phaseSubFolderName, options);
      }
      if (resolved.code === SiteMasterResolver.CODES.NOT_IN_MASTER) {
        Logger.log(
          '[DRIVE_ROOT_AUDIT][現場確認][resolvePhaseFolder] masterMiss siteName=%s -> TEMP',
          siteName
        );
        return buildTemporaryPhaseContext_(siteName, phaseNumber, phaseSubFolderName);
      }
      throw new Error(resolved.message || '稼働現場リストに登録されていません。管理者に連絡してください。');
    }

    var check = SiteDriveFolderGuard.checkSiteDriveFolderForPhase_({
      siteName: resolved.siteName,
      siteId: resolved.siteId,
      driveFolderId: resolved.driveFolderId
    });

    if (!check.ok) {
      if (shouldQuarantineOnFailure_(forPhotoUpload)) {
        Logger.log(
          '[DRIVE_ROOT_AUDIT][現場確認][quarantine] reason=%s siteName=%s siteId=%s',
          check.errorCode || '',
          siteName,
          resolved.siteId || ''
        );
        return SiteDriveQuarantine.createQuarantineContext_(buildQuarantineDetails_({
          errorCode: check.errorCode,
          reason: check.reason,
          siteName: siteName,
          masterSiteName: resolved.siteName,
          siteId: resolved.siteId,
          driveFolderId: resolved.driveFolderId,
          actualFolderName: check.actualFolderName || '',
          phaseNumber: phaseNumber,
          phaseName: options.phaseName || '',
          subFolderName: phaseSubFolderName || '',
          buildingName: options.buildingName || ''
        }));
      }
      throw new Error(SiteDriveFolderGuard.guardErrorToMessage_(check.errorCode));
    }

    var siteFolder = check.folder;

    Logger.log(
      '[DRIVE_ROOT_AUDIT][現場確認][resolvePhaseFolder] siteFolder siteName=%s createdNew=false folderId=%s',
      resolved.siteName,
      siteFolder.getId()
    );

    var subFolders = config.SITE_SUB_FOLDERS || [];
    for (var i = 0; i < subFolders.length; i++) {
      findOrCreateFolder(siteFolder, subFolders[i]);
    }
    var destination = phaseSubFolderName ? findOrCreateFolder(siteFolder, phaseSubFolderName) : null;
    var targetFolder = destination || siteFolder;
    return enrichFolderContextIds_({
      siteFolder: siteFolder,
      targetFolder: targetFolder,
      isTemporary: false,
      isQuarantine: false,
      siteId: resolved.siteId,
      driveFolderId: resolved.driveFolderId
    }, siteFolder, targetFolder);
  }

  function saveFilesFromResponse(fileUrls, destFolder, filePrefix, buildingName, saveOptions) {
    if (!fileUrls || fileUrls.length === 0) return [];
    if (!destFolder) throw new Error('Destination folder is required.');

    saveOptions = saveOptions || {};
    var targetFolder = destFolder;
    if (!saveOptions.flatSave) {
      var buildingFolder = resolveBuildingFolder(destFolder, buildingName);
      targetFolder = createDateFolder(buildingFolder);
    }

    var savedFiles = [];
    fileUrls.forEach(function(url) {
      var fileId = extractFileId(url);
      if (!fileId) return;
      var originalFile = DriveApp.getFileById(fileId);
      var copiedFile = originalFile.makeCopy(buildFileName(filePrefix, originalFile.getName()), targetFolder);
      savedFiles.push(copiedFile);
    });
    return savedFiles;
  }

  /**
   * Phase5/6 フォーム写真保存（quarantine / block 対応）
   * @returns {{ folderContext: Object|null, savedCount: number }}
   */
  function savePhasePhotosFromForm_(siteName, phaseNumber, phaseSubFolderName, photoUrls, filePrefix, options) {
    options = options || {};
    if (!photoUrls || photoUrls.length === 0) {
      return { folderContext: null, savedCount: 0 };
    }
    var folderContext = resolvePhaseFolder(siteName, phaseNumber, phaseSubFolderName, {
      forPhotoUpload: true,
      phaseName: options.phaseName || '',
      buildingName: options.buildingName || ''
    });
    var savedFiles = saveFilesFromResponse(
      photoUrls,
      folderContext.targetFolder,
      filePrefix,
      options.buildingName || '',
      { flatSave: folderContext.isQuarantine === true }
    );
    if (folderContext.isQuarantine) {
      try {
        SiteDriveQuarantine.finalizeQuarantineSave_(folderContext, savedFiles.length);
      } catch (finalizeErr) {
        Logger.log(
          'DriveService.savePhasePhotosFromForm_ finalizeQuarantineSave failed (ignored): ' +
          String(finalizeErr.message || finalizeErr)
        );
      }
    }
    return {
      folderContext: summarizeFolderContext_(folderContext),
      savedCount: savedFiles.length
    };
  }

  function findOrCreateFolderAtRootAllowed_(parentFolder, name) {
    return findOrCreateFolder(parentFolder, name);
  }

  function findOrCreateFolder_(parentFolder, name) {
    return findOrCreateFolder(parentFolder, name);
  }

  function findOrCreateFolder(parentFolder, name) {
    var config = getConfig();
    var parentId = parentFolder.getId();
    var isDriveRoot = config.DRIVE_ROOT_ID && parentId === config.DRIVE_ROOT_ID;
    var iterator = parentFolder.getFoldersByName(name);
    if (iterator.hasNext()) {
      var existing = iterator.next();
      if (isDriveRoot) {
        Logger.log(
          '[DRIVE_ROOT_AUDIT][現場確認][findOrCreateFolder] action=reuse siteName=%s driveRootId=%s createdNew=false folderId=%s',
          name,
          config.DRIVE_ROOT_ID,
          existing.getId()
        );
      }
      return existing;
    }
    if (isDriveRoot && !isRootCreateAllowedName_(name)) {
      Logger.log(
        '[DRIVE_ROOT_AUDIT][現場確認][findOrCreateFolder] action=reject siteName=%s driveRootId=%s reason=root_create_not_allowed',
        name,
        config.DRIVE_ROOT_ID
      );
      throw new Error(
        'Driveルート直下へのフォルダ作成は許可されていません。大本DBで現場フォルダを作成してください。'
      );
    }
    var created = parentFolder.createFolder(name);
    if (isDriveRoot) {
      Logger.log(
        '[DRIVE_ROOT_AUDIT][現場確認][findOrCreateFolder] action=create siteName=%s driveRootId=%s createdNew=true folderId=%s',
        name,
        config.DRIVE_ROOT_ID,
        created.getId()
      );
    }
    return created;
  }

  function createDateFolder(parentFolder) {
    var now = new Date();
    var name = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
    return parentFolder.createFolder(name);
  }

  var SKIP_BUILDING_VALUES = ['', '（現場名に含む）', '該当なし'];

  function normalizeBuildingName(value) {
    if (!value) return '';
    var s = String(value);
    s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
    s = s.toUpperCase();
    return s.trim();
  }

  function resolveBuildingFolder(parentFolder, buildingName) {
    var normalized = normalizeBuildingName(buildingName);
    if (!normalized || SKIP_BUILDING_VALUES.indexOf(normalized) !== -1) {
      return parentFolder;
    }
    return findOrCreateFolder(parentFolder, normalized);
  }

  function extractFileId(url) {
    if (!url) return '';
    var match = url.match(/[-\w]{25,}/);
    return match ? match[0] : '';
  }

  function buildFileName(prefix, originalName) {
    var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    if (prefix) {
      return prefix + '_' + ts + '_' + originalName;
    }
    return ts + '_' + originalName;
  }

  function cleanupUnregisteredFolders(registeredUrls, continuationToken) {
    var startTime = new Date().getTime();
    var config = getConfig();
    if (!config.DRIVE_ROOT_ID) throw new Error('DRIVE_ROOT_ID is not configured.');

    var parent = DriveApp.getFolderById(config.DRIVE_ROOT_ID);
    var folders = continuationToken ?
                  DriveApp.continueFolderIterator(continuationToken) :
                  parent.getFolders();

    var count = 0;
    var urlMap = {};
    (registeredUrls || []).forEach(function(url) {
      if (url) urlMap[url] = true;
    });

    while (folders.hasNext()) {
      if (new Date().getTime() - startTime > 300000) {
        return {
          isFinished: false,
          continuationToken: folders.getContinuationToken(),
          processedCount: count
        };
      }

      var folder = folders.next();
      var url = folder.getUrl();
      if (!urlMap[url]) {
        folder.setTrashed(true);
        count++;
        Logger.log('Trashed unregistered folder: ' + folder.getName() + ' (' + url + ')');
      }
    }

    return {
      isFinished: true,
      continuationToken: null,
      processedCount: count
    };
  }

  function saveBase64Files(base64Files, destFolder, filePrefix, buildingName) {
    if (!base64Files || base64Files.length === 0) return [];
    if (!destFolder) throw new Error('Destination folder is required.');

    var buildingFolder = resolveBuildingFolder(destFolder, buildingName);
    var dateFolder = createDateFolder(buildingFolder);
    var savedFiles = [];
    base64Files.forEach(function(fileInfo) {
      if (!fileInfo.data) return;
      var blob = Utilities.newBlob(
        Utilities.base64Decode(fileInfo.data),
        fileInfo.mimeType || 'image/jpeg',
        buildFileName(filePrefix, fileInfo.fileName || 'upload.jpg')
      );
      var file = dateFolder.createFile(blob);
      savedFiles.push(file);
    });
    return savedFiles;
  }

  return {
    ensureSiteFolder: ensureSiteFolder,
    findSiteFolder: findSiteFolder,
    getSubFolderIfExists: getSubFolderIfExists,
    ensureTemporaryPhaseFolder: ensureTemporaryPhaseFolder,
    resolvePhaseFolder: resolvePhaseFolder,
    resolveWebStagingFolder: resolveWebStagingFolder,
    saveFilesFromResponse: saveFilesFromResponse,
    savePhasePhotosFromForm_: savePhasePhotosFromForm_,
    summarizeFolderContext_: summarizeFolderContext_,
    findOrCreateFolderAtRootAllowed_: findOrCreateFolderAtRootAllowed_,
    findOrCreateFolder_: findOrCreateFolder_,
    saveBase64Files: saveBase64Files,
    createDateFolder: createDateFolder,
    cleanupUnregisteredFolders: cleanupUnregisteredFolders
  };
})();
