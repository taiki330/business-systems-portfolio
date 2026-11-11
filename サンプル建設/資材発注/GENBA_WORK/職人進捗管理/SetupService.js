/**
 * Service to initialize spreadsheet structure and data.
 */
const SetupService = (() => {
  /**
   * Initializes all necessary sheets and populates them with initial data.
   * Run this function from the GAS editor to set up your spreadsheet.
   */
  const initSpreadsheet = () => {
    const lock = LockService.getScriptLock();
    lock.waitLock(30 * 1000);
    try {
      // 1. Ensure all sheets exist
      const sheetNames = APP_CONFIG.sheetNames;
      SheetRepository.ensureSheet(sheetNames.forms);
      SheetRepository.ensureSheet(sheetNames.settings);
      SheetRepository.ensureSheet(sheetNames.sites);
      
      // Ensure log sheets for each report type
      APP_CONFIG.defaultFormTypes.forEach(type => {
        const logSheetName = APP_CONFIG.getLogSheetName(type);
        const sheet = SheetRepository.ensureSheet(logSheetName);
        if (sheet.getLastRow() === 0) {
          const headers = [...APP_CONFIG.logHeaders];
          sheet.appendRow(headers);
        }
      });

      // 2. Populate Config_Forms
      const forms = MockData.forms.map((f, index) => {
        const settings = [];
        if (f.meta) {
          if (f.meta.switchLabels) {
            settings.push(`ラベル:${f.meta.switchLabels.on}/${f.meta.switchLabels.off}`);
          }
          if (f.meta.checkLabel) {
            settings.push(`ラベル:${f.meta.checkLabel}`);
          }
          if (f.meta.unit) {
            settings.push(`単位:${f.meta.unit}`);
          }
          if (f.meta.min !== undefined) settings.push(`最小:${f.meta.min}`);
          if (f.meta.max !== undefined) settings.push(`最大:${f.meta.max}`);
          if (f.meta.default !== undefined) settings.push(`初期値:${f.meta.default}`);
          if (f.meta.skipLabel) settings.push(`ボタン:${f.meta.skipLabel}`);
          if (f.meta.textPlaceholder) settings.push(`プレースホルダ:${f.meta.textPlaceholder}`);
        }

        let condition = '';
        if (f.showWhen) {
          condition = `${f.showWhen.questionId}:${f.showWhen.equals}`;
        }

        return {
          '報告種別': f.reportType,
          '質問ID': f.id,
          '項目ID': f.id,
          '項目名': f.label,
          'タイプ': f.inputType,
          '入力タイプ': f.inputType,
          '必須': f.required ? 'TRUE' : 'FALSE',
          '選択肢': (f.options || []).join(','),
          '選択肢/設定': settings.join('\n'),
          '順番': f.sortOrder || (index + 1),
          'プレースホルダ': f.placeholder || '',
          '補足': f.helperText || '',
          '表示条件': condition
        };
      });
      const formHeaders = [
        '報告種別', '質問ID', '項目ID', '項目名', 'タイプ', '入力タイプ', 
        '必須', '選択肢', '選択肢/設定', '順番', 'プレースホルダ', '補足', '表示条件'
      ];
      SheetRepository.writeTable(sheetNames.forms, formHeaders, forms);

      // 3. Populate Master_Sites (現場一覧)
      const siteHeaders = ['現場ID', '現場名', 'DriveフォルダID', 'ステータス'];
      const sites = MockData.sites.map(s => ({
        '現場ID': s.id,
        '現場名': s.name,
        'DriveフォルダID': s.driveFolderId || '',
        'ステータス': s.status || 'active'
      }));
      SheetRepository.writeTable(sheetNames.sites, siteHeaders, sites);

      // 4. Populate Config_Settings
      const settings = [
        { Key: APP_CONFIG.settingsKeys.passcode, Value: '1234' },
        { Key: APP_CONFIG.settingsKeys.formVersion, Value: '5' },
        { Key: APP_CONFIG.settingsKeys.formUpdatedAt, Value: new Date().toISOString() }
      ];
      SheetRepository.writeTable(sheetNames.settings, ['Key', 'Value'], settings);

      console.log('Spreadsheet initialization completed successfully.');
      return true;
    } catch (error) {
      console.error('Failed to initialize spreadsheet:', error);
      throw error;
    } finally {
      lock.releaseLock();
    }
  };

  /**
   * 業者マスタシートを作成し、初期データ（20社＋全下請け）を投入する。
   * GAS エディタから runContractorSetup() で実行。
   */
  const setupContractorMaster = () => {
    // 現在の請負業者→施工業者マッピング（旧 CONTRACTOR_MAP のデータ）
    const INITIAL_CONTRACTOR_DATA = {
      'サンプル工業A': ['サンプル施工1', 'サンプル施工2', 'サンプル施工3'],
      'サンプル工業B': ['サンプル施工4', 'サンプル施工5'],
      'サンプル工業C': [],
      'サンプル工業D': ['サンプル施工6']
    };

    const sheetName = APP_CONFIG.sheetNames.contractors;
    SheetRepository.ensureSheet(sheetName);

    const headers = ['請負業者名', '施工業者名'];
    const rows = [];
    Object.entries(INITIAL_CONTRACTOR_DATA).forEach(([contractor, subs]) => {
      if (subs.length === 0) {
        // 下請けなしの業者は施工業者名を空欄で1行追加
        rows.push({ '請負業者名': contractor, '施工業者名': '' });
      } else {
        subs.forEach(sub => {
          rows.push({ '請負業者名': contractor, '施工業者名': sub });
        });
      }
    });

    SheetRepository.writeTable(sheetName, headers, rows);
    console.log('業者マスタの初期データ投入が完了しました。（' + rows.length + '行）');
    return true;
  };

  return {
    initSpreadsheet,
    setupContractorMaster
  };
})();

/**
 * Global function to be called from the GAS editor.
 */
function runSetup() {
  SetupService.initSpreadsheet();
}

/**
 * GAS エディタから実行: 業者マスタシートに初期データを投入する。
 */
function runContractorSetup() {
  SetupService.setupContractorMaster();
}
