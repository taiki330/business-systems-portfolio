/**
 * PHOTO_ROOT 配下の現場フォルダを正とした C列 DriveFolderId 監査（dryRun のみ）
 */
var AuditDriveFolders = (function() {
  const AUDIT_SHEET_NAME = 'DriveFolderId監査_dryRun';

  const PHOTO_ROOT_FOLDER_ID = 'SAMPLE_ID_037';
  const SHARED_ROOT_FOLDER_ID = 'SAMPLE_ID_018';

  const KANRI_SPREADSHEET_ID = 'SAMPLE_ID_011';
  const KANRI_SHEET_GID = 1304971549;

  const AUDIT_HEADERS = [
    'auditAt',
    'sourceSystem',
    'spreadsheetId',
    'sheetName',
    'rowNumber',
    'siteId',
    'masterSiteName',
    'driveFolderId_current',
    'auditStatus',
    'folderName_actual',
    'folderUrl_actual',
    'parentFolderId',
    'parentFolderName',
    'underPhotoRoot',
    'underSharedRoot',
    'matchLevel',
    'photoRoot_candidateId',
    'photoRoot_candidateName',
    'candidateCount',
    'driveFolderId_otherSheets',
    'suggestedAction',
    'suggestedDriveFolderId',
    'notes'
  ];

  const EXCLUDED_PHOTO_ROOT_CHILD_NAMES = ['99_要確認_保存先不整合', '仮置き'];

  const PREVIEW_SHEET_NAME = 'DriveFolderId更新プレビュー';

  const PREVIEW_HEADERS = [
    'previewAt',
    'applyEligible',
    'skipReason',
    'sourceSystem',
    'spreadsheetId',
    'sheetName',
    'rowNumber',
    'siteId',
    'masterSiteName',
    'driveFolderId_current_live',
    'driveFolderId_current_audit',
    'suggestedDriveFolderId',
    'candidateCount',
    'matchLevel',
    'auditAt',
    'notes'
  ];

  const APPLY_ALLOWED_SOURCE_SYSTEMS = ['職人進捗管理', '現場管理フォーム'];

  const DANGEROUS_NOTE_KEYWORDS = [
    'duplicate',
    'mismatch',
    'error',
    'manual',
    '複数',
    '不一致',
    'ancestry_error',
    'candidate_parent_resolve_failed',
    '他SITE-ID'
  ];

  const NORMAL_SET_C_NOTE = 'dryRun: SET_C候補（C列は書き換えません）';

  /** 本実行1回あたりの最大更新件数（GASエディタから引数未指定時の既定値） */
  const APPLY_MAX_ROWS = 50;

  /** 職人のみ本実行1回あたりの最大更新件数 */
  const MAX_SHOKUNIN_APPLY_ROWS = 100;

  const SHOKUNIN_SOURCE_SYSTEM = '職人進捗管理';

  const APPLY_LOG_SHEET_NAME = 'DriveFolderId更新ログ';

  const SHOKUNIN_MASTER_SHEET_NAME = '現場一覧';
  const KANRI_MASTER_SHEET_NAME = '稼働現場リスト';

  const APPLY_LOG_HEADERS = [
    'updatedAt',
    'runId',
    'sourceSystem',
    'spreadsheetId',
    'sheetName',
    'rowNumber',
    'siteId',
    'siteName',
    'oldDriveFolderId',
    'newDriveFolderId',
    'suggestedDriveFolderId',
    'auditStatus',
    'executedBy',
    'applyResult',
    'skipReason',
    'auditAt',
    'backupSheetName',
    'matchLevel'
  ];

  const APPLY_AUDIT_STATUS = 'SUGGEST_UPDATE';

  const LIGHT_AUDIT_SHEET_NAME = 'DriveFolderId監査_LIGHT';

  const LIGHT_AUDIT_HEADERS = [
    'auditAt',
    'sourceSystem',
    'spreadsheetId',
    'sheetName',
    'rowNumber',
    'siteId',
    'masterSiteName',
    'driveFolderId_current',
    'auditStatus',
    'currentIdInPhotoRoot',
    'photoRoot_candidateId',
    'photoRoot_candidateName',
    'candidateCount',
    'matchLevel',
    'suggestedAction',
    'suggestedDriveFolderId',
    'notes'
  ];

  const SYNC_KANRI_DRY_RUN_SHEET_NAME = 'DriveFolderId_職人to現場管理同期_dryRun';

  const SYNC_KANRI_DRY_RUN_HEADERS = [
    'checkedAt',
    'siteId',
    'shokuninRow',
    'kanriRow',
    'shokuninSiteName',
    'kanriSiteName',
    'matchLevel',
    'shokuninDriveFolderId',
    'kanriDriveFolderId_current',
    'suggestedDriveFolderId',
    'suggestedAction',
    'status',
    'notes'
  ];

  const MAX_SYNC_KANRI_ROWS = 100;

  const SYNC_KANRI_LOG_SHEET_NAME = 'DriveFolderId_職人to現場管理同期ログ';

  const SYNC_KANRI_LOG_HEADERS = [
    'syncedAt',
    'runId',
    'siteId',
    'kanriRow',
    'shokuninSiteName',
    'kanriSiteName',
    'matchLevel',
    'oldKanriDriveFolderId',
    'newKanriDriveFolderId',
    'suggestedDriveFolderId',
    'applyResult',
    'skipReason',
    'backupSheetName',
    'executedBy'
  ];

  const SYNC_KANRI_VERIFY_SHEET_NAME = 'DriveFolderId_現場管理同期検証';

  const SYNC_KANRI_VERIFY_HEADERS = [
    'verifiedAt',
    'runId',
    'siteId',
    'kanriRow',
    'kanriSiteName_current',
    'kanriSiteId_current',
    'oldKanriDriveFolderId',
    'newKanriDriveFolderId',
    'suggestedDriveFolderId',
    'currentKanriDriveFolderId',
    'verifyStatus',
    'notes'
  ];

  const VALID_MATCH_LEVELS_ = ['L0', 'L1', 'L2', 'L3', 'L4'];

  const MANUAL_REVIEW_SHEET_NAME = 'DriveFolderId手動確認リスト';

  const MANUAL_REVIEW_HEADERS = [
    'sourceSystem',
    'siteId',
    'masterSiteName',
    'driveFolderId_current',
    'auditStatus',
    'currentIdInPhotoRoot',
    'photoRoot_candidateId',
    'photoRoot_candidateName',
    'candidateCount',
    'matchLevel',
    'suggestedAction',
    'suggestedDriveFolderId',
    'notes',
    'reviewDecision',
    'finalDriveFolderId',
    'reviewerNote'
  ];

  const MOVE_TO_PHOTO_ROOT_DRY_RUN_SHEET_NAME = 'DriveFolderId_PHOTO_ROOT移動dryRun';

  const MOVE_TO_PHOTO_ROOT_LOG_SHEET_NAME = 'DriveFolderId_PHOTO_ROOT移動ログ';

  const MAX_MOVE_FOLDERS = 5;

  const MOVE_TO_PHOTO_ROOT_LOG_HEADERS = [
    'movedAt',
    'runId',
    'folderId',
    'folderName',
    'siteIds',
    'masterSiteNames',
    'oldParentId',
    'oldParentName',
    'newParentId',
    'newParentName',
    'moveResult',
    'skipReason',
    'sourceSystems',
    'executedBy'
  ];

  const MOVE_TO_PHOTO_ROOT_DRY_RUN_HEADERS = [
    'checkedAt',
    'sourceSystem',
    'siteId',
    'masterSiteName',
    'folderId',
    'folderName',
    'currentParentId',
    'currentParentName',
    'has08Shokunin',
    'hasSiteStructure',
    'duplicateInPhotoRoot',
    'duplicateCandidateNames',
    'moveStatus',
    'suggestedAction',
    'notes'
  ];

  const REVIEW_DECISION_MOVE_TO_PHOTO_ROOT = 'MOVE_EXISTING_FOLDER_TO_PHOTO_ROOT';
  const REVIEW_DECISION_MANUAL_HOLD = 'MANUAL_HOLD';

  const AUTO_MARK_SUCCESS_REVIEWER_NOTE =
    '自動判定: 現在C列IDのフォルダに現場フォルダ構成があり、PHOTO_ROOT側に重複候補なし。PHOTO_ROOT直下への移動候補。';

  const AUTO_MARK_SITE_STRUCTURE_NAMES_ = [
    '00_工程表',
    '01_現調',
    '02_仮設計画',
    '03_送り出し教育',
    '04_解体前教育',
    '05_点検',
    '06_巡回',
    '07_衛生協議会'
  ];

  const SITE_STRUCTURE_EXACT_NAMES_ = ['00_工程表', '01_現調'];

  function normalizeSiteIdKey_(id) {
    const t = String(id || '').trim().toUpperCase();
    return /^SITE-\d+$/i.test(t) ? t : '';
  }

  function parseMasterHeaders_(headers) {
    const h = (headers || []).map(x => String(x || '').trim());
    const siteNameCol = h.findIndex(
      x => x === '現場名' || x === '工事現場名' || x.toLowerCase() === 'sitename'
    );
    const siteIdCol = h.findIndex(x => x === '現場ID' || x.toLowerCase() === 'siteid');
    const driveCol = h.findIndex(
      x =>
        x === 'DriveフォルダID' ||
        x.toLowerCase() === 'drivefolderid' ||
        x === 'フォルダID'
    );
    return {
      siteNameCol: siteNameCol >= 0 ? siteNameCol : 0,
      siteIdCol: siteIdCol >= 0 ? siteIdCol : 1,
      driveCol: driveCol >= 0 ? driveCol : 2
    };
  }

  function readMasterRows_(spreadsheetId, sheetResolver, sourceSystem) {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = sheetResolver(ss);
    if (!sheet) {
      throw new Error(sourceSystem + ': シートが見つかりません spreadsheetId=' + spreadsheetId);
    }
    const values = sheet.getDataRange().getValues();
    if (!values.length) {
      return { spreadsheetId: spreadsheetId, sheetName: sheet.getName(), rows: [] };
    }
    const cols = parseMasterHeaders_(values[0]);
    const rows = [];
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i];
      const siteName = String(row[cols.siteNameCol] || '').trim();
      const siteId = String(row[cols.siteIdCol] || '').trim();
      const driveFolderId = String(row[cols.driveCol] || '').trim();
      if (!siteName && !siteId && !driveFolderId) {
        continue;
      }
      rows.push({
        sourceSystem: sourceSystem,
        spreadsheetId: spreadsheetId,
        sheetName: sheet.getName(),
        rowNumber: i + 1,
        siteId: siteId,
        masterSiteName: siteName,
        driveFolderId: driveFolderId
      });
    }
    return { spreadsheetId: spreadsheetId, sheetName: sheet.getName(), rows: rows };
  }

  function readShokuninMasterRows_() {
    return readMasterRows_(
      APP_CONFIG.spreadsheetId,
      ss => SheetRepository.getSheet(APP_CONFIG.sheetNames.sites),
      '職人進捗管理'
    );
  }

  function readKanriMasterRows_() {
    return readMasterRows_(
      KANRI_SPREADSHEET_ID,
      ss => {
        const byGid = ss.getSheets().find(sh => sh.getSheetId() === KANRI_SHEET_GID);
        if (byGid) {
          return byGid;
        }
        return ss.getSheetByName('稼働現場リスト');
      },
      '現場管理フォーム'
    );
  }

  function listPhotoRootFolders_() {
    const root = DriveApp.getFolderById(PHOTO_ROOT_FOLDER_ID);
    const out = [];
    let folders = root.getFolders();
    while (folders.hasNext()) {
      const folder = folders.next();
      const folderName = folder.getName();
      if (EXCLUDED_PHOTO_ROOT_CHILD_NAMES.indexOf(folderName) >= 0) {
        continue;
      }
      const siteIdSuffix = SiteDriveFolderGuard.extractSiteIdFromFolderName_(folderName);
      out.push({
        folderId: folder.getId(),
        folderName: folderName,
        folderUrl: folder.getUrl(),
        siteIdSuffix: siteIdSuffix,
        normalizedName: UtilitiesEx.normalizeName(folderName)
      });
    }
    return out;
  }

  function buildPhotoRootFolderIndex_(folders) {
    const byId = {};
    const bySiteId = {};
    const byNormalizedName = {};
    folders.forEach(f => {
      byId[f.folderId] = f;
      if (f.siteIdSuffix) {
        if (!bySiteId[f.siteIdSuffix]) {
          bySiteId[f.siteIdSuffix] = [];
        }
        bySiteId[f.siteIdSuffix].push(f);
      }
      const nk = f.normalizedName;
      if (nk) {
        if (!byNormalizedName[nk]) {
          byNormalizedName[nk] = [];
        }
        byNormalizedName[nk].push(f);
      }
    });
    return { byId: byId, bySiteId: bySiteId, byNormalizedName: byNormalizedName, all: folders };
  }

  function getFolderParentInfo_(folder) {
    if (!folder) {
      return { parentFolderId: '', parentFolderName: '' };
    }
    try {
      const parents = folder.getParents();
      if (!parents.hasNext()) {
        return { parentFolderId: '', parentFolderName: '' };
      }
      const parent = parents.next();
      return { parentFolderId: parent.getId(), parentFolderName: parent.getName() };
    } catch (e) {
      return { parentFolderId: '', parentFolderName: '', error: String(e.message || e) };
    }
  }

  function detectFolderAncestry_(folderId) {
    const result = {
      underPhotoRoot: false,
      underSharedRoot: false,
      isQuarantine: false,
      isTemp: false,
      isChildOfPhotoRootSiteFolder: false,
      notes: []
    };
    if (!folderId) {
      return result;
    }
    try {
      let current = DriveApp.getFolderById(folderId);
      const parentInfo = getFolderParentInfo_(current);
      if (parentInfo.parentFolderId === PHOTO_ROOT_FOLDER_ID) {
        result.underPhotoRoot = true;
        return result;
      }
      if (parentInfo.parentFolderId === SHARED_ROOT_FOLDER_ID) {
        result.underSharedRoot = true;
      }

      let node = current;
      for (let depth = 0; depth < 20; depth += 1) {
        const parents = node.getParents();
        if (!parents.hasNext()) {
          break;
        }
        const parent = parents.next();
        const pid = parent.getId();
        const pname = parent.getName();

        if (pid === PHOTO_ROOT_FOLDER_ID) {
          result.isChildOfPhotoRootSiteFolder = depth >= 0;
          break;
        }
        if (pid === SHARED_ROOT_FOLDER_ID) {
          result.underSharedRoot = true;
        }
        const qName = APP_CONFIG.QUARANTINE_ROOT_FOLDER_NAME || '99_要確認_保存先不整合';
        if (pname === qName || pname.indexOf('99_要確認') >= 0) {
          result.isQuarantine = true;
        }
        if (pname === '仮置き' || pname.indexOf('仮置き') >= 0) {
          result.isTemp = true;
        }
        node = parent;
      }
    } catch (e) {
      result.notes.push('ancestry_error:' + String(e.message || e));
    }
    return result;
  }

  function findPhotoRootCandidates_(masterRow, index) {
    const siteIdKey = normalizeSiteIdKey_(masterRow.siteId);
    const masterNorm = UtilitiesEx.normalizeName(masterRow.masterSiteName);
    const found = {};
    const add = f => {
      found[f.folderId] = f;
    };

    if (siteIdKey && index.bySiteId[siteIdKey]) {
      index.bySiteId[siteIdKey].forEach(add);
    }
    if (masterNorm && index.byNormalizedName[masterNorm]) {
      index.byNormalizedName[masterNorm].forEach(add);
    }

    index.all.forEach(f => {
      const match = SiteDriveFolderGuard.evaluateSiteFolderNameMatch_(
        f.folderName,
        masterRow.masterSiteName,
        masterRow.siteId
      );
      if (match.ok) {
        add(f);
      }
    });

    const list = Object.keys(found).map(k => found[k]);
    let bestLevel = 'none';
    list.forEach(f => {
      const m = SiteDriveFolderGuard.evaluateSiteFolderNameMatch_(
        f.folderName,
        masterRow.masterSiteName,
        masterRow.siteId
      );
      if (m.ok && m.level !== 'none') {
        bestLevel = m.level;
      }
    });

    return {
      candidates: list,
      candidateCount: list.length,
      matchLevel: bestLevel,
      photoRoot_candidateId: list.length === 1 ? list[0].folderId : '',
      photoRoot_candidateName: list.length === 1 ? list[0].folderName : ''
    };
  }

  function buildCrossSheetDriveMap_(sources) {
    const bySiteId = {};
    sources.forEach(src => {
      src.rows.forEach(row => {
        const key = normalizeSiteIdKey_(row.siteId) || '__NO_ID__' + row.rowNumber + row.sourceSystem;
        if (!bySiteId[key]) {
          bySiteId[key] = {};
        }
        bySiteId[key][row.sourceSystem] = row.driveFolderId || '';
      });
    });
    return bySiteId;
  }

  function buildDriveIdUsageMap_(sources) {
    const usage = {};
    sources.forEach(src => {
      src.rows.forEach(row => {
        const id = String(row.driveFolderId || '').trim();
        const sid = normalizeSiteIdKey_(row.siteId);
        if (!id) {
          return;
        }
        if (!usage[id]) {
          usage[id] = [];
        }
        if (sid && usage[id].indexOf(sid) < 0) {
          usage[id].push(sid);
        }
      });
    });
    return usage;
  }

  function formatOtherSheets_(masterRow, crossMap) {
    const key = normalizeSiteIdKey_(masterRow.siteId);
    if (!key) {
      return '';
    }
    const entry = crossMap[key];
    if (!entry) {
      return '';
    }
    const parts = [];
    Object.keys(entry).forEach(sys => {
      if (sys !== masterRow.sourceSystem) {
        parts.push(sys + '=' + (entry[sys] || '(空)'));
      }
    });
    return parts.join(' | ');
  }

  function hasCrossSheetMismatch_(masterRow, crossMap) {
    const key = normalizeSiteIdKey_(masterRow.siteId);
    if (!key || !crossMap[key]) {
      return false;
    }
    const entry = crossMap[key];
    const vals = Object.keys(entry).map(k => String(entry[k] || '').trim());
    const uniq = vals.filter((v, i, a) => a.indexOf(v) === i);
    return uniq.length > 1;
  }

  function isDriveIdUsedByOtherSite_(driveId, siteId, driveIdUsage) {
    const key = normalizeSiteIdKey_(siteId);
    const users = driveIdUsage[driveId] || [];
    if (users.length <= 1) {
      return false;
    }
    if (!key) {
      return users.length > 1;
    }
    return users.some(u => u !== key);
  }

  function canSuggestSetC_(ctx) {
    if (ctx.candidateCount !== 1 || !ctx.photoRoot_candidateId) {
      return false;
    }
    if (ctx.candidateParentId !== PHOTO_ROOT_FOLDER_ID) {
      return false;
    }
    const siteIdKey = normalizeSiteIdKey_(ctx.masterRow.siteId);
    const matchOk =
      ctx.matchLevel !== 'none' ||
      (siteIdKey && ctx.candidateSiteIdSuffix === siteIdKey);
    if (!matchOk) {
      return false;
    }
    const current = String(ctx.masterRow.driveFolderId || '').trim();
    const needsUpdate =
      !current ||
      ctx.baseAuditStatus === 'C_INVALID' ||
      ctx.baseAuditStatus === 'C_WRONG_PARENT' ||
      ctx.baseAuditStatus === 'C_SHARED_ROOT' ||
      ctx.baseAuditStatus === 'C_SUBFOLDER' ||
      ctx.baseAuditStatus === 'C_QUARANTINE' ||
      ctx.baseAuditStatus === 'C_EMPTY';
    if (!needsUpdate) {
      return false;
    }
    if (isDriveIdUsedByOtherSite_(ctx.photoRoot_candidateId, ctx.masterRow.siteId, ctx.driveIdUsage)) {
      return false;
    }
    if (ctx.hasCrossSheetMismatch) {
      return false;
    }
    return true;
  }

  function resolveSuggestedAction_(auditStatus, hasCrossSheetMismatch, candidateCount, canSetC) {
    if (canSetC) {
      return { suggestedAction: 'SET_C', auditStatus: 'SUGGEST_UPDATE' };
    }
    if (auditStatus === 'OK' && !hasCrossSheetMismatch) {
      return { suggestedAction: 'NO_CHANGE', auditStatus: auditStatus };
    }
    if (
      hasCrossSheetMismatch ||
      candidateCount > 1 ||
      auditStatus === 'C_NAME_MISMATCH' ||
      auditStatus === 'C_DUPLICATE_DRIVE' ||
      auditStatus === 'C_CROSS_SHEET_MISMATCH' ||
      auditStatus === 'C_WRONG_PARENT' ||
      auditStatus === 'C_INVALID' ||
      auditStatus === 'MASTER_NO_DRIVE' ||
      auditStatus === 'DRIVE_NO_MASTER'
    ) {
      return { suggestedAction: 'MANUAL_REVIEW', auditStatus: auditStatus };
    }
    if (auditStatus === 'C_EMPTY' || auditStatus === 'C_QUARANTINE' || auditStatus === 'C_SHARED_ROOT') {
      return { suggestedAction: 'MANUAL_REVIEW', auditStatus: auditStatus };
    }
    return { suggestedAction: 'NO_CHANGE', auditStatus: auditStatus };
  }

  function auditOneSiteDriveFolder_(masterRow, index, crossMap, driveIdUsage, auditAt) {
    const currentId = String(masterRow.driveFolderId || '').trim();
    const candidateInfo = findPhotoRootCandidates_(masterRow, index);
    const hasCrossSheetMismatch = hasCrossSheetMismatch_(masterRow, crossMap);

    let folderNameActual = '';
    let folderUrlActual = '';
    let parentFolderId = '';
    let parentFolderName = '';
    let underPhotoRoot = false;
    let underSharedRoot = false;
    let matchLevel = candidateInfo.matchLevel;
    let baseAuditStatus = 'OK';
    const notes = [];

    if (!currentId) {
      baseAuditStatus = candidateInfo.candidateCount === 0 ? 'MASTER_NO_DRIVE' : 'C_EMPTY';
    } else {
      try {
        const folder = DriveApp.getFolderById(currentId);
        folderNameActual = folder.getName();
        folderUrlActual = folder.getUrl();
        const parent = getFolderParentInfo_(folder);
        parentFolderId = parent.parentFolderId;
        parentFolderName = parent.parentFolderName;

        if (parentFolderId === PHOTO_ROOT_FOLDER_ID) {
          underPhotoRoot = true;
          const nameMatch = SiteDriveFolderGuard.evaluateSiteFolderNameMatch_(
            folderNameActual,
            masterRow.masterSiteName,
            masterRow.siteId
          );
          matchLevel = nameMatch.ok ? nameMatch.level : 'none';
          baseAuditStatus = nameMatch.ok ? 'OK' : 'C_NAME_MISMATCH';
        } else {
          const ancestry = detectFolderAncestry_(currentId);
          underSharedRoot = ancestry.underSharedRoot;
          if (ancestry.isQuarantine || ancestry.isTemp) {
            baseAuditStatus = 'C_QUARANTINE';
          } else if (ancestry.underSharedRoot || parentFolderId === SHARED_ROOT_FOLDER_ID) {
            baseAuditStatus = 'C_SHARED_ROOT';
          } else if (ancestry.isChildOfPhotoRootSiteFolder) {
            baseAuditStatus = 'C_SUBFOLDER';
            notes.push('PHOTO_ROOT配下の現場フォルダの子を指している可能性');
          } else {
            baseAuditStatus = 'C_WRONG_PARENT';
          }
        }

        if (isDriveIdUsedByOtherSite_(currentId, masterRow.siteId, driveIdUsage)) {
          baseAuditStatus = 'C_DUPLICATE_DRIVE';
          notes.push('同一DriveFolderIdが他SITE-IDでも使用されています');
        }
      } catch (e) {
        baseAuditStatus = 'C_INVALID';
        notes.push(String(e.message || e));
      }
    }

    if (hasCrossSheetMismatch) {
      baseAuditStatus = 'C_CROSS_SHEET_MISMATCH';
      notes.push('同一SITE-IDで他ソースのC列と不一致');
    }

    if (candidateInfo.candidateCount > 1) {
      notes.push('PHOTO_ROOT直下に候補が' + candidateInfo.candidateCount + '件');
    }

    let candidateParentId = '';
    let candidateSiteIdSuffix = '';
    if (candidateInfo.candidateCount === 1 && candidateInfo.photoRoot_candidateId) {
      try {
        const cf = DriveApp.getFolderById(candidateInfo.photoRoot_candidateId);
        candidateParentId = getFolderParentInfo_(cf).parentFolderId;
        candidateSiteIdSuffix = SiteDriveFolderGuard.extractSiteIdFromFolderName_(cf.getName());
      } catch (e) {
        notes.push('candidate_parent_resolve_failed:' + String(e.message || e));
      }
    }

    const canSetC = canSuggestSetC_({
      masterRow: masterRow,
      candidateCount: candidateInfo.candidateCount,
      photoRoot_candidateId: candidateInfo.photoRoot_candidateId,
      candidateParentId: candidateParentId,
      candidateSiteIdSuffix: candidateSiteIdSuffix,
      matchLevel: matchLevel,
      baseAuditStatus: baseAuditStatus,
      driveIdUsage: driveIdUsage,
      hasCrossSheetMismatch: hasCrossSheetMismatch
    });

    const actionResult = resolveSuggestedAction_(
      baseAuditStatus,
      hasCrossSheetMismatch,
      candidateInfo.candidateCount,
      canSetC
    );
    const auditStatus = actionResult.auditStatus;
    const suggestedAction = actionResult.suggestedAction;
    let suggestedDriveFolderId = '';

    if (suggestedAction === 'SET_C') {
      suggestedDriveFolderId = candidateInfo.photoRoot_candidateId;
      notes.push('dryRun: SET_C候補（C列は書き換えません）');
    }

    return {
      auditAt: auditAt,
      sourceSystem: masterRow.sourceSystem,
      spreadsheetId: masterRow.spreadsheetId,
      sheetName: masterRow.sheetName,
      rowNumber: masterRow.rowNumber,
      siteId: masterRow.siteId,
      masterSiteName: masterRow.masterSiteName,
      driveFolderId_current: currentId,
      auditStatus: auditStatus,
      folderName_actual: folderNameActual,
      folderUrl_actual: folderUrlActual,
      parentFolderId: parentFolderId,
      parentFolderName: parentFolderName,
      underPhotoRoot: underPhotoRoot,
      underSharedRoot: underSharedRoot,
      matchLevel: matchLevel,
      photoRoot_candidateId: candidateInfo.photoRoot_candidateId,
      photoRoot_candidateName: candidateInfo.photoRoot_candidateName,
      candidateCount: candidateInfo.candidateCount,
      driveFolderId_otherSheets: formatOtherSheets_(masterRow, crossMap),
      suggestedAction: suggestedAction,
      suggestedDriveFolderId: suggestedDriveFolderId,
      notes: notes.join('; ')
    };
  }

  function buildOrphanDriveRows_(index, masterRows, auditAt) {
    const matchedFolderIds = {};
    masterRows.forEach(row => {
      const id = String(row.driveFolderId || '').trim();
      if (id && index.byId[id]) {
        matchedFolderIds[id] = true;
      }
      const siteIdKey = normalizeSiteIdKey_(row.siteId);
      if (siteIdKey && index.bySiteId[siteIdKey]) {
        index.bySiteId[siteIdKey].forEach(f => {
          matchedFolderIds[f.folderId] = true;
        });
      }
      const masterNorm = UtilitiesEx.normalizeName(row.masterSiteName);
      if (masterNorm && index.byNormalizedName[masterNorm]) {
        index.byNormalizedName[masterNorm].forEach(f => {
          matchedFolderIds[f.folderId] = true;
        });
      }
    });

    const orphans = [];
    index.all.forEach(f => {
      if (matchedFolderIds[f.folderId]) {
        return;
      }
      orphans.push({
        auditAt: auditAt,
        sourceSystem: 'PHOTO_ROOT',
        spreadsheetId: '',
        sheetName: '',
        rowNumber: '',
        siteId: f.siteIdSuffix || '',
        masterSiteName: '',
        driveFolderId_current: f.folderId,
        auditStatus: 'DRIVE_NO_MASTER',
        folderName_actual: f.folderName,
        folderUrl_actual: f.folderUrl,
        parentFolderId: PHOTO_ROOT_FOLDER_ID,
        parentFolderName: '(PHOTO_ROOT)',
        underPhotoRoot: true,
        underSharedRoot: false,
        matchLevel: 'none',
        photoRoot_candidateId: f.folderId,
        photoRoot_candidateName: f.folderName,
        candidateCount: 1,
        driveFolderId_otherSheets: '',
        suggestedAction: 'MANUAL_REVIEW',
        suggestedDriveFolderId: '',
        notes: 'PHOTO_ROOT直下にマスタ未登録のフォルダ'
      });
    });
    return orphans;
  }

  function writeDriveFolderAuditSheet_(rows) {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    let sheet = ss.getSheetByName(AUDIT_SHEET_NAME);
    if (sheet) {
      sheet.clear();
    } else {
      sheet = ss.insertSheet(AUDIT_SHEET_NAME);
    }
    const data = [AUDIT_HEADERS];
    rows.forEach(r => {
      data.push(AUDIT_HEADERS.map(h => (r[h] != null ? r[h] : '')));
    });
    if (data.length > 0) {
      sheet.getRange(1, 1, data.length, AUDIT_HEADERS.length).setValues(data);
      sheet.setFrozenRows(1);
    }
    return { sheetName: AUDIT_SHEET_NAME, rowCount: rows.length };
  }

  function readAuditSheetRows_() {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    const sheet = ss.getSheetByName(AUDIT_SHEET_NAME);
    if (!sheet) {
      throw new Error('監査シートが見つかりません: ' + AUDIT_SHEET_NAME);
    }
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      return [];
    }
    const headers = values[0].map(h => String(h || '').trim());
    const colIndex = {};
    headers.forEach((h, i) => {
      colIndex[h] = i;
    });
    const missing = AUDIT_HEADERS.filter(h => colIndex[h] === undefined);
    if (missing.length) {
      throw new Error('監査シートに不足列があります: ' + missing.join(', '));
    }
    const rows = [];
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i];
      const record = {};
      AUDIT_HEADERS.forEach(h => {
        record[h] = row[colIndex[h]];
      });
      rows.push(record);
    }
    return rows;
  }

  function hasDangerousNotes_(notes) {
    let text = String(notes || '');
    text = text.split(NORMAL_SET_C_NOTE).join('');
    const lower = text.toLowerCase();
    for (let i = 0; i < DANGEROUS_NOTE_KEYWORDS.length; i += 1) {
      const kw = DANGEROUS_NOTE_KEYWORDS[i];
      if (lower.indexOf(kw.toLowerCase()) >= 0) {
        return true;
      }
    }
    return false;
  }

  function staticFilterAuditRow_(auditRow) {
    if (String(auditRow.suggestedAction || '').trim() !== 'SET_C') {
      return 'SKIP_NOT_SET_C';
    }
    if (String(auditRow.auditStatus || '').trim() !== 'SUGGEST_UPDATE') {
      return 'SKIP_STATUS';
    }
    if (!String(auditRow.suggestedDriveFolderId || '').trim()) {
      return 'SKIP_NO_SUGGESTED_ID';
    }
    const candidateCount = Number(auditRow.candidateCount);
    if (candidateCount !== 1) {
      return 'SKIP_STATUS';
    }
    if (!normalizeSiteIdKey_(auditRow.siteId)) {
      return 'SKIP_BAD_SITE_ID';
    }
    if (APPLY_ALLOWED_SOURCE_SYSTEMS.indexOf(String(auditRow.sourceSystem || '').trim()) < 0) {
      return 'SKIP_STATUS';
    }
    if (
      !String(auditRow.spreadsheetId || '').trim() ||
      !String(auditRow.sheetName || '').trim() ||
      !String(auditRow.rowNumber || '').trim()
    ) {
      return 'SKIP_STATUS';
    }
    if (hasDangerousNotes_(auditRow.notes)) {
      return 'SKIP_DANGEROUS_NOTES';
    }
    return '';
  }

  function isPermissionLikeError_(message) {
    const err = String(message || '').toLowerCase();
    return (
      err.indexOf('access') >= 0 ||
      err.indexOf('permission') >= 0 ||
      err.indexOf('authorized') >= 0 ||
      err.indexOf('denied') >= 0 ||
      err.indexOf('権限') >= 0
    );
  }

  function createSheetContextCache_() {
    return {};
  }

  function loadSheetContext_(cache, spreadsheetId, sheetName) {
    const key = spreadsheetId + '|' + sheetName;
    if (cache[key]) {
      return cache[key];
    }
    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        cache[key] = { ok: false, error: 'sheet_not_found' };
        return cache[key];
      }
      const values = sheet.getDataRange().getValues();
      const cols = parseMasterHeaders_(values[0] || []);
      cache[key] = { ok: true, values: values, cols: cols };
    } catch (e) {
      cache[key] = { ok: false, error: String(e.message || e) };
    }
    return cache[key];
  }

  function readLiveMasterRow_(cache, auditRow) {
    const spreadsheetId = String(auditRow.spreadsheetId || '').trim();
    const sheetName = String(auditRow.sheetName || '').trim();
    const rowNumber = Number(auditRow.rowNumber);
    const ctx = loadSheetContext_(cache, spreadsheetId, sheetName);
    if (!ctx.ok) {
      return { ok: false, error: ctx.error || 'permission_error' };
    }
    if (!rowNumber || rowNumber < 2 || rowNumber > ctx.values.length) {
      return { ok: false, error: 'row_out_of_range' };
    }
    const row = ctx.values[rowNumber - 1];
    return {
      ok: true,
      siteId: String(row[ctx.cols.siteIdCol] || '').trim(),
      masterSiteName: String(row[ctx.cols.siteNameCol] || '').trim(),
      driveFolderId: String(row[ctx.cols.driveCol] || '').trim()
    };
  }

  function validateSuggestedFolder_(suggestedId, masterSiteName, siteId) {
    try {
      const folder = DriveApp.getFolderById(suggestedId);
      const folderName = folder.getName();
      const parent = getFolderParentInfo_(folder);
      if (parent.error) {
        return { ok: false, reason: 'SKIP_INVALID_CANDIDATE', detail: parent.error };
      }
      if (parent.parentFolderId !== PHOTO_ROOT_FOLDER_ID) {
        return { ok: false, reason: 'SKIP_WRONG_PARENT', detail: parent.parentFolderId };
      }
      const nameMatch = SiteDriveFolderGuard.evaluateSiteFolderNameMatch_(
        folderName,
        masterSiteName,
        siteId
      );
      if (!nameMatch.ok) {
        return { ok: false, reason: 'SKIP_NAME_MISMATCH', detail: folderName, matchLevel: 'none' };
      }
      return { ok: true, matchLevel: nameMatch.level, folderName: folderName };
    } catch (e) {
      return { ok: false, reason: 'SKIP_INVALID_CANDIDATE', detail: String(e.message || e) };
    }
  }

  function buildDuplicateTargetSiteMap_(staticPassedRows) {
    const byFolderId = {};
    staticPassedRows.forEach(row => {
      const folderId = String(row.suggestedDriveFolderId || '').trim();
      const siteId = normalizeSiteIdKey_(row.siteId);
      if (!folderId || !siteId) {
        return;
      }
      if (!byFolderId[folderId]) {
        byFolderId[folderId] = [];
      }
      if (byFolderId[folderId].indexOf(siteId) < 0) {
        byFolderId[folderId].push(siteId);
      }
    });
    const duplicateFolderIds = {};
    Object.keys(byFolderId).forEach(folderId => {
      if (byFolderId[folderId].length > 1) {
        duplicateFolderIds[folderId] = true;
      }
    });
    return duplicateFolderIds;
  }

  function previewOneAuditRow_(auditRow, previewAt, sheetCache, duplicateFolderIds) {
    const base = {
      previewAt: previewAt,
      applyEligible: false,
      skipReason: '',
      sourceSystem: String(auditRow.sourceSystem || '').trim(),
      spreadsheetId: String(auditRow.spreadsheetId || '').trim(),
      sheetName: String(auditRow.sheetName || '').trim(),
      rowNumber: auditRow.rowNumber,
      siteId: String(auditRow.siteId || '').trim(),
      masterSiteName: String(auditRow.masterSiteName || '').trim(),
      driveFolderId_current_live: '',
      driveFolderId_current_audit: String(auditRow.driveFolderId_current || '').trim(),
      suggestedDriveFolderId: String(auditRow.suggestedDriveFolderId || '').trim(),
      candidateCount: auditRow.candidateCount,
      matchLevel: String(auditRow.matchLevel || '').trim(),
      auditAt: String(auditRow.auditAt || '').trim(),
      notes: String(auditRow.notes || '').trim()
    };

    const staticSkip = staticFilterAuditRow_(auditRow);
    if (staticSkip) {
      base.skipReason = staticSkip;
      return base;
    }

    const suggestedId = base.suggestedDriveFolderId;
    if (duplicateFolderIds[suggestedId]) {
      base.skipReason = 'SKIP_DUPLICATE_TARGET';
      return base;
    }

    const live = readLiveMasterRow_(sheetCache, auditRow);
    if (!live.ok) {
      base.skipReason = isPermissionLikeError_(live.error)
        ? 'SKIP_PERMISSION_ERROR'
        : 'SKIP_ROW_DRIFT';
      return base;
    }

    base.driveFolderId_current_live = live.driveFolderId;
    const auditSiteId = normalizeSiteIdKey_(auditRow.siteId);
    const liveSiteId = normalizeSiteIdKey_(live.siteId);
    if (!liveSiteId || liveSiteId !== auditSiteId) {
      base.skipReason = 'SKIP_ROW_DRIFT';
      return base;
    }

    if (live.driveFolderId !== base.driveFolderId_current_audit) {
      base.skipReason = 'SKIP_STALE_CURRENT';
      return base;
    }

    const folderCheck = validateSuggestedFolder_(
      suggestedId,
      base.masterSiteName,
      base.siteId
    );
    if (!folderCheck.ok) {
      base.skipReason = folderCheck.reason;
      if (folderCheck.matchLevel) {
        base.matchLevel = folderCheck.matchLevel;
      }
      return base;
    }

    base.matchLevel = folderCheck.matchLevel || base.matchLevel;
    base.applyEligible = true;
    base.skipReason = 'OK_ELIGIBLE';
    return base;
  }

  function writePreviewApplySheet_(rows) {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    let sheet = ss.getSheetByName(PREVIEW_SHEET_NAME);
    if (sheet) {
      sheet.clear();
    } else {
      sheet = ss.insertSheet(PREVIEW_SHEET_NAME);
    }
    const data = [PREVIEW_HEADERS];
    rows.forEach(r => {
      data.push(PREVIEW_HEADERS.map(h => (r[h] != null ? r[h] : '')));
    });
    if (data.length > 0) {
      sheet.getRange(1, 1, data.length, PREVIEW_HEADERS.length).setValues(data);
      sheet.setFrozenRows(1);
    }
    return { sheetName: PREVIEW_SHEET_NAME, rowCount: rows.length };
  }

  function summarizePreviewRows_(rows) {
    const summary = {
      totalRows: rows.length,
      eligible: 0,
      skipped: 0,
      bySourceEligible: {},
      byMatchLevelEligible: {},
      bySkipReason: {}
    };
    rows.forEach(r => {
      const reason = r.skipReason || 'UNKNOWN';
      summary.bySkipReason[reason] = (summary.bySkipReason[reason] || 0) + 1;
      if (r.applyEligible) {
        summary.eligible += 1;
        const src = r.sourceSystem || '(unknown)';
        summary.bySourceEligible[src] = (summary.bySourceEligible[src] || 0) + 1;
        const ml = r.matchLevel || '(none)';
        summary.byMatchLevelEligible[ml] = (summary.byMatchLevelEligible[ml] || 0) + 1;
      } else {
        summary.skipped += 1;
      }
    });
    return summary;
  }

  function runPreviewApply_() {
    const previewAt = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );

    Logger.log('[AuditDriveFolders] previewApply start sheet=%s', AUDIT_SHEET_NAME);

    const auditRows = readAuditSheetRows_();
    const staticPassed = [];
    auditRows.forEach(row => {
      if (!staticFilterAuditRow_(row)) {
        staticPassed.push(row);
      }
    });
    const duplicateFolderIds = buildDuplicateTargetSiteMap_(staticPassed);
    const sheetCache = createSheetContextCache_();

    const previewRows = auditRows.map(row =>
      previewOneAuditRow_(row, previewAt, sheetCache, duplicateFolderIds)
    );

    const writeResult = writePreviewApplySheet_(previewRows);
    const summary = summarizePreviewRows_(previewRows);

    Logger.log('[AuditDriveFolders] previewApply complete rows=%s sheet=%s', previewRows.length, writeResult.sheetName);
    Logger.log('[AuditDriveFolders] eligible=%s skipped=%s', summary.eligible, summary.skipped);
    Logger.log('[AuditDriveFolders] bySourceEligible: %s', JSON.stringify(summary.bySourceEligible));
    Logger.log('[AuditDriveFolders] byMatchLevelEligible: %s', JSON.stringify(summary.byMatchLevelEligible));
    Logger.log('[AuditDriveFolders] bySkipReason: %s', JSON.stringify(summary.bySkipReason));

    return {
      ok: true,
      previewAt: previewAt,
      auditSheetName: AUDIT_SHEET_NAME,
      previewSheetName: writeResult.sheetName,
      previewRowCount: previewRows.length,
      auditRowCount: auditRows.length,
      staticPassedCount: staticPassed.length,
      summary: summary
    };
  }

  function isTruthyEligible_(value) {
    if (value === true) {
      return true;
    }
    const s = String(value || '').trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === '1';
  }

  function readPreviewSheetRows_() {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    const sheet = ss.getSheetByName(PREVIEW_SHEET_NAME);
    if (!sheet) {
      throw new Error('プレビューシートが見つかりません: ' + PREVIEW_SHEET_NAME);
    }
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      return [];
    }
    const headers = values[0].map(h => String(h || '').trim());
    const colIndex = {};
    headers.forEach((h, i) => {
      colIndex[h] = i;
    });
    const missing = PREVIEW_HEADERS.filter(h => colIndex[h] === undefined);
    if (missing.length) {
      throw new Error('プレビューシートに不足列があります: ' + missing.join(', '));
    }
    const rows = [];
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i];
      const record = {};
      PREVIEW_HEADERS.forEach(h => {
        record[h] = row[colIndex[h]];
      });
      rows.push(record);
    }
    return rows;
  }

  function isPreviewRowApplyTarget_(previewRow) {
    if (!isTruthyEligible_(previewRow.applyEligible)) {
      return false;
    }
    if (String(previewRow.skipReason || '').trim() !== 'OK_ELIGIBLE') {
      return false;
    }
    if (!String(previewRow.suggestedDriveFolderId || '').trim()) {
      return false;
    }
    if (!normalizeSiteIdKey_(previewRow.siteId)) {
      return false;
    }
    if (APPLY_ALLOWED_SOURCE_SYSTEMS.indexOf(String(previewRow.sourceSystem || '').trim()) < 0) {
      return false;
    }
    if (
      !String(previewRow.spreadsheetId || '').trim() ||
      !String(previewRow.sheetName || '').trim() ||
      !String(previewRow.rowNumber || '').trim()
    ) {
      return false;
    }
    return true;
  }

  function isPreviewRowShokuninApplyTarget_(previewRow) {
    if (String(previewRow.sourceSystem || '').trim() !== SHOKUNIN_SOURCE_SYSTEM) {
      return false;
    }
    return isPreviewRowApplyTarget_(previewRow);
  }

  function invalidateSheetCache_(cache, spreadsheetId, sheetName) {
    const key = spreadsheetId + '|' + sheetName;
    if (cache[key]) {
      delete cache[key];
    }
  }

  function readLiveMasterRowFromPreview_(cache, previewRow) {
    return readLiveMasterRow_(cache, {
      spreadsheetId: previewRow.spreadsheetId,
      sheetName: previewRow.sheetName,
      rowNumber: previewRow.rowNumber
    });
  }

  function revalidatePreviewRowForApply_(previewRow, sheetCache) {
    const expectedCurrent = String(previewRow.driveFolderId_current_live || '').trim();
    const suggestedId = String(previewRow.suggestedDriveFolderId || '').trim();
    const siteId = String(previewRow.siteId || '').trim();
    const masterSiteName = String(previewRow.masterSiteName || '').trim();

    const live = readLiveMasterRowFromPreview_(sheetCache, previewRow);
    if (!live.ok) {
      return {
        ok: false,
        skipReason: isPermissionLikeError_(live.error) ? 'SKIP_PERMISSION_ERROR' : 'SKIP_ROW_DRIFT',
        oldDriveFolderId: expectedCurrent,
        siteName: masterSiteName,
        matchLevel: String(previewRow.matchLevel || '').trim()
      };
    }

    const auditSiteId = normalizeSiteIdKey_(siteId);
    const liveSiteId = normalizeSiteIdKey_(live.siteId);
    if (!liveSiteId || liveSiteId !== auditSiteId) {
      return {
        ok: false,
        skipReason: 'SKIP_ROW_DRIFT',
        oldDriveFolderId: live.driveFolderId,
        siteName: live.masterSiteName || masterSiteName,
        matchLevel: String(previewRow.matchLevel || '').trim()
      };
    }

    if (live.driveFolderId !== expectedCurrent) {
      return {
        ok: false,
        skipReason: 'SKIP_STALE_CURRENT',
        oldDriveFolderId: live.driveFolderId,
        siteName: live.masterSiteName || masterSiteName,
        matchLevel: String(previewRow.matchLevel || '').trim()
      };
    }

    if (live.driveFolderId === suggestedId) {
      return {
        ok: false,
        skipReason: 'SKIP_ALREADY_APPLIED',
        oldDriveFolderId: live.driveFolderId,
        siteName: live.masterSiteName || masterSiteName,
        matchLevel: String(previewRow.matchLevel || '').trim()
      };
    }

    const folderCheck = validateSuggestedFolder_(suggestedId, masterSiteName, siteId);
    if (!folderCheck.ok) {
      return {
        ok: false,
        skipReason: folderCheck.reason,
        oldDriveFolderId: live.driveFolderId,
        siteName: live.masterSiteName || masterSiteName,
        matchLevel: folderCheck.matchLevel || String(previewRow.matchLevel || '').trim()
      };
    }

    return {
      ok: true,
      skipReason: '',
      oldDriveFolderId: live.driveFolderId,
      siteName: live.masterSiteName || masterSiteName,
      matchLevel: folderCheck.matchLevel || String(previewRow.matchLevel || '').trim()
    };
  }

  function createSheetBackup_(spreadsheetId, sourceSheetName, backupSheetName) {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName(sourceSheetName);
    if (!sheet) {
      throw new Error('バックアップ元シートが見つかりません: ' + sourceSheetName);
    }
    const copy = sheet.copyTo(ss);
    copy.setName(backupSheetName);
    return backupSheetName;
  }

  function writeDriveFolderIdToRow_(previewRow) {
    const spreadsheetId = String(previewRow.spreadsheetId || '').trim();
    const sheetName = String(previewRow.sheetName || '').trim();
    const rowNumber = Number(previewRow.rowNumber);
    const newId = String(previewRow.suggestedDriveFolderId || '').trim();

    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return { ok: false, error: 'sheet_not_found' };
    }
    const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const cols = parseMasterHeaders_(headerRow);
    if (cols.driveCol < 0) {
      return { ok: false, error: 'drive_col_not_found' };
    }
    if (!rowNumber || rowNumber < 2) {
      return { ok: false, error: 'invalid_row_number' };
    }
    sheet.getRange(rowNumber, cols.driveCol + 1).setValue(newId);
    return { ok: true };
  }

  function getExecutedBy_() {
    try {
      const active = Session.getActiveUser().getEmail();
      if (active) {
        return active;
      }
    } catch (ignore) {
      // continue
    }
    try {
      return Session.getEffectiveUser().getEmail() || '';
    } catch (ignore2) {
      return '';
    }
  }

  function resolveBackupSheetName_(backupMap, spreadsheetId) {
    return backupMap[spreadsheetId] || '';
  }

  function sheetHasApplyLogHeader_(sheet) {
    if (sheet.getLastRow() < 1) {
      return false;
    }
    const first = String(sheet.getRange(1, 1).getValue() || '').trim();
    return first === APPLY_LOG_HEADERS[0];
  }

  function ensureApplyLogHeader_(sheet) {
    if (sheetHasApplyLogHeader_(sheet)) {
      return;
    }
    if (sheet.getLastRow() > 0) {
      sheet.insertRowBefore(1);
    }
    sheet.getRange(1, 1, 1, APPLY_LOG_HEADERS.length).setValues([APPLY_LOG_HEADERS]);
    sheet.setFrozenRows(1);
  }

  /**
   * 更新ログを指定シートに追記（ヘッダーとデータ行を分離、行数は data.length と厳密一致）
   * @param {Object[]} logRows
   * @param {string} sheetName
   */
  function appendApplyLogRowsToSheet_(logRows, sheetName) {
    if (!logRows || !logRows.length) {
      Logger.log(
        '[appendApplyLogRows] skip empty logRows sheet=%s',
        sheetName || APPLY_LOG_SHEET_NAME
      );
      return { sheetName: sheetName || APPLY_LOG_SHEET_NAME, rowCount: 0 };
    }

    const targetSheetName = sheetName || APPLY_LOG_SHEET_NAME;
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    let sheet = ss.getSheetByName(targetSheetName);
    if (!sheet) {
      sheet = ss.insertSheet(targetSheetName);
    }

    ensureApplyLogHeader_(sheet);

    const data = logRows.map(r => APPLY_LOG_HEADERS.map(h => (r[h] != null ? r[h] : '')));
    const rangeRows = data.length;
    const rangeCols = APPLY_LOG_HEADERS.length;
    const startRow = sheet.getLastRow() + 1;
    const endRow = startRow + rangeRows - 1;

    Logger.log(
      '[appendApplyLogRows] data.length=%s logRows.length=%s headers.length=%s startRow=%s rangeRows=%s rangeCols=%s endRow=%s sheet=%s',
      data.length,
      logRows.length,
      APPLY_LOG_HEADERS.length,
      startRow,
      rangeRows,
      rangeCols,
      endRow,
      targetSheetName
    );

    if (rangeRows < 1) {
      return { sheetName: targetSheetName, rowCount: 0 };
    }

    // getRange(row, column, numRows, numColumns) — 第3引数は終了行ではなく行数
    sheet.getRange(startRow, 1, rangeRows, rangeCols).setValues(data);
    return { sheetName: targetSheetName, rowCount: logRows.length };
  }

  function appendApplyLogRows_(logRows) {
    return appendApplyLogRowsToSheet_(logRows, APPLY_LOG_SHEET_NAME);
  }

  function buildApplyLogRow_(previewRow, runId, updatedAt, executedBy, backupMap, reval, applyResult, skipReason) {
    const spreadsheetId = String(previewRow.spreadsheetId || '').trim();
    return {
      updatedAt: updatedAt,
      runId: runId,
      sourceSystem: String(previewRow.sourceSystem || '').trim(),
      spreadsheetId: spreadsheetId,
      sheetName: String(previewRow.sheetName || '').trim(),
      rowNumber: previewRow.rowNumber,
      siteId: String(previewRow.siteId || '').trim(),
      siteName: (reval && reval.siteName) || String(previewRow.masterSiteName || '').trim(),
      oldDriveFolderId: (reval && reval.oldDriveFolderId) || String(previewRow.driveFolderId_current_live || '').trim(),
      newDriveFolderId:
        applyResult === 'APPLIED' ? String(previewRow.suggestedDriveFolderId || '').trim() : '',
      suggestedDriveFolderId: String(previewRow.suggestedDriveFolderId || '').trim(),
      auditStatus: APPLY_AUDIT_STATUS,
      executedBy: executedBy,
      applyResult: applyResult,
      skipReason: skipReason || '',
      auditAt: String(previewRow.auditAt || '').trim(),
      backupSheetName: resolveBackupSheetName_(backupMap, spreadsheetId),
      matchLevel: (reval && reval.matchLevel) || String(previewRow.matchLevel || '').trim()
    };
  }

  function runApplyExecute_(maxRowsOverride) {
    const maxRows =
      maxRowsOverride != null && maxRowsOverride !== ''
        ? Number(maxRowsOverride)
        : APPLY_MAX_ROWS;
    if (!maxRows || maxRows < 1) {
      throw new Error('APPLY_MAX_ROWS が無効です: ' + maxRows);
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw new Error('別のDriveFolderId適用処理が実行中です。しばらく待ってから再実行してください。');
    }

    try {
      const tz = Session.getScriptTimeZone();
      const runId = Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
      const updatedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
      const executedBy = getExecutedBy_();

      Logger.log('[AuditDriveFolders] applyExecute start runId=%s maxRows=%s', runId, maxRows);

      const previewRows = readPreviewSheetRows_();
      const eligibleRows = previewRows.filter(isPreviewRowApplyTarget_);
      const targetRows = eligibleRows.slice(0, maxRows);

      Logger.log(
        '[AuditDriveFolders] previewRows=%s eligible=%s targetRows=%s',
        previewRows.length,
        eligibleRows.length,
        targetRows.length
      );

      if (!targetRows.length) {
        Logger.log('[AuditDriveFolders] applyExecute: 更新対象がありません');
        return {
          ok: true,
          runId: runId,
          targetRows: 0,
          applied: 0,
          skipped: 0,
          failed: 0,
          bySourceApplied: {},
          backupSheetNames: {},
          applyMaxRows: maxRows,
          message: 'no_targets'
        };
      }

      const needsShokunin = targetRows.some(
        r => String(r.sourceSystem || '').trim() === '職人進捗管理'
      );
      const needsKanri = targetRows.some(
        r => String(r.sourceSystem || '').trim() === '現場管理フォーム'
      );

      const backupSheetNames = {};
      if (needsShokunin) {
        const name = SHOKUNIN_MASTER_SHEET_NAME + '_backup_' + runId;
        backupSheetNames[APP_CONFIG.spreadsheetId] = createSheetBackup_(
          APP_CONFIG.spreadsheetId,
          SHOKUNIN_MASTER_SHEET_NAME,
          name
        );
      }
      if (needsKanri) {
        const name = KANRI_MASTER_SHEET_NAME + '_backup_' + runId;
        backupSheetNames[KANRI_SPREADSHEET_ID] = createSheetBackup_(
          KANRI_SPREADSHEET_ID,
          KANRI_MASTER_SHEET_NAME,
          name
        );
      }

      const sheetCache = createSheetContextCache_();
      const logRows = [];
      let applied = 0;
      let skipped = 0;
      let failed = 0;
      const bySourceApplied = {};
      let shokuninUpdated = false;

      targetRows.forEach(previewRow => {
        const reval = revalidatePreviewRowForApply_(previewRow, sheetCache);
        if (!reval.ok) {
          logRows.push(
            buildApplyLogRow_(
              previewRow,
              runId,
              updatedAt,
              executedBy,
              backupSheetNames,
              reval,
              'SKIPPED',
              reval.skipReason
            )
          );
          skipped += 1;
          return;
        }

        try {
          const writeResult = writeDriveFolderIdToRow_(previewRow);
          if (!writeResult.ok) {
            logRows.push(
              buildApplyLogRow_(
                previewRow,
                runId,
                updatedAt,
                executedBy,
                backupSheetNames,
                reval,
                'FAILED',
                writeResult.error || 'write_failed'
              )
            );
            failed += 1;
            return;
          }

          invalidateSheetCache_(sheetCache, previewRow.spreadsheetId, previewRow.sheetName);

          if (String(previewRow.sourceSystem || '').trim() === '職人進捗管理') {
            shokuninUpdated = true;
          }

          logRows.push(
            buildApplyLogRow_(
              previewRow,
              runId,
              updatedAt,
              executedBy,
              backupSheetNames,
              reval,
              'APPLIED',
              ''
            )
          );
          applied += 1;
          const src = String(previewRow.sourceSystem || '').trim();
          bySourceApplied[src] = (bySourceApplied[src] || 0) + 1;
        } catch (e) {
          logRows.push(
            buildApplyLogRow_(
              previewRow,
              runId,
              updatedAt,
              executedBy,
              backupSheetNames,
              reval,
              'FAILED',
              String(e.message || e)
            )
          );
          failed += 1;
        }
      });

      if (shokuninUpdated) {
        MasterDataService.invalidateSites();
      }

      const logWrite = appendApplyLogRows_(logRows);

      Logger.log('[AuditDriveFolders] applyExecute complete runId=%s', runId);
      Logger.log('[AuditDriveFolders] targetRows=%s applied=%s skipped=%s failed=%s', targetRows.length, applied, skipped, failed);
      Logger.log('[AuditDriveFolders] bySourceApplied: %s', JSON.stringify(bySourceApplied));
      Logger.log('[AuditDriveFolders] backupSheetNames: %s', JSON.stringify(backupSheetNames));
      Logger.log('[AuditDriveFolders] applyLog sheet=%s rows=%s', logWrite.sheetName, logWrite.rowCount);

      return {
        ok: true,
        runId: runId,
        updatedAt: updatedAt,
        targetRows: targetRows.length,
        eligibleRows: eligibleRows.length,
        applied: applied,
        skipped: skipped,
        failed: failed,
        bySourceApplied: bySourceApplied,
        backupSheetNames: backupSheetNames,
        applyMaxRows: maxRows,
        applyLogSheetName: logWrite.sheetName,
        applyLogRowCount: logWrite.rowCount
      };
    } finally {
      lock.releaseLock();
    }
  }

  function runApplyShokuninOnlyExecute_(maxRowsOverride) {
    const maxRows =
      maxRowsOverride != null && maxRowsOverride !== ''
        ? Number(maxRowsOverride)
        : MAX_SHOKUNIN_APPLY_ROWS;
    if (!maxRows || maxRows < 1) {
      throw new Error('MAX_SHOKUNIN_APPLY_ROWS が無効です: ' + maxRows);
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw new Error('別のDriveFolderId適用処理が実行中です。しばらく待ってから再実行してください。');
    }

    try {
      const tz = Session.getScriptTimeZone();
      const runId = Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
      const updatedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
      const executedBy = getExecutedBy_();

      Logger.log(
        '[AuditDriveFolders] applyShokuninOnly start runId=%s maxRows=%s',
        runId,
        maxRows
      );

      const previewRows = readPreviewSheetRows_();
      const eligibleRows = previewRows.filter(isPreviewRowShokuninApplyTarget_);
      const targetRows = eligibleRows.slice(0, maxRows);

      Logger.log(
        '[AuditDriveFolders] previewRows=%s shokuninEligible=%s targetRows=%s',
        previewRows.length,
        eligibleRows.length,
        targetRows.length
      );

      if (!targetRows.length) {
        Logger.log('[AuditDriveFolders] applyShokuninOnly: 更新対象がありません');
        return {
          ok: true,
          runId: runId,
          targetRows: 0,
          applied: 0,
          skipped: 0,
          failed: 0,
          shokuninEligibleRows: eligibleRows.length,
          backupSheetNames: {},
          applyMaxRows: maxRows,
          message: 'no_targets'
        };
      }

      const backupSheetNames = {};
      const backupName = SHOKUNIN_MASTER_SHEET_NAME + '_backup_shokuninOnly_' + runId;
      backupSheetNames[APP_CONFIG.spreadsheetId] = createSheetBackup_(
        APP_CONFIG.spreadsheetId,
        SHOKUNIN_MASTER_SHEET_NAME,
        backupName
      );

      const sheetCache = createSheetContextCache_();
      const logRows = [];
      let applied = 0;
      let skipped = 0;
      let failed = 0;
      let shokuninUpdated = false;

      targetRows.forEach(previewRow => {
        const reval = revalidatePreviewRowForApply_(previewRow, sheetCache);
        if (!reval.ok) {
          logRows.push(
            buildApplyLogRow_(
              previewRow,
              runId,
              updatedAt,
              executedBy,
              backupSheetNames,
              reval,
              'SKIPPED',
              reval.skipReason
            )
          );
          skipped += 1;
          return;
        }

        try {
          const writeResult = writeDriveFolderIdToRow_(previewRow);
          if (!writeResult.ok) {
            logRows.push(
              buildApplyLogRow_(
                previewRow,
                runId,
                updatedAt,
                executedBy,
                backupSheetNames,
                reval,
                'FAILED',
                writeResult.error || 'write_failed'
              )
            );
            failed += 1;
            return;
          }

          invalidateSheetCache_(sheetCache, previewRow.spreadsheetId, previewRow.sheetName);
          shokuninUpdated = true;

          logRows.push(
            buildApplyLogRow_(
              previewRow,
              runId,
              updatedAt,
              executedBy,
              backupSheetNames,
              reval,
              'APPLIED',
              ''
            )
          );
          applied += 1;
        } catch (e) {
          logRows.push(
            buildApplyLogRow_(
              previewRow,
              runId,
              updatedAt,
              executedBy,
              backupSheetNames,
              reval,
              'FAILED',
              String(e.message || e)
            )
          );
          failed += 1;
        }
      });

      if (shokuninUpdated) {
        MasterDataService.invalidateSites();
      }

      const logWrite = appendApplyLogRows_(logRows);

      Logger.log('[AuditDriveFolders] applyShokuninOnly complete runId=%s', runId);
      Logger.log(
        '[AuditDriveFolders] targetRows=%s applied=%s skipped=%s failed=%s',
        targetRows.length,
        applied,
        skipped,
        failed
      );
      Logger.log('[AuditDriveFolders] backupSheetNames: %s', JSON.stringify(backupSheetNames));
      Logger.log('[AuditDriveFolders] applyLog sheet=%s rows=%s', logWrite.sheetName, logWrite.rowCount);

      return {
        ok: true,
        runId: runId,
        updatedAt: updatedAt,
        targetRows: targetRows.length,
        shokuninEligibleRows: eligibleRows.length,
        applied: applied,
        skipped: skipped,
        failed: failed,
        backupSheetNames: backupSheetNames,
        applyMaxRows: maxRows,
        applyLogSheetName: logWrite.sheetName,
        applyLogRowCount: logWrite.rowCount
      };
    } finally {
      lock.releaseLock();
    }
  }

  function canSuggestSetCLight_(masterRow, candidateInfo, matchLevel, currentId) {
    if (candidateInfo.candidateCount !== 1 || !candidateInfo.photoRoot_candidateId) {
      return false;
    }
    if (String(currentId || '').trim() === String(candidateInfo.photoRoot_candidateId).trim()) {
      return false;
    }
    const siteIdKey = normalizeSiteIdKey_(masterRow.siteId);
    const suffix = SiteDriveFolderGuard.extractSiteIdFromFolderName_(
      candidateInfo.photoRoot_candidateName
    );
    if (siteIdKey && suffix === siteIdKey) {
      return true;
    }
    const ml = String(matchLevel || '').trim();
    return ml === 'L3' || ml === 'L4';
  }

  function resolveLightSuggestedAction_(auditStatus, masterRow, candidateInfo, matchLevel, currentId) {
    if (!masterRow.siteId && !masterRow.masterSiteName && !currentId) {
      return { suggestedAction: 'SKIP', suggestedDriveFolderId: '' };
    }
    if (auditStatus === 'OK_LIGHT') {
      return { suggestedAction: 'NO_CHANGE', suggestedDriveFolderId: '' };
    }
    if (canSuggestSetCLight_(masterRow, candidateInfo, matchLevel, currentId)) {
      return {
        suggestedAction: 'SET_C',
        suggestedDriveFolderId: candidateInfo.photoRoot_candidateId
      };
    }
    if (
      auditStatus === 'C_DUPLICATE_CANDIDATE_LIGHT' ||
      auditStatus === 'C_NAME_MISMATCH_LIGHT' ||
      auditStatus === 'C_NOT_IN_PHOTO_ROOT_LIGHT' ||
      auditStatus === 'MASTER_NO_DRIVE_LIGHT'
    ) {
      return { suggestedAction: 'MANUAL_REVIEW', suggestedDriveFolderId: '' };
    }
    return { suggestedAction: 'MANUAL_REVIEW', suggestedDriveFolderId: '' };
  }

  function auditOneSiteLight_(masterRow, index, auditAt) {
    const currentId = String(masterRow.driveFolderId || '').trim();
    const candidateInfo = findPhotoRootCandidates_(masterRow, index);
    const candidateCount = candidateInfo.candidateCount;
    const inPhotoRoot = !!(currentId && index.byId[currentId]);
    const notes = [];
    let auditStatus = 'C_NOT_IN_PHOTO_ROOT_LIGHT';
    let matchLevel = candidateInfo.matchLevel || 'none';

    if (!currentId) {
      if (candidateCount === 0) {
        auditStatus = 'MASTER_NO_DRIVE_LIGHT';
        notes.push('C列空・PHOTO_ROOT候補なし');
      } else if (candidateCount === 1) {
        auditStatus = 'C_EMPTY_LIGHT';
        notes.push('C列空・PHOTO_ROOT候補1件');
      } else {
        auditStatus = 'C_DUPLICATE_CANDIDATE_LIGHT';
        notes.push('C列空・PHOTO_ROOT候補' + candidateCount + '件');
      }
    } else if (inPhotoRoot) {
      const folderEntry = index.byId[currentId];
      const nameMatch = SiteDriveFolderGuard.evaluateSiteFolderNameMatch_(
        folderEntry.folderName,
        masterRow.masterSiteName,
        masterRow.siteId
      );
      matchLevel = nameMatch.ok ? nameMatch.level : 'none';
      if (nameMatch.ok) {
        auditStatus = 'OK_LIGHT';
        notes.push('C列IDがPHOTO_ROOT直下かつ現場名一致');
      } else {
        auditStatus = 'C_NAME_MISMATCH_LIGHT';
        notes.push('C列IDはPHOTO_ROOT直下だが現場名不一致');
      }
    } else if (candidateCount === 1) {
      auditStatus = 'SUGGEST_UPDATE_LIGHT';
      matchLevel = candidateInfo.matchLevel || matchLevel;
      notes.push('C列IDがPHOTO_ROOT直下一覧に無い・候補1件');
    } else if (candidateCount === 0) {
      auditStatus = 'C_NOT_IN_PHOTO_ROOT_LIGHT';
      notes.push('C列IDがPHOTO_ROOT直下一覧に無い・候補なし');
    } else {
      auditStatus = 'C_DUPLICATE_CANDIDATE_LIGHT';
      notes.push('PHOTO_ROOT候補' + candidateCount + '件');
    }

    const action = resolveLightSuggestedAction_(
      auditStatus,
      masterRow,
      candidateInfo,
      matchLevel,
      currentId
    );

    return {
      auditAt: auditAt,
      sourceSystem: masterRow.sourceSystem,
      spreadsheetId: masterRow.spreadsheetId,
      sheetName: masterRow.sheetName,
      rowNumber: masterRow.rowNumber,
      siteId: masterRow.siteId,
      masterSiteName: masterRow.masterSiteName,
      driveFolderId_current: currentId,
      auditStatus: auditStatus,
      currentIdInPhotoRoot: inPhotoRoot,
      photoRoot_candidateId: candidateInfo.photoRoot_candidateId || '',
      photoRoot_candidateName: candidateInfo.photoRoot_candidateName || '',
      candidateCount: candidateCount,
      matchLevel: matchLevel,
      suggestedAction: action.suggestedAction,
      suggestedDriveFolderId: action.suggestedDriveFolderId,
      notes: notes.join('; ')
    };
  }

  function writeLightAuditSheet_(rows) {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    let sheet = ss.getSheetByName(LIGHT_AUDIT_SHEET_NAME);
    if (sheet) {
      sheet.clear();
    } else {
      sheet = ss.insertSheet(LIGHT_AUDIT_SHEET_NAME);
    }
    const data = [LIGHT_AUDIT_HEADERS];
    rows.forEach(r => {
      data.push(LIGHT_AUDIT_HEADERS.map(h => (r[h] != null ? r[h] : '')));
    });
    if (data.length > 0) {
      sheet.getRange(1, 1, data.length, LIGHT_AUDIT_HEADERS.length).setValues(data);
      sheet.setFrozenRows(1);
    }
    return { sheetName: LIGHT_AUDIT_SHEET_NAME, rowCount: rows.length };
  }

  function readLightAuditSheetRows_() {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    const sheet = ss.getSheetByName(LIGHT_AUDIT_SHEET_NAME);
    if (!sheet) {
      throw new Error('LIGHT監査シートが見つかりません: ' + LIGHT_AUDIT_SHEET_NAME);
    }
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      return [];
    }
    const headers = values[0].map(h => String(h || '').trim());
    const colIndex = {};
    headers.forEach((h, i) => {
      colIndex[h] = i;
    });
    const missing = LIGHT_AUDIT_HEADERS.filter(h => colIndex[h] === undefined);
    if (missing.length) {
      throw new Error('LIGHT監査シートに不足列があります: ' + missing.join(', '));
    }
    const rows = [];
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i];
      const record = {};
      LIGHT_AUDIT_HEADERS.forEach(h => {
        record[h] = row[colIndex[h]];
      });
      rows.push(record);
    }
    return rows;
  }

  function writeManualReviewSheet_(rows) {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    let sheet = ss.getSheetByName(MANUAL_REVIEW_SHEET_NAME);
    if (sheet) {
      sheet.clear();
    } else {
      sheet = ss.insertSheet(MANUAL_REVIEW_SHEET_NAME);
    }
    const data = [MANUAL_REVIEW_HEADERS];
    rows.forEach(r => {
      data.push(MANUAL_REVIEW_HEADERS.map(h => (r[h] != null ? r[h] : '')));
    });
    if (data.length > 0) {
      sheet.getRange(1, 1, data.length, MANUAL_REVIEW_HEADERS.length).setValues(data);
      sheet.setFrozenRows(1);
    }
    return { sheetName: MANUAL_REVIEW_SHEET_NAME, rowCount: rows.length };
  }

  function runBuildManualReviewSheet_() {
    const lightRows = readLightAuditSheetRows_();
    const targets = lightRows.filter(r => String(r.auditStatus || '').trim() !== 'OK_LIGHT');

    Logger.log(
      '[AuditDriveFolders] manualReview build start LIGHT rows=%s targets=%s',
      lightRows.length,
      targets.length
    );

    const resultRows = targets.map(r => ({
      sourceSystem: r.sourceSystem || '',
      siteId: r.siteId || '',
      masterSiteName: r.masterSiteName || '',
      driveFolderId_current: r.driveFolderId_current || '',
      auditStatus: r.auditStatus || '',
      currentIdInPhotoRoot: r.currentIdInPhotoRoot || '',
      photoRoot_candidateId: r.photoRoot_candidateId || '',
      photoRoot_candidateName: r.photoRoot_candidateName || '',
      candidateCount: r.candidateCount || '',
      matchLevel: r.matchLevel || '',
      suggestedAction: r.suggestedAction || '',
      suggestedDriveFolderId: r.suggestedDriveFolderId || '',
      notes: r.notes || '',
      reviewDecision: '',
      finalDriveFolderId: '',
      reviewerNote: ''
    }));

    const writeResult = writeManualReviewSheet_(resultRows);

    Logger.log(
      '[AuditDriveFolders] manualReview build complete sheet=%s rows=%s',
      writeResult.sheetName,
      writeResult.rowCount
    );

    return {
      ok: true,
      lightRowCount: lightRows.length,
      targetRowCount: targets.length,
      sheetName: writeResult.sheetName
    };
  }

  function readManualReviewSheetRows_() {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    const sheet = ss.getSheetByName(MANUAL_REVIEW_SHEET_NAME);
    if (!sheet) {
      throw new Error('手動確認リストが見つかりません: ' + MANUAL_REVIEW_SHEET_NAME);
    }
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      return [];
    }
    const headers = values[0].map(h => String(h || '').trim());
    const colIndex = {};
    headers.forEach((h, i) => {
      colIndex[h] = i;
    });
    const missing = MANUAL_REVIEW_HEADERS.filter(h => colIndex[h] === undefined);
    if (missing.length) {
      throw new Error('手動確認リストに不足列があります: ' + missing.join(', '));
    }
    const rows = [];
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i];
      const record = {};
      MANUAL_REVIEW_HEADERS.forEach(h => {
        record[h] = row[colIndex[h]];
      });
      rows.push(record);
    }
    return rows;
  }

  function readManualReviewSheetContext_() {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    const sheet = ss.getSheetByName(MANUAL_REVIEW_SHEET_NAME);
    if (!sheet) {
      throw new Error('手動確認リストが見つかりません: ' + MANUAL_REVIEW_SHEET_NAME);
    }
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      return { sheet: sheet, colIndex: {}, rows: [] };
    }
    const headers = values[0].map(h => String(h || '').trim());
    const colIndex = {};
    headers.forEach((h, i) => {
      colIndex[h] = i;
    });
    const missing = MANUAL_REVIEW_HEADERS.filter(h => colIndex[h] === undefined);
    if (missing.length) {
      throw new Error('手動確認リストに不足列があります: ' + missing.join(', '));
    }
    const rows = [];
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i];
      const record = { sheetRowNumber: i + 1 };
      MANUAL_REVIEW_HEADERS.forEach(h => {
        record[h] = row[colIndex[h]];
      });
      rows.push(record);
    }
    return { sheet: sheet, colIndex: colIndex, rows: rows };
  }

  function applyManualReviewDecisionUpdates_(sheet, colIndex, updates) {
    if (!updates || !updates.length) {
      return 0;
    }
    const reviewCol = colIndex.reviewDecision + 1;
    const finalCol = colIndex.finalDriveFolderId + 1;
    const noteCol = colIndex.reviewerNote + 1;
    updates.forEach(u => {
      const rowNum = u.sheetRowNumber;
      if (u.reviewDecision != null) {
        sheet.getRange(rowNum, reviewCol).setValue(u.reviewDecision);
      }
      if (u.finalDriveFolderId != null) {
        sheet.getRange(rowNum, finalCol).setValue(u.finalDriveFolderId);
      }
      if (u.reviewerNote != null) {
        sheet.getRange(rowNum, noteCol).setValue(u.reviewerNote);
      }
    });
    return updates.length;
  }

  function isAutoMarkManualReviewTarget_(row) {
    const auditStatus = String(row.auditStatus || '').trim();
    if (auditStatus === 'C_DUPLICATE_CANDIDATE_LIGHT' || auditStatus === 'C_NAME_MISMATCH_LIGHT') {
      return false;
    }
    if (auditStatus !== 'C_NOT_IN_PHOTO_ROOT_LIGHT') {
      return false;
    }
    const decision = String(row.reviewDecision || '').trim();
    if (decision && decision !== 'MANUAL_REVIEW') {
      return false;
    }
    if (!String(row.driveFolderId_current || '').trim()) {
      return false;
    }
    if (!normalizeSiteIdKey_(row.siteId)) {
      return false;
    }
    return true;
  }

  function folderHasAutoMarkSiteStructure_(folder) {
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      const name = subfolders.next().getName();
      if (AUTO_MARK_SITE_STRUCTURE_NAMES_.indexOf(name) >= 0) {
        return true;
      }
    }
    return false;
  }

  function folderNameMatchesSiteForAutoMark_(folderName, masterSiteName, siteId) {
    const match = SiteDriveFolderGuard.evaluateSiteFolderNameMatch_(
      folderName,
      masterSiteName,
      siteId
    );
    if (match.ok) {
      return true;
    }
    const siteIdKey = normalizeSiteIdKey_(siteId);
    const suffix = SiteDriveFolderGuard.extractSiteIdFromFolderName_(folderName);
    if (siteIdKey && suffix === siteIdKey) {
      return true;
    }
    if (siteIdKey && String(folderName || '').toUpperCase().indexOf(siteIdKey) >= 0) {
      return true;
    }
    return false;
  }

  function evaluateAutoMarkManualReviewRow_(row, photoRootIndex) {
    const currentId = String(row.driveFolderId_current || '').trim();
    const siteId = String(row.siteId || '').trim();
    const masterSiteName = String(row.masterSiteName || '').trim();
    const existingDecision = String(row.reviewDecision || '').trim();

    let folder;
    try {
      folder = DriveApp.getFolderById(currentId);
    } catch (e) {
      return {
        autoMark: false,
        reason: 'フォルダを開けないため保留',
        setManualHold: !existingDecision,
        updateNoteOnly: !!existingDecision
      };
    }

    const folderName = folder.getName();
    const has08 = folderHasDirectSubfolderByName_(folder, '08_職人報告');
    const hasStructure = folderHasAutoMarkSiteStructure_(folder);
    if (!has08 && !hasStructure) {
      return {
        autoMark: false,
        reason: '現場フォルダ構成が確認できないため保留',
        setManualHold: !existingDecision,
        updateNoteOnly: !!existingDecision
      };
    }

    const duplicateNames = findPhotoRootDuplicateNames_(
      currentId,
      folderName,
      masterSiteName,
      siteId,
      photoRootIndex
    );
    if (duplicateNames.length > 0) {
      return {
        autoMark: false,
        reason: 'PHOTO_ROOT側に重複候補あり',
        setManualHold: !existingDecision,
        updateNoteOnly: !!existingDecision
      };
    }

    if (!folderNameMatchesSiteForAutoMark_(folderName, masterSiteName, siteId)) {
      return {
        autoMark: false,
        reason: '現場名とフォルダ名が一致しないため保留',
        setManualHold: !existingDecision,
        updateNoteOnly: !!existingDecision
      };
    }

    return {
      autoMark: true,
      reason: '',
      reviewDecision: REVIEW_DECISION_MOVE_TO_PHOTO_ROOT,
      finalDriveFolderId: currentId,
      reviewerNote: AUTO_MARK_SUCCESS_REVIEWER_NOTE
    };
  }

  function runAutoMarkMoveExistingFoldersInManualReview_() {
    Logger.log('[AuditDriveFolders] autoMark manualReview start');

    const ctx = readManualReviewSheetContext_();
    const allRows = ctx.rows;
    const targets = allRows.filter(isAutoMarkManualReviewTarget_);
    const skippedCount = allRows.length - targets.length;

    Logger.log(
      '[AuditDriveFolders] manualReview rows=%s targets=%s skipped=%s',
      allRows.length,
      targets.length,
      skippedCount
    );

    const photoFolders = listPhotoRootFolders_();
    const photoRootIndex = buildPhotoRootFolderIndex_(photoFolders);

    const updates = [];
    let autoMarkedCount = 0;
    let manualHoldCount = 0;
    const reasonSummary = {};

    targets.forEach(row => {
      const result = evaluateAutoMarkManualReviewRow_(row, photoRootIndex);
      if (result.autoMark) {
        updates.push({
          sheetRowNumber: row.sheetRowNumber,
          reviewDecision: result.reviewDecision,
          finalDriveFolderId: result.finalDriveFolderId,
          reviewerNote: result.reviewerNote
        });
        autoMarkedCount += 1;
        return;
      }

      const reason = result.reason || '保留';
      reasonSummary[reason] = (reasonSummary[reason] || 0) + 1;

      if (result.setManualHold) {
        updates.push({
          sheetRowNumber: row.sheetRowNumber,
          reviewDecision: REVIEW_DECISION_MANUAL_HOLD,
          finalDriveFolderId: '',
          reviewerNote: reason
        });
        manualHoldCount += 1;
      } else if (result.updateNoteOnly) {
        updates.push({
          sheetRowNumber: row.sheetRowNumber,
          reviewDecision: null,
          finalDriveFolderId: null,
          reviewerNote: reason
        });
      }
    });

    const updatedCount = applyManualReviewDecisionUpdates_(ctx.sheet, ctx.colIndex, updates);

    Logger.log('[AuditDriveFolders] autoMarked=%s manualHold=%s updatedCells=%s', autoMarkedCount, manualHoldCount, updatedCount);
    Logger.log('[AuditDriveFolders] reason summary: %s', JSON.stringify(reasonSummary));

    return {
      ok: true,
      sheetName: MANUAL_REVIEW_SHEET_NAME,
      totalRows: allRows.length,
      targetCount: targets.length,
      autoMarkedCount: autoMarkedCount,
      manualHoldCount: manualHoldCount,
      skippedCount: skippedCount,
      updatedRowCount: updates.length,
      reasonSummary: reasonSummary
    };
  }

  function isMoveToPhotoRootDryRunTarget_(row) {
    if (String(row.reviewDecision || '').trim() !== REVIEW_DECISION_MOVE_TO_PHOTO_ROOT) {
      return false;
    }
    const finalId = String(row.finalDriveFolderId || '').trim();
    const currentId = String(row.driveFolderId_current || '').trim();
    if (!finalId || finalId !== currentId) {
      return false;
    }
    if (!normalizeSiteIdKey_(row.siteId)) {
      return false;
    }
    return true;
  }

  function folderHasDirectSubfolderByName_(folder, subfolderName) {
    const it = folder.getFoldersByName(subfolderName);
    return it.hasNext();
  }

  function folderHasSiteStructure_(folder) {
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      const name = subfolders.next().getName();
      if (SITE_STRUCTURE_EXACT_NAMES_.indexOf(name) >= 0) {
        return true;
      }
      if (/^0[0-7]_/.test(name)) {
        return true;
      }
    }
    return false;
  }

  function findPhotoRootDuplicateNames_(folderId, folderName, masterSiteName, siteId, index) {
    const siteIdKey = normalizeSiteIdKey_(siteId);
    const norm = UtilitiesEx.normalizeName(folderName);
    const masterNorm = UtilitiesEx.normalizeName(masterSiteName);
    const found = {};
    const add = name => {
      if (name) {
        found[name] = true;
      }
    };

    index.all.forEach(f => {
      if (f.folderId === folderId) {
        return;
      }
      if (siteIdKey && f.siteIdSuffix === siteIdKey) {
        add(f.folderName);
      }
      if (norm && f.normalizedName === norm) {
        add(f.folderName);
      }
      if (masterNorm && f.normalizedName === masterNorm) {
        add(f.folderName);
      }
      const match = SiteDriveFolderGuard.evaluateSiteFolderNameMatch_(
        f.folderName,
        masterSiteName,
        siteId
      );
      if (match.ok) {
        add(f.folderName);
      }
    });

    return Object.keys(found);
  }

  function resolveMoveDryRunResult_(moveStatus) {
    if (moveStatus === 'ALREADY_IN_PHOTO_ROOT') {
      return 'NO_CHANGE';
    }
    if (moveStatus === 'MOVE_CANDIDATE') {
      return 'MOVE_TO_PHOTO_ROOT';
    }
    if (moveStatus === 'DUPLICATE_IN_PHOTO_ROOT' || moveStatus === 'MISSING_SITE_STRUCTURE') {
      return 'MANUAL_REVIEW';
    }
    if (moveStatus === 'INVALID_FOLDER_ID') {
      return 'SKIP';
    }
    return 'MANUAL_REVIEW';
  }

  function auditOneMoveToPhotoRootDryRun_(manualRow, photoRootIndex, checkedAt) {
    const folderId = String(manualRow.finalDriveFolderId || '').trim();
    const siteId = String(manualRow.siteId || '').trim();
    const masterSiteName = String(manualRow.masterSiteName || '').trim();
    const notes = [];

    const base = {
      checkedAt: checkedAt,
      sourceSystem: String(manualRow.sourceSystem || '').trim(),
      siteId: siteId,
      masterSiteName: masterSiteName,
      folderId: folderId,
      folderName: '',
      currentParentId: '',
      currentParentName: '',
      has08Shokunin: false,
      hasSiteStructure: false,
      duplicateInPhotoRoot: false,
      duplicateCandidateNames: '',
      moveStatus: 'MANUAL_REVIEW',
      suggestedAction: 'MANUAL_REVIEW',
      notes: ''
    };

    let folder;
    try {
      folder = DriveApp.getFolderById(folderId);
      base.folderName = folder.getName();
    } catch (e) {
      base.moveStatus = 'INVALID_FOLDER_ID';
      base.suggestedAction = resolveMoveDryRunResult_(base.moveStatus);
      base.notes = String(e.message || e);
      return base;
    }

    const parent = getFolderParentInfo_(folder);
    base.currentParentId = parent.parentFolderId || '';
    base.currentParentName = parent.parentFolderName || '';
    if (parent.error) {
      notes.push('parent_error:' + parent.error);
    }

    base.has08Shokunin = folderHasDirectSubfolderByName_(folder, '08_職人報告');
    base.hasSiteStructure = folderHasSiteStructure_(folder);

    const duplicateNames = findPhotoRootDuplicateNames_(
      folderId,
      base.folderName,
      masterSiteName,
      siteId,
      photoRootIndex
    );
    base.duplicateInPhotoRoot = duplicateNames.length > 0;
    base.duplicateCandidateNames = duplicateNames.join(' | ');

    if (base.currentParentId === PHOTO_ROOT_FOLDER_ID) {
      base.moveStatus = 'ALREADY_IN_PHOTO_ROOT';
      notes.push('親がPHOTO_ROOT直下');
    } else if (base.duplicateInPhotoRoot) {
      base.moveStatus = 'DUPLICATE_IN_PHOTO_ROOT';
      notes.push('PHOTO_ROOT直下に同名または同SITE-ID候補あり');
    } else if (!base.has08Shokunin && !base.hasSiteStructure) {
      base.moveStatus = 'MISSING_SITE_STRUCTURE';
      notes.push('08_職人報告も00_〜07_系構成も見つからない');
    } else {
      base.moveStatus = 'MOVE_CANDIDATE';
      notes.push('PHOTO_ROOT外から移動候補');
      if (base.has08Shokunin) {
        notes.push('08_職人報告あり');
      }
      if (base.hasSiteStructure) {
        notes.push('現場フォルダ構成あり');
      }
    }

    base.suggestedAction = resolveMoveDryRunResult_(base.moveStatus);
    base.notes = notes.join('; ');
    return base;
  }

  function writeMoveToPhotoRootDryRunSheet_(rows) {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    let sheet = ss.getSheetByName(MOVE_TO_PHOTO_ROOT_DRY_RUN_SHEET_NAME);
    if (sheet) {
      sheet.clear();
    } else {
      sheet = ss.insertSheet(MOVE_TO_PHOTO_ROOT_DRY_RUN_SHEET_NAME);
    }
    const data = [MOVE_TO_PHOTO_ROOT_DRY_RUN_HEADERS];
    rows.forEach(r => {
      data.push(MOVE_TO_PHOTO_ROOT_DRY_RUN_HEADERS.map(h => (r[h] != null ? r[h] : '')));
    });
    if (data.length > 0) {
      sheet
        .getRange(1, 1, data.length, MOVE_TO_PHOTO_ROOT_DRY_RUN_HEADERS.length)
        .setValues(data);
      sheet.setFrozenRows(1);
    }
    return { sheetName: MOVE_TO_PHOTO_ROOT_DRY_RUN_SHEET_NAME, rowCount: rows.length };
  }

  function runMoveToPhotoRootDryRun_() {
    const checkedAt = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );

    Logger.log('[AuditDriveFolders] moveToPhotoRoot dryRun start PHOTO_ROOT=%s', PHOTO_ROOT_FOLDER_ID);

    const manualRows = readManualReviewSheetRows_();
    const targets = manualRows.filter(isMoveToPhotoRootDryRunTarget_);
    Logger.log(
      '[AuditDriveFolders] manualReview rows=%s moveTargets=%s',
      manualRows.length,
      targets.length
    );

    const photoFolders = listPhotoRootFolders_();
    const photoRootIndex = buildPhotoRootFolderIndex_(photoFolders);
    Logger.log('[AuditDriveFolders] PHOTO_ROOT folders count=%s', photoFolders.length);

    const auditRows = targets.map(row =>
      auditOneMoveToPhotoRootDryRun_(row, photoRootIndex, checkedAt)
    );

    const writeResult = writeMoveToPhotoRootDryRunSheet_(auditRows);

    const statusSummary = {};
    const actionSummary = {};
    auditRows.forEach(r => {
      const st = r.moveStatus || 'UNKNOWN';
      statusSummary[st] = (statusSummary[st] || 0) + 1;
      const act = r.suggestedAction || 'UNKNOWN';
      actionSummary[act] = (actionSummary[act] || 0) + 1;
    });

    Logger.log('[AuditDriveFolders] moveStatus summary: %s', JSON.stringify(statusSummary));
    Logger.log('[AuditDriveFolders] suggestedAction summary: %s', JSON.stringify(actionSummary));
    Logger.log(
      '[AuditDriveFolders] moveToPhotoRoot dryRun complete sheet=%s rows=%s',
      writeResult.sheetName,
      writeResult.rowCount
    );

    return {
      ok: true,
      checkedAt: checkedAt,
      manualRowCount: manualRows.length,
      targetRowCount: targets.length,
      auditRowCount: auditRows.length,
      sheetName: writeResult.sheetName,
      moveStatusSummary: statusSummary,
      suggestedActionSummary: actionSummary
    };
  }

  function isTruthySheetFlag_(value) {
    if (value === true) {
      return true;
    }
    const s = String(value || '').trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === '1';
  }

  function readMoveToPhotoRootDryRunSheetRows_() {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    const sheet = ss.getSheetByName(MOVE_TO_PHOTO_ROOT_DRY_RUN_SHEET_NAME);
    if (!sheet) {
      throw new Error('移動dryRunシートが見つかりません: ' + MOVE_TO_PHOTO_ROOT_DRY_RUN_SHEET_NAME);
    }
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      return [];
    }
    const headers = values[0].map(h => String(h || '').trim());
    const colIndex = {};
    headers.forEach((h, i) => {
      colIndex[h] = i;
    });
    const missing = MOVE_TO_PHOTO_ROOT_DRY_RUN_HEADERS.filter(h => colIndex[h] === undefined);
    if (missing.length) {
      throw new Error('移動dryRunシートに不足列があります: ' + missing.join(', '));
    }
    const rows = [];
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i];
      const record = {};
      MOVE_TO_PHOTO_ROOT_DRY_RUN_HEADERS.forEach(h => {
        record[h] = row[colIndex[h]];
      });
      rows.push(record);
    }
    return rows;
  }

  function isMoveExecuteDryRunRowTarget_(row) {
    if (String(row.moveStatus || '').trim() !== 'MOVE_CANDIDATE') {
      return false;
    }
    if (String(row.suggestedAction || '').trim() !== 'MOVE_TO_PHOTO_ROOT') {
      return false;
    }
    if (!String(row.folderId || '').trim()) {
      return false;
    }
    const has08 = isTruthySheetFlag_(row.has08Shokunin);
    const hasStructure = isTruthySheetFlag_(row.hasSiteStructure);
    if (!has08 && !hasStructure) {
      return false;
    }
    if (isTruthySheetFlag_(row.duplicateInPhotoRoot)) {
      return false;
    }
    return true;
  }

  function uniqueNonEmptyStrings_(values) {
    const seen = {};
    const out = [];
    (values || []).forEach(v => {
      const s = String(v || '').trim();
      if (!s || seen[s]) {
        return;
      }
      seen[s] = true;
      out.push(s);
    });
    return out;
  }

  function buildUniqueFolderMoveTargets_(dryRunRows) {
    const filtered = dryRunRows.filter(isMoveExecuteDryRunRowTarget_);
    const byFolderId = {};
    filtered.forEach(row => {
      const folderId = String(row.folderId || '').trim();
      if (!byFolderId[folderId]) {
        byFolderId[folderId] = [];
      }
      byFolderId[folderId].push(row);
    });
    return Object.keys(byFolderId).map(folderId => {
      const rows = byFolderId[folderId];
      return {
        folderId: folderId,
        rows: rows,
        siteIds: uniqueNonEmptyStrings_(rows.map(r => r.siteId)),
        masterSiteNames: uniqueNonEmptyStrings_(rows.map(r => r.masterSiteName)),
        sourceSystems: uniqueNonEmptyStrings_(rows.map(r => r.sourceSystem))
      };
    });
  }

  function folderHasMoveExecuteSiteStructure_(folder) {
    if (folderHasDirectSubfolderByName_(folder, '08_職人報告')) {
      return true;
    }
    if (folderHasAutoMarkSiteStructure_(folder)) {
      return true;
    }
    return folderHasSiteStructure_(folder);
  }

  function hasDuplicateInPhotoRootForMoveTarget_(folderId, folderName, rows, photoRootIndex) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const duplicateNames = findPhotoRootDuplicateNames_(
        folderId,
        folderName,
        String(row.masterSiteName || '').trim(),
        String(row.siteId || '').trim(),
        photoRootIndex
      );
      if (duplicateNames.length > 0) {
        return { hasDuplicate: true, duplicateNames: duplicateNames };
      }
    }
    return { hasDuplicate: false, duplicateNames: [] };
  }

  function sheetHasMoveToPhotoRootLogHeader_(sheet) {
    if (sheet.getLastRow() < 1) {
      return false;
    }
    return String(sheet.getRange(1, 1).getValue() || '').trim() === MOVE_TO_PHOTO_ROOT_LOG_HEADERS[0];
  }

  function ensureMoveToPhotoRootLogHeader_(sheet) {
    if (sheetHasMoveToPhotoRootLogHeader_(sheet)) {
      return;
    }
    if (sheet.getLastRow() > 0) {
      sheet.insertRowBefore(1);
    }
    sheet.getRange(1, 1, 1, MOVE_TO_PHOTO_ROOT_LOG_HEADERS.length).setValues([MOVE_TO_PHOTO_ROOT_LOG_HEADERS]);
    sheet.setFrozenRows(1);
  }

  function appendMoveToPhotoRootLogRows_(logRows) {
    if (!logRows || !logRows.length) {
      return { sheetName: MOVE_TO_PHOTO_ROOT_LOG_SHEET_NAME, rowCount: 0 };
    }
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    let sheet = ss.getSheetByName(MOVE_TO_PHOTO_ROOT_LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(MOVE_TO_PHOTO_ROOT_LOG_SHEET_NAME);
    }
    ensureMoveToPhotoRootLogHeader_(sheet);

    const data = logRows.map(r => MOVE_TO_PHOTO_ROOT_LOG_HEADERS.map(h => (r[h] != null ? r[h] : '')));
    const rangeRows = data.length;
    const rangeCols = MOVE_TO_PHOTO_ROOT_LOG_HEADERS.length;
    const startRow = sheet.getLastRow() + 1;

    Logger.log(
      '[appendMoveToPhotoRootLog] data.length=%s startRow=%s rangeRows=%s rangeCols=%s',
      data.length,
      startRow,
      rangeRows,
      rangeCols
    );

    sheet.getRange(startRow, 1, rangeRows, rangeCols).setValues(data);
    return { sheetName: MOVE_TO_PHOTO_ROOT_LOG_SHEET_NAME, rowCount: logRows.length };
  }

  function buildMoveToPhotoRootLogRow_(target, runId, movedAt, executedBy, result) {
    return {
      movedAt: movedAt,
      runId: runId,
      folderId: target.folderId,
      folderName: result.folderName || '',
      siteIds: target.siteIds.join(' | '),
      masterSiteNames: target.masterSiteNames.join(' | '),
      oldParentId: result.oldParentId || '',
      oldParentName: result.oldParentName || '',
      newParentId: result.newParentId || '',
      newParentName: result.newParentName || '',
      moveResult: result.moveResult || '',
      skipReason: result.skipReason || '',
      sourceSystems: target.sourceSystems.join(' | '),
      executedBy: executedBy
    };
  }

  function executeMoveFolderToPhotoRoot_(target, photoRootIndex) {
    const folderId = target.folderId;
    let folder;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (e) {
      return {
        moveResult: 'FAILED',
        skipReason: 'SKIP_INVALID_FOLDER_ID',
        folderName: '',
        oldParentId: '',
        oldParentName: '',
        newParentId: '',
        newParentName: '',
        error: String(e.message || e)
      };
    }

    const folderName = folder.getName();
    const parentBefore = getFolderParentInfo_(folder);
    const oldParentId = parentBefore.parentFolderId || '';
    const oldParentName = parentBefore.parentFolderName || '';

    if (oldParentId === PHOTO_ROOT_FOLDER_ID) {
      return {
        moveResult: 'SKIPPED',
        skipReason: 'SKIP_ALREADY_IN_PHOTO_ROOT',
        folderName: folderName,
        oldParentId: oldParentId,
        oldParentName: oldParentName,
        newParentId: oldParentId,
        newParentName: oldParentName
      };
    }

    if (!folderHasMoveExecuteSiteStructure_(folder)) {
      return {
        moveResult: 'SKIPPED',
        skipReason: 'SKIP_MISSING_SITE_STRUCTURE',
        folderName: folderName,
        oldParentId: oldParentId,
        oldParentName: oldParentName,
        newParentId: '',
        newParentName: ''
      };
    }

    const dup = hasDuplicateInPhotoRootForMoveTarget_(
      folderId,
      folderName,
      target.rows,
      photoRootIndex
    );
    if (dup.hasDuplicate) {
      return {
        moveResult: 'SKIPPED',
        skipReason: 'SKIP_DUPLICATE_IN_PHOTO_ROOT',
        folderName: folderName,
        oldParentId: oldParentId,
        oldParentName: oldParentName,
        newParentId: '',
        newParentName: '',
        duplicateNames: dup.duplicateNames.join(' | ')
      };
    }

    try {
      const photoRoot = DriveApp.getFolderById(PHOTO_ROOT_FOLDER_ID);
      folder.moveTo(photoRoot);
      const parentAfter = getFolderParentInfo_(folder);
      return {
        moveResult: 'MOVED',
        skipReason: 'OK_MOVED',
        folderName: folderName,
        oldParentId: oldParentId,
        oldParentName: oldParentName,
        newParentId: parentAfter.parentFolderId || PHOTO_ROOT_FOLDER_ID,
        newParentName: parentAfter.parentFolderName || photoRoot.getName()
      };
    } catch (e) {
      return {
        moveResult: 'FAILED',
        skipReason: 'FAILED_MOVE',
        folderName: folderName,
        oldParentId: oldParentId,
        oldParentName: oldParentName,
        newParentId: '',
        newParentName: '',
        error: String(e.message || e)
      };
    }
  }

  function runMoveToPhotoRootExecute_(maxFoldersOverride) {
    const maxFolders =
      maxFoldersOverride != null && maxFoldersOverride !== ''
        ? Number(maxFoldersOverride)
        : MAX_MOVE_FOLDERS;
    if (!maxFolders || maxFolders < 1) {
      throw new Error('MAX_MOVE_FOLDERS が無効です: ' + maxFolders);
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw new Error('別のPHOTO_ROOT移動処理が実行中です。しばらく待ってから再実行してください。');
    }

    try {
      const tz = Session.getScriptTimeZone();
      const runId = Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
      const movedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
      const executedBy = getExecutedBy_();

      Logger.log('[AuditDriveFolders] moveToPhotoRoot execute start runId=%s maxFolders=%s', runId, maxFolders);

      const dryRunRows = readMoveToPhotoRootDryRunSheetRows_();
      const uniqueTargets = buildUniqueFolderMoveTargets_(dryRunRows);
      const targetFolders = uniqueTargets.slice(0, maxFolders);

      Logger.log(
        '[AuditDriveFolders] dryRunRows=%s uniqueFolderTargets=%s targetFolders=%s',
        dryRunRows.length,
        uniqueTargets.length,
        targetFolders.length
      );

      if (!targetFolders.length) {
        Logger.log('[AuditDriveFolders] moveToPhotoRoot execute: 移動対象がありません');
        return {
          ok: true,
          runId: runId,
          dryRunRows: dryRunRows.length,
          uniqueFolderTargets: uniqueTargets.length,
          targetFolders: 0,
          moved: 0,
          skipped: 0,
          failed: 0,
          message: 'no_targets'
        };
      }

      const photoFolders = listPhotoRootFolders_();
      const photoRootIndex = buildPhotoRootFolderIndex_(photoFolders);

      const logRows = [];
      let moved = 0;
      let skipped = 0;
      let failed = 0;

      targetFolders.forEach(target => {
        const result = executeMoveFolderToPhotoRoot_(target, photoRootIndex);
        logRows.push(buildMoveToPhotoRootLogRow_(target, runId, movedAt, executedBy, result));

        if (result.moveResult === 'MOVED') {
          moved += 1;
          const movedEntry = {
            folderId: target.folderId,
            folderName: result.folderName,
            siteIdSuffix: '',
            normalizedName: UtilitiesEx.normalizeName(result.folderName)
          };
          photoRootIndex.byId[target.folderId] = movedEntry;
          photoRootIndex.all.push(movedEntry);
        } else if (result.moveResult === 'SKIPPED') {
          skipped += 1;
        } else {
          failed += 1;
        }
      });

      const logWrite = appendMoveToPhotoRootLogRows_(logRows);

      Logger.log('[AuditDriveFolders] moveToPhotoRoot execute complete runId=%s', runId);
      Logger.log('[AuditDriveFolders] moved=%s skipped=%s failed=%s', moved, skipped, failed);
      Logger.log('[AuditDriveFolders] moveLog sheet=%s rows=%s', logWrite.sheetName, logWrite.rowCount);

      return {
        ok: true,
        runId: runId,
        movedAt: movedAt,
        dryRunRows: dryRunRows.length,
        uniqueFolderTargets: uniqueTargets.length,
        targetFolders: targetFolders.length,
        moved: moved,
        skipped: skipped,
        failed: failed,
        maxMoveFolders: maxFolders,
        moveLogSheetName: logWrite.sheetName,
        moveLogRowCount: logWrite.rowCount
      };
    } finally {
      lock.releaseLock();
    }
  }

  function runLightDryRun_() {
    const auditAt = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );

    Logger.log('[AuditDriveFolders] LIGHT start PHOTO_ROOT=%s', PHOTO_ROOT_FOLDER_ID);

    const photoFolders = listPhotoRootFolders_();
    const index = buildPhotoRootFolderIndex_(photoFolders);
    Logger.log('[AuditDriveFolders] PHOTO_ROOT folders count=%s', photoFolders.length);

    const shokunin = readShokuninMasterRows_();
    Logger.log('[AuditDriveFolders] shokunin rows count=%s', shokunin.rows.length);

    const kanri = readKanriMasterRows_();
    Logger.log('[AuditDriveFolders] kanri rows count=%s', kanri.rows.length);

    const allMasterRows = shokunin.rows.concat(kanri.rows);
    const auditRows = allMasterRows.map(row => auditOneSiteLight_(row, index, auditAt));
    Logger.log('[AuditDriveFolders] audited rows count=%s', auditRows.length);

    const writeResult = writeLightAuditSheet_(auditRows);

    const summary = {};
    auditRows.forEach(r => {
      const st = r.auditStatus || 'UNKNOWN';
      summary[st] = (summary[st] || 0) + 1;
    });

    Logger.log('[AuditDriveFolders] status summary: %s', JSON.stringify(summary));
    Logger.log(
      '[AuditDriveFolders] LIGHT complete rows=%s sheet=%s',
      auditRows.length,
      writeResult.sheetName
    );

    return {
      ok: true,
      auditAt: auditAt,
      photoRootFolderId: PHOTO_ROOT_FOLDER_ID,
      photoRootChildCount: photoFolders.length,
      masterRowCount: allMasterRows.length,
      auditRowCount: auditRows.length,
      sheetName: writeResult.sheetName,
      statusSummary: summary
    };
  }

  function runDryRun_() {
    const auditAt = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );

    Logger.log('[AuditDriveFolders] dryRun start PHOTO_ROOT=%s', PHOTO_ROOT_FOLDER_ID);

    const photoFolders = listPhotoRootFolders_();
    const index = buildPhotoRootFolderIndex_(photoFolders);
    Logger.log('[AuditDriveFolders] PHOTO_ROOT child folders (excl.除外): %s', photoFolders.length);

    const shokunin = readShokuninMasterRows_();
    const kanri = readKanriMasterRows_();
    const sources = [shokunin, kanri];
    const allMasterRows = shokunin.rows.concat(kanri.rows);
    const crossMap = buildCrossSheetDriveMap_(sources);
    const driveIdUsage = buildDriveIdUsageMap_(sources);

    const auditRows = [];
    allMasterRows.forEach(row => {
      auditRows.push(auditOneSiteDriveFolder_(row, index, crossMap, driveIdUsage, auditAt));
    });

    const orphanRows = buildOrphanDriveRows_(index, allMasterRows, auditAt);
    const allRows = auditRows.concat(orphanRows);

    const writeResult = writeDriveFolderAuditSheet_(allRows);

    const summary = {};
    allRows.forEach(r => {
      const st = r.auditStatus || 'UNKNOWN';
      summary[st] = (summary[st] || 0) + 1;
    });

    Logger.log('[AuditDriveFolders] dryRun complete rows=%s sheet=%s', allRows.length, writeResult.sheetName);
    Logger.log('[AuditDriveFolders] status summary: %s', JSON.stringify(summary));

    return {
      ok: true,
      auditAt: auditAt,
      photoRootFolderId: PHOTO_ROOT_FOLDER_ID,
      photoRootChildCount: photoFolders.length,
      masterRowCount: allMasterRows.length,
      auditRowCount: allRows.length,
      sheetName: writeResult.sheetName,
      statusSummary: summary
    };
  }

  function findDuplicateSiteIds_(rows) {
    const counts = {};
    rows.forEach(row => {
      const key = normalizeSiteIdKey_(row.siteId);
      if (!key) {
        return;
      }
      counts[key] = (counts[key] || 0) + 1;
    });
    const duplicates = {};
    Object.keys(counts).forEach(key => {
      if (counts[key] > 1) {
        duplicates[key] = true;
      }
    });
    return duplicates;
  }

  function buildSiteIdRowIndex_(rows) {
    const bySiteId = {};
    rows.forEach(row => {
      const key = normalizeSiteIdKey_(row.siteId);
      if (!key) {
        return;
      }
      if (!bySiteId[key]) {
        bySiteId[key] = [];
      }
      bySiteId[key].push(row);
    });
    return bySiteId;
  }

  function compareMasterSiteNamesMatchLevel_(nameA, nameB, siteId) {
    const matchA = SiteDriveFolderGuard.evaluateSiteFolderNameMatch_(nameA, nameB, siteId);
    if (matchA.ok) {
      return matchA.level;
    }
    const matchB = SiteDriveFolderGuard.evaluateSiteFolderNameMatch_(nameB, nameA, siteId);
    return matchB.ok ? matchB.level : 'none';
  }

  function buildOneSyncDryRunRow_(
    shokuninRow,
    kanriBySiteId,
    photoRootById,
    shokuninDupIds,
    kanriDupIds,
    checkedAt
  ) {
    const siteIdKey = normalizeSiteIdKey_(shokuninRow.siteId);
    const shokuninC = String(shokuninRow.driveFolderId || '').trim();
    const row = {
      checkedAt: checkedAt,
      siteId: String(shokuninRow.siteId || '').trim(),
      shokuninRow: shokuninRow.rowNumber,
      kanriRow: '',
      shokuninSiteName: String(shokuninRow.masterSiteName || '').trim(),
      kanriSiteName: '',
      matchLevel: 'none',
      shokuninDriveFolderId: shokuninC,
      kanriDriveFolderId_current: '',
      suggestedDriveFolderId: '',
      suggestedAction: 'SKIP',
      status: 'MANUAL_REVIEW',
      notes: ''
    };

    if (!siteIdKey) {
      row.notes = 'SITE-ID形式不正';
      return row;
    }

    if (shokuninDupIds[siteIdKey]) {
      row.status = 'DUPLICATE_SITE_ID_SHOKUNIN';
      row.suggestedAction = 'MANUAL_REVIEW';
      row.notes = '職人側SITE-ID重複';
      return row;
    }

    const kanriRows = kanriBySiteId[siteIdKey] || [];
    if (!kanriRows.length) {
      row.status = 'SITE_ID_NOT_FOUND_IN_KANRI';
      row.suggestedAction = 'MANUAL_REVIEW';
      row.notes = '現場管理側に同一SITE-IDなし';
      return row;
    }

    if (kanriDupIds[siteIdKey]) {
      row.kanriRow = kanriRows.map(r => r.rowNumber).join(',');
      row.kanriSiteName = kanriRows.map(r => r.masterSiteName).join(' | ');
      row.status = 'DUPLICATE_SITE_ID_KANRI';
      row.suggestedAction = 'MANUAL_REVIEW';
      row.notes = '現場管理側SITE-ID重複';
      return row;
    }

    const kanriRow = kanriRows[0];
    row.kanriRow = kanriRow.rowNumber;
    row.kanriSiteName = String(kanriRow.masterSiteName || '').trim();
    row.kanriDriveFolderId_current = String(kanriRow.driveFolderId || '').trim();

    if (!shokuninC) {
      row.status = 'MISSING_SHOKUNIN_C';
      row.suggestedAction = 'MANUAL_REVIEW';
      row.notes = '職人側C列が空';
      return row;
    }

    if (!photoRootById[shokuninC]) {
      row.status = 'SHOKUNIN_C_NOT_PHOTO_ROOT';
      row.suggestedAction = 'MANUAL_REVIEW';
      row.notes = '職人C列がPHOTO_ROOT直下一覧に無い';
      return row;
    }

    const matchLevel = compareMasterSiteNamesMatchLevel_(
      row.shokuninSiteName,
      row.kanriSiteName,
      siteIdKey
    );
    row.matchLevel = matchLevel;

    if (matchLevel === 'none') {
      row.status = 'NAME_MISMATCH';
      row.suggestedAction = 'MANUAL_REVIEW';
      row.notes = '職人側と現場管理側の現場名不一致';
      return row;
    }

    row.suggestedDriveFolderId = shokuninC;

    if (row.kanriDriveFolderId_current === shokuninC) {
      row.status = 'ALREADY_SYNCED';
      row.suggestedAction = 'NO_CHANGE';
      row.notes = '既に同一DriveFolderId';
      return row;
    }

    row.status = 'SYNC_CANDIDATE';
    row.suggestedAction = 'SET_KANRI_C';
    row.notes = '職人C列を現場管理へ同期候補';
    return row;
  }

  function writeSyncKanriDryRunSheet_(rows) {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    let sheet = ss.getSheetByName(SYNC_KANRI_DRY_RUN_SHEET_NAME);
    if (sheet) {
      sheet.clear();
    } else {
      sheet = ss.insertSheet(SYNC_KANRI_DRY_RUN_SHEET_NAME);
    }
    const data = [SYNC_KANRI_DRY_RUN_HEADERS];
    rows.forEach(r => {
      data.push(SYNC_KANRI_DRY_RUN_HEADERS.map(h => (r[h] != null ? r[h] : '')));
    });
    if (data.length > 0) {
      sheet.getRange(1, 1, data.length, SYNC_KANRI_DRY_RUN_HEADERS.length).setValues(data);
      sheet.setFrozenRows(1);
    }
    return { sheetName: SYNC_KANRI_DRY_RUN_SHEET_NAME, rowCount: rows.length };
  }

  function runSyncKanriFromShokuninDryRun_() {
    const checkedAt = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );

    Logger.log('[AuditDriveFolders] syncKanri dryRun start PHOTO_ROOT=%s', PHOTO_ROOT_FOLDER_ID);

    const photoFolders = listPhotoRootFolders_();
    const photoRootById = buildPhotoRootFolderIndex_(photoFolders).byId;
    Logger.log('[AuditDriveFolders] PHOTO_ROOT folders count=%s', photoFolders.length);

    const shokunin = readShokuninMasterRows_();
    Logger.log('[AuditDriveFolders] shokunin rows count=%s', shokunin.rows.length);

    const kanri = readKanriMasterRows_();
    Logger.log('[AuditDriveFolders] kanri rows count=%s', kanri.rows.length);

    const shokuninDupIds = findDuplicateSiteIds_(shokunin.rows);
    const kanriDupIds = findDuplicateSiteIds_(kanri.rows);
    const kanriBySiteId = buildSiteIdRowIndex_(kanri.rows);

    const syncRows = shokunin.rows.map(shokuninRow =>
      buildOneSyncDryRunRow_(
        shokuninRow,
        kanriBySiteId,
        photoRootById,
        shokuninDupIds,
        kanriDupIds,
        checkedAt
      )
    );

    const writeResult = writeSyncKanriDryRunSheet_(syncRows);

    const statusSummary = {};
    const actionSummary = {};
    syncRows.forEach(r => {
      const st = r.status || 'UNKNOWN';
      statusSummary[st] = (statusSummary[st] || 0) + 1;
      const act = r.suggestedAction || 'UNKNOWN';
      actionSummary[act] = (actionSummary[act] || 0) + 1;
    });

    Logger.log('[AuditDriveFolders] syncKanri dryRun rows=%s sheet=%s', syncRows.length, writeResult.sheetName);
    Logger.log('[AuditDriveFolders] status summary: %s', JSON.stringify(statusSummary));
    Logger.log('[AuditDriveFolders] suggestedAction summary: %s', JSON.stringify(actionSummary));
    Logger.log('[AuditDriveFolders] syncKanri dryRun complete');

    return {
      ok: true,
      checkedAt: checkedAt,
      photoRootChildCount: photoFolders.length,
      shokuninRowCount: shokunin.rows.length,
      kanriRowCount: kanri.rows.length,
      syncRowCount: syncRows.length,
      sheetName: writeResult.sheetName,
      statusSummary: statusSummary,
      suggestedActionSummary: actionSummary
    };
  }

  function isValidMatchLevel_(matchLevel) {
    return VALID_MATCH_LEVELS_.indexOf(String(matchLevel || '').trim()) >= 0;
  }

  function readSyncKanriDryRunSheetRows_() {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    const sheet = ss.getSheetByName(SYNC_KANRI_DRY_RUN_SHEET_NAME);
    if (!sheet) {
      throw new Error('同期dryRunシートが見つかりません: ' + SYNC_KANRI_DRY_RUN_SHEET_NAME);
    }
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      return [];
    }
    const headers = values[0].map(h => String(h || '').trim());
    const colIndex = {};
    headers.forEach((h, i) => {
      colIndex[h] = i;
    });
    const missing = SYNC_KANRI_DRY_RUN_HEADERS.filter(h => colIndex[h] === undefined);
    if (missing.length) {
      throw new Error('同期dryRunシートに不足列があります: ' + missing.join(', '));
    }
    const rows = [];
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i];
      const record = {};
      SYNC_KANRI_DRY_RUN_HEADERS.forEach(h => {
        record[h] = row[colIndex[h]];
      });
      rows.push(record);
    }
    return rows;
  }

  function isSyncKanriExecuteTarget_(dryRunRow, photoRootById) {
    if (String(dryRunRow.status || '').trim() !== 'SYNC_CANDIDATE') {
      return false;
    }
    if (String(dryRunRow.suggestedAction || '').trim() !== 'SET_KANRI_C') {
      return false;
    }
    if (!normalizeSiteIdKey_(dryRunRow.siteId)) {
      return false;
    }
    if (!String(dryRunRow.kanriRow || '').trim()) {
      return false;
    }
    const shokuninId = String(dryRunRow.shokuninDriveFolderId || '').trim();
    const suggestedId = String(dryRunRow.suggestedDriveFolderId || '').trim();
    if (!shokuninId || !suggestedId) {
      return false;
    }
    if (shokuninId !== suggestedId) {
      return false;
    }
    if (!photoRootById[shokuninId]) {
      return false;
    }
    if (!isValidMatchLevel_(dryRunRow.matchLevel)) {
      return false;
    }
    return true;
  }

  function resolveKanriSheet_(ss) {
    const byGid = ss.getSheets().find(sh => sh.getSheetId() === KANRI_SHEET_GID);
    if (byGid) {
      return byGid;
    }
    return ss.getSheetByName(KANRI_MASTER_SHEET_NAME);
  }

  function readKanriLiveRow_(rowNumber) {
    try {
      const ss = SpreadsheetApp.openById(KANRI_SPREADSHEET_ID);
      const sheet = resolveKanriSheet_(ss);
      if (!sheet) {
        return { ok: false, error: 'kanri_sheet_not_found' };
      }
      const values = sheet.getDataRange().getValues();
      const rowNum = Number(rowNumber);
      if (!rowNum || rowNum < 2 || rowNum > values.length) {
        return { ok: false, error: 'row_out_of_range' };
      }
      const cols = parseMasterHeaders_(values[0] || []);
      const row = values[rowNum - 1];
      return {
        ok: true,
        siteId: String(row[cols.siteIdCol] || '').trim(),
        siteName: String(row[cols.siteNameCol] || '').trim(),
        driveFolderId: String(row[cols.driveCol] || '').trim()
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  function kanriSiteNameMatchesDryRun_(liveSiteName, dryRunKanriSiteName, siteId) {
    const live = String(liveSiteName || '').trim();
    const dry = String(dryRunKanriSiteName || '').trim();
    if (live && dry && live === dry) {
      return true;
    }
    return compareMasterSiteNamesMatchLevel_(live, dry, siteId) !== 'none';
  }

  function revalidateSyncKanriRowForExecute_(dryRunRow, photoRootById) {
    const siteId = String(dryRunRow.siteId || '').trim();
    const siteIdKey = normalizeSiteIdKey_(siteId);
    const suggestedId = String(dryRunRow.suggestedDriveFolderId || '').trim();
    const expectedCurrent = String(dryRunRow.kanriDriveFolderId_current || '').trim();
    const dryKanriSiteName = String(dryRunRow.kanriSiteName || '').trim();
    const rowNumber = Number(dryRunRow.kanriRow);

    const live = readKanriLiveRow_(rowNumber);
    if (!live.ok) {
      return {
        ok: false,
        skipReason: isPermissionLikeError_(live.error) ? 'SKIP_PERMISSION_ERROR' : 'SKIP_ROW_DRIFT',
        oldKanriDriveFolderId: expectedCurrent,
        liveSiteName: dryKanriSiteName
      };
    }

    const liveSiteId = normalizeSiteIdKey_(live.siteId);
    if (!liveSiteId || liveSiteId !== siteIdKey) {
      return {
        ok: false,
        skipReason: 'SKIP_ROW_DRIFT',
        oldKanriDriveFolderId: live.driveFolderId,
        liveSiteName: live.siteName
      };
    }

    if (!kanriSiteNameMatchesDryRun_(live.siteName, dryKanriSiteName, siteIdKey)) {
      return {
        ok: false,
        skipReason: 'SKIP_NAME_MISMATCH',
        oldKanriDriveFolderId: live.driveFolderId,
        liveSiteName: live.siteName
      };
    }

    if (live.driveFolderId !== expectedCurrent) {
      return {
        ok: false,
        skipReason: 'SKIP_STALE_CURRENT',
        oldKanriDriveFolderId: live.driveFolderId,
        liveSiteName: live.siteName
      };
    }

    if (live.driveFolderId === suggestedId) {
      return {
        ok: false,
        skipReason: 'SKIP_ALREADY_SYNCED',
        oldKanriDriveFolderId: live.driveFolderId,
        liveSiteName: live.siteName
      };
    }

    if (!photoRootById[suggestedId]) {
      return {
        ok: false,
        skipReason: 'SKIP_INVALID_SUGGESTED_ID',
        oldKanriDriveFolderId: live.driveFolderId,
        liveSiteName: live.siteName
      };
    }

    return {
      ok: true,
      skipReason: 'OK_APPLIED',
      oldKanriDriveFolderId: live.driveFolderId,
      liveSiteName: live.siteName
    };
  }

  function writeKanriDriveFolderIdToRow_(rowNumber, newId) {
    try {
      const ss = SpreadsheetApp.openById(KANRI_SPREADSHEET_ID);
      const sheet = resolveKanriSheet_(ss);
      if (!sheet) {
        return { ok: false, error: 'kanri_sheet_not_found' };
      }
      const rowNum = Number(rowNumber);
      if (!rowNum || rowNum < 2) {
        return { ok: false, error: 'invalid_row_number' };
      }
      const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const cols = parseMasterHeaders_(headerRow);
      if (cols.driveCol < 0) {
        return { ok: false, error: 'drive_col_not_found' };
      }
      sheet.getRange(rowNum, cols.driveCol + 1).setValue(newId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  function sheetHasSyncKanriLogHeader_(sheet) {
    if (sheet.getLastRow() < 1) {
      return false;
    }
    const first = String(sheet.getRange(1, 1).getValue() || '').trim();
    return first === SYNC_KANRI_LOG_HEADERS[0];
  }

  function ensureSyncKanriLogHeader_(sheet) {
    if (sheetHasSyncKanriLogHeader_(sheet)) {
      return;
    }
    if (sheet.getLastRow() > 0) {
      sheet.insertRowBefore(1);
    }
    sheet.getRange(1, 1, 1, SYNC_KANRI_LOG_HEADERS.length).setValues([SYNC_KANRI_LOG_HEADERS]);
    sheet.setFrozenRows(1);
  }

  function appendSyncKanriLogRows_(logRows) {
    if (!logRows || !logRows.length) {
      return { sheetName: SYNC_KANRI_LOG_SHEET_NAME, rowCount: 0 };
    }
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    let sheet = ss.getSheetByName(SYNC_KANRI_LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SYNC_KANRI_LOG_SHEET_NAME);
    }
    ensureSyncKanriLogHeader_(sheet);

    const data = logRows.map(r => SYNC_KANRI_LOG_HEADERS.map(h => (r[h] != null ? r[h] : '')));
    const rangeRows = data.length;
    const rangeCols = SYNC_KANRI_LOG_HEADERS.length;
    const startRow = sheet.getLastRow() + 1;
    const endRow = startRow + rangeRows - 1;

    Logger.log(
      '[appendSyncKanriLog] data.length=%s startRow=%s rangeRows=%s rangeCols=%s endRow=%s',
      data.length,
      startRow,
      rangeRows,
      rangeCols,
      endRow
    );

    sheet.getRange(startRow, 1, rangeRows, rangeCols).setValues(data);
    return { sheetName: SYNC_KANRI_LOG_SHEET_NAME, rowCount: logRows.length };
  }

  function buildSyncKanriLogRow_(dryRunRow, runId, syncedAt, executedBy, backupSheetName, reval, applyResult, skipReason) {
    const suggestedId = String(dryRunRow.suggestedDriveFolderId || '').trim();
    return {
      syncedAt: syncedAt,
      runId: runId,
      siteId: String(dryRunRow.siteId || '').trim(),
      kanriRow: dryRunRow.kanriRow,
      shokuninSiteName: String(dryRunRow.shokuninSiteName || '').trim(),
      kanriSiteName: (reval && reval.liveSiteName) || String(dryRunRow.kanriSiteName || '').trim(),
      matchLevel: String(dryRunRow.matchLevel || '').trim(),
      oldKanriDriveFolderId: (reval && reval.oldKanriDriveFolderId) || String(dryRunRow.kanriDriveFolderId_current || '').trim(),
      newKanriDriveFolderId: applyResult === 'APPLIED' ? suggestedId : '',
      suggestedDriveFolderId: suggestedId,
      applyResult: applyResult,
      skipReason: skipReason || '',
      backupSheetName: backupSheetName || '',
      executedBy: executedBy
    };
  }

  function runSyncKanriExecute_(maxRowsOverride) {
    const maxRows =
      maxRowsOverride != null && maxRowsOverride !== ''
        ? Number(maxRowsOverride)
        : MAX_SYNC_KANRI_ROWS;
    if (!maxRows || maxRows < 1) {
      throw new Error('MAX_SYNC_KANRI_ROWS が無効です: ' + maxRows);
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw new Error('別のDriveFolderId同期処理が実行中です。しばらく待ってから再実行してください。');
    }

    try {
      const tz = Session.getScriptTimeZone();
      const runId = Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
      const syncedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
      const executedBy = getExecutedBy_();

      Logger.log('[AuditDriveFolders] syncKanri execute start runId=%s maxRows=%s', runId, maxRows);

      const photoFolders = listPhotoRootFolders_();
      const photoRootById = buildPhotoRootFolderIndex_(photoFolders).byId;

      const dryRunRows = readSyncKanriDryRunSheetRows_();
      const eligibleRows = dryRunRows.filter(r => isSyncKanriExecuteTarget_(r, photoRootById));
      const targetRows = eligibleRows.slice(0, maxRows);

      Logger.log(
        '[AuditDriveFolders] dryRunRows=%s eligible=%s targetRows=%s',
        dryRunRows.length,
        eligibleRows.length,
        targetRows.length
      );

      if (!targetRows.length) {
        Logger.log('[AuditDriveFolders] syncKanri execute: 更新対象がありません');
        return {
          ok: true,
          runId: runId,
          targetRows: 0,
          applied: 0,
          skipped: 0,
          failed: 0,
          backupSheetName: '',
          message: 'no_targets'
        };
      }

      const backupSheetName =
        KANRI_MASTER_SHEET_NAME + '_backup_syncKanri_' + runId;
      createSheetBackup_(KANRI_SPREADSHEET_ID, KANRI_MASTER_SHEET_NAME, backupSheetName);

      const logRows = [];
      let applied = 0;
      let skipped = 0;
      let failed = 0;

      targetRows.forEach(dryRunRow => {
        const reval = revalidateSyncKanriRowForExecute_(dryRunRow, photoRootById);
        if (!reval.ok) {
          logRows.push(
            buildSyncKanriLogRow_(
              dryRunRow,
              runId,
              syncedAt,
              executedBy,
              backupSheetName,
              reval,
              'SKIPPED',
              reval.skipReason
            )
          );
          skipped += 1;
          return;
        }

        const suggestedId = String(dryRunRow.suggestedDriveFolderId || '').trim();
        const writeResult = writeKanriDriveFolderIdToRow_(dryRunRow.kanriRow, suggestedId);
        if (!writeResult.ok) {
          logRows.push(
            buildSyncKanriLogRow_(
              dryRunRow,
              runId,
              syncedAt,
              executedBy,
              backupSheetName,
              reval,
              'FAILED',
              'FAILED_SET_VALUE'
            )
          );
          failed += 1;
          return;
        }

        logRows.push(
          buildSyncKanriLogRow_(
            dryRunRow,
            runId,
            syncedAt,
            executedBy,
            backupSheetName,
            reval,
            'APPLIED',
            'OK_APPLIED'
          )
        );
        applied += 1;
      });

      const logWrite = appendSyncKanriLogRows_(logRows);

      Logger.log('[AuditDriveFolders] syncKanri execute complete runId=%s', runId);
      Logger.log('[AuditDriveFolders] targetRows=%s applied=%s skipped=%s failed=%s', targetRows.length, applied, skipped, failed);
      Logger.log('[AuditDriveFolders] backupSheetName=%s', backupSheetName);
      Logger.log('[AuditDriveFolders] syncLog sheet=%s rows=%s', logWrite.sheetName, logWrite.rowCount);

      return {
        ok: true,
        runId: runId,
        syncedAt: syncedAt,
        targetRows: targetRows.length,
        eligibleRows: eligibleRows.length,
        applied: applied,
        skipped: skipped,
        failed: failed,
        backupSheetName: backupSheetName,
        syncLogSheetName: logWrite.sheetName,
        syncLogRowCount: logWrite.rowCount
      };
    } finally {
      lock.releaseLock();
    }
  }

  function columnIndexToLetter_(zeroBasedIndex) {
    let n = zeroBasedIndex + 1;
    let letters = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      letters = String.fromCharCode(65 + rem) + letters;
      n = Math.floor((n - 1) / 26);
    }
    return letters;
  }

  function readSyncKanriLogRows_() {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    const sheet = ss.getSheetByName(SYNC_KANRI_LOG_SHEET_NAME);
    if (!sheet) {
      throw new Error('同期ログシートが見つかりません: ' + SYNC_KANRI_LOG_SHEET_NAME);
    }
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      return [];
    }
    const headers = values[0].map(h => String(h || '').trim());
    const colIndex = {};
    headers.forEach((h, i) => {
      colIndex[h] = i;
    });
    const missing = SYNC_KANRI_LOG_HEADERS.filter(h => colIndex[h] === undefined);
    if (missing.length) {
      throw new Error('同期ログシートに不足列があります: ' + missing.join(', '));
    }
    const rows = [];
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i];
      const record = {};
      SYNC_KANRI_LOG_HEADERS.forEach(h => {
        record[h] = row[colIndex[h]];
      });
      rows.push(record);
    }
    return rows;
  }

  function readKanriSheetContext_() {
    const ss = SpreadsheetApp.openById(KANRI_SPREADSHEET_ID);
    const sheet = resolveKanriSheet_(ss);
    if (!sheet) {
      throw new Error('稼働現場リストが見つかりません');
    }
    const values = sheet.getDataRange().getValues();
    const headers = (values[0] || []).map(h => String(h || '').trim());
    const cols = parseMasterHeaders_(headers);
    return {
      sheetName: sheet.getName(),
      spreadsheetId: KANRI_SPREADSHEET_ID,
      values: values,
      headers: headers,
      cols: cols
    };
  }

  function logKanriColumnStructure_(ctx) {
    const headers = ctx.headers || [];
    const maxLogCols = Math.min(headers.length, 10);
    const headerParts = [];
    for (let i = 0; i < maxLogCols; i += 1) {
      headerParts.push(
        columnIndexToLetter_(i) + '(' + (i + 1) + ')=' + (headers[i] || '(空)')
      );
    }
    Logger.log('[verifySyncKanri] kanri sheet=%s spreadsheetId=%s', ctx.sheetName, ctx.spreadsheetId);
    Logger.log('[verifySyncKanri] kanri headers (first %s cols): %s', maxLogCols, headerParts.join(' | '));
    Logger.log(
      '[verifySyncKanri] col A(1)=%s B(2)=%s C(3)=%s',
      headers[0] || '(空)',
      headers[1] || '(空)',
      headers[2] || '(空)'
    );
    const cols = ctx.cols;
    Logger.log(
      '[verifySyncKanri] parseMasterHeaders: siteNameCol=%s (%s列) siteIdCol=%s (%s列) driveCol=%s (%s列)',
      cols.siteNameCol,
      columnIndexToLetter_(cols.siteNameCol) + '(' + (cols.siteNameCol + 1) + ')',
      cols.siteIdCol,
      columnIndexToLetter_(cols.siteIdCol) + '(' + (cols.siteIdCol + 1) + ')',
      cols.driveCol,
      columnIndexToLetter_(cols.driveCol) + '(' + (cols.driveCol + 1) + ')'
    );
    Logger.log(
      '[verifySyncKanri] execute/dryRun read driveCol 0-based=%s 1-based列番号=%s (setValue列=%s)',
      cols.driveCol,
      cols.driveCol + 1,
      cols.driveCol + 1
    );
    if (cols.driveCol !== 2) {
      Logger.log(
        '[verifySyncKanri] NOTE: DriveFolderId列はC列(3列目)ではなく%s列です',
        columnIndexToLetter_(cols.driveCol) + '(' + (cols.driveCol + 1) + ')'
      );
    }
  }

  function verifyOneSyncApplyLogRow_(logRow, kanriCtx, verifiedAt, runId) {
    const rowNumber = Number(logRow.kanriRow);
    const oldId = String(logRow.oldKanriDriveFolderId || '').trim();
    const newId = String(logRow.newKanriDriveFolderId || '').trim();
    const suggestedId = String(logRow.suggestedDriveFolderId || '').trim();
    const logSiteId = normalizeSiteIdKey_(logRow.siteId);

    const base = {
      verifiedAt: verifiedAt,
      runId: runId,
      siteId: String(logRow.siteId || '').trim(),
      kanriRow: logRow.kanriRow,
      kanriSiteName_current: '',
      kanriSiteId_current: '',
      oldKanriDriveFolderId: oldId,
      newKanriDriveFolderId: newId,
      suggestedDriveFolderId: suggestedId,
      currentKanriDriveFolderId: '',
      verifyStatus: 'VERIFY_INVALID_ROW',
      notes: ''
    };

    if (!rowNumber || rowNumber < 2 || rowNumber > kanriCtx.values.length) {
      base.notes = 'kanriRow範囲外 rowNumber=' + rowNumber + ' lastRow=' + kanriCtx.values.length;
      return base;
    }

    const row = kanriCtx.values[rowNumber - 1];
    const cols = kanriCtx.cols;
    const currentSiteId = String(row[cols.siteIdCol] || '').trim();
    const currentSiteName = String(row[cols.siteNameCol] || '').trim();
    const currentDriveId = String(row[cols.driveCol] || '').trim();

    base.kanriSiteId_current = currentSiteId;
    base.kanriSiteName_current = currentSiteName;
    base.currentKanriDriveFolderId = currentDriveId;

    const currentSiteIdKey = normalizeSiteIdKey_(currentSiteId);
    if (!logSiteId || !currentSiteIdKey || currentSiteIdKey !== logSiteId) {
      base.verifyStatus = 'VERIFY_ROW_DRIFT';
      base.notes =
        'ログsiteId=' +
        logSiteId +
        ' 現在siteId=' +
        currentSiteIdKey +
        ' (kanriRow=' +
        rowNumber +
        ')';
      return base;
    }

    if (currentDriveId === newId) {
      base.verifyStatus = 'VERIFY_OK';
      base.notes = '現在C列=' + newId;
      return base;
    }

    if (currentDriveId === oldId) {
      base.verifyStatus = 'VERIFY_NOT_APPLIED';
      base.notes = '更新未反映: 現在値がoldのまま';
      return base;
    }

    base.verifyStatus = 'VERIFY_DIFFERENT_VALUE';
    base.notes =
      '現在C列がold/newどちらでもない current=' +
      currentDriveId +
      ' old=' +
      oldId +
      ' new=' +
      newId;
    return base;
  }

  function writeSyncKanriVerifySheet_(rows) {
    const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    let sheet = ss.getSheetByName(SYNC_KANRI_VERIFY_SHEET_NAME);
    if (sheet) {
      sheet.clear();
    } else {
      sheet = ss.insertSheet(SYNC_KANRI_VERIFY_SHEET_NAME);
    }
    const data = [SYNC_KANRI_VERIFY_HEADERS];
    rows.forEach(r => {
      data.push(SYNC_KANRI_VERIFY_HEADERS.map(h => (r[h] != null ? r[h] : '')));
    });
    if (data.length > 0) {
      sheet.getRange(1, 1, data.length, SYNC_KANRI_VERIFY_HEADERS.length).setValues(data);
      sheet.setFrozenRows(1);
    }
    return { sheetName: SYNC_KANRI_VERIFY_SHEET_NAME, rowCount: rows.length };
  }

  function runVerifySyncKanriApplyByRunId_(runId) {
    const targetRunId = String(runId || '').trim();
    if (!targetRunId) {
      throw new Error('runId が空です');
    }

    const verifiedAt = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );

    Logger.log('[verifySyncKanri] start runId=%s', targetRunId);

    const logRows = readSyncKanriLogRows_().filter(r => {
      return (
        String(r.runId || '').trim() === targetRunId &&
        String(r.applyResult || '').trim() === 'APPLIED'
      );
    });

    Logger.log('[verifySyncKanri] applied log rows=%s', logRows.length);

    const kanriCtx = readKanriSheetContext_();
    logKanriColumnStructure_(kanriCtx);

    const verifyRows = logRows.map(logRow =>
      verifyOneSyncApplyLogRow_(logRow, kanriCtx, verifiedAt, targetRunId)
    );

    const writeResult = writeSyncKanriVerifySheet_(verifyRows);

    const statusSummary = {};
    verifyRows.forEach(r => {
      const st = r.verifyStatus || 'UNKNOWN';
      statusSummary[st] = (statusSummary[st] || 0) + 1;
    });

    Logger.log('[verifySyncKanri] verifyStatus summary: %s', JSON.stringify(statusSummary));
    Logger.log('[verifySyncKanri] complete sheet=%s rows=%s', writeResult.sheetName, writeResult.rowCount);

    return {
      ok: true,
      verifiedAt: verifiedAt,
      runId: targetRunId,
      appliedLogCount: logRows.length,
      verifyRowCount: verifyRows.length,
      sheetName: writeResult.sheetName,
      statusSummary: statusSummary,
      kanriColumnInfo: {
        sheetName: kanriCtx.sheetName,
        siteNameCol: kanriCtx.cols.siteNameCol,
        siteIdCol: kanriCtx.cols.siteIdCol,
        driveCol: kanriCtx.cols.driveCol,
        driveColLetter: columnIndexToLetter_(kanriCtx.cols.driveCol),
        headerA: kanriCtx.headers[0] || '',
        headerB: kanriCtx.headers[1] || '',
        headerC: kanriCtx.headers[2] || ''
      }
    };
  }

  return {
    AUDIT_SHEET_NAME: AUDIT_SHEET_NAME,
    LIGHT_AUDIT_SHEET_NAME: LIGHT_AUDIT_SHEET_NAME,
    SYNC_KANRI_DRY_RUN_SHEET_NAME: SYNC_KANRI_DRY_RUN_SHEET_NAME,
    PREVIEW_SHEET_NAME: PREVIEW_SHEET_NAME,
    APPLY_LOG_SHEET_NAME: APPLY_LOG_SHEET_NAME,
    APPLY_MAX_ROWS: APPLY_MAX_ROWS,
    MAX_SHOKUNIN_APPLY_ROWS: MAX_SHOKUNIN_APPLY_ROWS,
    MAX_SYNC_KANRI_ROWS: MAX_SYNC_KANRI_ROWS,
    MAX_MOVE_FOLDERS: MAX_MOVE_FOLDERS,
    MOVE_TO_PHOTO_ROOT_LOG_SHEET_NAME: MOVE_TO_PHOTO_ROOT_LOG_SHEET_NAME,
    SYNC_KANRI_LOG_SHEET_NAME: SYNC_KANRI_LOG_SHEET_NAME,
    SYNC_KANRI_VERIFY_SHEET_NAME: SYNC_KANRI_VERIFY_SHEET_NAME,
    PHOTO_ROOT_FOLDER_ID: PHOTO_ROOT_FOLDER_ID,
    listPhotoRootFolders_: listPhotoRootFolders_,
    buildPhotoRootFolderIndex_: buildPhotoRootFolderIndex_,
    getFolderParentInfo_: getFolderParentInfo_,
    detectFolderAncestry_: detectFolderAncestry_,
    findPhotoRootCandidates_: findPhotoRootCandidates_,
    auditOneSiteDriveFolder_: auditOneSiteDriveFolder_,
    writeDriveFolderAuditSheet_: writeDriveFolderAuditSheet_,
    readLightAuditSheetRows_: readLightAuditSheetRows_,
    writeManualReviewSheet_: writeManualReviewSheet_,
    runBuildManualReviewSheet_: runBuildManualReviewSheet_,
    runAutoMarkMoveExistingFoldersInManualReview_: runAutoMarkMoveExistingFoldersInManualReview_,
    runMoveToPhotoRootDryRun_: runMoveToPhotoRootDryRun_,
    runMoveToPhotoRootExecute_: runMoveToPhotoRootExecute_,
    readAuditSheetRows_: readAuditSheetRows_,
    readPreviewSheetRows_: readPreviewSheetRows_,
    staticFilterAuditRow_: staticFilterAuditRow_,
    previewOneAuditRow_: previewOneAuditRow_,
    writePreviewApplySheet_: writePreviewApplySheet_,
    revalidatePreviewRowForApply_: revalidatePreviewRowForApply_,
    appendApplyLogRowsToSheet_: appendApplyLogRowsToSheet_,
    runDryRun_: runDryRun_,
    runLightDryRun_: runLightDryRun_,
    runPreviewApply_: runPreviewApply_,
    runApplyExecute_: runApplyExecute_,
    runApplyShokuninOnlyExecute_: runApplyShokuninOnlyExecute_,
    runSyncKanriFromShokuninDryRun_: runSyncKanriFromShokuninDryRun_,
    runSyncKanriExecute_: runSyncKanriExecute_,
    runVerifySyncKanriApplyByRunId_: runVerifySyncKanriApplyByRunId_
  };
})();

