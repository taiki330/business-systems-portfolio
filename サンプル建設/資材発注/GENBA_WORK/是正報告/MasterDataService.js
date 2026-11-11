/**
 * 現場・施工会社マスタ読み取りサービス
 * 職人管理と同じスプレッドシートを外部参照（読み取り専用）
 */
const MasterDataService = (() => {
  let sitesCache = null;

  /**
   * 現場マスタを取得する
   * @returns {{ id: string, name: string }[]}
   */
  const getSites = () => {
    if (sitesCache) return sitesCache;
    try {
      const { rows } = SheetRepository.readTable(APP_CONFIG.masterSheetNames.sites, true);
      sitesCache = rows
        .map(row => ({
          id: String(row['現場ID'] || row['SiteId'] || '').trim(),
          name: String(row['現場名'] || row['SiteName'] || '').trim()
        }))
        .filter(s => s.name);
    } catch (e) {
      console.warn('現場マスタの読み込みに失敗しました:', e.message);
      sitesCache = [];
    }
    return sitesCache;
  };

  /**
   * 業者マスタ（1行目ヘッダー想定:A=請負業者名 B=施工業者名／2行目からデータ）。
   *
   * ■ 選択肢を増やす場所
   * masterSpreadsheetId のブック、「業者マスタ」シートに行を追加し、請負と施工を列ごと入力。
   * 反映は ScriptCache のため最大おおよそ 2 分遅れる場合があります。
   *
   * @returns {{ primeContractors: string[], contractorsByPrime: Record<string, string[]>, contractors: string[] }}
   */
  const loadVendorMatrix = () => {
    const contractorsByPrime = {};
    try {
      const { rows } = SheetRepository.readTable(APP_CONFIG.masterSheetNames.contractors, true);
      rows.forEach(row => {
        const p = String(row['請負業者名'] || '').trim();
        const s = String(row['施工業者名'] || '').trim();
        if (!p) return;
        if (!contractorsByPrime[p]) contractorsByPrime[p] = [];
        if (s && contractorsByPrime[p].indexOf(s) === -1) contractorsByPrime[p].push(s);
      });
    } catch (e) {
      console.warn('業者マスタの読み込みに失敗しました:', e.message);
    }
    const primeContractors = Object.keys(contractorsByPrime).sort((a, b) => a.localeCompare(b, 'ja'));
    const contractors = [...new Set(Object.values(contractorsByPrime).reduce((acc, arr) => acc.concat(arr), []))].sort(
      (a, b) => a.localeCompare(b, 'ja')
    );
    return { primeContractors, contractorsByPrime, contractors };
  };

  /** @deprecated Bootstrap の contractors を利用してください */
  const getContractors = () => loadVendorMatrix().contractors;

  /**
   * フロントエンドに渡す初期データをまとめて返す
   * ScriptCache に短時間キャッシュし、同時アクセスでマスタ全読込が連発しないよう軽減
   */
  const getBootstrap = () => {
    const key = 'rect_bootstrap_v3_issue_checklist';
    const cache = CacheService.getScriptCache();
    const hit = cache.get(key);
    if (hit) {
      try {
        return JSON.parse(hit);
      } catch (e) {
        /* 続行して再構築 */
      }
    }
    const opts = APP_CONFIG.reportCategoryOptions || [];
    const vendors = loadVendorMatrix();
    const payload = {
      sites: getSites(),
      contractors: vendors.contractors,
      primeContractors: vendors.primeContractors,
      contractorsByPrime: vendors.contractorsByPrime,
      reportCategoryOptions: opts.length ? opts : [APP_CONFIG.reportCategory],
      defaultReportCategory: APP_CONFIG.reportCategory,
      businessDaysToSubmit: APP_CONFIG.businessDaysToSubmit || 3,
      issueChecklist: getIssueChecklistBootstrap()
    };
    try {
      cache.put(key, JSON.stringify(payload), 120);
    } catch (e) {
      /* 100KB 超などで put 失敗時は毎回読むだけ */
    }
    return payload;
  };

  return { getSites, getContractors, getBootstrap, loadVendorMatrix };
})();
