/**
 * GAS `e.parameter` は `?team=サンプル組D` のように括弧付きの値で欠落する場合がある。
 * `e.queryString` を一括でパースして補完する（GET のみ）。
 * @return {Object<string, string>}
 */
function parseQueryString_(queryString) {
  var out = {};
  if (!queryString || typeof queryString !== 'string') {
    return out;
  }
  var parts = queryString.split('&');
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (!part) {
      continue;
    }
    var eq = part.indexOf('=');
    var rawKey;
    var rawVal;
    if (eq < 0) {
      rawKey = part;
      rawVal = '';
    } else {
      rawKey = part.substring(0, eq);
      rawVal = part.substring(eq + 1);
    }
    var key = _qpDecodeKeyOrVal_(rawKey);
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      continue;
    }
    out[key] = _qpDecodeKeyOrVal_(rawVal);
  }
  return out;
}

function _qpDecodeKeyOrVal_(s) {
  if (s == null) {
    return '';
  }
  var str = String(s).replace(/\+/g, ' ');
  try {
    return decodeURIComponent(str);
  } catch (ignore) {
    return str;
  }
}

/** `e.parameters[key]` の先頭（配列で届く場合の補助） */
function _paramFirst_(e, key) {
  const a = e && e.parameters && e.parameters[key];
  if (a && a.length) {
    return String(a[0] == null ? '' : a[0]).trim();
  }
  return '';
}

/**
 * GAS entry points invoked from the client.
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const q = parseQueryString_((e && e.queryString) || '');
  const siteParam = String(
    p.site ||
      p.siteId ||
      q.site ||
      q.siteId ||
      _paramFirst_(e, 'site') ||
      _paramFirst_(e, 'siteId') ||
      ''
  ).trim();
  const teamParam = String(
    p.team ||
      p.請負業者 ||
      q.team ||
      q.請負業者 ||
      _paramFirst_(e, 'team') ||
      _paramFirst_(e, '請負業者') ||
      ''
  ).trim();
  const viewParam = String(
    p.view || q.view || _paramFirst_(e, 'view') || ''
  ).toLowerCase();
  // 職人向け閲覧: ?view=viewer / ?site=… / ?team=請負業者名（施工業者→現場の順に選択）
  if (
    siteParam ||
    teamParam ||
    viewParam === 'viewer' ||
    viewParam === 'site'
  ) {
    const building = String(
      p.building || q.building || _paramFirst_(e, 'building') || ''
    ).trim();
    let resolvedSiteId = '';
    let resolvedSiteName = '';
    let resolveError = '';
    let looksResolved = false;
    /** 請負業者ウィザード用（team 引数、または site= に誤って請負名を入れた場合の振り替え） */
    let teamNameForBoot = teamParam;
    /** @type {'site'|'team'|'help'} */
    let bootMode = 'help';

    if (siteParam) {
      bootMode = 'site';
      const looksLikeSiteId = /^SITE-\d+$/i.test(siteParam);
      const resolved = MasterDataService.resolveSiteForReport(
        looksLikeSiteId
          ? { siteId: siteParam, siteName: '' }
          : { siteId: '', siteName: siteParam }
      );
      resolvedSiteId = String((resolved && resolved.id) || '').trim();
      resolvedSiteName = String((resolved && resolved.name) || '').trim();
      looksResolved = !!(
        resolvedSiteId && /^SITE-\d+$/i.test(resolvedSiteId)
      );
      if (!looksResolved) {
        if (looksLikeSiteId) {
          // SITE-形式だがマスタに無い → 現場解決失敗のまま
          resolveError =
            '現場ID・現場名のどちらとも、現場一覧マスタに一致する現場がありませんでした。';
        } else {
          // 現場名としては解けない → 請負業者名を site= に入れた誤用として team 案内へ
          bootMode = 'team';
          teamNameForBoot = teamParam || siteParam;
          resolveError = '';
        }
      }
    } else if (teamParam) {
      bootMode = 'team';
    }

    const t = HtmlService.createTemplateFromFile('Viewer');
    t.bootPayload = encodeURIComponent(
      JSON.stringify({
        mode: bootMode,
        siteId: looksResolved ? resolvedSiteId : '',
        siteName: resolvedSiteName,
        teamName: teamNameForBoot,
        building: building,
        resolveError: resolveError || undefined
      })
    );
    return t
      .evaluate()
      .setTitle('現場報告一覧')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME);
  }

  // 初回HTMLは ScriptCache を使わず毎回組み立てる（現場で設定変更後もURLを変えず確実に反映）
  const bootstrap = FormConfigService.getBootstrapPayload();
  FormConfigService.setFormConfigCache(bootstrap);

  const template = HtmlService.createTemplateFromFile('Index');
  template.bootstrap = bootstrap;
  return template
    .evaluate()
    .setTitle('現場進捗報告')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

