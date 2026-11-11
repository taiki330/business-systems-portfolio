/**
 * 是正報告 LINE 通知（1回目: 是正受付 / 2回目: 修正完了）
 */
var NotificationService = (function() {
  var FIELD_RECEIVED_AT = '是正通知済み日時';
  var FIELD_COMPLETED_AT = '修正完了通知済み日時';
  var LOCK_TIMEOUT_MS = 15000;

  function isBlank_(v) {
    return v == null || String(v).trim() === '';
  }

  function fieldLabel_(caseRow, key) {
    var v = caseRow && caseRow[key];
    return v != null && String(v).trim() !== '' ? String(v).trim() : '—';
  }

  function currentCaseUrl_(caseRow) {
    var current = buildCaseShareUrl_(caseRow && caseRow['案件ID']);
    return current || fieldLabel_(caseRow, '共有URL');
  }

  function buildReceivedMessage_(caseRow) {
    return [
      '【是正報告】是正の依頼が届きました',
      '',
      '現場名：' + fieldLabel_(caseRow, '現場名'),
      '棟名：' + fieldLabel_(caseRow, '棟名'),
      '施工会社：' + fieldLabel_(caseRow, '施工会社名'),
      '施工班：' + fieldLabel_(caseRow, '施工班'),
      '点検者：' + fieldLabel_(caseRow, '点検者'),
      '',
      '現場用URL：',
      currentCaseUrl_(caseRow),
      '',
      '現場側の修正・写真登録をお願いします。'
    ].join('\n');
  }

  function buildCompletedMessage_(caseRow) {
    return [
      '【是正報告】現場から修正が届きました',
      '',
      '現場名：' + fieldLabel_(caseRow, '現場名'),
      '棟名：' + fieldLabel_(caseRow, '棟名'),
      '施工会社：' + fieldLabel_(caseRow, '施工会社名'),
      '施工班：' + fieldLabel_(caseRow, '施工班'),
      '',
      '現場用URL：',
      currentCaseUrl_(caseRow),
      '',
      '内容の確認をお願いします。'
    ].join('\n');
  }

  /**
   * 現場側提出完了判定
   * @param {Object} detail
   * @returns {boolean}
   */
  function isDetailSiteSubmissionComplete_(detail) {
    if (!detail) return false;
    if (Utilities_.isNoAfterPhotoRequiredKind(detail['種別'])) {
      var st = String(detail['確認状態'] || '').trim();
      return (
        st === APP_CONFIG.status.detail.submitted ||
        st === APP_CONFIG.status.detail.approved
      );
    }
    return !isBlank_(detail['是正後写真URL']);
  }

  function isAllDetailsSiteComplete_(details) {
    if (!details || !details.length) return false;
    for (var i = 0; i < details.length; i++) {
      if (!isDetailSiteSubmissionComplete_(details[i])) return false;
    }
    return true;
  }

  function getCaseRow_(caseId) {
    var result = CaseService.getCase(caseId);
    if (!result || !result.case) return null;
    return result.case;
  }

  function markNotificationSent_(caseId, fieldName) {
    var now = Utilities_.nowIso();
    CaseService.updateCaseHeaderRow(caseId, {
      [fieldName]: now,
      '更新日時': now
    });
  }

  /**
   * @param {string} caseId
   * @returns {{ skipped?: boolean, sent?: number, failed?: number, warning?: string }}
   */
  function notifyCorrectionReceived(caseId) {
    var cid = String(caseId || '').trim();
    if (!cid) {
      return { skipped: true, warning: '案件IDが空のため通知をスキップしました' };
    }

    var cfg = LineNotifyService.getLineConfig();
    if (!cfg.enabled) {
      return { skipped: true };
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(LOCK_TIMEOUT_MS);

      var caseRow = getCaseRow_(cid);
      if (!caseRow) {
        Logger.log('notifyCorrectionReceived: 案件が見つかりません caseId=' + cid);
        return { skipped: true, warning: '案件が見つかりません' };
      }
      if (!isBlank_(caseRow[FIELD_RECEIVED_AT])) {
        return { skipped: true };
      }

      var text = buildReceivedMessage_(caseRow);
      var pushResult = LineNotifyService.pushTextToMany(text);
      if (pushResult.skipped) {
        return { skipped: true };
      }
      if (pushResult.failed > 0) {
        var errMsg = '是正受付LINE通知: 一部送信失敗 sent=' + pushResult.sent + ' failed=' + pushResult.failed;
        Logger.log(errMsg + ' ' + JSON.stringify(pushResult.errors));
        return {
          sent: pushResult.sent,
          failed: pushResult.failed,
          warning: 'LINE通知の送信に失敗しました（案件は保存済み）'
        };
      }

      markNotificationSent_(cid, FIELD_RECEIVED_AT);
      return { sent: pushResult.sent, failed: 0 };
    } catch (e) {
      Logger.log('notifyCorrectionReceived: ' + (e && e.message ? e.message : e));
      return { warning: 'LINE通知に失敗しました（案件は保存済み）' };
    } finally {
      try {
        lock.releaseLock();
      } catch (ignore) {}
    }
  }

  /**
   * @param {string} caseId
   * @returns {{ skipped?: boolean, sent?: number, failed?: number, warning?: string }}
   */
  function tryNotifyCorrectionCompleted(caseId) {
    var cid = String(caseId || '').trim();
    if (!cid) {
      return { skipped: true };
    }

    var cfg = LineNotifyService.getLineConfig();
    if (!cfg.enabled) {
      return { skipped: true };
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(LOCK_TIMEOUT_MS);

      var caseResult = CaseService.getCase(cid);
      if (!caseResult || !caseResult.case) {
        return { skipped: true };
      }
      var caseRow = caseResult.case;
      if (!isBlank_(caseRow[FIELD_COMPLETED_AT])) {
        return { skipped: true };
      }

      var details = caseResult.details || DetailService.getDetailsByCaseId(cid);
      if (!isAllDetailsSiteComplete_(details)) {
        return { skipped: true };
      }

      var text = buildCompletedMessage_(caseRow);
      var pushResult = LineNotifyService.pushTextToMany(text);
      if (pushResult.skipped) {
        return { skipped: true };
      }
      if (pushResult.failed > 0) {
        var errMsg2 = '修正完了LINE通知: 一部送信失敗 sent=' + pushResult.sent + ' failed=' + pushResult.failed;
        Logger.log(errMsg2 + ' ' + JSON.stringify(pushResult.errors));
        return {
          sent: pushResult.sent,
          failed: pushResult.failed,
          warning: 'LINE通知の送信に失敗しました（提出は完了済み）'
        };
      }

      markNotificationSent_(cid, FIELD_COMPLETED_AT);
      return { sent: pushResult.sent, failed: 0 };
    } catch (e) {
      Logger.log('tryNotifyCorrectionCompleted: ' + (e && e.message ? e.message : e));
      return { warning: 'LINE通知に失敗しました（提出は完了済み）' };
    } finally {
      try {
        lock.releaseLock();
      } catch (ignore) {}
    }
  }

  return {
    notifyCorrectionReceived: notifyCorrectionReceived,
    tryNotifyCorrectionCompleted: tryNotifyCorrectionCompleted,
    isDetailSiteSubmissionComplete: isDetailSiteSubmissionComplete_,
    isAllDetailsSiteComplete: isAllDetailsSiteComplete_
  };
})();
