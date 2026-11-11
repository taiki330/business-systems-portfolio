/**
 * GAS エントリポイント
 * doGet でルーティングし、google.script.run のハンドラを公開する
 */

/** 公式LINE・共有リンクで使う公開URLを一元管理する。 */
function getPublicWebAppUrl_() {
    var configured = String((APP_CONFIG && APP_CONFIG.publicWebAppUrl) || '').trim();
    var url = configured || String(ScriptApp.getService().getUrl() || '').trim();
    return url.replace(/[?#].*$/, '').replace(/\/$/, '');
}

function buildCaseShareUrl_(caseId) {
    var cid = String(caseId == null ? '' : caseId).trim();
    if (!cid) return '';
    return getPublicWebAppUrl_() + '?caseId=' + encodeURIComponent(cid);
}

/**
 * GAS e.parameter は括弧付き文字を含む値で欠落する場合があるため、
 * e.queryString を直接パースして補完する。
 * @param {string} queryString
 * @returns {Object<string,string>}
 */
function parseQueryString_(queryString) {
    var out = {};
    if (!queryString || typeof queryString !== 'string') return out;
    var parts = queryString.split('&');
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (!part) continue;
        var eq = part.indexOf('=');
        var rawKey = eq < 0 ? part : part.substring(0, eq);
        var rawVal = eq < 0 ? '' : part.substring(eq + 1);
        var key = decodeQueryPart_(rawKey);
        if (Object.prototype.hasOwnProperty.call(out, key)) continue;
        out[key] = decodeQueryPart_(rawVal);
    }
    return out;
}

function decodeQueryPart_(s) {
    if (s == null) return '';
    var str = String(s).replace(/\+/g, ' ');
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str;
    }
}

function paramFirst_(e, key) {
    var arr = e && e.parameters && e.parameters[key];
    if (arr && arr.length) return String(arr[0] == null ? '' : arr[0]).trim();
    return '';
}

/**
 * URLパラメータに応じて画面を振り分ける
 * - ?mode=print → Print.html（帳票・印刷）
 * - ?mode=rect-viewer&prime=請負業者名 → RectViewer.html（請負業者別ビュー）
 * - ?caseId= または ?id=（print 以外）→ Upload.html（現場用）
 * - それ以外 → Index.html（管理用）
 */