/**
 * GASエディタから実行: PHOTO_ROOT 基準の C列監査 dryRun（シート出力のみ、C列・Driveは変更しない）
 */
function debugAuditPhotoRootDriveFolderIdsDryRun() {
  const result = AuditDriveFolders.runDryRun_();
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * GASエディタから実行: PHOTO_ROOT 基準の C列監査 LIGHT版（Drive逐次参照なし・シート出力のみ）
 */
function debugAuditPhotoRootDriveFolderIdsLightDryRun() {
  const result = AuditDriveFolders.runLightDryRun_();
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * GASエディタから実行: DriveFolderId監査_LIGHT の OK_LIGHT 以外を手動確認リストに抽出（書込なし）
 */
function debugBuildDriveFolderManualReviewSheet() {
  const result = AuditDriveFolders.runBuildManualReviewSheet_();
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * GASエディタから実行: 手動確認リストの C_NOT_IN_PHOTO_ROOT_LIGHT 行へ移動候補を自動マーキング（C列・Drive移動なし）
 */
function debugAutoMarkMoveExistingFoldersInManualReview() {
  const result = AuditDriveFolders.runAutoMarkMoveExistingFoldersInManualReview_();
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * GASエディタから実行: 手動確認リストの MOVE_EXISTING_FOLDER_TO_PHOTO_ROOT 行について移動dryRun（移動・C列更新なし）
 */
function debugDryRunMoveExistingFoldersToPhotoRoot() {
  const result = AuditDriveFolders.runMoveToPhotoRootDryRun_();
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * GASエディタから実行: 移動dryRunの MOVE_CANDIDATE フォルダを PHOTO_ROOT 直下へ移動（最大 MAX_MOVE_FOLDERS 件）
 * @param {number} [maxFolders] 未指定時は MAX_MOVE_FOLDERS（既定 5）
 */
function debugExecuteMoveExistingFoldersToPhotoRoot(maxFolders) {
  const result = AuditDriveFolders.runMoveToPhotoRootExecute_(maxFolders);
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * GASエディタから実行: 職人C列を正として現場管理C列同期候補のdryRun（書込なし）
 */
function debugDryRunSyncKanriDriveFolderIdsFromShokunin() {
  const result = AuditDriveFolders.runSyncKanriFromShokuninDryRun_();
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * GASエディタから実行: 同期dryRunの SYNC_CANDIDATE を現場管理C列へ反映（職人C列は更新しない）
 * @param {number} [maxRows] 未指定時は MAX_SYNC_KANRI_ROWS（既定 100）
 */
function debugExecuteSyncKanriDriveFolderIdsFromShokunin(maxRows) {
  const result = AuditDriveFolders.runSyncKanriExecute_(maxRows);
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * runId 指定の同期本実行(APPLIED)について、現場管理C列の反映状況を診断（書込なし）
 */
function debugVerifySyncKanriApplyByRunId() {
  const VERIFY_RUN_ID = '20260702_143910';
  const result = AuditDriveFolders.runVerifySyncKanriApplyByRunId_(VERIFY_RUN_ID);
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * GASエディタから実行: 監査シートの SET_C 候補について C列更新プレビュー（書込なし）
 */
function debugPreviewApplyPhotoRootDriveFolderIdsFromAudit() {
  const result = AuditDriveFolders.runPreviewApply_();
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * GASエディタから実行: プレビュー eligible 行の C列を suggestedDriveFolderId に更新（最大 APPLY_MAX_ROWS 件）
 * @param {number} [maxRows] 未指定時は AuditDriveFolders.APPLY_MAX_ROWS（既定 50）
 */
function debugApplyPhotoRootDriveFolderIdsFromPreview_execute(maxRows) {
  const result = AuditDriveFolders.runApplyExecute_(maxRows);
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * GASエディタから実行: プレビュー eligible の職人進捗管理行のみ C列更新（現場管理は更新しない）
 * @param {number} [maxRows] 未指定時は MAX_SHOKUNIN_APPLY_ROWS（既定 100）
 */
function debugApplyShokuninPhotoRootDriveFolderIdsOnly_execute(maxRows) {
  const result = AuditDriveFolders.runApplyShokuninOnlyExecute_(maxRows);
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * appendApplyLogRows_ の動作確認（DriveFolderId更新ログ_test にダミー1行のみ。本番ログ・C列は触らない）
 */
function debugTestAppendApplyLogRows() {
  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const dummyRow = {
    updatedAt: now,
    runId: 'TEST_APPEND',
    sourceSystem: '職人進捗管理',
    spreadsheetId: APP_CONFIG.spreadsheetId,
    sheetName: '現場一覧',
    rowNumber: 2,
    siteId: 'SITE-000',
    siteName: 'appendApplyLogRows_テスト',
    oldDriveFolderId: 'old_test_id',
    newDriveFolderId: 'new_test_id',
    suggestedDriveFolderId: 'new_test_id',
    auditStatus: 'SUGGEST_UPDATE',
    executedBy: 'debugTestAppendApplyLogRows',
    applyResult: 'SKIPPED',
    skipReason: 'TEST_ONLY',
    auditAt: now,
    backupSheetName: '',
    matchLevel: 'L3'
  };
  const result = AuditDriveFolders.appendApplyLogRowsToSheet_(
    [dummyRow],
    'DriveFolderId更新ログ_test'
  );
  Logger.log('[debugTestAppendApplyLogRows] result=%s', JSON.stringify(result));
}
