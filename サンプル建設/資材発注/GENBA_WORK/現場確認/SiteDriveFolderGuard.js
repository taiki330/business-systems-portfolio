/**
 * 現場確認: 稼働現場リスト C列と Drive フォルダ実名の整合チェック（職人 Phase1 同等 L0-L4）
 */
var SiteDriveFolderGuard = (function() {
  var SITE_DRIVE_GUARD_CODES = Object.freeze({
    NOT_SET: 'SITE_DRIVE_FOLDER_NOT_SET',
    INVALID: 'SITE_DRIVE_FOLDER_INVALID',
    MISMATCH: 'SITE_DRIVE_FOLDER_MISMATCH'
  });

  var SITE_ID_PATTERN = /^SITE-\d+$/i;

  function normalizeSiteIdKey_(id) {
    var t = String(id || '').trim().toUpperCase();
    return SITE_ID_PATTERN.test(t) ? t : '';
  }

  function logGuardReject_(code, details) {
    Logger.log(
      'SiteDriveFolderGuard reject code=%s siteName=%s siteId=%s driveFolderId=%s actualFolderName=%s matchLevel=%s reason=%s',
      code,
      details.siteName || '',
      details.siteId || '',
      details.driveFolderId || '',
      details.actualFolderName || '',
      details.matchLevel || '',
      details.reason || ''
    );
  }

  function evaluateSiteFolderNameMatch_(folderName, siteName, siteId) {
    var fn = String(folderName || '');
    var sn = String(siteName || '');
    if (!fn || !sn) return { ok: false, level: 'none' };

    if (fn.trim() === sn.trim()) return { ok: true, level: 'L0' };

    if (SiteNameUtils.normalizeName(fn) === SiteNameUtils.normalizeName(sn)) {
      return { ok: true, level: 'L1' };
    }

    if (SiteNameUtils.folderKeyFromSiteName(fn) === SiteNameUtils.folderKeyFromSiteName(sn)) {
      return { ok: true, level: 'L2' };
    }

    var suffixId = SiteNameUtils.extractSiteIdFromFolderName(fn);
    var idNorm = normalizeSiteIdKey_(siteId);
    if (suffixId && idNorm && suffixId === idNorm) {
      return { ok: true, level: 'L3' };
    }

    if (
      SiteNameUtils.normalizeSiteName(SiteNameUtils.stripSiteIdSuffix(fn)) ===
      SiteNameUtils.normalizeSiteName(sn)
    ) {
      return { ok: true, level: 'L4' };
    }

    return { ok: false, level: 'none' };
  }

  function assertSiteDriveFolderForPhase_(site) {
    var siteId = String((site && site.siteId) || '').trim();
    var siteName = String((site && site.siteName) || '').trim();
    var driveFolderId = String((site && site.driveFolderId) || '').trim();

    if (!driveFolderId) {
      logGuardReject_(SITE_DRIVE_GUARD_CODES.NOT_SET, {
        siteId: siteId,
        siteName: siteName,
        driveFolderId: '',
        actualFolderName: '',
        matchLevel: 'none',
        reason: 'driveFolderId_empty'
      });
      throw new Error('この現場のDriveフォルダが未設定です。管理者に連絡してください。');
    }

    var folder;
    try {
      folder = DriveApp.getFolderById(driveFolderId);
      folder.getName();
    } catch (e) {
      logGuardReject_(SITE_DRIVE_GUARD_CODES.INVALID, {
        siteId: siteId,
        siteName: siteName,
        driveFolderId: driveFolderId,
        actualFolderName: '',
        matchLevel: 'none',
        reason: String(e)
      });
      throw new Error('Driveフォルダを開けませんでした。管理者に確認してください。');
    }

    var actualFolderName = folder.getName();
    var match = evaluateSiteFolderNameMatch_(actualFolderName, siteName, siteId);
    if (!match.ok) {
      logGuardReject_(SITE_DRIVE_GUARD_CODES.MISMATCH, {
        siteId: siteId,
        siteName: siteName,
        driveFolderId: driveFolderId,
        actualFolderName: actualFolderName,
        matchLevel: match.level,
        reason: 'folder_name_mismatch'
      });
      throw new Error(
        '現場情報とDriveフォルダの組み合わせが一致しません。写真は保存していません。'
      );
    }

    Logger.log(
      'SiteDriveFolderGuard ok siteId=%s siteName=%s driveFolderId=%s actualFolderName=%s matchLevel=%s',
      siteId,
      siteName,
      driveFolderId,
      actualFolderName,
      match.level
    );
    return folder;
  }

  /**
   * ガード判定（throw しない）。quarantine モード用。
   * @returns {{ ok: boolean, folder?: Folder, errorCode?: string, reason?: string, actualFolderName?: string, matchLevel?: string }}
   */
  function checkSiteDriveFolderForPhase_(site) {
    var siteId = String((site && site.siteId) || '').trim();
    var siteName = String((site && site.siteName) || '').trim();
    var driveFolderId = String((site && site.driveFolderId) || '').trim();

    if (!driveFolderId) {
      logGuardReject_(SITE_DRIVE_GUARD_CODES.NOT_SET, {
        siteId: siteId,
        siteName: siteName,
        driveFolderId: '',
        actualFolderName: '',
        matchLevel: 'none',
        reason: 'driveFolderId_empty'
      });
      return {
        ok: false,
        errorCode: SITE_DRIVE_GUARD_CODES.NOT_SET,
        reason: 'driveFolderId_empty',
        actualFolderName: '',
        matchLevel: 'none'
      };
    }

    var folder;
    try {
      folder = DriveApp.getFolderById(driveFolderId);
      folder.getName();
    } catch (e) {
      logGuardReject_(SITE_DRIVE_GUARD_CODES.INVALID, {
        siteId: siteId,
        siteName: siteName,
        driveFolderId: driveFolderId,
        actualFolderName: '',
        matchLevel: 'none',
        reason: String(e)
      });
      return {
        ok: false,
        errorCode: SITE_DRIVE_GUARD_CODES.INVALID,
        reason: String(e),
        actualFolderName: '',
        matchLevel: 'none'
      };
    }

    var actualFolderName = folder.getName();
    var match = evaluateSiteFolderNameMatch_(actualFolderName, siteName, siteId);
    if (!match.ok) {
      logGuardReject_(SITE_DRIVE_GUARD_CODES.MISMATCH, {
        siteId: siteId,
        siteName: siteName,
        driveFolderId: driveFolderId,
        actualFolderName: actualFolderName,
        matchLevel: match.level,
        reason: 'folder_name_mismatch'
      });
      return {
        ok: false,
        errorCode: SITE_DRIVE_GUARD_CODES.MISMATCH,
        reason: 'folder_name_mismatch',
        actualFolderName: actualFolderName,
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
      folder: folder,
      actualFolderName: actualFolderName,
      matchLevel: match.level
    };
  }

  function guardErrorToMessage_(errorCode) {
    if (errorCode === SITE_DRIVE_GUARD_CODES.NOT_SET) {
      return 'この現場のDriveフォルダが未設定です。管理者に連絡してください。';
    }
    if (errorCode === SITE_DRIVE_GUARD_CODES.INVALID) {
      return 'Driveフォルダを開けませんでした。管理者に確認してください。';
    }
    if (errorCode === SITE_DRIVE_GUARD_CODES.MISMATCH) {
      return '現場情報とDriveフォルダの組み合わせが一致しません。写真は保存していません。';
    }
    return 'Drive保存に失敗しました。';
  }

  return {
    SITE_DRIVE_GUARD_CODES: SITE_DRIVE_GUARD_CODES,
    evaluateSiteFolderNameMatch_: evaluateSiteFolderNameMatch_,
    assertSiteDriveFolderForPhase_: assertSiteDriveFolderForPhase_,
    checkSiteDriveFolderForPhase_: checkSiteDriveFolderForPhase_,
    guardErrorToMessage_: guardErrorToMessage_
  };
})();