function getBootstrapData() {
  const payload = FormConfigService.getBootstrapPayload();
  FormConfigService.setFormConfigCache(payload);
  return payload;
}

function submitReport(payload) {
  return ReportService.saveReport(payload);
}

function submitResendReport(payload) {
  return ReportService.saveResendReport(payload);
}

/**
 * 並列バッチアップロード用: Drive フォルダを作成して folderId を返す。
 * フロントエンドが画像アップロード前に1回だけ呼び出す。
 */
function prepareReportFolder(payload) {
  const site = MasterDataService.resolveSiteForReport({
    siteId: payload.siteId,
    siteName: payload.siteName || ''
  });
  return DriveService.createReportFolderForBatch({
    site,
    reportType: payload.reportType,
    workerName: payload.reporterName,
    submittedAt: payload.submittedAt,
    buildingName: payload.buildingName || ''
  });
}

/**
 * フォルダ確保と最初の写真バッチを1回のサーバー呼び出しで行う（google.script.run の往復削減）。
 */
function prepareFolderAndUploadFirstBatch(payload) {
  const site = MasterDataService.resolveSiteForReport({
    siteId: payload.siteId,
    siteName: payload.siteName || ''
  });
  const folderRes = DriveService.createReportFolderForBatch({
    site,
    reportType: payload.reportType,
    workerName: payload.reporterName,
    submittedAt: payload.submittedAt,
    buildingName: payload.buildingName || ''
  });
  const folderId = folderRes && folderRes.folderId;
  const files = (payload && payload.files) || [];
  if (!folderId) {
    return { folderId: '', files: [] };
  }
  if (!files.length) {
    return { folderId, files: [] };
  }
  const uploadResult = DriveService.uploadPhotoBatch({
    files,
    folderId,
    questionLabels: (payload && payload.questionLabels) || {},
    namePrefix: (payload && payload.namePrefix) || 'b0_'
  });
  return {
    folderId,
    files: uploadResult.files || [],
    isQuarantine: !!(folderRes && folderRes.isQuarantine),
    quarantineReason: (folderRes && folderRes.quarantineReason) || '',
    quarantineFolderUrl: (folderRes && folderRes.quarantineFolderUrl) || '',
    quarantineCaseFolderId: (folderRes && folderRes.quarantineCaseFolderId) || '',
    intendedPath: (folderRes && folderRes.intendedPath) || '',
    driveFolderIdFromMaster: (folderRes && folderRes.driveFolderIdFromMaster) || '',
    actualFolderName: (folderRes && folderRes.actualFolderName) || ''
  };
}

/**
 * 並列バッチアップロード用: 指定フォルダに画像バッチを保存する。
 * フロントエンドから複数並列で呼び出される。
 */
function uploadPhotoBatch(payload) {
  return DriveService.uploadPhotoBatch({
    files: payload.files || [],
    folderId: payload.folderId,
    questionLabels: payload.questionLabels || {},
    namePrefix: payload.namePrefix || ''
  });
}

/**
 * アップロード失敗時のロールバック: 作成済みフォルダを削除する。
 */
function deleteReportFolder(folderId) {
  return DriveService.deleteReportFolder(folderId);
}

function updateFormConfig(records) {
  return FormConfigService.updateFormConfig(records);
}

function validatePasscode(passcode) {
  return SecurityService.validatePasscode(passcode);
}

function checkTsumeshoStatus(siteId, buildingName) {
  return ReportService.getTsumeshoStatus(siteId, buildingName);
}

/**
 * 職人向け閲覧画面用：指定現場の報告ログを集約して返す。
 */
function getViewerSiteReports(siteId, building) {
  return SiteReportViewerService.getSiteReports(siteId, building);
}

/**
 * 請負業者名に紐づく施工業者×現場の一覧（閲覧の選択 UI 用）。
 */
function getViewerTeamSites(teamName) {
  return SiteReportViewerService.getTeamSitePairs(teamName);
}

// ── Admin entry points ──

function getAdminConfig() {
  return AdminService.getAdminConfig();
}

function saveAdminConfigFromClient(incoming) {
  return AdminService.saveAdminConfig(incoming);
}

function runMigration() {
  return AdminService.migrateFromSheet();
}

/**
 * `<?!= include('Styles') ?>` helper inside HTML templates.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
