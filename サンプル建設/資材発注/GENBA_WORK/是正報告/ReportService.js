/**
 * 帳票サービス - 是正報告書の帳票データを組み立てる
 */
const ReportService = (() => {
  const MAIN_TITLE = '自主安全パトロール是正報告書';
  const SECTION_TITLE = '是正・改善指示事項';
  const COMPANY_NAME = '株式会社サンプル建設';
  /** 帳票タイトル下・左寄せの赤色注記（見本と同じ2行） */
  const NOTICE_LINES = Object.freeze([
    '※是正実施日は現場担当者と必ず打合せをすること',
    '※是正後の写真は是正前の写真と同じアングルで撮影すること'
  ]);

  const formatDateTimeMinute = value => {
    if (value == null || value === '') return '';
    const d = Object.prototype.toString.call(value) === '[object Date]'
      ? value
      : new Date(value);
    if (isNaN(d.getTime())) return '';
    let tz = 'Asia/Tokyo';
    try {
      tz = Session.getScriptTimeZone() || tz;
    } catch (e) {
      // ignore
    }
    return Utilities.formatDate(d, tz, 'yyyy/MM/dd HH:mm');
  };

  /**
   * 帳票用データを取得する
   * @param {string} caseId - 案件ID
   * @returns {{ title: string, companyName: string, inspectorName: string, siteName: string, contractorName: string, patrolDate: string, submitDeadline: string, details: Object[] } | null} patrolDate=巡回日、submitDeadline=提出期日（案件シートの値＝新規登録時の自動計算と同じ）
   */
  const getReportData = (caseId) => {
    const result = CaseService.getCase(caseId);
    if (!result) return null;

    const caseInfo = result.case;
    const details = result.details || [];

    const formattedDetails = details.map(detail => {
      const correction = String(detail['是正内容'] || '').trim();
      const correctionRequest = String(detail['修正依頼内容'] || '').trim();
      const issueText = String(detail['指摘事項'] || '').trim();
      return {
        order: Number(detail['表示順']) || 0,
        kubunNo: detail['区分番号'] != null && detail['区分番号'] !== ''
          ? String(detail['区分番号']).trim()
          : '',
        kind: String(detail['種別'] || '').trim(),
        issue: issueText,
        issueText: issueText,
        remark: detail['備考'] || '',
        correctionRequestText: correctionRequest,
        /** 旧データ互換: 修正依頼内容が空の過去データだけ是正内容を表示する */
        correctionText: correctionRequest || correction,
        beforePhotoUrl: detail['是正前写真URL'] || '',
        afterPhotoUrl: detail['是正後写真URL'] || '',
        afterUploadedAt: formatDateTimeMinute(detail['是正後アップロード日時']),
        status: detail['確認状態'] || ''
      };
    });

    // 表示順でソート
    formattedDetails.sort((a, b) => a.order - b.order);

    return {
      mainTitle: MAIN_TITLE,
      sectionTitle: SECTION_TITLE,
      title: MAIN_TITLE,
      companyName: COMPANY_NAME,
      noticeLines: NOTICE_LINES.slice(),
      reportCategory: caseInfo['報告区分'] || '',
      primeContractorName: caseInfo['請負業者名'] || '',
      inspectorName: caseInfo['点検者'] || '',
      // 帳票の現場名欄では棟名も一体で表示する。
      siteName: (function() {
        const site = String(caseInfo['現場名'] || '').trim();
        const building = String(caseInfo['棟名'] || '').trim();
        if (!building || building === '該当なし' || building === '（現場名に含む）' || site.indexOf(building) >= 0) {
          return site;
        }
        return site ? site + '（' + building + '）' : building;
      })(),
      buildingName: caseInfo['棟名'] || '',
      contractorName: caseInfo['施工会社名'] || '',
      // 帳票の日付は案件シートの値を、管理・現場（getCaseBootstrap）と同じ表示に揃える
      patrolDate: Utilities_.formatDisplayDateJst(caseInfo['巡回日']),
      submitDeadline: Utilities_.formatDisplayDateJst(caseInfo['提出期日']),
      details: formattedDetails
    };
  };

  return {
    getReportData
  };
})();
