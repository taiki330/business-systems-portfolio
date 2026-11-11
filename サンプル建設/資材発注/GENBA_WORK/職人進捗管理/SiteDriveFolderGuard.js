/**
 * 職人報告保存前: Master_Sites の現場名と C列 Drive フォルダ実名の整合チェック。
 */
const SiteDriveFolderGuard = (() => {
  const SITE_DRIVE_GUARD_CODES = Object.freeze({
    NOT_SET: 'SITE_DRIVE_FOLDER_NOT_SET',
    INVALID: 'SITE_DRIVE_FOLDER_INVALID',
    MISMATCH: 'SITE_DRIVE_FOLDER_MISMATCH'
  });

  const SITE_ID_PATTERN = /^SITE-\d+$/i;

  const normalizeSiteIdKey_ = id => {
    const t = String(id || '').trim().toUpperCase();
    return SITE_ID_PATTERN.test(t) ? t : '';
  };

  const stripSiteIdSuffix_ = name =>
    String(name || '').replace(/\s+__SITE-\d+\s*$/i, '').trim();

  const folderKeyFromSiteName_ = displayName =>
    UtilitiesEx.sanitizeName(UtilitiesEx.normalizeSiteName(displayName));

  const extractSiteIdFromFolderName_ = folderName => {
    const m = String(folderName || '').match(/\s+__(SITE-\d+)\s*$/i);
    return m ? m[1].toUpperCase() : '';
  };

  /**
   * @param {string} folderName Drive 親フォルダの実名
   * @param {string} siteName Master_Sites の現場名
   * @param {string} siteId SITE-xxx
   * @returns {{ ok: boolean, level: string }}
   */
  const evaluateSiteFolderNameMatch_ = (folderName, siteName, siteId) => {
    const fn = String(folderName || '');
    const sn = String(siteName || '');
    if (!fn || !sn) return { ok: false, level: 'none' };

    if (fn.trim() === sn.trim()) return { ok: true, level: 'L0' };

    if (UtilitiesEx.normalizeName(fn) === UtilitiesEx.normalizeName(sn)) {
      return { ok: true, level: 'L1' };
    }

    if (folderKeyFromSiteName_(fn) === folderKeyFromSiteName_(sn)) {
      return { ok: true, level: 'L2' };
    }

    const suffixId = extractSiteIdFromFolderName_(fn);
    const idNorm = normalizeSiteIdKey_(siteId);
    if (suffixId && idNorm && suffixId === idNorm) {
      return { ok: true, level: 'L3' };
    }

    if (
      UtilitiesEx.normalizeSiteName(stripSiteIdSuffix_(fn)) ===
      UtilitiesEx.normalizeSiteName(sn)
    ) {
      return { ok: true, level: 'L4' };
    }

    return { ok: false, level: 'none' };
  };

  const logGuardReject_ = (code, details) => {
    Logger.log(
      'SiteDriveFolderGuard reject code=%s siteId=%s siteName=%s driveFolderId=%s actualFolderName=%s matchLevel=%s reason=%s',
      code,
      details.siteId || '',
      details.siteName || '',
      details.driveFolderId || '',
      details.actualFolderName || '',
      details.matchLevel || '',
      details.reason || ''
    );
  };

  /**
   * ガード判定（throw しない）。quarantine モード用。
   * @param {{ id?: string, name?: string, driveFolderId?: string }} site
   */
  const checkSiteDriveFolderForReport_ = site => {
    const siteId = String((site && site.id) || '').trim();
    const siteName = String((site && site.name) || '').trim();
    const driveFolderId = String((site && site.driveFolderId) || '').trim();

    if (!driveFolderId) {
      logGuardReject_(SITE_DRIVE_GUARD_CODES.NOT_SET, {
        siteId,
        siteName,
        driveFolderId: '',
        actualFolderName: '',
        matchLevel: 'none',
        reason: 'driveFolderId_empty'
      });
      return {
        ok: false,
        errorCode: SITE_DRIVE_GUARD_CODES.NOT_SET,
        reason: 'driveFolderId_empty',
        siteId,
        siteName,
        driveFolderId: '',
        actualFolderName: '',
        matchLevel: 'none'
      };
    }

    let folder;
    try {
      folder = DriveApp.getFolderById(driveFolderId);
      folder.getName();
    } catch (e) {
      logGuardReject_(SITE_DRIVE_GUARD_CODES.INVALID, {
        siteId,
        siteName,
        driveFolderId,
        actualFolderName: '',
        matchLevel: 'none',
        reason: String(e)
      });
      return {
        ok: false,
        errorCode: SITE_DRIVE_GUARD_CODES.INVALID,
        reason: String(e.message || e),
        siteId,
        siteName,
        driveFolderId,
        actualFolderName: '',
        matchLevel: 'none'
      };
    }

    const actualFolderName = folder.getName();
    const match = evaluateSiteFolderNameMatch_(actualFolderName, siteName, siteId);
    if (!match.ok) {
      logGuardReject_(SITE_DRIVE_GUARD_CODES.MISMATCH, {
        siteId,
        siteName,
        driveFolderId,
        actualFolderName,
        matchLevel: match.level,
        reason: 'folder_name_mismatch'
      });
      return {
        ok: false,
        errorCode: SITE_DRIVE_GUARD_CODES.MISMATCH,
        reason: 'folder_name_mismatch',
        siteId,
        siteName,
        driveFolderId,
        actualFolderName,
        matchLevel: match.level
      };
    }

    Logger.log(
      'SiteDriveFolderGuard ok siteId=%s siteName=%s driveFolderId=%s actualFolderName=%s matchLevel=%s',
      siteId,
      siteName,
      driveFolderId,
      actualFolderName,
      match.level
    );
    return {
      ok: true,
      folder,
      folderId: folder.getId(),
      folderName: actualFolderName,
      matchLevel: match.level,
      siteId,
      siteName,
      driveFolderId
    };
  };

  /**
   * @param {{ id?: string, name?: string, driveFolderId?: string }} site Master 解決済み
   * @returns {GoogleAppsScript.Drive.Folder}
   */
  const assertSiteDriveFolderForReport_ = site => {
    const check = checkSiteDriveFolderForReport_(site);
    if (check.ok) {
      return check.folder;
    }
    if (check.errorCode === SITE_DRIVE_GUARD_CODES.NOT_SET) {
      throw new Error(
        'この現場のDriveフォルダが未設定です。管理者に連絡してください。'
      );
    }
    if (check.errorCode === SITE_DRIVE_GUARD_CODES.INVALID) {
      throw new Error(
        'Driveフォルダを開けませんでした。管理者にフォルダ設定を確認してもらってください。'
      );
    }
    throw new Error(
      '現場情報とDriveフォルダの組み合わせが一致しません。写真は保存していません。管理者に連絡してください。'
    );
  };

  return {
    SITE_DRIVE_GUARD_CODES,
    folderKeyFromSiteName_,
    extractSiteIdFromFolderName_,
    evaluateSiteFolderNameMatch_,
    checkSiteDriveFolderForReport_,
    assertSiteDriveFolderForReport_
  };
})();
