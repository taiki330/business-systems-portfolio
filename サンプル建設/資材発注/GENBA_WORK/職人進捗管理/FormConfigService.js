/**
 * Handles form configuration CRUD + bootstrap payload building.
 */
const FormConfigService = (() => {
  const useMock = !!APP_CONFIG.mockMode;

  const BASE_HEADERS = [
    '報告種別',
    '質問ID',
    '項目ID',
    '項目名',
    'タイプ',
    '入力タイプ',
    '必須',
    '選択肢',
    '選択肢/設定',
    '順番',
    'プレースホルダ',
    '補足',
    '表示条件'
  ];

  const HEADER_ALIASES = Object.freeze({
    reportType: ['報告種別', 'ReportType'],
    questionId: ['質問ID', '項目ID', 'QuestionId'],
    label: ['項目名', 'Label'],
    inputType: ['タイプ', '入力タイプ', 'InputType', 'Type'],
    required: ['必須', 'Required'],
    options: ['選択肢', 'Options'],
    settings: ['選択肢/設定', 'Settings'],
    sortOrder: ['順番', 'SortOrder'],
    placeholder: ['プレースホルダ', 'プレースホルダー', 'Placeholder'],
    helperText: ['補足', '補足テキスト', 'HelperText'],
    condition: ['表示条件', 'DisplayCondition']
  });

  const CHOICE_INPUTS = ['select', 'radio', 'checkbox', 'check_text_group'];

  const SETTINGS_KEY_ALIASES = {
    ラベル: 'labels',
    label: 'labels',
    labels: 'labels',
    ボタン: 'button',
    button: 'button',
    min: 'min',
    最小: 'min',
    max: 'max',
    最大: 'max',
    default: 'default',
    初期値: 'default',
    デフォルト: 'default',
    単位: 'unit',
    unit: 'unit',
    text: 'text',
    note: 'text',
    文字: 'text',
    プレースホルダ: 'textPlaceholder',
    プレースホルダー: 'textPlaceholder',
    placeholder: 'textPlaceholder',
    textplaceholder: 'textPlaceholder',
    step: 'step'
  };

  const parseBoolean = value => {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  };

  const parseOptions = value =>
    String(value || '')
      .split(/[\n,\/]/)
      .map(v => v.trim())
      .filter(Boolean);

  const normalizeInputType = input => {
    const raw = String(input || '').trim().toLowerCase();
    if (!raw) return 'text';
    if (raw === 'range') return 'slider';
    if (raw === 'check') return 'check';
    if (raw === 'image text' || raw === 'image-text') return 'image_text';
    return raw;
  };

  const normalizeSettingsKey = key => {
    const raw = String(key || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    return SETTINGS_KEY_ALIASES[raw] || SETTINGS_KEY_ALIASES[lower] || lower;
  };

  const parseSettingsMap = value => {
    const text = String(value || '').trim();
    if (!text) return {};
    return text
      .split(/\n|,/)
      .map(part => part.trim())
      .filter(Boolean)
      .reduce((acc, part) => {
        const [key, ...rest] = part.split(':');
        if (!rest.length) {
          return acc;
        }
        const normalizedKey = normalizeSettingsKey(key);
        const normalizedValue = rest.join(':').trim();
        if (normalizedKey) {
          acc[normalizedKey] = normalizedValue;
        } else {
          acc[key.trim()] = normalizedValue;
        }
        return acc;
      }, {});
  };

  const parseCondition = (value, normalizeIdFn) => {
    const text = String(value || '').trim();
    if (!text) return null;
    const separators = [':', '=', '：'];
    let separatorIndex = -1;
    let separator = '';
    separators.some(sep => {
      const index = text.indexOf(sep);
      if (index >= 0) {
        separatorIndex = index;
        separator = sep;
        return true;
      }
      return false;
    });
    if (separatorIndex < 0) {
      return null;
    }
    const leftRaw = text.substring(0, separatorIndex).trim();
    const right = text.substring(separatorIndex + separator.length).trim();
    
    // Normalize ID in condition just in case (though it's usually a string)
    const left = normalizeIdFn ? normalizeIdFn(leftRaw) : leftRaw;
    
    if (!left || !right) {
      return null;
    }
    return {
      questionId: left,
      equals: right
    };
  };

  const buildMetaFromSettings = (inputType, settingsMap) => {
    const meta = {};
    if (!settingsMap || typeof settingsMap !== 'object') {
      return meta;
    }
    if (inputType === 'slider') {
      if (settingsMap.min) {
        meta.min = Number(settingsMap.min);
      }
      if (settingsMap.max) {
        meta.max = Number(settingsMap.max);
      }
      if (settingsMap.default) {
        meta.default = Number(settingsMap.default);
      }
      if (settingsMap.step) {
        meta.step = Number(settingsMap.step);
      }
    }
    if (inputType === 'switch') {
      const labels = String(settingsMap.labels || '').split('/').map(v => v.trim()).filter(Boolean);
      meta.switchLabels = {
        on: labels[0] || 'ON',
        off: labels[1] || 'OFF'
      };
    }
    if (inputType === 'check') {
      if (settingsMap.labels) {
        const labelValues = String(settingsMap.labels)
          .split('/')
          .map(v => v.trim())
          .filter(Boolean);
        meta.checkLabel = labelValues[0] || settingsMap.labels;
      }
    }
    if (inputType === 'image' || inputType === 'image_text') {
      if (settingsMap.button) {
        meta.skipLabel = settingsMap.button;
      }
    }
    if (inputType === 'image_text') {
      if (settingsMap.text || settingsMap.textPlaceholder) {
        meta.textPlaceholder = settingsMap.textPlaceholder || settingsMap.text || '';
      }
    }
    if (inputType === 'number' && settingsMap.unit) {
      meta.unit = settingsMap.unit;
    }
    return meta;
  };

  const buildConditionText = showWhen => {
    if (!showWhen || !showWhen.questionId) return '';
    if (showWhen.equals === undefined || showWhen.equals === null) {
      return showWhen.questionId;
    }
    return `${showWhen.questionId}:${showWhen.equals}`;
  };

  const sanitizeMeta = meta => {
    if (!meta) return {};
    const clone = { ...meta };
    delete clone.settingsText;
    delete clone.conditionText;
    return clone;
  };

  const pickValue = (row, keys) => {
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
        return row[key];
      }
    }
    return '';
  };

  const getScriptCache = () => {
    if (typeof CacheService === 'undefined' || typeof CacheService.getScriptCache !== 'function') {
      return null;
    }
    try {
      return CacheService.getScriptCache() || null;
    } catch (error) {
      return null;
    }
  };

  const parseForms = () => {
    if (useMock && typeof MockData !== 'undefined') {
      return (MockData.forms || []).map(item => ({
        ...item,
        options: Array.isArray(item.options) ? [...item.options] : [],
        meta: { ...(item.meta || {}) },
        showWhen: item.showWhen ? { ...item.showWhen } : null
      }));
    }
    const { rows } = SheetRepository.readTable(APP_CONFIG.sheetNames.forms);
    return rows.map((row, index) => {
      const reportType =
        pickValue(row, HEADER_ALIASES.reportType) || APP_CONFIG.defaultFormTypes[0];
      const normalizeId = val => {
        if (!val) return '';
        if (val instanceof Date) {
          // If it's a date like Feb 2nd, convert back to '2-2'
          const m = val.getMonth() + 1;
          const d = val.getDate();
          return `${m}-${d}`;
        }
        return String(val).trim();
      };

      const questionId = normalizeId(pickValue(row, HEADER_ALIASES.questionId)) ||
        `${reportType || 'TYPE'}-${index + 1}-${new Date().getTime()}`;
      const settingsText = String(pickValue(row, HEADER_ALIASES.settings) || '').trim();
      const conditionText = String(pickValue(row, HEADER_ALIASES.condition) || '').trim();
      const inputType = normalizeInputType(pickValue(row, HEADER_ALIASES.inputType) || 'text');
      const settingsMap = parseSettingsMap(settingsText);
      const optionsSource = pickValue(row, HEADER_ALIASES.options);
      const base = {
        id: String(questionId),
        reportType: String(reportType).trim(),
        label: pickValue(row, HEADER_ALIASES.label) || '',
        inputType,
        required: parseBoolean(pickValue(row, HEADER_ALIASES.required)),
        options: CHOICE_INPUTS.includes(inputType)
          ? parseOptions(optionsSource || settingsText)
          : [],
        sortOrder: Number(pickValue(row, HEADER_ALIASES.sortOrder) || index + 1),
        placeholder: pickValue(row, HEADER_ALIASES.placeholder) || '',
        helperText: pickValue(row, HEADER_ALIASES.helperText) || '',
        settingsText,
        conditionText,
        showWhen: parseCondition(conditionText, normalizeId),
        meta: buildMetaFromSettings(inputType, settingsMap)
      };
      Object.keys(row).forEach(key => {
        if (BASE_HEADERS.includes(key)) return;
        if (
          [
            'ReportType',
            'QuestionId',
            'Label',
            'InputType',
            'Type',
            'Required',
            'Options',
            'Settings',
            'SortOrder',
            'Placeholder',
            'HelperText',
            'DisplayCondition'
          ].includes(key)
        ) {
          return;
        }
        base.meta[key] = row[key];
      });
      return base;
    });
  };

  const getVersionInfo = () => {
    if (useMock && typeof MockData !== 'undefined') {
      return {
        version: MockData.version || 1,
        updatedAt: MockData.updatedAt || ''
      };
    }
    const map = SheetRepository.getSettingsMap();
    return {
      version: Number(map[APP_CONFIG.settingsKeys.formVersion] || 1),
      updatedAt: map[APP_CONFIG.settingsKeys.formUpdatedAt] || ''
    };
  };

  /**
   * スプレッドシートのフォーム定義のみを読む（Script Properties の JSON は見ない）。
   * シートを直したあと JSON に取り込むときは AdminService.migrateFromSheet から使う。
   */
  const getRawFormsFromSpreadsheet = () => parseForms();

  const getFormConfigs = () => {
    // JSON config takes priority over spreadsheet（管理画面で保存した設定がシートより優先）
    if (!useMock && typeof AdminService !== 'undefined') {
      const config = AdminService.loadConfig();
      if (config && Array.isArray(config.questions)) {
        // Return only active questions, sorted
        let questions = config.questions.filter(q => q.active !== false);
        // コード側の skipRules 変更を常に反映する
        if (AdminService.reapplySkipRules) {
          questions = AdminService.reapplySkipRules(questions);
        }
        return questions.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      }
    }
    // Fallback: read from spreadsheet (legacy)
    let items = parseForms();
    
    // Adapt legacy items to JSON format（モック時も skipRules / 必須フラグを本番と揃える）
    if (typeof AdminService !== 'undefined' && AdminService.adaptLegacyQuestions) {
      items = AdminService.adaptLegacyQuestions(items);
    }

    items.sort((a, b) => a.sortOrder - b.sortOrder);
    return items;
  };

  const getBootstrapPayload = () => {
    const { version, updatedAt } = getVersionInfo();
    const forms = getFormConfigs();
    const rawTypes = [...new Set(forms.map(item => item.reportType))].filter(Boolean);
    const orderedTypes = [
      ...APP_CONFIG.defaultFormTypes.filter(type => rawTypes.includes(type)),
      ...rawTypes.filter(type => !APP_CONFIG.defaultFormTypes.includes(type)).sort()
    ];
    const sites = MasterDataService.getSites().map(s => {
      const id = String(s.id || '').trim();
      const name = String(s.name || '').trim();
      const displayLabel =
        id && name && /^SITE-\d+$/i.test(id)
          ? `${name} (${id.toUpperCase()})`
          : name || id;
      return { ...s, displayLabel };
    });
    const contractors = MasterDataService.getContractors();
    return {
      version,
      updatedAt,
      forms,
      reportTypes: orderedTypes.length ? orderedTypes : APP_CONFIG.defaultFormTypes,
      sites,
      contractors
    };
  };

  const updateFormConfig = records => {
    if (useMock) {
      throw new Error('現在はモックモードのため、設定はスプレッドシートへ保存されません。APP_CONFIG.mockMode を false に設定してください。');
    }
    if (!Array.isArray(records)) {
      throw new Error('Invalid payload.');
    }
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10 * 1000)) {
      throw new Error('設定の保存処理が混み合っています。少し待ってから再実行してください。');
    }
    try {
      const extraHeaders = new Set();
      records.forEach(record => {
        if (record.meta) {
          Object.keys(record.meta).forEach(key => extraHeaders.add(key));
        }
      });
      const headers = [...BASE_HEADERS, ...Array.from(extraHeaders)];
      const rows = records.map((record, index) => ({
        報告種別: record.reportType || '',
        質問ID: record.id || `${record.reportType || 'TYPE'}-${index + 1}`,
        項目ID: record.id || `${record.reportType || 'TYPE'}-${index + 1}`,
        項目名: record.label || '',
        タイプ: record.inputType || 'text',
        入力タイプ: record.inputType || 'text',
        必須: record.required ? 'TRUE' : 'FALSE',
        選択肢: Array.isArray(record.options) ? record.options.join(',') : '',
        順番: Number(record.sortOrder || index + 1),
        プレースホルダ: record.placeholder || '',
        補足: record.helperText || '',
        '選択肢/設定':
          record.settingsText ||
          (record.meta && record.meta.settingsText) ||
          '',
        表示条件: record.conditionText || buildConditionText(record.showWhen),
        ...sanitizeMeta(record.meta)
      }));
      SheetRepository.writeTable(APP_CONFIG.sheetNames.forms, headers, rows);
      const { version } = getVersionInfo();
      const nextVersion = Number(version || 1) + 1;
      SheetRepository.upsertSettings({
        [APP_CONFIG.settingsKeys.formVersion]: nextVersion,
        [APP_CONFIG.settingsKeys.formUpdatedAt]: UtilitiesEx.nowIso()
      });
      clearBootstrapScriptCache();
      return { version: nextVersion };
    } finally {
      lock.releaseLock();
    }
  };

  // キャッシュを複数キーに分割して100KB上限を回避
  const BOOTSTRAP_CACHE_KEYS = Object.freeze({
    meta: 'bootstrap_meta',
    forms: 'bootstrap_forms',
    master: 'bootstrap_master'
  });

  const setFormConfigCache = payload => {
    const cache = getScriptCache();
    if (!cache) return;
    // settingsText/conditionText はサーバー側で既に meta/options/showWhen にパース済みのため除外
    const slimForms = (payload.forms || []).map(({ settingsText, conditionText, ...rest }) => rest);
    const ttl = APP_CONFIG.cache.ttlSeconds;
    cache.putAll({
      [BOOTSTRAP_CACHE_KEYS.meta]: safeJsonStringifyDirect({
        version: payload.version,
        updatedAt: payload.updatedAt,
        reportTypes: payload.reportTypes
      }),
      [BOOTSTRAP_CACHE_KEYS.forms]: safeJsonStringifyDirect(slimForms),
      [BOOTSTRAP_CACHE_KEYS.master]: safeJsonStringifyDirect({
        sites: payload.sites,
        contractors: payload.contractors
      })
    }, ttl);
  };

  const getCachedBootstrap = () => {
    const cache = getScriptCache();
    if (!cache) return null;
    const all = cache.getAll(Object.values(BOOTSTRAP_CACHE_KEYS));
    if (!all[BOOTSTRAP_CACHE_KEYS.meta]) return null;
    return {
      ...safeJsonParseDirect(all[BOOTSTRAP_CACHE_KEYS.meta], {}),
      forms: safeJsonParseDirect(all[BOOTSTRAP_CACHE_KEYS.forms], []),
      ...safeJsonParseDirect(all[BOOTSTRAP_CACHE_KEYS.master], {})
    };
  };

  /** ScriptCache の bootstrap キーを確実に削除（removeAll 非対応環境でも remove でフォールバック） */
  const clearBootstrapScriptCache = () => {
    const cache = getScriptCache();
    if (!cache) return;
    const keys = Object.values(BOOTSTRAP_CACHE_KEYS);
    try {
      if (typeof cache.removeAll === 'function') {
        cache.removeAll(keys);
      }
    } catch (e) {
      Logger.log('clearBootstrapScriptCache removeAll: ' + e);
    }
    keys.forEach(k => {
      try {
        cache.remove(k);
      } catch (e2) {
        Logger.log('clearBootstrapScriptCache remove ' + k + ': ' + e2);
      }
    });
  };

  return {
    getFormConfigs,
    getRawFormsFromSpreadsheet,
    getBootstrapPayload,
    updateFormConfig,
    getVersionInfo,
    setFormConfigCache,
    getCachedBootstrap,
    clearBootstrapScriptCache
  };
})();
// 追加で中継役を作る
function safeJsonStringifyDirect(val) { return UtilitiesEx.safeJsonStringify(val); }
function safeJsonParseDirect(val, fallback) { return UtilitiesEx.safeJsonParse(val, fallback); }