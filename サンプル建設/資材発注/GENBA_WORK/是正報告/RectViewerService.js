/**
 * 是正報告ビューア（請負業者別）
 * - 案件シートを読み取り専用で集計し、請負業者ごとの未処理一覧を返す
 */
const RectViewerService = (() => {
  /**
   * 請負業者ごとの案件一覧を取得
   * @param {string} primeName - 請負業者名
   * @returns {{ ok: boolean, prime: string, items: Array }}
   */
  const getPrimeCases = (primeName) => {
    const raw = String(primeName || '').trim();
    if (!raw) {
      return { ok: false, prime: '', items: [], error: '請負業者名が指定されていません。' };
    }

    const target = raw;
    const all = CaseService.getCases() || [];

    const items = all
      .filter(c => String(c.primeContractorName || '').trim() === target)
      .map(c => ({
        caseId: c.caseId,
        siteName: c.siteName,
        buildingName: c.buildingName,
        reportCategory: c.reportCategory,
        primeContractorName: c.primeContractorName,
        contractor: c.contractor,
        patrolDate: c.patrolDate,
        submitDeadline: c.submitDeadline,
        status: c.status,
        pendingCount: c.pendingCount,
        rejectedCount: c.rejectedCount,
        isOverdue: !!c.isOverdue,
        daysOverdue: c.daysOverdue || 0,
        updatedAt: c.updatedAt
      }))
      .sort((a, b) => {
        // 未提出・差し戻しが残っているものを上に
        const aOpen = (a.pendingCount || 0) + (a.rejectedCount || 0);
        const bOpen = (b.pendingCount || 0) + (b.rejectedCount || 0);
        if (aOpen !== bOpen) return bOpen - aOpen;
        // 期限超過を優先
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        // 更新日時の新しい順
        const da = new Date(a.updatedAt || 0);
        const db = new Date(b.updatedAt || 0);
        return db - da;
      });

    return {
      ok: true,
      prime: target,
      items
    };
  };

  return {
    getPrimeCases
  };
})();

