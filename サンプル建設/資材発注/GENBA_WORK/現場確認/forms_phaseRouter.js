/**
 * フォーム回答をフェーズ別の処理に振り分けるルーター。
 */
var PhaseRouter = (function() {

  function handleSubmit(e) {
    if (!e) {
      Logger.log('PhaseRouter: No event received');
      return;
    }
    
    var phaseConfig = detectPhaseFromEvent(e);
    if (!phaseConfig) {
      Logger.log('PhaseRouter: Phase not detected for event');
      return;
    }
    
    Logger.log('PhaseRouter: Detected phase ' + phaseConfig.phase + ' (' + phaseConfig.name + ')');
    
    // PhaseHandlersから直接ハンドラーを取得
    var handler = PhaseHandlers[phaseConfig.phase];
    if (!handler || typeof handler.handleSubmit !== 'function') {
      Logger.log('PhaseRouter: Handler not found for phase ' + phaseConfig.phase);
      return;
    }
    
    Logger.log('PhaseRouter: Executing handler for phase ' + phaseConfig.phase);
    handler.handleSubmit(e, phaseConfig);
  }

  function detectPhaseFromEvent(e) {
    // まず回答内容から判定（これが最も確実）
    var answers = e.namedValues || {};
    Logger.log('PhaseRouter: namedValues = ' + JSON.stringify(answers));
    
    var config = getConfig();
    var phaseIndicatorKey = config.PHASE_INDICATOR_KEY;
    if (phaseIndicatorKey && answers[phaseIndicatorKey]) {
      var selectedPhase = answers[phaseIndicatorKey][0];
      Logger.log('PhaseRouter: Selected phase indicator = ' + selectedPhase);
      
      var phaseFromAnswer = config.FORMS.find(function(formConfig) {
        return formConfig.phaseIndicatorValue === selectedPhase;
      });
      
      if (phaseFromAnswer) {
        Logger.log('PhaseRouter: Found phase config for ' + selectedPhase);
        return phaseFromAnswer;
      }
    }
    
    // シート名からも判定（フォールバック）
    var sheetName = '';
    if (e.range && e.range.getSheet()) {
      sheetName = e.range.getSheet().getName();
    }
    if (!sheetName && e.source && typeof e.source.getSheetName === 'function') {
      sheetName = e.source.getSheetName();
    }
    Logger.log('PhaseRouter: sheetName = ' + sheetName);

    var phaseFromSheet = config.FORMS.find(function(formConfig) {
      return formConfig.responseSheetName && formConfig.responseSheetName === sheetName;
    });
    if (phaseFromSheet) {
      return phaseFromSheet;
    }

    Logger.log('PhaseRouter: Phase detection failed. sheet=' + sheetName + ' namedValues=' + JSON.stringify(answers));
    return null;
  }

  return {
    handleSubmit: handleSubmit
  };
})();
