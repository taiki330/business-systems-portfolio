/**
 * 各フェーズの処理を管理するモジュール。
 * ハンドラーを直接定義して、実行時に確実に利用可能にする。
 */
var PhaseHandlers = {
  // フェーズ1: 現場調査
  1: {
    handleSubmit: function(e, phaseConfig) {
      Phase1Handler.handleSubmit(e, phaseConfig);
    }
  },
  // フェーズ2: 仮設計画打合わせ
  2: {
    handleSubmit: function(e, phaseConfig) {
      Phase2Handler.handleSubmit(e, phaseConfig);
    }
  },
  // フェーズ3: 送り出し教育
  3: {
    handleSubmit: function(e, phaseConfig) {
      Phase3Handler.handleSubmit(e, phaseConfig);
    }
  },
  // フェーズ4: 解体前教育
  4: {
    handleSubmit: function(e, phaseConfig) {
      Phase4Handler.handleSubmit(e, phaseConfig);
    }
  },
  // フェーズ5: 足場工区点検
  5: {
    handleSubmit: function(e, phaseConfig) {
      Phase5Handler.handleSubmit(e, phaseConfig);
    }
  },
  // フェーズ6: 稼働現場巡回
  6: {
    handleSubmit: function(e, phaseConfig) {
      Phase6Handler.handleSubmit(e, phaseConfig);
    }
  },
  // フェーズ7: 安全衛生協議会
  7: {
    handleSubmit: function(e, phaseConfig) {
      Phase7Handler.handleSubmit(e, phaseConfig);
    }
  }
};
