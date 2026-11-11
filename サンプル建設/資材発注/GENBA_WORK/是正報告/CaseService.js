/**
 * 案件サービス - 案件の作成・取得・ステータス管理
 */
const CaseService = (() => {
    const SHEET_NAME = APP_CONFIG.sheetNames.cases;
    const DETAIL_SHEET_NAME = APP_CONFIG.sheetNames.details;
    const HEADERS = APP_CONFIG.caseHeaders;
    const CASE_LIST_CACHE_KEY = 'rectification_case_list_v1';

    const invalidateCaseListCache = () => {
        try { CacheService.getScriptCache().remove(CASE_LIST_CACHE_KEY); } catch (e) { /* cache unavailable */ }
    };

    /**
     * 案件オブジェクトからヘッダー順の配列を生成する
     */
    const toRowValues = (caseObj) => {
        return HEADERS.map(header => caseObj[header] !== undefined ? caseObj[header] : '');
    };

    /**
     * セルが日付として解釈できるか（列ズレ補正用）
     */
    const dateOk = (v) => {
        if (v == null || v === '') return false;
        if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) return true;
        return Utilities_.parseDateOnly(v) != null;
    };

    /**
     * 共有URL等が日付枠に入っているときの判別
     */
    const isUrlLike = (v) => {
        const s = String(v == null ? '' : v).trim();
        if (!s) return false;
        if (/^https?:\/\//i.test(s)) return true;
        if (s.indexOf('docs.google.com') >= 0) return true;
        if (s.indexOf('drive.google.com') >= 0) return true;
        if (s.indexOf('script.google.com') >= 0) return true;
        if (s.indexOf('/macros/s/') >= 0) return true;
        return false;
    };

    const patrolAsDate = (v) => {
        if (v == null || v === '') return null;
        if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) return v;
        return Utilities_.parseDateOnly(v) || (isNaN(new Date(v).getTime()) ? null : new Date(v));
    };

    /**
     * A〜L 列定義: E=点検 F=巡回 G=提出 前提で、GがURL/不正なときG列生セル or 巡回から営業日再計算
     */
    const fixCaseDateAndDeadline = (obj, r) => {
        const n = (r && r.length) || 0;
        if (n < 1) return;
        if (n > 5 && dateOk(r[5]) && !isUrlLike(r[5])) {
            obj['巡回日'] = r[5];
        }
        if (n > 4 && (obj['点検者'] == null || String(obj['点検者'] || '').trim() === '')) {
            if (r[4] != null && r[4] !== '' && !dateOk(r[4]) && !isUrlLike(r[4])) {
                obj['点検者'] = r[4];
            }
        }
        const rawD = obj['提出期日'];
        const dBad = isUrlLike(rawD) || !dateOk(rawD) || (rawD != null && String(rawD).trim() === '');
        if (dBad && n > 6 && dateOk(r[6]) && !isUrlLike(r[6])) {
            obj['提出期日'] = r[6];
        } else if (dBad) {
            const p2 = patrolAsDate(n > 5 ? r[5] : obj['巡回日']);
            if (p2 && !isNaN(p2.getTime())) {
                obj['提出期日'] = Utilities_.formatDate(Utilities_.calcSubmitDeadline(p2));
            }
        }
    };

    /**
     * 1行目の列名で列を解決。欠け列は同じインデックス位置（A〜L）にフォールバック。
     */
    const normalizeCaseDataRow = (headerRow, dataRow) => {
        const h = (headerRow || []).map((x) => String(x == null ? '' : x).trim());
        const r = dataRow || [];
        const n = r.length;
        const obj = {};
        for (let i = 0; i < HEADERS.length; i++) {
            const key = HEADERS[i];
            const col = h.indexOf(key);
            if (col >= 0) {
                obj[key] = r[col] != null && r[col] !== '' ? r[col] : '';
            } else if (i < n) {
                obj[key] = r[i] != null && r[i] !== '' ? r[i] : '';
            } else {
                obj[key] = '';
            }
        }
        fixCaseDateAndDeadline(obj, r);
        return obj;
    };

    const readAllNormalizedCaseRows = () => {
        const values = SheetRepository.getCaseTableValues();
        if (values.length < 2) return [];
        const headerRow = values[0];
        return values
            .slice(1)
            .filter((row) => row.some((cell) => cell !== '' && cell != null))
            .map((row) => normalizeCaseDataRow(headerRow, row));
    };

    const ensureCaseHeaders = () => {
        const sheet = SheetRepository.ensureSheet(SHEET_NAME, HEADERS);
        const lastCol = sheet.getLastColumn();
        if (lastCol >= HEADERS.length) return;
        const missing = HEADERS.slice(lastCol);
        if (missing.length) {
            sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
        }
    };

    /**
     * 案件を作成する
     * @param {Object} caseData - { siteName, contractorName, inspector, patrolDate, details[], primeContractorName, reportCategory, constructionTeam }
     * @returns {{ success: boolean, caseId?: string, shareUrl?: string, error?: string }}
     */
    const createCase = (caseData) => {
        const lock = LockService.getScriptLock();
        try {
            lock.waitLock(10000);

            if (!String(caseData.primeContractorName || '').trim()) {
                return { success: false, error: '請負業者名は必須です' };
            }
            if (!String(caseData.inspector || '').trim()) {
                return { success: false, error: '点検者は必須です' };
            }
            if (!String(caseData.buildingName || '').trim()) {
                return { success: false, error: '棟名は必須です' };
            }

            ensureCaseHeaders();

            const caseId = Utilities_.generateCaseId();
            const now = Utilities_.nowIso();
            const submitDeadline = Utilities_.formatDate(Utilities_.calcSubmitDeadline(caseData.patrolDate));
            const patrolDateFormatted = Utilities_.formatDate(caseData.patrolDate);

            const contractor =
                caseData.contractorName ||
                caseData.contractor ||
                '';
            // 新規登録の報告区分は運用上、自主安全パトロールに固定する。
            const reportCat = APP_CONFIG.reportCategory;

            const caseObj = {
                '案件ID': caseId,
                '報告区分': reportCat,
                '現場名': caseData.siteName,
                '施工会社名': contractor,
                '点検者': String(caseData.inspector || '').trim(),
                '巡回日': patrolDateFormatted,
                '提出期日': submitDeadline,
                '全体ステータス': APP_CONFIG.status.case.draft,
                '共有URL': '',
                '作成日時': now,
                '更新日時': now,
                '請負業者名': String(caseData.primeContractorName || '').trim(),
                '施工班': String(caseData.constructionTeam || '').trim(),
                '棟名': String(caseData.buildingName || '').trim()
            };

            SheetRepository.appendRow(SHEET_NAME, toRowValues(caseObj), HEADERS);
            invalidateCaseListCache();

            let detailIds = [];
            if (caseData.details && caseData.details.length > 0) {
                const addRes = DetailService.addDetails(caseId, caseData.details);
                if (!addRes.success) {
                    return { success: false, error: addRes.error || '明細の保存に失敗しました' };
                }
                detailIds = addRes.detailIds || [];

                const logEntries = caseData.details.map(function(detail, index) {
                    return {
                        detailId: detailIds[index] || '',
                        kind: detail.kind || '',
                        issueItemId: detail.issueItemId || '',
                        issueLabel: detail.issueText || detail.issueLabel || detail.issue || '',
                        freeText: detail.freeText || detail.issueText || ''
                    };
                });
                const logRes = IssueLogService.addLogs(caseId, logEntries, {
                    siteName: caseData.siteName,
                    companyName: contractor,
                    constructionTeam: caseData.constructionTeam || '',
                    inspector: caseData.inspector || '',
                    reportCategory: reportCat
                });
                if (!logRes.success) {
                    return { success: false, error: logRes.error || '指摘ログの保存に失敗しました' };
                }
            }

            invalidateCaseListCache();
            return { success: true, caseId: caseId, shareUrl: '', detailIds: detailIds };
        } catch (e) {
            return { success: false, error: e.message };
        } finally {
            lock.releaseLock();
        }
    };

    /**
     * 案件一覧を取得する（更新日時の降順）
     * @returns {Object[]} 案件オブジェクトの配列
     */
    const getCases = (forceRefresh) => {
        if (!forceRefresh) {
            try {
                const cached = CacheService.getScriptCache().get(CASE_LIST_CACHE_KEY);
                if (cached) return JSON.parse(cached);
            } catch (e) { /* fall through to spreadsheet */ }
        }
        const cases = readAllNormalizedCaseRows();
        if (!cases.length) return [];

        // 指摘明細を一度だけ読み込む（N+1クエリ回避）
        const { rows: allDetails } = SheetRepository.readTable(DETAIL_SHEET_NAME);
        
        // 案件IDごとに集計
        const statsMap = {};
        allDetails.forEach(d => {
            const cid = d['案件ID'];
            if (!cid) return;
            if (!statsMap[cid]) statsMap[cid] = { pending: 0, rejected: 0, replyDate: '' };
            if (d['確認状態'] === APP_CONFIG.status.detail.pending) statsMap[cid].pending++;
            if (d['確認状態'] === APP_CONFIG.status.detail.rejected) statsMap[cid].rejected++;
            const uploadedAt = String(d['是正後アップロード日時'] || '').trim();
            if (uploadedAt) {
                const currentTime = new Date(statsMap[cid].replyDate || 0).getTime() || 0;
                const uploadedTime = new Date(uploadedAt).getTime() || 0;
                if (!statsMap[cid].replyDate || uploadedTime >= currentTime) {
                    statsMap[cid].replyDate = uploadedAt;
                }
            }
        });

        const result = cases
            .map(row => {
                const cid = row['案件ID'];
                const stats = statsMap[cid] || { pending: 0, rejected: 0, replyDate: '' };
                const submitDeadline = String(row['提出期日'] || '');
                const overallStatus = String(row['全体ステータス'] || '');
                const alert = Utilities_.getDeadlineAlertState(
                    submitDeadline,
                    overallStatus,
                    stats.pending
                );
                return {
                    caseId: String(cid || ''),
                    siteName: String(row['現場名'] || ''),
                    buildingName: String(row['棟名'] || '').trim(),
                    reportCategory: String(row['報告区分'] || ''),
                    primeContractorName: String(row['請負業者名'] || ''),
                    contractor: String(row['施工会社名'] || ''),
                    constructionTeam: String(row['施工班'] || ''),
                    inspector: String(row['点検者'] || ''),
                    status: overallStatus,
                    patrolDate: String(row['巡回日'] || ''),
                    submitDeadline: submitDeadline,
                    replyDate: stats.replyDate,
                    pendingCount: stats.pending,
                    rejectedCount: stats.rejected,
                    updatedAt: String(row['更新日時'] || ''),
                    isOverdue: alert.isOverdue,
                    isDueToday: alert.isDueToday,
                    isDeadlineAlert: alert.isDeadlineAlert,
                    daysOverdue: alert.daysOverdue,
                    deadlineState: alert.deadlineState,
                    deadlineMessage: alert.message
                };
            })
            .sort((a, b) => {
                if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
                const dateA = new Date(a.updatedAt || 0);
                const dateB = new Date(b.updatedAt || 0);
                return dateB - dateA;
            });
        try { CacheService.getScriptCache().put(CASE_LIST_CACHE_KEY, JSON.stringify(result), 60); } catch (e) { /* ignore */ }
        return result;
    };

    /**
     * 案件詳細を取得する
     * @param {string} caseId - 案件ID
     * @returns {{ case: Object, details: Object[] } | null}
     */
    const getCase = (caseId) => {
        const rows = readAllNormalizedCaseRows();
        const caseRow = rows.find(row => String(row['案件ID']) === String(caseId));
        if (!caseRow) return null;

        const details = DetailService.getDetailsByCaseId(caseId);
        let pendingCount = 0;
        let rejectedCount = 0;
        (details || []).forEach((detail) => {
            if (detail['確認状態'] === APP_CONFIG.status.detail.pending) pendingCount++;
            if (detail['確認状態'] === APP_CONFIG.status.detail.rejected) rejectedCount++;
        });

        return {
            case: Object.assign({}, caseRow, { pendingCount, rejectedCount }),
            details: details
        };
    };

    /**
     * Upload.html 用のブートストラップデータを返す
     * @param {string} caseId - 案件ID
     * @returns {{ caseId: string, caseInfo: Object, details: Object[] } | null}
     */
    const getCaseBootstrap = (caseId) => {
        const result = getCase(caseId);
        if (!result) return null;

        const c = result.case;
        const alert = Utilities_.getDeadlineAlertState(
            c['提出期日'],
            c['全体ステータス'],
            c.pendingCount
        );
        const details = (result.details || []).map(d => ({
            detailId: d['明細ID'] || '',
            caseId: d['案件ID'] || '',
            order: Number(d['表示順']) || 0,
            kind: String(d['種別'] || '').trim(),
            issue: d['指摘事項'] || '',
            correction: d['是正内容'] || '',
            correctionRequest: d['修正依頼内容'] || '',
            remark: d['備考'] || '',
            beforePhotoUrl: d['是正前写真URL'] || '',
            afterPhotoUrl: d['是正後写真URL'] || '',
            status: d['確認状態'] || '',
            rejectionReason: d['差し戻し理由'] || ''
        }));

        return {
            caseId: caseId,
            caseInfo: {
                reportCategory: c['報告区分'] || '',
                siteName: c['現場名'] || '',
                primeContractorName: c['請負業者名'] || '',
                contractorName: c['施工会社名'] || '',
                inspector: String(c['点検者'] || ''),
                buildingName: String(c['棟名'] || ''),
                patrolDate: Utilities_.formatDisplayDateJst(c['巡回日']),
                submitDeadline: Utilities_.formatDisplayDateJst(c['提出期日']),
                overallStatus: c['全体ステータス'] || '',
                isOverdue: alert.isOverdue,
                isDueToday: alert.isDueToday,
                isDeadlineAlert: alert.isDeadlineAlert,
                daysOverdue: alert.daysOverdue,
                deadlineState: alert.deadlineState,
                deadlineMessage: alert.message
            },
            details: details
        };
    };

    /**
     * 案件の共有URLを更新する
     * @param {string} caseId - 案件ID
     * @param {string} shareUrl - 共有URL
     */
    const updateCaseShareUrl = (caseId, shareUrl) => {
        SheetRepository.updateRow(SHEET_NAME, '案件ID', caseId, {
            '共有URL': shareUrl,
            '更新日時': Utilities_.nowIso()
        });
        invalidateCaseListCache();
    };

    /**
     * 案件全体ステータスを明細の確認状態に基づいて自動更新する
     * @param {string} caseId - 案件ID
     */
    const refreshCaseStatus = (caseId) => {
        const details = DetailService.getDetailsByCaseId(caseId);
        if (details.length === 0) return;

        let newStatus;
        const allApproved = details.every(d => d['確認状態'] === APP_CONFIG.status.detail.approved);
        const hasRejected = details.some(d => d['確認状態'] === APP_CONFIG.status.detail.rejected);
        const hasSubmitted = details.some(d => d['確認状態'] === APP_CONFIG.status.detail.submitted);

        if (allApproved) {
            newStatus = APP_CONFIG.status.case.completed;
        } else if (hasRejected) {
            newStatus = APP_CONFIG.status.case.reviewing;
        } else if (hasSubmitted) {
            newStatus = APP_CONFIG.status.case.reviewing;
        } else {
            // 提出済みの明細があるかどうかで判断
            const hasAnySubmittedOrApproved = details.some(d =>
                d['確認状態'] === APP_CONFIG.status.detail.submitted ||
                d['確認状態'] === APP_CONFIG.status.detail.approved
            );
            newStatus = hasAnySubmittedOrApproved
                ? APP_CONFIG.status.case.submitted
                : APP_CONFIG.status.case.draft;
        }

        SheetRepository.updateRow(SHEET_NAME, '案件ID', caseId, {
            '全体ステータス': newStatus,
            '更新日時': Utilities_.nowIso()
        });
        invalidateCaseListCache();
        return newStatus;
    };

    /**
     * 案件ヘッダー行を更新する（下書き編集用）
     * @param {string} caseId
     * @param {Object} fields - { ヘッダー名: 値 }
     */
    const updateCaseHeaderRow = (caseId, fields) => {
        ensureCaseHeaders();
        const updated = SheetRepository.updateRow(SHEET_NAME, '案件ID', caseId, fields);
        if (!updated) {
            throw new Error('案件ID "' + String(caseId) + '" が見つかりません。');
        }
        invalidateCaseListCache();
        return true;
    };

    return {
        createCase,
        getCases,
        getCase,
        getCaseBootstrap,
        updateCaseShareUrl,
        refreshCaseStatus,
        updateCaseHeaderRow
    };
})();
