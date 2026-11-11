/**
 * Driveフォルダ関連の共通処理をまとめたサービス。
 */
var DriveService = (function() {

  /**
   * 現場名に紐づくフォルダを親フォルダ配下に作成/取得する。
   * @param {string} siteName
   * @param {Array<string>} subFolders サブフォルダ名の配列
   * @return {Object} { rootFolder: DriveApp.Folder, subFolderMap: {name: folder} }
   */
  function ensureSiteFolder(siteName, subFolders) {
    throw new Error('ensureSiteFolder は非推奨です。resolvePhaseFolder を使用してください。');
  }

  /**
   * 既存の現場フォルダ（正式名称）を検索して返す。存在しなければnull。
   * @deprecated resolvePhaseFolder は C列参照のため本番経路では使用しない。
   */
  function findSiteFolder(siteName) {
    var config = getConfig();
    if (!config.DRIVE_ROOT_ID) {
      throw new Error('DRIVE_ROOT_ID is not configured.');
    }
    if (!siteName) return null;
    var parent = DriveApp.getFolderById(config.DRIVE_ROOT_ID);
    var iterator = parent.getFoldersByName(siteName);
    var found = iterator.hasNext() ? iterator.next() : null;
    Logger.log(
      '[DRIVE_ROOT_AUDIT][現場管理][findSiteFolder] siteName=%s driveRootId=%s found=%s folderId=%s',
      siteName,
      config.DRIVE_ROOT_ID,
      found ? 'yes' : 'no',
      found ? found.getId() : ''
    );
    return found;
  }

  /**
   * 親フォルダ配下に指定名のサブフォルダが存在すれば返す。無ければnull。
   */
  function getSubFolderIfExists(parentFolder, name) {
    if (!parentFolder || !name) return null;
    var iterator = parentFolder.getFoldersByName(name);
    return iterator.hasNext() ? iterator.next() : null;
  }

  /**
   * 仮置き用フォルダ（phase別配下）に現場名フォルダを作成/取得する。
   */
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
    var parent = DriveApp.getFolderById(config.DRIVE_ROOT_ID);
    var tempRoot = findOrCreateFolder(parent, config.TEMP_FOLDER_NAME);
    var tempPhaseName = (config.TEMP_PHASE_FOLDER_NAMES && config.TEMP_PHASE_FOLDER_NAMES[phaseNumber]) || ('phase_' + phaseNumber);
    var tempPhaseFolder = findOrCreateFolder(tempRoot, tempPhaseName);
    return findOrCreateFolder(tempPhaseFolder, siteName);
  }

  /**
   * フェーズ別の保存先フォルダ（稼働現場リスト C列 + ガード済み現場フォルダ配下）。
   * @return {Object} { siteFolder, targetFolder, isTemporary, siteId, driveFolderId }
   */
  function resolvePhaseFolder(siteName, phaseNumber, phaseSubFolderName) {
    var config = getConfig();
    Logger.log(
      '[DRIVE_ROOT_AUDIT][現場管理][resolvePhaseFolder] start siteName=%s driveRootId=%s phase=%s subFolder=%s',
      siteName,
      config.DRIVE_ROOT_ID,
      phaseNumber,
      phaseSubFolderName || ''
    );

    var resolved = SiteMasterResolver.resolveSiteForDrive(siteName);
    if (!resolved.ok) {
      throw new Error(resolved.message || '稼働現場リストに登録されていません。管理者に連絡してください。');
    }

    var siteFolder = SiteDriveFolderGuard.assertSiteDriveFolderForPhase_({
      siteName: resolved.siteName,
      siteId: resolved.siteId,
      driveFolderId: resolved.driveFolderId
    });

    Logger.log(
      '[DRIVE_ROOT_AUDIT][現場管理][resolvePhaseFolder] siteFolder siteName=%s createdNew=false folderId=%s',
      resolved.siteName,
      siteFolder.getId()
    );

    var subFolders = config.SITE_SUB_FOLDERS || [];
    for (var i = 0; i < subFolders.length; i++) {
      findOrCreateFolder(siteFolder, subFolders[i]);
    }
    var destination = phaseSubFolderName ? findOrCreateFolder(siteFolder, phaseSubFolderName) : null;
    return {
      siteFolder: siteFolder,
      targetFolder: destination || siteFolder,
      isTemporary: false,
      siteId: resolved.siteId,
      driveFolderId: resolved.driveFolderId
    };
  }

  /**
   * フォーム回答のファイルURLを指定フォルダへ保存する。
   * Googleフォームのファイルアップロード項目を想定。
   */
  function saveFilesFromResponse(fileUrls, destFolder, filePrefix, buildingName) {
    if (!fileUrls || fileUrls.length === 0) return [];
    if (!destFolder) throw new Error('Destination folder is required.');

    var buildingFolder = resolveBuildingFolder(destFolder, buildingName);
    var dateFolder = createDateFolder(buildingFolder);
    var savedFiles = [];
    fileUrls.forEach(function(url) {
      var fileId = extractFileId(url);
      if (!fileId) return;
      var originalFile = DriveApp.getFileById(fileId);
      var copiedFile = originalFile.makeCopy(buildFileName(filePrefix, originalFile.getName()), dateFolder);
      savedFiles.push(copiedFile);
    });
    return savedFiles;
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
          '[DRIVE_ROOT_AUDIT][現場管理][findOrCreateFolder] action=reuse siteName=%s driveRootId=%s createdNew=false folderId=%s',
          name,
          config.DRIVE_ROOT_ID,
          existing.getId()
        );
      }
      return existing;
    }
    var created = parentFolder.createFolder(name);
    if (isDriveRoot) {
      Logger.log(
        '[DRIVE_ROOT_AUDIT][現場管理][findOrCreateFolder] action=create siteName=%s driveRootId=%s createdNew=true folderId=%s',
        name,
        config.DRIVE_ROOT_ID,
        created.getId()
      );
    }
    return created;
  }

  /**
   * 親フォルダ配下に日付フォルダ（yyyy-MM-dd_HH-mm）を新規作成する。
   * 提出ごとに1つのフォルダが作られる。
   */
  function createDateFolder(parentFolder) {
    var now = new Date();
    var name = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
    return parentFolder.createFolder(name);
  }

  // 棟名フォルダ省略対象の値
  var SKIP_BUILDING_VALUES = ['', '（現場名に含む）', '該当なし'];

  /**
   * 棟名を正規化する（表記ゆれ吸収）。
   * 職人管理 Utilities.js の normalizeBuildingName と同ロジック。
   */
  function normalizeBuildingName(value) {
    if (!value) return '';
    var s = String(value);
    s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
    s = s.toUpperCase();
    return s.trim();
  }

  /**
   * 棟名フォルダを解決する。スキップ対象ならparentFolderをそのまま返す。
   */
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

  /**
   * 親フォルダ内のフォルダのうち、登録済みURLリストに含まれないものをゴミ箱へ移動する。
   * タイムアウト対策として継続トークンに対応。
   * @param {Array<string>} registeredUrls 登録済みフォルダのURL配列
   * @param {string} continuationToken 継続トークン（省略可）
   * @return {Object} 処理結果 { isFinished: boolean, continuationToken: string, processedCount: number }
   */
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
      // 5分経過したら中断（GASの制限対策）
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

  /**
   * Base64エンコードされたファイルをDriveフォルダに保存する。
   * Webアプリからのファイルアップロード用。
   * @param {Array<Object>} base64Files [{data, fileName, mimeType}]
   * @param {DriveApp.Folder} destFolder 保存先フォルダ
   * @param {string} filePrefix ファイル名プレフィックス
   * @return {Array<DriveApp.File>} 保存されたファイルの配列
   */
  function saveBase64Files(base64Files, destFolder, filePrefix, buildingName) {
    if (!base64Files || base64Files.length === 0) return { files: [], folderUrl: '' };
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
    return { files: savedFiles, folderUrl: dateFolder.getUrl() };
  }

  /**
   * 指定したフォルダIDに直接Base64ファイルを保存する。
   * チャンク分割送信で、Phase 1で確保済みのフォルダへ追加保存する際に使用。
   * @param {Array<Object>} base64Files [{data, fileName, mimeType}]
   * @param {string} folderId 保存先DriveフォルダのID
   * @param {string} filePrefix ファイル名プレフィックス
   * @return {number} 保存したファイル数
   */
  function saveBase64FilesToFolder(base64Files, folderId, filePrefix) {
    var folder = DriveApp.getFolderById(folderId);
    var count = 0;
    base64Files.forEach(function(fileInfo) {
      if (!fileInfo.data) return;
      var blob = Utilities.newBlob(
        Utilities.base64Decode(fileInfo.data),
        fileInfo.mimeType || 'image/jpeg',
        buildFileName(filePrefix, fileInfo.fileName || 'upload.jpg')
      );
      folder.createFile(blob);
      count++;
    });
    return count;
  }

  return {
    ensureSiteFolder: ensureSiteFolder,
    findSiteFolder: findSiteFolder,
    getSubFolderIfExists: getSubFolderIfExists,
    ensureTemporaryPhaseFolder: ensureTemporaryPhaseFolder,
    resolvePhaseFolder: resolvePhaseFolder,
    saveFilesFromResponse: saveFilesFromResponse,
    saveBase64Files: saveBase64Files,
    saveBase64FilesToFolder: saveBase64FilesToFolder,
    createDateFolder: createDateFolder,
    cleanupUnregisteredFolders: cleanupUnregisteredFolders
  };
})();
