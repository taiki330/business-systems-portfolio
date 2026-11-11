/**
 * 明細サービス - 指摘明細の追加・写真アップロード・確認状態管理
 */
const DetailService = (() => {
  const SHEET_NAME = APP_CONFIG.sheetNames.details;
  const HEADERS = APP_CONFIG.detailHeaders;

  /**
   * 明細オブジェクトからヘッダー順の配列を生成する
   */
  const toRowValues = (detailObj) => {
    return HEADERS.map(header => detailObj[header] !== undefined ? detailObj[header] : '');
  };

  const ensureDetailHeaders = () => {
    const sheet = SheetRepository.ensureSheet(SHEET_NAME, HEADERS);
    const lastCol = sheet.getLastColumn();
    if (lastCol >= HEADERS.length) return;
    const missing = HEADERS.slice(lastCol);
    if (missing.length) {
      sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    }
  };

  const buildIssueText = (label, freeText) => {
    const base = String(label || '').trim();
    const note = String(freeText || '').trim();
    if (base && note) return base + ' / ' + note;
    return base || note;
  };

  /**
   * 明細を複数件まとめて追加する
   * @param {string} caseId - 案件ID
   * @param {Object[]} detailsData - [{ kind, issue, correction, beforePhotoUrl }]
   * @returns {{ success: boolean, detailIds?: string[], error?: string }}
   */
  const addDetails = (caseId, detailsData) => {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      ensureDetailHeaders();

      const now = Utilities_.nowIso();
      const detailIds = [];

      detailsData.forEach((detail, index) => {
        const order = index + 1;
        const detailId = Utilities_.generateDetailId(caseId, order);
        detailIds.push(detailId);

        const issueLabel = detail.issueLabel || detail.issue || '';
        const freeText = detail.freeText || '';
        const remark = String(detail.remark == null ? '' : detail.remark).trim();
        const issueTextRaw = String(detail.issueText == null ? '' : detail.issueText).trim();
        const issueText = issueTextRaw || buildIssueText(issueLabel, freeText);

        const detailObj = {
          '明細ID': detailId,
          '案件ID': caseId,
          '表示順': order,
          '区分番号': order,
          '種別': detail.kind || '',
          '指摘事項': issueText,
          '是正内容': detail.correction || '',
          '是正前写真URL': detail.beforePhotoUrl || '',
          '是正後写真URL': '',
          '是正後アップロード日時': '',
          '確認状態': APP_CONFIG.status.detail.pending,
          '差し戻し理由': '',
          '確認者': '',
          '確認日時': '',
          '作成日時': now,
          '更新日時': now,
          '指摘項目ID': detail.issueItemId || '',
          '自由記述': freeText,
          '修正依頼内容': String(detail.correctionRequest == null ? '' : detail.correctionRequest).trim(),
          '備考': remark
        };

        SheetRepository.appendRow(SHEET_NAME, toRowValues(detailObj), HEADERS);
      });

      return { success: true, detailIds: detailIds };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      lock.releaseLock();
    }
  };

  /**
   * 是正内容のみ更新（現場URLで文章だけ先に保存する場合）
   */
  const updateDetailCorrection = (detailId, correction) => {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      const now = Utilities_.nowIso();
      const updated = SheetRepository.updateRow(SHEET_NAME, '明細ID', detailId, {
        '是正内容': String(correction == null ? '' : correction),
        '更新日時': now
      });
      if (!updated) {
        return { success: false, error: `明細ID "${detailId}" が見つかりません。` };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      lock.releaseLock();
    }
  };

  /**
   * 是正後写真のURLを更新し、確認状態を「提出済み」に変更する
   * @param {string} detailId - 明細ID
   * @param {string} afterPhotoUrl - 是正後写真URL
   * @returns {{ success: boolean, error?: string }}
   */
  const updateAfterPhoto = (detailId, afterPhotoUrl) => {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      const now = Utilities_.nowIso();
      const updateData = {
        '是正後写真URL': afterPhotoUrl,
        '是正後アップロード日時': now,
        '確認状態': APP_CONFIG.status.detail.submitted,
        '更新日時': now
      };

      const updated = SheetRepository.updateRow(SHEET_NAME, '明細ID', detailId, updateData);

      if (!updated) {
        return { success: false, error: `明細ID "${detailId}" が見つかりません。` };
      }

      // 親案件のステータスを更新
      const caseId = extractCaseId(detailId);
      if (caseId) {
        CaseService.refreshCaseStatus(caseId);
        try {
          NotificationService.tryNotifyCorrectionCompleted(caseId);
        } catch (notifyErr) {
          Logger.log('updateAfterPhoto tryNotifyCorrectionCompleted: ' + notifyErr);
        }
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      lock.releaseLock();
    }
  };

  /**
   * 確認状態を更新する（確認完了 / 差し戻し）
   * @param {string} detailId - 明細ID
   * @param {string} status - 'approved' | 'rejected'
   * @param {Object} [options] - { reason?: string, confirmedBy?: string }
   * @returns {{ success: boolean, error?: string }}
   */
  const updateDetailStatus = (detailId, status, options) => {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      const opts = options || {};
      const now = Utilities_.nowIso();

      const statusMap = {
        approved: APP_CONFIG.status.detail.approved,
        rejected: APP_CONFIG.status.detail.rejected
      };

      const newStatus = statusMap[status];
      if (!newStatus) {
        return { success: false, error: `無効なステータスです: "${status}"` };
      }

      const updateData = {
        '確認状態': newStatus,
        '確認日時': now,
        '更新日時': now
      };

      if (opts.reason !== undefined) {
        updateData['差し戻し理由'] = opts.reason;
      }
      if (opts.confirmedBy !== undefined) {
        updateData['確認者'] = opts.confirmedBy;
      }

      const updated = SheetRepository.updateRow(SHEET_NAME, '明細ID', detailId, updateData);

      if (!updated) {
        return { success: false, error: `明細ID "${detailId}" が見つかりません。` };
      }

      // 親案件のステータスを更新
      const caseId = extractCaseId(detailId);
      let caseStatus = '';
      if (caseId) {
        caseStatus = CaseService.refreshCaseStatus(caseId) || '';
        try {
          NotificationService.tryNotifyCorrectionCompleted(caseId);
        } catch (notifyErr) {
          Logger.log('submitGoodDetail tryNotifyCorrectionCompleted: ' + notifyErr);
        }
      }

      return { success: true, caseStatus: caseStatus };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      lock.releaseLock();
    }
  };

  /** 管理画面から、同一案件の提出済み明細を一括承認する。 */
  const approveDetails = (caseId, detailIds) => {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      const wanted = {};
      (detailIds || []).forEach(id => {
        const key = String(id == null ? '' : id).trim();
        if (key) wanted[key] = true;
      });
      const eligibleIds = getDetailsByCaseId(caseId)
        .filter(d => wanted[String(d['明細ID'] || '').trim()])
        .filter(d => {
          const current = d['確認状態'];
          const kind = String(d['種別'] || '').trim();
          const noPhotoRequired = kind === '良好' || kind === '注意';
          const hasAfterPhoto = !!String(d['是正後写真URL'] || '').trim();
          return current !== APP_CONFIG.status.detail.approved &&
            (hasAfterPhoto || (noPhotoRequired && current === APP_CONFIG.status.detail.submitted));
        })
        .map(d => String(d['明細ID'] || '').trim());
      if (!eligibleIds.length) {
        return { success: false, error: '承認できる提出済みの明細がありません。' };
      }

      const now = Utilities_.nowIso();
      const updatedIds = SheetRepository.updateRowsByIds(
        SHEET_NAME,
        '明細ID',
        eligibleIds,
        { '確認状態': APP_CONFIG.status.detail.approved, '差し戻し理由': '', '確認日時': now, '更新日時': now }
      );
      const caseStatus = CaseService.refreshCaseStatus(caseId) || '';
      try {
        NotificationService.tryNotifyCorrectionCompleted(caseId);
      } catch (notifyErr) {
        Logger.log('approveDetails tryNotifyCorrectionCompleted: ' + notifyErr);
      }
      return { success: true, approvedCount: updatedIds.length, approvedIds: updatedIds, caseStatus: caseStatus };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      lock.releaseLock();
    }
  };

  /**
   * 案件IDに紐づく明細一覧を取得する（表示順でソート）
   * @param {string} caseId - 案件ID
   * @returns {Object[]} 明細オブジェクトの配列
   */
  const getDetailsByCaseId = (caseId) => {
    // 既存環境でも写真変更履歴列を初回参照時に自動追加する。
    ensureDetailHeaders();
    const want = String(caseId == null ? '' : caseId).trim();
    const details = SheetRepository.findRows(
      SHEET_NAME,
      row => String(row['案件ID'] == null ? '' : row['案件ID']).trim() === want
    );

    details.sort((a, b) => {
      const orderA = Number(a['表示順']) || 0;
      const orderB = Number(b['表示順']) || 0;
      return orderA - orderB;
    });

    return details;
  };

  /**
   * 明細IDから案件IDを抽出する
   * 明細IDの形式: CASE-{timestamp}-{3桁連番}
   */
  const extractCaseId = (detailId) => {
    const match = String(detailId).match(/^(CASE-\d+)-\d{3}$/);
    return match ? match[1] : null;
  };

  /**
   * 種別「良好」「注意」: 写真なしで「提出済み」にする（現場用URLの提出完了）
   * @param {string} detailId
   * @param {string|undefined} correctionOpt
   * @returns {{ success: boolean, error?: string }}
   */
  const submitGoodDetail = (detailId, correctionOpt) => {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      const rows = SheetRepository.findRows(SHEET_NAME, r => r['明細ID'] === detailId);
      if (!rows.length) {
        return { success: false, error: '明細ID "' + String(detailId) + '" が見つかりません。' };
      }
      const row = rows[0];
      if (!Utilities_.isNoAfterPhotoRequiredKind(row['種別'])) {
        return {
          success: false,
          error: 'この明細は是正後写真が必要な種別のため、写真なしの提出はできません。'
        };
      }
      const now = Utilities_.nowIso();
      const updateData = {
        '確認状態': APP_CONFIG.status.detail.submitted,
        '更新日時': now
      };
      if (correctionOpt !== undefined) {
        updateData['是正内容'] = correctionOpt == null ? '' : String(correctionOpt);
      }
      const updated = SheetRepository.updateRow(SHEET_NAME, '明細ID', detailId, updateData);
      if (!updated) {
        return { success: false, error: '更新に失敗しました。' };
      }
      const caseId = extractCaseId(detailId);
      if (caseId) {
        CaseService.refreshCaseStatus(caseId);
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      lock.releaseLock();
    }
  };

  /**
   * 下書き編集: 明細1行を更新する（編集可能列のみ）
   * @param {string} detailId
   * @param {Object} fields
   * @returns {{ success: boolean, error?: string }}
   */
  const updateDetailRow = (detailId, fields) => {
    const now = Utilities_.nowIso();
    const updateData = Object.assign({}, fields, { '更新日時': now });
    const updated = SheetRepository.updateRow(SHEET_NAME, '明細ID', detailId, updateData);
    if (!updated) {
      return { success: false, error: '明細ID "' + String(detailId) + '" が見つかりません。' };
    }
    return { success: true };
  };

  /**
   * 下書き編集: 明細1行を追加する
   * @param {Object} detailObj
   * @returns {{ success: boolean, error?: string }}
   */
  const insertDetailRow = (detailObj) => {
    ensureDetailHeaders();
    SheetRepository.appendRow(SHEET_NAME, toRowValues(detailObj), HEADERS);
    return { success: true };
  };

  /**
   * 下書き編集: 明細1行を削除する
   * @param {string} detailId
   * @returns {{ success: boolean, error?: string }}
   */
  const deleteDetailRow = (detailId) => {
    const deleted = SheetRepository.deleteRowById(SHEET_NAME, '明細ID', detailId);
    if (!deleted) {
      return { success: false, error: '明細ID "' + String(detailId) + '" が見つかりません。' };
    }
    return { success: true };
  };

  /**
   * 明細IDで1行取得する
   * @param {string} detailId
   * @returns {Object|null}
   */
  const getDetailById = (detailId) => {
    const rows = SheetRepository.findRows(
      SHEET_NAME,
      row => String(row['明細ID'] || '') === String(detailId)
    );
    return rows.length ? rows[0] : null;
  };

  return {
    ensureDetailHeaders,
    addDetails,
    updateDetailCorrection,
    updateAfterPhoto,
    updateDetailStatus,
    approveDetails,
    getDetailsByCaseId,
    submitGoodDetail,
    updateDetailRow,
    insertDetailRow,
    deleteDetailRow,
    getDetailById,
    extractCaseId,
    buildIssueText
  };
})();
