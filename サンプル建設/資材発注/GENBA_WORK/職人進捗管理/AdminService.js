const AdminService = (() => {
  // Lazy load property key to avoid ReferenceError if AppConfig is loaded after AdminService
  const getPropKey = () => APP_CONFIG.admin.configPropertyKey;

  // ── Read / Write ──────────────────────────────────────────

  /* 
   * Chunk size for PropertiesService.
   * Limit is 9KB bytes, so we use 8000 chars to be safe (UTF-16 chars can be 2 bytes).
   */
  const CHUNK_SIZE = 8000;

  const loadConfig = () => {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    const keyBase = getPropKey();
    
    // Try to find chunked properties
    let joined = '';
    let i = 0;
    while (true) {
      const chunk = all[`${keyBase}_${i}`];
      if (chunk === undefined) break; // End of chunks
      joined += chunk;
      i++;
    }

    if (joined.length > 0) {
      return UtilitiesEx.safeJsonParse(joined, null);
    }

    // Fallback: try legacy single key
    const raw = all[keyBase];
    if (raw) return UtilitiesEx.safeJsonParse(raw, null);

    return null;
  };

  const saveConfig = (config) => {
    const json = UtilitiesEx.safeJsonStringify(config);
    const props = PropertiesService.getScriptProperties();
    const keyBase = getPropKey();
    
    // Delete existing single key if present (cleanup)
    props.deleteProperty(keyBase);
    
    // Clean up old chunks first (to avoid stale tail chunks if new config is smaller)
    // We can't easily know how many there were, so we just check a reasonable range or get all.
    // Optimization: we will overwrite relevant indexes and delete the rest.
    const allKeys = props.getKeys();
    const chunkKeys = allKeys.filter(k => k.startsWith(`${keyBase}_`));
    chunkKeys.forEach(k => props.deleteProperty(k));

    // Split and save
    const chunks = {};
    const totalLength = json.length;
    let offset = 0;
    let idx = 0;

    while (offset < totalLength) {
      const chunk = json.substr(offset, CHUNK_SIZE);
      chunks[`${keyBase}_${idx}`] = chunk;
      offset += CHUNK_SIZE;
      idx++;
    }

    props.setProperties(chunks);

    // Bump version in settings (this is fine to keep in sheet as it's just meta)
    const currentVersion = Number(config.version || 0);
    SheetRepository.upsertSettings({
      [APP_CONFIG.settingsKeys.formVersion]: currentVersion,
      [APP_CONFIG.settingsKeys.formUpdatedAt]: UtilitiesEx.nowIso()
    });

    FormConfigService.clearBootstrapScriptCache();
  };

  // ── Admin API (called from UiController) ──────────────────

  /**
   * Returns the full config for the admin UI.
   */
  const getAdminConfig = () => {
    const config = loadConfig();
    if (!config) {
      // First time — run migration automatically
      return migrateFromSheet();
    }
    return config;
  };

  /**
   * Saves updated config from the admin UI.
   * Server-side validation: protect systemLocked items.
   */
  const saveAdminConfig = (incoming) => {
    if (!incoming || !Array.isArray(incoming.questions)) {
      throw new Error('不正なデータ形式です。');
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const existing = loadConfig();

      // Build map of existing systemLocked items
      const lockedMap = {};
      if (existing && existing.questions) {
        existing.questions.forEach(q => {
          if (q.systemLocked) lockedMap[q.id] = q;
        });
      }

      // Enforce: systemLocked items cannot be removed or have their lock changed
      const incomingIds = new Set(incoming.questions.map(q => q.id));
      Object.keys(lockedMap).forEach(lockedId => {
        if (!incomingIds.has(lockedId)) {
          // Locked item was removed — add it back
          incoming.questions.push(lockedMap[lockedId]);
        }
      });

      // Enforce: systemLocked flag cannot be removed by client
      incoming.questions.forEach(q => {
        if (lockedMap[q.id]) {
          q.systemLocked = true;
        }
      });

      // Check for showWhen dependency warnings
      const activeIds = new Set(incoming.questions.filter(q => q.active !== false).map(q => q.id));
      const warnings = [];
      incoming.questions.forEach(q => {
        if (q.active !== false && q.showWhen && q.showWhen.questionId) {
          if (!activeIds.has(q.showWhen.questionId)) {
            warnings.push(`「${q.displayLabel || q.label}」は非表示の項目に依存しています`);
          }
        }
      });

      // Save
      const nextVersion = (existing ? existing.version : 0) + 1;
      const config = {
        version: nextVersion,
        updatedAt: UtilitiesEx.nowIso(),
        questions: incoming.questions
      };
      saveConfig(config);

      return {
        success: true,
        version: nextVersion,
        warnings: warnings
      };
    } finally {
      lock.releaseLock();
    }
  };

  // ── Migration ─────────────────────────────────────────────

  /**
   * Hardcoded rule definitions used during migration.
   * These capture the rules currently embedded in Index.html.
   */
  /** シート上の表記ゆれ（全角スペース等）でも作業種別設問を拾う */
  const isWorkTypeQuestionLabel = label => {
    const t = String(label || '').replace(/\s/g, '');
    return t.indexOf('作業種別') >= 0;
  };

  /**
   * 午後報告で写真必須・該当なし不可にする項目（②系・⑤系の1行1設問）。
   * 行頭の丸数字のみで判定（他項目に「②」を含む長文ラベルで誤爆しない）。
   */
  const isAfternoonMandatoryPhotoLabel = label => {
    const s = String(label || '').trim();
    return /^②/.test(s) || /^⑤/.test(s);
  };

  const HARDCODED_RULES = {
    labelOverrides: {
      '本日の作業進捗': { displayLabel: '本日の全体作業進捗' },
      '翌日作業内容': {
        displayLabel: '翌日作業の有無',
        effectiveInputType: 'switch',
        uiHint: 'switch_with_calendar'
      }
    },
    uiHints: {
      matchWorkZone: (label) => {
        if (label && label.includes('工区') && label.includes('進捗')) return 'repeatable_zone';
        if (label === '工区番号') return 'hidden';
        return null;
      }
    },
    skipRules: {
      '始業前報告': (label) => {
        // ③使用工具の使用前点検: 資材搬出入の場合のみ該当なし表示
        if (/^③/.test(label)) return { showSkip: true, skipCondition: { dependsOn: 'WORK_TYPE', showWhen: 'equals', equals: '資材搬出入' } };
        if (/^[①②④]/.test(label)) return { showSkip: false };
        if (/^[⑤-⑧]/.test(label)) return { showSkip: true, skipCondition: { dependsOn: 'WORK_TYPE', showWhen: 'selected' } };
        return { showSkip: true };
      },
      '午後報告': (label) => {
        const s = String(label || '').trim();
        // ②⑤のみ該当なしなし・写真必須。それ以外の画像は常に該当なし可（作業種別は不要）
        if (isAfternoonMandatoryPhotoLabel(s)) return { showSkip: false };
        return { showSkip: true };
      },
      '終業前報告': (label) => {
        if (label.includes('⑨詰所')) return { showSkip: true };
        return { showSkip: false };
      },
      '中間報告': (label) => {
        if (label.includes('①安全設備') || label.includes('②資材置き場')) return { showSkip: false };
        return { showSkip: true };
      }
    },
    // 終業前報告: only these image labels are shown (rest are inactive)
    endOfDayActiveImages: ['②資材置き場', '⑤足場の外観', '⑨詰所']
  };

  /**
   * Applies hardcoded rules to legacy questions, adapting them to the new JSON format.
   * Exposed so FormConfigService can use it for fallback support.
   */
  const adaptLegacyQuestions = (forms) => {
    const questions = forms.map(q => {
      const label = q.label || '';
      const reportType = q.reportType || '';
      const isImage = q.inputType === 'image' || q.inputType === 'image_text';

      // Start with base properties from spreadsheet data
      const question = {
        id: q.id,
        reportType: reportType,
        label: label,
        displayLabel: null,
        inputType: q.inputType,
        effectiveInputType: null,
        required: !!q.required,
        active: true,
        showSkip: isImage, // Default: images show skip
        skipCondition: null,
        options: q.options || [],
        sortOrder: q.sortOrder,
        placeholder: q.placeholder || '',
        helperText: q.helperText || '',
        showWhen: q.showWhen || null,
        uiHint: null,
        meta: q.meta || {},
        systemLocked: false
      };

      // Apply label overrides
      const override = HARDCODED_RULES.labelOverrides[label];
      if (override) {
        if (override.displayLabel) question.displayLabel = override.displayLabel;
        if (override.effectiveInputType) question.effectiveInputType = override.effectiveInputType;
        if (override.uiHint) question.uiHint = override.uiHint;
      }

      // Apply UI hints (repeatable zone, hidden)
      const hint = HARDCODED_RULES.uiHints.matchWorkZone(label);
      if (hint) question.uiHint = hint;

      // Apply skip rules (per report type, for image items)
      if (isImage && HARDCODED_RULES.skipRules[reportType]) {
        const skipRule = HARDCODED_RULES.skipRules[reportType](label);
        question.showSkip = skipRule.showSkip;
        if (skipRule.skipCondition) question.skipCondition = skipRule.skipCondition;
      }

      // 午後報告: ②⑤のみ必須・それ以外の画像はシートが TRUE でも必須にしない（該当なしで送れるようにする）
      if (reportType === '午後報告' && isImage) {
        question.required = isAfternoonMandatoryPhotoLabel(label);
      }

      // 終業前報告: deactivate images not in the allowed list
      if (reportType === '終業前報告' && isImage) {
        const isAllowed = HARDCODED_RULES.endOfDayActiveImages.some(allowed => label.includes(allowed));
        if (!isAllowed) question.active = false;
      }

      // Mark work type questions for skipCondition reference
      if (isWorkTypeQuestionLabel(label)) {
        question.meta._isWorkTypeQuestion = true;
      }

      return question;
    });

    // Second pass: resolve skipCondition dependsOn to actual question IDs
    const workTypeQMap = {};
    questions.forEach(q => {
      if (q.meta && q.meta._isWorkTypeQuestion) {
        workTypeQMap[q.reportType] = q.id;
      }
    });
    questions.forEach(q => {
      if (q.skipCondition && q.skipCondition.dependsOn === 'WORK_TYPE') {
        const actualId = workTypeQMap[q.reportType];
        if (actualId) {
          q.skipCondition.dependsOn = actualId;
        }
      }
      // Clean up temp meta
      if (q.meta) delete q.meta._isWorkTypeQuestion;
    });

    return questions;
  };

  /**
   * Migrate from the existing forms spreadsheet to JSON config.
   * Reads current form data and applies hardcoded rules as JSON flags.
   * ※ getFormConfigs() は JSON を優先するため、ここでは必ずシートだけを読む。
   */
  const migrateFromSheet = () => {
    const forms = FormConfigService.getRawFormsFromSpreadsheet();
    forms
      .filter(f => isWorkTypeQuestionLabel(f.label))
      .forEach(f => {
        Logger.log(
          'migrateFromSheet シート→ id=%s reportType=%s options=%s',
          f.id,
          f.reportType,
          JSON.stringify(f.options)
        );
      });
    const questions = adaptLegacyQuestions(forms);

    const map = SheetRepository.getSettingsMap();
    const sheetVer = Number(map[APP_CONFIG.settingsKeys.formVersion] || 0);
    const existing = loadConfig();
    const jsonVer =
      existing && existing.version != null && existing.version !== ''
        ? Number(existing.version)
        : 0;
    const nextVersion = Math.max(sheetVer, jsonVer, 0) + 1;

    const config = {
      version: nextVersion,
      updatedAt: UtilitiesEx.nowIso(),
      questions: questions
    };

    saveConfig(config);
    return config;
  };

  /**
   * JSON設定読み込み後にハードコードされた skipRules を再適用する。
   * コード変更が既存JSON設定に反映されるようにするため。
   */
  const reapplySkipRules = (questions) => {
    questions.forEach(q => {
      const label = q.label || '';
      const reportType = q.reportType || '';
      const isImage = ['image', 'image_text'].includes(q.inputType);

      if (isImage && HARDCODED_RULES.skipRules[reportType]) {
        const skipRule = HARDCODED_RULES.skipRules[reportType](label);
        q.showSkip = skipRule.showSkip;
        if (skipRule.skipCondition) {
          q.skipCondition = skipRule.skipCondition;
        } else {
          delete q.skipCondition;
        }
      }

      if (reportType === '午後報告' && isImage) {
        q.required = isAfternoonMandatoryPhotoLabel(label);
      }

      if (isWorkTypeQuestionLabel(label)) {
        q.meta = q.meta || {};
        q.meta._isWorkTypeQuestion = true;
      }
    });

    // WORK_TYPE 依存を実際の質問IDに解決
    const workTypeQMap = {};
    questions.forEach(q => {
      if (q.meta && q.meta._isWorkTypeQuestion) {
        workTypeQMap[q.reportType] = q.id;
      }
    });
    questions.forEach(q => {
      if (q.skipCondition && q.skipCondition.dependsOn === 'WORK_TYPE') {
        const actualId = workTypeQMap[q.reportType];
        if (actualId) q.skipCondition.dependsOn = actualId;
      }
      if (q.meta) delete q.meta._isWorkTypeQuestion;
    });

    return questions;
  };

  // ── Public API ────────────────────────────────────────────

  return {
    loadConfig,
    saveConfig,
    getAdminConfig,
    saveAdminConfig,
    migrateFromSheet,
    adaptLegacyQuestions,
    reapplySkipRules
  };
})();
