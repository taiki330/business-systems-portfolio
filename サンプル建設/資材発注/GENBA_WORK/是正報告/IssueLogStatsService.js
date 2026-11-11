/**
 * 指摘ログ集計（読取専用）
 */
const IssueLogStatsService = (() => {
  const SHEET_NAME = APP_CONFIG.sheetNames.issueLogs;
  const EMPTY_GROUP_LABEL = '(未入力)';
  const EMPTY_ITEM_LABEL = '(項目未設定)';

  const KIND = APP_CONFIG.issueKinds || {};

  const normalizeGroupKey = value => {
    const s = String(value == null ? '' : value).trim();
    return s || EMPTY_GROUP_LABEL;
  };

  /**
   * 区分を集計用バケットに正規化（旧「良好」→注意）
   * @returns {'immediate'|'correction'|'notice'|'other'}
   */
  const normalizeKindBucket = kind => {
    const k = String(kind == null ? '' : kind).trim();
    if (k === KIND.immediate || k === '即報告') return 'immediate';
    if (k === KIND.correction || k === '是正') return 'correction';
    if (k === KIND.notice || k === KIND.legacyGood || k === '注意' || k === '良好') return 'notice';
    return 'other';
  };

  /**
   * 指摘項目別テーブル用の区分表示（良好→注意）
   */
  const kindLabelForItem = kind => {
    const k = String(kind == null ? '' : kind).trim();
    if (k === KIND.legacyGood || k === '良好') return KIND.notice || '注意';
    if (k) return k;
    return '—';
  };

  const createBucket = () => ({
    total: 0,
    immediate: 0,
    correction: 0,
    notice: 0
  });

  const addToBucket = (bucket, kindBucket) => {
    bucket.total += 1;
    if (kindBucket === 'immediate') bucket.immediate += 1;
    else if (kindBucket === 'correction') bucket.correction += 1;
    else if (kindBucket === 'notice') bucket.notice += 1;
  };

  const readLogRows = () => {
    try {
      const table = SheetRepository.readTable(SHEET_NAME, false);
      return (table && table.rows) || [];
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg.indexOf('見つかりません') >= 0) return [];
      throw e;
    }
  };

  const sortBuckets = (entries, nameKey) =>
    entries.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return String(a[nameKey]).localeCompare(String(b[nameKey]), 'ja');
    });

  const RANK_TOP_N = 10;

  /**
   * 施工班ランキング（metricKey の件数 > 0 のみ、上位10件）
   */
  const rankTeamList = (teams, metricKey) =>
    teams
      .filter(t => (t[metricKey] || 0) > 0)
      .sort((a, b) => {
        if (b[metricKey] !== a[metricKey]) return b[metricKey] - a[metricKey];
        return String(a.team).localeCompare(String(b.team), 'ja');
      })
      .slice(0, RANK_TOP_N)
      .map((row, i) => ({
        rank: i + 1,
        team: row.team,
        total: row.total,
        immediate: row.immediate,
        correction: row.correction,
        notice: row.notice
      }));

  /**
   * 指摘項目ランキング（件数 > 0、上位10件・byItem の並びを利用）
   */
  const rankItemList = items =>
    items
      .filter(it => (it.count || 0) > 0)
      .slice(0, RANK_TOP_N)
      .map((row, i) => ({
        rank: i + 1,
        label: row.label,
        kind: row.kind,
        count: row.count
      }));

  const buildRankings = (byTeam, byItem) => ({
    teamByTotal: rankTeamList(byTeam, 'total'),
    teamByImmediate: rankTeamList(byTeam, 'immediate'),
    teamByCorrection: rankTeamList(byTeam, 'correction'),
    teamByNotice: rankTeamList(byTeam, 'notice'),
    itemByCount: rankItemList(byItem)
  });

  const INSPECTOR_TOP_ITEMS = 5;
  const MIN_TOTAL_FOR_RATE_BIAS = 3;

  const calcRate = (count, total) => {
    if (!total) return 0;
    return Math.round((count / total) * 1000) / 10;
  };

  const medianOf = nums => {
    const arr = nums.filter(n => n > 0).sort((a, b) => a - b);
    if (!arr.length) return 0;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  };

  const isDominant = (val, a, b, c) => val > 0 && val >= a && val >= b && val >= c;

  /** 3区分の件数差が total の30%以内なら偏りなし（傾向なし） */
  const isBalancedKindCounts = (imm, cor, not, total) => {
    if (total < MIN_TOTAL_FOR_RATE_BIAS) return false;
    const max = Math.max(imm, cor, not);
    const min = Math.min(imm, cor, not);
    return max - min <= total * 0.3;
  };

  const buildBiasLabels = (row, medianTotal, inspectorCount) => {
    const labels = [];
    const total = row.total || 0;
    const imm = row.immediate || 0;
    const cor = row.correction || 0;
    const not = row.notice || 0;

    if (total >= MIN_TOTAL_FOR_RATE_BIAS) {
      if (isBalancedKindCounts(imm, cor, not, total)) {
        labels.push('傾向なし');
      } else {
        if (row.immediateRate >= 25 && isDominant(imm, imm, cor, not)) {
          labels.push('即報告率が高い');
        }
        if (row.noticeRate >= 40 && isDominant(not, imm, cor, not)) {
          labels.push('注意中心');
        }
        if (row.correctionRate >= 40 && isDominant(cor, imm, cor, not)) {
          labels.push('是正中心');
        }
      }
    }

    if (inspectorCount >= 2 && medianTotal > 0 && total > 0) {
      if (total >= medianTotal * 1.5) labels.push('指摘件数が多い');
      if (total <= medianTotal * 0.5) labels.push('指摘件数が少ない');
    }

    return labels;
  };

  const buildTopItemsForInspector = itemMap => {
    const entries = Array.from(itemMap.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return String(a[0]).localeCompare(String(b[0]), 'ja');
      })
      .slice(0, INSPECTOR_TOP_ITEMS)
      .map(([label, count]) => ({ label, count }));

    return {
      topItems: entries,
      topItemsText: entries.length
        ? entries.map(e => e.label + '(' + e.count + ')').join('、')
        : '該当なし'
    };
  };

  const buildInspectorAnalysis = (byInspector, inspectorItemMap) => {
    const medianTotal = medianOf(byInspector.map(r => r.total || 0));
    const inspectorCount = byInspector.length;

    const summaries = byInspector.map(row => {
      const total = row.total || 0;
      const summary = {
        inspector: row.inspector,
        total,
        immediate: row.immediate || 0,
        correction: row.correction || 0,
        notice: row.notice || 0,
        immediateRate: calcRate(row.immediate, total),
        correctionRate: calcRate(row.correction, total),
        noticeRate: calcRate(row.notice, total)
      };
      summary.biasLabels = buildBiasLabels(summary, medianTotal, inspectorCount);
      return summary;
    });

    const topItemsByInspector = byInspector.map(row => {
      const itemMap = inspectorItemMap.get(row.inspector) || new Map();
      const built = buildTopItemsForInspector(itemMap);
      return {
        inspector: row.inspector,
        topItems: built.topItems,
        topItemsText: built.topItemsText
      };
    });

    return { summaries, topItemsByInspector };
  };

  /**
   * inspectorAnalysis を必ず byInspector と整合させる（旧デプロイ・空返却のフォールバック）
   */
  const resolveInspectorAnalysis = (byInspector, inspectorItemMap, analysis) => {
    const needRebuild =
      !analysis ||
      !Array.isArray(analysis.summaries) ||
      !Array.isArray(analysis.topItemsByInspector) ||
      (byInspector.length > 0 && analysis.summaries.length === 0);
    const resolved = needRebuild
      ? buildInspectorAnalysis(byInspector, inspectorItemMap)
      : analysis;

    if (!byInspector.length) {
      return { summaries: [], topItemsByInspector: [] };
    }

    const summaryByKey = new Map(
      (resolved.summaries || []).map(s => [String(s.inspector), s])
    );
    const topByKey = new Map(
      (resolved.topItemsByInspector || []).map(t => [String(t.inspector), t])
    );

    const summaries = byInspector.map(row => {
      const hit = summaryByKey.get(String(row.inspector));
      if (hit) return hit;
      const total = row.total || 0;
      return {
        inspector: row.inspector,
        total,
        immediate: row.immediate || 0,
        correction: row.correction || 0,
        notice: row.notice || 0,
        immediateRate: calcRate(row.immediate, total),
        correctionRate: calcRate(row.correction, total),
        noticeRate: calcRate(row.notice, total),
        biasLabels: []
      };
    });

    const topItemsByInspector = byInspector.map(row => {
      const hit = topByKey.get(String(row.inspector));
      if (hit) return hit;
      const itemMap = inspectorItemMap.get(row.inspector) || new Map();
      const built = buildTopItemsForInspector(itemMap);
      return {
        inspector: row.inspector,
        topItems: built.topItems,
        topItemsText: built.topItemsText
      };
    });

    return { summaries, topItemsByInspector };
  };

  const KIND_FILTER_OPTIONS = ['即報告', '是正', '注意'];

  const parseFilterDate = value => {
    const s = String(value == null ? '' : value).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return '';
  };

  const normalizeFilters = raw => ({
    dateFrom: parseFilterDate(raw && raw.dateFrom),
    dateTo: parseFilterDate(raw && raw.dateTo),
    team: String(raw && raw.team || '').trim(),
    inspector: String(raw && raw.inspector || '').trim(),
    kind: String(raw && raw.kind || '').trim()
  });

  const toReportDateKeyJst = value => {
    if (value == null || value === '') return '';
    let d = null;
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      d = value;
    } else {
      const parsed = new Date(String(value).trim());
      if (!isNaN(parsed.getTime())) d = parsed;
    }
    if (!d) return '';
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  };

  const formatReportDateDisplay = dateKey => {
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return '';
    const parts = dateKey.split('-');
    return parts[0] + '/' + String(parseInt(parts[1], 10)) + '/' + String(parseInt(parts[2], 10));
  };

  const createSiteBucket = siteName => ({
    siteName,
    immediate: 0,
    correction: 0,
    notice: 0,
    total: 0,
    lastReportDate: ''
  });

  const addToSiteBucket = (bucket, kindBucket) => {
    if (kindBucket === 'immediate') bucket.immediate += 1;
    else if (kindBucket === 'correction') bucket.correction += 1;
    else if (kindBucket === 'notice') bucket.notice += 1;
    else return;
    bucket.total = bucket.immediate + bucket.correction + bucket.notice;
  };

  const buildFilterOptions = rows => {
    const teams = new Set();
    const inspectors = new Set();
    (rows || []).forEach(row => {
      teams.add(normalizeGroupKey(row['施工班']));
      inspectors.add(normalizeGroupKey(row['巡回者']));
    });
    return {
      teams: Array.from(teams).sort((a, b) => a.localeCompare(b, 'ja')),
      inspectors: Array.from(inspectors).sort((a, b) => a.localeCompare(b, 'ja')),
      kinds: KIND_FILTER_OPTIONS.slice()
    };
  };

  const matchesKindFilter = (row, kindFilter) => {
    if (!kindFilter) return true;
    const bucket = normalizeKindBucket(row['区分']);
    if (kindFilter === '即報告') return bucket === 'immediate';
    if (kindFilter === '是正') return bucket === 'correction';
    if (kindFilter === '注意') return bucket === 'notice';
    return false;
  };

  const applyFilters = (rows, filters) =>
    (rows || []).filter(row => {
      if (filters.team && normalizeGroupKey(row['施工班']) !== filters.team) return false;
      if (filters.inspector && normalizeGroupKey(row['巡回者']) !== filters.inspector) return false;
      if (!matchesKindFilter(row, filters.kind)) return false;

      if (filters.dateFrom || filters.dateTo) {
        const dateKey = toReportDateKeyJst(row['報告日時']);
        if (!dateKey) return false;
        if (filters.dateFrom && dateKey < filters.dateFrom) return false;
        if (filters.dateTo && dateKey > filters.dateTo) return false;
      }
      return true;
    });

  const aggregateRows = rows => {
    const teamMap = new Map();
    const inspectorMap = new Map();
    const inspectorItemMap = new Map();
    const itemMap = new Map();
    const siteMap = new Map();

    rows.forEach(row => {
      const kindBucket = normalizeKindBucket(row['区分']);

      const teamKey = normalizeGroupKey(row['施工班']);
      if (!teamMap.has(teamKey)) teamMap.set(teamKey, createBucket());
      addToBucket(teamMap.get(teamKey), kindBucket);

      const inspectorKey = normalizeGroupKey(row['巡回者']);
      if (!inspectorMap.has(inspectorKey)) inspectorMap.set(inspectorKey, createBucket());
      addToBucket(inspectorMap.get(inspectorKey), kindBucket);

      const siteNameRaw = String(row['現場名'] == null ? '' : row['現場名']).trim();
      if (siteNameRaw) {
        if (!siteMap.has(siteNameRaw)) siteMap.set(siteNameRaw, createSiteBucket(siteNameRaw));
        const siteBucket = siteMap.get(siteNameRaw);
        const reportedAtKey = toReportDateKeyJst(row['報告日時']);
        if (reportedAtKey && (!siteBucket.lastReportDate || reportedAtKey > siteBucket.lastReportDate)) {
          siteBucket.lastReportDate = reportedAtKey;
        }
        addToSiteBucket(siteBucket, kindBucket);
      }

      const itemLabel = String(row['指摘項目'] == null ? '' : row['指摘項目']).trim() || EMPTY_ITEM_LABEL;
      if (!inspectorItemMap.has(inspectorKey)) inspectorItemMap.set(inspectorKey, new Map());
      const inspectorItems = inspectorItemMap.get(inspectorKey);
      inspectorItems.set(itemLabel, (inspectorItems.get(itemLabel) || 0) + 1);

      const itemKind = kindLabelForItem(row['区分']);
      const itemKey = itemLabel + '\t' + itemKind;
      itemMap.set(itemKey, (itemMap.get(itemKey) || 0) + 1);
    });

    const byTeam = sortBuckets(
      Array.from(teamMap.entries()).map(([team, b]) => ({
        team,
        total: b.total,
        immediate: b.immediate,
        correction: b.correction,
        notice: b.notice
      })),
      'team'
    );

    const byInspector = sortBuckets(
      Array.from(inspectorMap.entries()).map(([inspector, b]) => ({
        inspector,
        total: b.total,
        immediate: b.immediate,
        correction: b.correction,
        notice: b.notice
      })),
      'inspector'
    );

    const bySite = Array.from(siteMap.values())
      .map(s => ({
        siteName: s.siteName,
        immediate: s.immediate,
        correction: s.correction,
        notice: s.notice,
        total: s.total,
        lastReportDate: s.lastReportDate || '',
        lastReportDateDisplay: formatReportDateDisplay(s.lastReportDate) || '—'
      }))
      .sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return String(a.siteName).localeCompare(String(b.siteName), 'ja');
      });

    const byItem = Array.from(itemMap.entries())
      .map(([key, count]) => {
        const parts = key.split('\t');
        return {
          label: parts[0] || EMPTY_ITEM_LABEL,
          kind: parts[1] || '—',
          count
        };
      })
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const labelCmp = String(a.label).localeCompare(String(b.label), 'ja');
        if (labelCmp !== 0) return labelCmp;
        return String(a.kind).localeCompare(String(b.kind), 'ja');
      });

    const inspectorAnalysis = resolveInspectorAnalysis(
      byInspector,
      inspectorItemMap,
      buildInspectorAnalysis(byInspector, inspectorItemMap)
    );

    return {
      ok: true,
      generatedAt: Utilities_.nowIso(),
      rowCount: rows.length,
      byTeam,
      bySite,
      byItem,
      byInspector,
      rankings: buildRankings(byTeam, byItem),
      inspectorAnalysis
    };
  };

  const CHART_KIND_LABELS = ['即報告', '是正', '注意'];
  const CHART_TEAM_TOP_N = 5;

  const buildKindPieSummary = (immediate, correction, notice) =>
    '即報告: ' + immediate + '件 / 是正: ' + correction + '件 / 注意: ' + notice + '件';

  const buildMonthlySummary = entries =>
    entries.length
      ? entries.map(e => e[0] + ' ' + e[1] + '件').join(' / ')
      : '該当データがありません';

  const buildTeamTop5Summary = entries =>
    entries.length
      ? entries.map(e => e[0] + ': ' + e[1] + '件').join(' / ')
      : '該当データがありません';

  /**
   * 絞り込み済み rows からグラフ用データを生成（再読取なし）
   */
  const buildCharts = (rows, filtersApplied) => {
    const kindHidden = !!(filtersApplied && filtersApplied.kind);
    const teamHidden = !!(filtersApplied && filtersApplied.team);

    let immediate = 0;
    let correction = 0;
    let notice = 0;
    const monthMap = new Map();
    const teamMap = new Map();

    (rows || []).forEach(row => {
      const kindBucket = normalizeKindBucket(row['区分']);
      if (kindBucket === 'immediate') immediate += 1;
      else if (kindBucket === 'correction') correction += 1;
      else if (kindBucket === 'notice') notice += 1;

      const dateKey = toReportDateKeyJst(row['報告日時']);
      if (dateKey) {
        const monthKey = dateKey.slice(0, 7);
        monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + 1);
      }

      const teamKey = normalizeGroupKey(row['施工班']);
      teamMap.set(teamKey, (teamMap.get(teamKey) || 0) + 1);
    });

    const monthlyEntries = Array.from(monthMap.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const teamEntries = Array.from(teamMap.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return String(a[0]).localeCompare(String(b[0]), 'ja');
      })
      .slice(0, CHART_TEAM_TOP_N);

    return {
      kindPie: {
        visible: !kindHidden,
        hiddenReason: kindHidden ? '区分で絞り込み中のため非表示' : '',
        labels: CHART_KIND_LABELS.slice(),
        values: [immediate, correction, notice],
        summary: buildKindPieSummary(immediate, correction, notice)
      },
      monthlyLine: {
        visible: true,
        labels: monthlyEntries.map(e => e[0]),
        values: monthlyEntries.map(e => e[1]),
        summary: buildMonthlySummary(monthlyEntries)
      },
      teamTop5: {
        visible: !teamHidden,
        hiddenReason: teamHidden ? '施工班で絞り込み中のため非表示' : '',
        labels: teamEntries.map(e => e[0]),
        values: teamEntries.map(e => e[1]),
        summary: buildTeamTop5Summary(teamEntries)
      }
    };
  };

  const computeStats = filters => {
    const allRows = readLogRows();
    const totalRowCount = allRows.length;
    const filterOptions = buildFilterOptions(allRows);
    const filtersApplied = normalizeFilters(filters);

    if (filtersApplied.dateFrom && filtersApplied.dateTo
        && filtersApplied.dateFrom > filtersApplied.dateTo) {
      return {
        ok: false,
        error: '開始日は終了日以前を指定してください',
        totalRowCount,
        filterOptions,
        filtersApplied
      };
    }

    const rows = applyFilters(allRows, filtersApplied);
    const stats = aggregateRows(rows);
    const charts = buildCharts(rows, filtersApplied);
    return Object.assign({}, stats, {
      totalRowCount,
      filterOptions,
      filtersApplied,
      charts
    });
  };

  return {
    computeStats
  };
})();
