/**
 * 下書き案件編集サービス - 差分CRUD（明細ID・ログID維持）
 */
const CaseUpdateService = (() => {
  const detailBelongsToCase = (detailId, caseId) => {
    const match = String(detailId || '').match(/^(CASE-\d+)-\d{3}$/);
    return match ? match[1] === String(caseId) : false;
  };

  /**
   * @param {string} caseId
   * @returns {{ ok: boolean, reason?: string }}
   */
  const isCaseEditable = (caseId) => {
    const cid = String(caseId || '').trim();
    if (!cid) {
      return { ok: false, reason: '案件IDが指定されていません' };
    }

    const result = CaseService.getCase(cid);
    if (!result) {
      return { ok: false, reason: '案件が見つかりません' };
    }

    const caseRow = result.case;
    if (caseRow['全体ステータス'] !== APP_CONFIG.status.case.draft) {
      return { ok: false, reason: '下書き以外の案件は編集できません' };
    }

    (result.details || []).forEach((detail) => {
      if (detail['確認状態'] !== APP_CONFIG.status.detail.pending) {
        throw new Error('現場が提出済みの指摘があるため編集できません');
      }
      if (String(detail['是正内容'] || '').trim()) {
        throw new Error('現場が是正報告内容を入力済みのため編集できません');
      }
      if (String(detail['是正後写真URL'] || '').trim()) {
        throw new Error('現場が是正後写真を登録済みのため編集できません');
      }
      if (String(detail['是正後アップロード日時'] || '').trim()) {
        throw new Error('現場が是正後写真を登録済みのため編集できません');
      }
    });

    return { ok: true };
  };

  /**
   * @param {string} caseId
   * @returns {{ ok: boolean, reason?: string }}
   */
  const isCaseEditableSafe = (caseId) => {
    try {
      return isCaseEditable(caseId);
    } catch (e) {
      return { ok: false, reason: String(e.message || e) };
    }
  };

  /**
   * @param {string} caseId
   * @returns {string}
   */
  const generateNextDetailId = (caseId) => {
    const details = DetailService.getDetailsByCaseId(caseId);
    let max = 0;
    details.forEach((d) => {
      const m = String(d['明細ID'] || '').match(/-(\d{3})$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `${caseId}-${String(max + 1).padStart(3, '0')}`;
  };

  /**
   * @param {string} caseId
   * @returns {string}
   */
  const generateNextLogId = (caseId) => {
    const logs = IssueLogService.getLogsByCaseId(caseId);
    let max = 0;
    logs.forEach((l) => {
      const m = String(l['ログID'] || '').match(/-LOG-(\d{3})$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `${caseId}-LOG-${String(max + 1).padStart(3, '0')}`;
  };

  /**
   * @param {Object} raw
   * @returns {Object}
   */
  const normalizeIncomingDetail = (raw) => {
    const issueItemId = String((raw && raw.issueItemId) || '').trim();
    let issueLabel = String((raw && (raw.issueLabel || raw.label)) || '').trim();
    const freeText = String((raw && raw.freeText) || '').trim();
    if (!issueLabel && issueItemId) {
      const def = getIssueItemById(issueItemId);
      if (def) issueLabel = def.label;
    }
    if (!issueLabel && freeText) issueLabel = 'その他';

    const issueTextRaw = String((raw && raw.issueText) == null ? '' : raw.issueText).trim();
    const issueText = issueTextRaw || DetailService.buildIssueText(issueLabel, freeText);

    return {
      detailId: String((raw && raw.detailId) || '').trim() || null,
      kind: String((raw && raw.kind) || '').trim(),
      issueItemId: issueItemId,
      issueLabel: issueLabel,
      freeText: freeText,
      issueText: issueText,
      correctionRequest: String((raw && raw.correctionRequest) == null ? '' : raw.correctionRequest).trim(),
      remark: String((raw && raw.remark) == null ? '' : raw.remark).trim(),
      beforePhotoUrl: String((raw && raw.beforePhotoUrl) || '').trim()
    };
  };

  /**
   * @param {Object[]} existing
   * @param {Object[]} incoming
   * @param {string} caseId
   * @returns {{ ordered: Object[], toDelete: string[] }}
   */
  const diffDetails = (existing, incoming, caseId) => {
    const existingMap = {};
    (existing || []).forEach((row) => {
      const id = String(row['明細ID'] || '').trim();
      if (id) existingMap[id] = row;
    });

    const incomingIds = new Set();
    const ordered = [];

    (incoming || []).forEach((raw, index) => {
      const item = normalizeIncomingDetail(raw);
      item.order = index + 1;
      if (!item.kind || !item.issueText) {
        throw new Error('指摘明細の種別または指摘事項が不足しています');
      }

      if (item.detailId) {
        if (!existingMap[item.detailId]) {
          throw new Error('明細ID "' + item.detailId + '" が見つかりません');
        }
        if (!detailBelongsToCase(item.detailId, caseId)) {
          throw new Error('他案件の明細IDが含まれています');
        }
        incomingIds.add(item.detailId);
        ordered.push({ op: 'update', item: item });
      } else {
        ordered.push({ op: 'insert', item: item });
      }
    });

    const toDelete = Object.keys(existingMap).filter((id) => !incomingIds.has(id));
    return { ordered, toDelete };
  };

  /**
   * @param {string} caseId
   * @param {{ ordered: Object[], toDelete: string[] }} diff
   * @returns {{ updated: string[], inserted: string[], deleted: string[], detailIdsInOrder: string[], syncItems: Object[] }}
   */
  const syncDetails = (caseId, diff) => {
    const now = Utilities_.nowIso();
    const updated = [];
    const inserted = [];
    const deleted = [];
    const syncItems = [];
    const insertIdByOrder = {};

    (diff.ordered || []).filter((entry) => entry.op === 'insert').forEach((entry) => {
      const item = entry.item;
      const detailId = generateNextDetailId(caseId);
      insertIdByOrder[item.order] = detailId;

      const detailObj = {
        '明細ID': detailId,
        '案件ID': caseId,
        '表示順': item.order,
        '区分番号': item.order,
        '種別': item.kind,
        '指摘事項': item.issueText,
        '是正内容': '',
        '是正前写真URL': item.beforePhotoUrl || '',
        '是正後写真URL': '',
        '是正後アップロード日時': '',
        '確認状態': APP_CONFIG.status.detail.pending,
        '差し戻し理由': '',
        '確認者': '',
        '確認日時': '',
        '作成日時': now,
        '更新日時': now,
        '指摘項目ID': item.issueItemId,
        '自由記述': item.freeText,
        '修正依頼内容': item.correctionRequest,
        '備考': item.remark
      };
      const res = DetailService.insertDetailRow(detailObj);
      if (!res.success) {
        throw new Error(res.error || '明細の追加に失敗しました');
      }
      inserted.push(detailId);
      syncItems.push({ action: 'insert', detailId: detailId, item: item });
    });

    (diff.ordered || []).filter((entry) => entry.op === 'update').forEach((entry) => {
      const item = entry.item;
      const updateFields = {
        '表示順': item.order,
        '区分番号': item.order,
        '種別': item.kind,
        '指摘事項': item.issueText,
        '指摘項目ID': item.issueItemId,
        '自由記述': item.freeText,
        '修正依頼内容': item.correctionRequest,
        '備考': item.remark,
        '是正前写真URL': item.beforePhotoUrl || ''
      };

      const res = DetailService.updateDetailRow(item.detailId, updateFields);
      if (!res.success) {
        throw new Error(res.error || '明細の更新に失敗しました');
      }
      updated.push(item.detailId);
      syncItems.push({ action: 'update', detailId: item.detailId, item: item });
    });

    (diff.toDelete || []).forEach((detailId) => {
      const res = DetailService.deleteDetailRow(detailId);
      if (!res.success) {
        throw new Error(res.error || '明細の削除に失敗しました');
      }
      deleted.push(detailId);
      syncItems.push({ action: 'delete', detailId: detailId });
    });

    const detailIdsInOrder = (diff.ordered || []).map((entry) => {
      if (entry.op === 'update') return entry.item.detailId;
      return insertIdByOrder[entry.item.order];
    });

    return { updated, inserted, deleted, detailIdsInOrder, syncItems };
  };

  /**
   * @param {Object} item
   * @param {Object} caseMeta
   * @returns {Object}
   */
  const buildLogMetaFields = (item, caseMeta) => ({
    '現場名': caseMeta.siteName || '',
    '会社名': caseMeta.companyName || '',
    '施工班': caseMeta.constructionTeam || '',
    '巡回者': caseMeta.inspector || '',
    '報告区分': caseMeta.reportCategory || '',
    '区分': item.kind || '',
    '指摘項目ID': item.issueItemId || '',
    '指摘項目': item.issueLabel || '',
    '自由記述': item.freeText || ''
  });

  /**
   * @param {string} caseId
   * @param {{ syncItems: Object[] }} detailSyncResult
   * @param {Object} caseMeta
   */
  const syncIssueLogs = (caseId, detailSyncResult, caseMeta) => {
    const now = Utilities_.nowIso();

    (detailSyncResult.syncItems || []).forEach((entry) => {
      if (entry.action === 'insert') {
        const logObj = Object.assign(
          {
            ログID: generateNextLogId(caseId),
            案件ID: caseId,
            明細ID: entry.detailId,
            報告日時: now,
            作成日時: now
          },
          buildLogMetaFields(entry.item, caseMeta)
        );
        const res = IssueLogService.insertLogRow(logObj);
        if (!res.success) {
          throw new Error(res.error || '指摘ログの追加に失敗しました');
        }
        return;
      }

      if (entry.action === 'update') {
        const log = IssueLogService.getLogByDetailId(entry.detailId);
        if (!log) {
          const logObj = Object.assign(
            {
              ログID: generateNextLogId(caseId),
              案件ID: caseId,
              明細ID: entry.detailId,
              報告日時: now,
              作成日時: now
            },
            buildLogMetaFields(entry.item, caseMeta)
          );
          IssueLogService.insertLogRow(logObj);
          return;
        }
        const res = IssueLogService.updateLogRow(log['ログID'], buildLogMetaFields(entry.item, caseMeta));
        if (!res.success) {
          throw new Error(res.error || '指摘ログの更新に失敗しました');
        }
        return;
      }

      if (entry.action === 'delete') {
        const res = IssueLogService.deleteLogByDetailId(entry.detailId);
        if (!res.success) {
          throw new Error(res.error || '指摘ログの削除に失敗しました');
        }
      }
    });
  };

  /**
   * @param {string} caseId
   * @param {Object} headerData
   */
  const updateCaseHeader = (caseId, headerData) => {
    const submitDeadline = Utilities_.formatDate(
      Utilities_.calcSubmitDeadline(headerData.patrolDate)
    );
    const patrolDateFormatted = Utilities_.formatDate(headerData.patrolDate);
    const contractor =
      headerData.contractorName || headerData.contractor || '';
    const reportCat =
      String(headerData.reportCategory || '').trim() || APP_CONFIG.reportCategory;

    CaseService.updateCaseHeaderRow(caseId, {
      '報告区分': reportCat,
      '現場名': headerData.siteName,
      '施工会社名': contractor,
      '点検者': String(headerData.inspector || '').trim(),
      '巡回日': patrolDateFormatted,
      '提出期日': submitDeadline,
      '請負業者名': String(headerData.primeContractorName || '').trim(),
      '施工班': String(headerData.constructionTeam || '').trim(),
      '棟名': String(headerData.buildingName || '').trim(),
      '更新日時': Utilities_.nowIso()
    });

    return {
      siteName: headerData.siteName,
      companyName: contractor,
      constructionTeam: String(headerData.constructionTeam || '').trim(),
      inspector: String(headerData.inspector || '').trim(),
      reportCategory: reportCat
    };
  };

  /**
   * @param {Object} payload
   * @returns {{ success: boolean, caseId?: string, detailIds?: string[], detailResults?: Object, error?: string }}
   */
  const updateCase = (payload) => {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      const caseId = String((payload && payload.caseId) || '').trim();
      if (!caseId) {
        return { success: false, error: '案件IDが指定されていません' };
      }

      const editable = isCaseEditableSafe(caseId);
      if (!editable.ok) {
        return { success: false, error: editable.reason };
      }

      if (!String(payload.primeContractorName || '').trim()) {
        return { success: false, error: '請負業者名は必須です' };
      }
      if (!String(payload.inspector || '').trim()) {
        return { success: false, error: '点検者は必須です' };
      }
      if (!String(payload.buildingName || '').trim()) {
        return { success: false, error: '棟名は必須です' };
      }
      if (!String(payload.siteName || '').trim()) {
        return { success: false, error: '工事現場名は必須です' };
      }
      if (!String(payload.patrolDate || '').trim()) {
        return { success: false, error: '巡回日は必須です' };
      }

      const incoming = payload.details || [];
      if (!incoming.length) {
        return { success: false, error: '指摘明細を1件以上入力してください' };
      }

      const existingDetails = DetailService.getDetailsByCaseId(caseId);
      const diff = diffDetails(existingDetails, incoming, caseId);

      const caseMeta = updateCaseHeader(caseId, payload);
      const detailSyncResult = syncDetails(caseId, diff);
      syncIssueLogs(caseId, detailSyncResult, caseMeta);

      CaseService.refreshCaseStatus(caseId);

      return {
        success: true,
        caseId: caseId,
        detailIds: detailSyncResult.detailIdsInOrder,
        detailResults: {
          updated: detailSyncResult.updated,
          inserted: detailSyncResult.inserted,
          deleted: detailSyncResult.deleted
        }
      };
    } catch (e) {
      return { success: false, error: String(e.message || e) };
    } finally {
      lock.releaseLock();
    }
  };

  return {
    isCaseEditable: isCaseEditableSafe,
    updateCase,
    updateCaseHeader,
    diffDetails,
    syncDetails,
    syncIssueLogs,
    generateNextDetailId,
    generateNextLogId
  };
})();