function doGet(e) {
    const p = (e && e.parameter) || {};
    const q = parseQueryString_((e && e.queryString) || '');
    const mode = String(
        p.mode ||
        q.mode ||
        paramFirst_(e, 'mode') ||
        ''
    ).toLowerCase();
    const caseId = p.caseId || p.id || null;

    // 共通データ（自分のURLなど）
    const bootstrap = MasterDataService.getBootstrap();
    bootstrap.deployUrl = getPublicWebAppUrl_();

    // 帳票（印刷）— ?id= だけでは Upload へ飛ばさない。mode=print を最優先する
    // 案件IDはテンプレートに埋め込む（表示後の location.search から取れない環境があるため）
    if (mode === 'print') {
        const tPrint = HtmlService.createTemplateFromFile('Print');
        tPrint.embeddedCaseId = JSON.stringify(String(p.caseId || p.id || ''));
        tPrint.deployUrl = JSON.stringify(bootstrap.deployUrl || getPublicWebAppUrl_());
        return tPrint.evaluate()
            .setTitle('自主安全パトロール是正報告書（帳票）')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    // 請負業者別ビューア
    if (mode === 'rect-viewer') {
        const prime = String(
            p.prime ||
            q.prime ||
            paramFirst_(e, 'prime') ||
            ''
        ).trim();
        const viewerTemplate = HtmlService.createTemplateFromFile('RectViewer');
        viewerTemplate.bootstrap = {
            prime: prime,
            deployUrl: bootstrap.deployUrl
        };
        return viewerTemplate.evaluate()
            .setTitle('是正報告 — 請負業者別一覧')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    if (caseId) {
        // 現場用アップロード画面（または詳細表示）
        const caseBootstrap = CaseService.getCaseBootstrap(caseId);
        caseBootstrap.deployUrl = bootstrap.deployUrl; // これも追加
        const template = HtmlService.createTemplateFromFile('Upload'); // ※1
        template.bootstrap = caseBootstrap;
        return template.evaluate()
            .setTitle('是正後写真アップロード')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    // 管理用メイン画面
    const template = HtmlService.createTemplateFromFile('Index');
    template.bootstrap = bootstrap;
    return template.evaluate()
        .setTitle('是正報告システム')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * LINE Messaging API Webhook（userId 取得用）
 * 既存 Web アプリ画面とは独立。Verify / イベント受信時は常に 200 OK を返す。
 * @param {Object} e
 * @return {GoogleAppsScript.Content.TextOutput}
 */
var LINE_WEBHOOK_LOG_SHEET_NAME_ = 'LINE_Webhook_Log';
var LINE_WEBHOOK_LOG_HEADERS_ = ['日時', 'userId', 'groupId', 'roomId', 'type', 'messageText', 'rawBody'];

function ensureLineWebhookLogSheet_() {
    const sheet = SheetRepository.ensureSheet(LINE_WEBHOOK_LOG_SHEET_NAME_, LINE_WEBHOOK_LOG_HEADERS_);
    const firstHeader = sheet.getRange(1, 1).getValue();
    if (!firstHeader || String(firstHeader).trim() !== '日時') {
        sheet.getRange(1, 1, 1, LINE_WEBHOOK_LOG_HEADERS_.length).setValues([LINE_WEBHOOK_LOG_HEADERS_]);
        sheet.setFrozenRows(1);
    }
    return sheet;
}

function appendLineWebhookLogRow_(rowValues) {
    try {
        const sheet = ensureLineWebhookLogSheet_();
        sheet.appendRow(rowValues);
    } catch (logErr) {
        Logger.log('[LINE Webhook] sheet log error: ' + logErr);
    }
}

function doPost(e) {
    try {
        const body = e && e.postData && e.postData.contents ? e.postData.contents : '';
        Logger.log('[LINE Webhook] raw body: ' + body);

        if (body) {
            const json = JSON.parse(body);
            const events = json.events || [];
            if (events.length) {
                events.forEach(function(ev, index) {
                    const source = ev.source || {};
                    if (source.userId) {
                        Logger.log('[LINE Webhook] userId[' + index + ']: ' + source.userId);
                    }
                    if (source.groupId) {
                        Logger.log('[LINE Webhook] groupId[' + index + ']: ' + source.groupId);
                    }
                    if (source.roomId) {
                        Logger.log('[LINE Webhook] roomId[' + index + ']: ' + source.roomId);
                    }
                    const messageText =
                        ev.message && ev.message.text != null ? String(ev.message.text) : '';
                    appendLineWebhookLogRow_([
                        new Date(),
                        source.userId || '',
                        source.groupId || '',
                        source.roomId || '',
                        ev.type || '',
                        messageText,
                        body
                    ]);
                });
            } else {
                appendLineWebhookLogRow_([
                    new Date(),
                    '',
                    '',
                    '',
                    '',
                    '',
                    body
                ]);
            }
        } else {
            appendLineWebhookLogRow_([
                new Date(),
                '',
                '',
                '',
                '',
                '',
                ''
            ]);
        }
    } catch (err) {
        Logger.log('[LINE Webhook] error: ' + err);
    }

    return ContentService
        .createTextOutput('OK')
        .setMimeType(ContentService.MimeType.TEXT);
}


// ─── 案件 ────────────────────────────────────────────────

/**
 * 新規画面: 巡回日入力時の提出期日プレビュー（土曜営業・日曜祝休と Utilities_.calcSubmitDeadline 一致）
 * @param {string} patrolDateStr - yyyy-MM-dd 等
 * @returns {{ ok: boolean, year?: number, month?: number, day?: number, businessDays?: number, error?: string }}
 */
function previewSubmitDeadline(patrolDateStr) {
    try {
        const d = Utilities_.calcSubmitDeadline(patrolDateStr);
        return {
            ok: true,
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            day: d.getDate(),
            businessDays: APP_CONFIG.businessDaysToSubmit || 3
        };
    } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
    }
}

/** 案件一覧取得 */
function getCases(options) {
    return CaseService.getCases(!!(options && options.forceRefresh));
}

/** 案件詳細取得 (管理画面用) */
function getCaseDetail(caseId) {
    var result = CaseService.getCase(caseId);
    if (!result) return null;
    var c = result.case;
    var dlAlert = Utilities_.getDeadlineAlertState(
        c['提出期日'],
        c['全体ステータス'],
        c.pendingCount
    );
    var editable = CaseUpdateService.isCaseEditable(caseId);
    var replyDate = '';
    (result.details || []).forEach(function(d) {
        var uploadedAt = String(d['是正後アップロード日時'] || '').trim();
        if (!uploadedAt) return;
        var currentTime = new Date(replyDate || 0).getTime() || 0;
        var uploadedTime = new Date(uploadedAt).getTime() || 0;
        if (!replyDate || uploadedTime >= currentTime) replyDate = uploadedAt;
    });
    return {
        caseId: String(c['案件ID'] || ''),
        siteName: String(c['現場名'] || ''),
        reportCategory: String(c['報告区分'] || ''),
        primeContractorName: String(c['請負業者名'] || ''),
        contractor: String(c['施工会社名'] || ''),
        constructionTeam: String(c['施工班'] || ''),
        patrolDate: String(c['巡回日'] || ''),
        deadline: String(c['提出期日'] || ''),
        replyDate: replyDate,
        status: String(c['全体ステータス'] || ''),
        inspector: String(c['点検者'] || ''),
        buildingName: String(c['棟名'] || ''),
        shareUrl: String(c['共有URL'] || ''),
        isOverdue: dlAlert.isOverdue,
        isDueToday: dlAlert.isDueToday,
        isDeadlineAlert: dlAlert.isDeadlineAlert,
        daysOverdue: dlAlert.daysOverdue,
        deadlineState: dlAlert.deadlineState,
        deadlineMessage: dlAlert.message,
        canEdit: !!editable.ok,
        editBlockReason: editable.ok ? '' : String(editable.reason || ''),
        details: (result.details || []).map(function(d) {
            return {
                id: String(d['明細ID'] || ''),
                kind: String(d['種別'] || '').trim(),
                issue: String(d['指摘事項'] || ''),
                correctionRequest: String(d['修正依頼内容'] || ''),
                remark: String(d['備考'] || ''),
                correction: String(d['是正内容'] || ''),
                beforePhotoId: String(d['是正前写真URL'] || ''),
                afterPhotoId: String(d['是正後写真URL'] || ''),
                afterUploadedAt: String(d['是正後アップロード日時'] || ''),
                hasPreviousBeforePhoto: String(d['是正前写真変更履歴あり'] || '').toLowerCase() === 'true' || !!String(d['是正前写真URL（変更前）'] || '').trim(),
                hasPreviousAfterPhoto: String(d['是正後写真変更履歴あり'] || '').toLowerCase() === 'true' || !!String(d['是正後写真URL（変更前）'] || '').trim(),
                status: String(d['確認状態'] || '未提出'),
                rejectionReason: String(d['差し戻し理由'] || '')
            };
        })
    };
}

/**
 * 下書き編集フォーム復元用
 * @param {string} caseId
 */
function getCaseForEdit(caseId) {
    var cid = String(caseId || '').trim();
    var editable = CaseUpdateService.isCaseEditable(cid);
    if (!editable.ok) {
        return { success: false, canEdit: false, error: String(editable.reason || '編集できません') };
    }

    var result = CaseService.getCase(cid);
    if (!result) {
        return { success: false, canEdit: false, error: '案件が見つかりません' };
    }

    var c = result.case;
    var otherIds = ISSUE_CHECKLIST_CONFIG.otherItemIds;

    return {
        success: true,
        canEdit: true,
        caseId: String(c['案件ID'] || ''),
        siteName: String(c['現場名'] || ''),
        reportCategory: String(c['報告区分'] || ''),
        primeContractorName: String(c['請負業者名'] || ''),
        contractor: String(c['施工会社名'] || ''),
        constructionTeam: String(c['施工班'] || ''),
        inspector: String(c['点検者'] || ''),
        buildingName: String(c['棟名'] || ''),
        patrolDate: patrolDateToInputValue_(c['巡回日']),
        details: (result.details || []).map(function(d) {
            var issueItemId = String(d['指摘項目ID'] || '').trim();
            var issueLabel = '';
            if (issueItemId && otherIds && otherIds[String(d['種別'] || '').trim()] === issueItemId) {
                issueLabel = 'その他';
            } else if (issueItemId) {
                var def = getIssueItemById(issueItemId);
                issueLabel = def ? def.label : '';
            }
            return {
                detailId: String(d['明細ID'] || ''),
                order: Number(d['表示順']) || 0,
                kind: String(d['種別'] || '').trim(),
                issueItemId: issueItemId,
                issueLabel: issueLabel,
                freeText: String(d['自由記述'] || ''),
                issueText: String(d['指摘事項'] || ''),
                correctionRequest: String(d['修正依頼内容'] || ''),
                remark: String(d['備考'] || ''),
                beforePhotoUrl: String(d['是正前写真URL'] || ''),
                status: String(d['確認状態'] || '')
            };
        })
    };
}

/**
 * @param {string|Date} patrolDate
 * @returns {string} yyyy-MM-dd
 */
function patrolDateToInputValue_(patrolDate) {
    var d = Utilities_.parseDateOnly(patrolDate);
    if (!d || isNaN(d.getTime())) return '';
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
}

/**
 * 下書き案件更新
 * @param {Object} payload
 */
function updateCase(payload) {
    var p = Object.assign({}, payload);
    p.caseId = String((payload && payload.caseId) || '').trim();
    p.constructionTeam = String((payload && payload.constructionTeam) || '').trim();
    p.buildingName = String((payload && payload.buildingName) || '').trim();
    p.details = normalizeCheckedItemsForCase_(payload);
    return CaseUpdateService.updateCase(p);
}

/** 案件詳細取得 (汎用) */
function getCase(caseId) {
    return CaseService.getCase(caseId);
}

/**
 * 請負業者別ビューア用: 請負業者に紐づく案件一覧を返す
 * @param {string} primeName
 */
function getRectViewerPrimeCases(primeName) {
    return RectViewerService.getPrimeCases(primeName);
}

/**
 * チェック項目または旧形式明細を案件保存用 details に正規化する
 * @param {Object} payload
 * @return {Array<Object>}
 */
function normalizeCheckedItemsForCase_(payload) {
    var checked = payload && payload.checkedItems;
    if (Array.isArray(checked) && checked.length) {
        var flat = [];
        checked.forEach(function(item) {
            var kind = String((item && item.kind) || '').trim();
            var issueItemId = String((item && (item.itemId || item.issueItemId)) || '').trim();
            var freeText = String((item && item.freeText) || '').trim();
            var label = String((item && (item.issueLabel || item.label)) || '').trim();
            if (!label && issueItemId) {
                var def = getIssueItemById(issueItemId);
                if (def) label = def.label;
            }
            if (!label && freeText) label = 'その他';
            if (!kind || (!label && !freeText)) return;

            var subs = item && item.details;
            if (!Array.isArray(subs) || !subs.length) {
                subs = [{
                    correctionRequest: String((item && item.correctionRequest) || '').trim(),
                    remark: '',
                    detailTempId: (item && item.tempId) || ''
                }];
            }

            subs.forEach(function(sub) {
                var issueText = String((sub && sub.issueText) || '').trim();
                var detailId = String((sub && sub.detailId) || '').trim();
                flat.push({
                    detailId: detailId || null,
                    kind: kind,
                    issueItemId: issueItemId,
                    issueLabel: label,
                    freeText: freeText,
                    issueText: issueText,
                    correctionRequest: String((sub && sub.correctionRequest) || '').trim(),
                    remark: String((sub && sub.remark) || '').trim(),
                    issue: issueText || label,
                    correction: '',
                    beforePhotoUrl: String((sub && sub.beforePhotoUrl) || '').trim()
                });
            });
        });
        return flat.filter(function(d) {
            return d.kind && (d.issueText || d.issueLabel || d.freeText);
        });
    }
    var legacy = (payload && payload.details) || [];
    return legacy.map(function(d) {
        return {
            detailId: String((d && d.detailId) || '').trim() || null,
            kind: d && d.kind,
            issue: d && d.issue,
            issueLabel: (d && d.issue) || '',
            correction: d && d.correction,
            beforePhotoUrl: d && d.beforePhotoUrl,
            issueItemId: (d && d.issueItemId) || '',
            freeText: (d && d.freeText) || '',
            correctionRequest: (d && d.correctionRequest) || '',
            remark: (d && d.remark) || ''
        };
    });
}

/**
 * 新規案件作成（明細のテキストのみ。base64 は送らないこと。
 * 是正前写真は uploadCaseBeforePhoto を明細1件ずつ呼ぶ。google.script.run の制限回避）
 * @param {Object} payload
 * @param {Array}  payload.checkedItems [{ kind, itemId, issueLabel, freeText }]
 * @returns {{ success: boolean, caseId: string, shareUrl: string, detailIds?: string[] }}
 */
function createCase(payload) {
    const p = Object.assign({}, payload);
    p.constructionTeam = String((payload && payload.constructionTeam) || '').trim();
    p.buildingName = String((payload && payload.buildingName) || '').trim();
    p.details = normalizeCheckedItemsForCase_(payload);
    const result = CaseService.createCase(p);
    if (!result.success) {
        return result;
    }

    const caseId = result.caseId;
    const shareUrl = buildCaseShareUrl_(caseId);
    CaseService.updateCaseShareUrl(caseId, shareUrl);
    result.shareUrl = shareUrl;
    try {
        const notifyResult = NotificationService.notifyCorrectionReceived(caseId);
        if (notifyResult && notifyResult.warning) {
            result.notificationWarning = notifyResult.warning;
        }
    } catch (notifyErr) {
        Logger.log('createCase notifyCorrectionReceived: ' + notifyErr);
        result.notificationWarning = 'LINE通知に失敗しました（案件は保存済み）';
    }
    return result;
}

/**
 * 一件の是正前写真（案件新規直後。createCase とは別送信用）
 * @param {{ caseId: string, siteName: string, detailId: string, detailOrder: number, base64: string }} payload
 */
function uploadCaseBeforePhoto(payload) {
    try {
        const caseId = String((payload && payload.caseId) || '').trim();
        const siteName = String((payload && payload.siteName) || '').trim();
        const detailId = String((payload && payload.detailId) || '').trim();
        const detailOrder = Number((payload && payload.detailOrder) || 0) || 0;
        const base64 = payload && payload.base64;
        if (!caseId || !siteName || !detailId || !base64) {
            return { success: false, error: '必須パラメータが不足しています' };
        }
        const uploaded = DriveService.uploadBeforePhotos({
            caseId: caseId,
            siteName: siteName,
            photos: [
                {
                    detailOrder: detailOrder,
                    base64: base64
                }
            ]
        });
        if (!uploaded || !uploaded.length) {
            return { success: false, error: 'アップロードに失敗しました' };
        }
        const now = Utilities_.nowIso();
        const detailSheet = APP_CONFIG.sheetNames.details;
        const item = uploaded[0];
        SheetRepository.updateRow(detailSheet, '明細ID', detailId, {
            '是正前写真URL': item.url,
            '更新日時': now
        });
        return { success: true, afterPhotoUrl: item.url, fileId: item.fileId };
    } catch (e) {
        Logger.log('uploadCaseBeforePhoto: ' + e);
        return { success: false, error: String((e && e.message) || e) };
    }
}

/**
 * 管理画面から是正前・是正後写真を追加または差し替える。
 * 案件の進捗状態にかかわらず使用でき、是正後写真の変更時は再確認待ちに戻す。
 * @param {{caseId:string, siteName:string, detailId:string, detailOrder:number, photoType:'before'|'after', base64:string}} payload
 */
function replaceDetailPhoto(payload) {
    try {
        const caseId = String((payload && payload.caseId) || '').trim();
        const siteName = String((payload && payload.siteName) || '').trim();
        const detailId = String((payload && payload.detailId) || '').trim();
        const detailOrder = Number((payload && payload.detailOrder) || 0) || 0;
        const photoType = String((payload && payload.photoType) || '').trim();
        const base64 = payload && payload.base64;
        if (!caseId || !siteName || !detailId || !detailOrder || !base64 || (photoType !== 'before' && photoType !== 'after')) {
            return { success: false, error: '写真更新に必要な情報が不足しています' };
        }
        const detail = DetailService.getDetailById(detailId);
        if (!detail || String(detail['案件ID'] || '').trim() !== caseId) {
            return { success: false, error: '対象の指摘明細が見つかりません' };
        }

        DetailService.ensureDetailHeaders();

        let photoUrl = '';
        if (photoType === 'before') {
            const uploaded = DriveService.uploadBeforePhotos({
                caseId: caseId,
                siteName: siteName,
                photos: [{ detailOrder: detailOrder, base64: base64 }]
            });
            photoUrl = uploaded && uploaded[0] && uploaded[0].url;
            if (!photoUrl) return { success: false, error: '是正前写真の保存に失敗しました' };
            SheetRepository.updateRow(APP_CONFIG.sheetNames.details, '明細ID', detailId, {
                '是正前写真URL（変更前）': String(detail['是正前写真URL'] || ''),
                '是正前写真変更履歴あり': true,
                '是正前写真URL': photoUrl,
                '更新日時': Utilities_.nowIso()
            });
        } else {
            const uploaded = DriveService.uploadAfterPhoto({
                caseId: caseId,
                siteName: siteName,
                detailId: detailId,
                detailOrder: detailOrder,
                base64: base64
            });
            photoUrl = uploaded && uploaded.url;
            if (!photoUrl) return { success: false, error: '是正後写真の保存に失敗しました' };
            SheetRepository.updateRow(APP_CONFIG.sheetNames.details, '明細ID', detailId, {
                '是正後写真URL（変更前）': String(detail['是正後写真URL'] || ''),
                '是正後アップロード日時（変更前）': String(detail['是正後アップロード日時'] || ''),
                '確認状態（変更前）': String(detail['確認状態'] || ''),
                '差し戻し理由（変更前）': String(detail['差し戻し理由'] || ''),
                '確認者（変更前）': String(detail['確認者'] || ''),
                '確認日時（変更前）': String(detail['確認日時'] || ''),
                '是正後写真変更履歴あり': true,
                '是正後写真URL': photoUrl,
                '是正後アップロード日時': Utilities_.nowIso(),
                '確認状態': APP_CONFIG.status.detail.submitted,
                '差し戻し理由': '',
                '確認者': '',
                '確認日時': '',
                '更新日時': Utilities_.nowIso()
            });
            CaseService.refreshCaseStatus(caseId);
        }
        return { success: true, photoUrl: photoUrl };
    } catch (e) {
        return { success: false, error: String((e && e.message) || e) };
    }
}

/**
 * 管理画面で差し替えた写真を、直前の写真と状態へ戻す。
 * 現在値と変更前値を入れ替えるため、誤って戻した場合はもう一度押して再適用できる。
 */
function restorePreviousDetailPhoto(payload) {
    try {
        const caseId = String((payload && payload.caseId) || '').trim();
        const detailId = String((payload && payload.detailId) || '').trim();
        const photoType = String((payload && payload.photoType) || '').trim();
        if (!caseId || !detailId || (photoType !== 'before' && photoType !== 'after')) {
            return { success: false, error: '写真を戻すために必要な情報が不足しています' };
        }

        DetailService.ensureDetailHeaders();
        const detail = DetailService.getDetailById(detailId);
        if (!detail || String(detail['案件ID'] || '').trim() !== caseId) {
            return { success: false, error: '対象の指摘明細が見つかりません' };
        }

        const now = Utilities_.nowIso();
        let updateData;
        if (photoType === 'before') {
            const hasHistory = String(detail['是正前写真変更履歴あり'] || '').toLowerCase() === 'true' ||
                String(detail['是正前写真URL（変更前）'] || '').trim() !== '';
            if (!hasHistory) return { success: false, error: '戻せる是正前写真がありません' };
            updateData = {
                '是正前写真URL': String(detail['是正前写真URL（変更前）'] || ''),
                '是正前写真URL（変更前）': String(detail['是正前写真URL'] || ''),
                '是正前写真変更履歴あり': true,
                '更新日時': now
            };
        } else {
            const hasHistory = String(detail['是正後写真変更履歴あり'] || '').toLowerCase() === 'true' ||
                String(detail['是正後写真URL（変更前）'] || '').trim() !== '';
            if (!hasHistory) return { success: false, error: '戻せる是正後写真がありません' };
            updateData = {
                '是正後写真URL': String(detail['是正後写真URL（変更前）'] || ''),
                '是正後写真URL（変更前）': String(detail['是正後写真URL'] || ''),
                '是正後アップロード日時': String(detail['是正後アップロード日時（変更前）'] || ''),
                '是正後アップロード日時（変更前）': String(detail['是正後アップロード日時'] || ''),
                '確認状態': String(detail['確認状態（変更前）'] || APP_CONFIG.status.detail.pending),
                '確認状態（変更前）': String(detail['確認状態'] || ''),
                '差し戻し理由': String(detail['差し戻し理由（変更前）'] || ''),
                '差し戻し理由（変更前）': String(detail['差し戻し理由'] || ''),
                '確認者': String(detail['確認者（変更前）'] || ''),
                '確認者（変更前）': String(detail['確認者'] || ''),
                '確認日時': String(detail['確認日時（変更前）'] || ''),
                '確認日時（変更前）': String(detail['確認日時'] || ''),
                '是正後写真変更履歴あり': true,
                '更新日時': now
            };
        }

        const updated = SheetRepository.updateRow(APP_CONFIG.sheetNames.details, '明細ID', detailId, updateData);
        if (!updated) return { success: false, error: '写真を元に戻せませんでした' };
        if (photoType === 'after') CaseService.refreshCaseStatus(caseId);
        return { success: true };
    } catch (e) {
        return { success: false, error: String((e && e.message) || e) };
    }
}

// ─── 明細 ────────────────────────────────────────────────

/**
 * 確認状態の更新（確認完了 / 差し戻し）
 * @param {Object} payload
 * @param {string} payload.detailId
 * @param {string} payload.status   'approved' | 'rejected'
 * @param {string} [payload.reason]
 * @param {string} [payload.confirmedBy]
 */
function updateDetailStatus(payload) {
    const result = DetailService.updateDetailStatus(
        payload.detailId,
        payload.status,
        { reason: payload.reason, confirmedBy: payload.confirmedBy }
    );
    return result;
}

/**
 * 管理画面: 是正後の承認 / 差し戻し（Index の handleVerifyDetail から）
 */
function verifyDetail(payload) {
    const detailId = String((payload && payload.detailId) || '').trim();
    const isApproved = !!(payload && payload.isApproved);
    const note = String((payload && payload.note) || '').trim();
    const caseId = String((payload && payload.caseId) || '').trim();
    if (!detailId) {
        return { success: false, error: '明細IDがありません' };
    }
    if (!isApproved && !note) {
        return { success: false, error: '差し戻し理由を入力してください' };
    }
    const result = DetailService.updateDetailStatus(
        detailId,
        isApproved ? 'approved' : 'rejected',
        isApproved ? {} : { reason: note }
    );
    return result;
}

/** 管理画面: 選択した提出済み明細を一括承認する。 */
function approveDetailsBulk(payload) {
    const caseId = String((payload && payload.caseId) || '').trim();
    const detailIds = (payload && payload.detailIds) || [];
    if (!caseId) return { success: false, error: '案件IDがありません。' };
    return DetailService.approveDetails(caseId, detailIds);
}

// ─── 是正後写真 ──────────────────────────────────────────

/**
 * 是正後写真を1件アップロードして明細を「提出済み」に更新する
 * @param {Object} payload
 * @param {string} payload.detailId
 * @param {string} payload.caseId
 * @param {string} payload.siteName
 * @param {number} payload.detailOrder
 * @param {string} payload.base64     画像のBase64（data:image/...;base64,xxx形式）
 * @returns {{ success: boolean, afterPhotoUrl: string }}
 */
function submitAfterPhoto(payload) {
    try {
        // Driveに写真を保存
        const uploadResult = DriveService.uploadAfterPhoto({
            caseId: payload.caseId,
            siteName: payload.siteName,
            detailId: payload.detailId,
            detailOrder: payload.detailOrder,
            base64: payload.base64
        });

        // 明細の写真URL・状態を更新（現場側文字入力は保存しない）
        const updateResult = DetailService.updateAfterPhoto(
            payload.detailId,
            uploadResult.url
        );

        // 案件全体ステータスを自動更新
        let caseStatus = '';
        if (updateResult.success) {
            caseStatus = CaseService.refreshCaseStatus(payload.caseId);
        } else {
            return updateResult;
        }

        return { success: true, afterPhotoUrl: uploadResult.url, caseStatus: caseStatus || '' };
    } catch (e) {
        console.error('submitAfterPhoto エラー:', e.message, e.stack);
        return { success: false, error: e.message };
    }
}

/**
 * 現場用URL: 是正内容のみ保存（写真提出前に本文を残す場合）
 */
function saveDetailCorrection(payload) {
    try {
        const detailId = String((payload && payload.detailId) || '').trim();
        const correction = payload && payload.correction != null ? String(payload.correction) : '';
        if (!detailId) {
            return { success: false, error: '明細IDがありません' };
        }
        return DetailService.updateDetailCorrection(detailId, correction);
    } catch (e) {
        return { success: false, error: String((e && e.message) || e) };
    }
}

/**
 * 種別「良好」: 写真なしで提出済み（現場用URL）
 * @param {{ detailId: string, correction?: string }} payload
 */
function submitGoodDetail(payload) {
    try {
        const detailId = String((payload && payload.detailId) || '').trim();
        const caseId = String((payload && payload.caseId) || '').trim();
        if (!detailId) {
            return { success: false, error: '明細IDがありません' };
        }
        const hasC = payload && Object.prototype.hasOwnProperty.call(payload, 'correction');
        const correction = hasC ? (payload.correction == null ? '' : String(payload.correction)) : undefined;
        const result = DetailService.submitGoodDetail(detailId, correction);
        if (result && result.success && caseId) {
            result.caseStatus = CaseService.refreshCaseStatus(caseId);
        }
        return result;
    } catch (e) {
        return { success: false, error: String((e && e.message) || e) };
    }
}

/**
 * 複数の是正後写真を一括提出する
 * @param {Array} submissions [{ detailId, caseId, siteName, detailOrder, base64 }]
 * @returns {{ success: boolean, results: [] }}
 */
function submitAllAfterPhotos(submissions) {
    const results = [];
    let hasError = false;

    for (const item of submissions) {
        try {
            const res = submitAfterPhoto(item);
            results.push({ detailId: item.detailId, ...res });
            if (!res.success) hasError = true;
        } catch (e) {
            results.push({ detailId: item.detailId, success: false, error: e.message });
            hasError = true;
        }
    }

    return { success: !hasError, results };
}

// ─── Drive写真フォルダ ────────────────────────────────────

/**
 * 案件フォルダを事前準備してフォルダIDを返す（バッチアップロード用）
 * @param {{ caseId: string, siteName: string }}
 * @returns {{ caseFolderId, beforeFolderId, afterFolderId }}
 */
function prepareCaseFolderForBatch(payload) {
    return DriveService.prepareCaseFolderForBatch(payload.caseId, payload.siteName);
}

/**
 * 写真バッチアップロード（フロントから並列呼び出し）
 * @param {{ files, folderId, namePrefix }}
 * @returns {Array} [{ order, url, fileId }]
 */
function uploadPhotoBatch(payload) {
    return DriveService.uploadPhotoBatch({
        files: payload.files || [],
        folderId: payload.folderId,
        namePrefix: payload.namePrefix || ''
    });
}

// ─── 帳票 ────────────────────────────────────────────────

/**
 * 帳票用データを取得する
 * @param {string} caseId
 * @returns {Object} 帳票に必要なデータ一式
 */
function getReportData(caseId) {
    return ReportService.getReportData(caseId);
}

// ─── デバッグ ──────────────────────────────────────────
/**
 * システム情報の取得（デバッグ用）
 * google.script.run のシリアライズ問題を避けるため、全て文字列で返す
 */
function debug_getSystemInfo() {
  try {
    var ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
    var sheets = ss.getSheets();
    var sheetList = '';
    for (var i = 0; i < sheets.length; i++) {
      if (i > 0) sheetList += ', ';
      sheetList += sheets[i].getName() + '(' + sheets[i].getLastRow() + '行)';
    }

    // 案件シートを直接読み取る（SheetRepositoryを経由しない）
    var caseSheet = ss.getSheetByName(APP_CONFIG.sheetNames.cases);
    var caseInfo = 'シート "' + APP_CONFIG.sheetNames.cases + '" が見つかりません';
    var rowCount = 0;
    var headerText = '';
    var firstRowText = '';

    if (caseSheet) {
      var vals = caseSheet.getDataRange().getValues();
      rowCount = vals.length > 0 ? vals.length - 1 : 0; // ヘッダー除く
      if (vals.length > 0) {
        headerText = vals[0].map(function(h) { return String(h); }).join(', ');
      }
      if (vals.length > 1) {
        firstRowText = vals[1].map(function(v) { return String(v); }).join(' | ');
      }
      caseInfo = 'OK';
    }

    return {
      ssName: String(ss.getName()),
      ssUrl: String(ss.getUrl()),
      sheetList: sheetList,
      configSheetName: String(APP_CONFIG.sheetNames.cases),
      caseSheetStatus: caseInfo,
      dataRowCount: String(rowCount),
      headers: headerText,
      firstRow: firstRowText
    };
  } catch (e) {
    return {
      ssName: 'エラー',
      ssUrl: '',
      sheetList: '',
      configSheetName: String(APP_CONFIG.sheetNames.cases || ''),
      caseSheetStatus: 'エラー: ' + String(e.message),
      dataRowCount: '0',
      headers: '',
      firstRow: ''
    };
  }
}

/**
 * LINE通知の手動テスト（先頭 userId に1通送信）
 * GASエディタから実行
 */
function testLinePush() {
  var cfg = LineNotifyService.getLineConfig();
  Logger.log('LINE_NOTIFY_ENABLED=' + cfg.enabled);
  Logger.log('LINE_USER_IDS count=' + cfg.userIds.length);
  if (!cfg.enabled) {
    Logger.log('LINE_NOTIFY_ENABLED が true ではないため送信しません');
    return { ok: false, reason: 'disabled' };
  }
  if (!cfg.token) {
    Logger.log('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
    return { ok: false, reason: 'no_token' };
  }
  if (!cfg.userIds.length) {
    Logger.log('LINE_USER_IDS が未設定です');
    return { ok: false, reason: 'no_user_ids' };
  }
  var text = '【是正報告】LINE通知テスト\n送信時刻: ' + Utilities_.nowIso();
  try {
    var result = LineNotifyService.pushText(cfg.userIds[0], text);
    Logger.log('testLinePush 成功: ' + JSON.stringify(result));
    return { ok: true, userId: cfg.userIds[0], result: result };
  } catch (e) {
    Logger.log('testLinePush 失敗: ' + (e && e.message ? e.message : e));
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
