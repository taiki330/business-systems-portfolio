/**
 * 共通ユーティリティ
 */
const Utilities_ = (() => {
  /**
   * ユニーク案件IDを生成する（タイムスタンプベース）
   */
  const generateCaseId = () => {
    return `CASE-${Date.now()}`;
  };

  /**
   * 明細IDを生成する（案件ID + 3桁連番）
   */
  const generateDetailId = (caseId, order) => {
    return `${caseId}-${String(order).padStart(3, '0')}`;
  };

  /** Google 公開カレンダー「日本の祝日」参照用（読み取り失敗時は祝日として扱わない） */
  const JP_HOLIDAY_CALENDAR_ID = 'ja.japanese#sample@example.com';

  let _holidayCalendarWarned = false;

  const parsePatrolDateLocal = patrolDate => {
    const t = String(patrolDate || '').trim();
    const m =
      t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) ||
      t.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(patrolDate);
    return isNaN(d.getTime()) ? null : d;
  };

  /**
   * その日が日本の祝日（公式祝日カレンダーに記載がある日）か
   */
  const isJapanesePublicHoliday = date => {
    try {
      const cal = CalendarApp.getCalendarById(JP_HOLIDAY_CALENDAR_ID);
      if (!cal) return false;
      const mid = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
      return cal.getEventsForDay(mid).length > 0;
    } catch (e) {
      if (!_holidayCalendarWarned) {
        Logger.log(
          '是正報告: 祝日カレンダー参照に失敗しました（休み日の判定に影響します）。' + e
        );
        _holidayCalendarWarned = true;
      }
      return false;
    }
  };

  /**
   * カウント対象の営業日か
   * - **土曜**: 運用で営業日に数える（祝日カレンダーで休みの土曜のみ除外）
   * - **日曜**: 常にカウントしない
   * - **月〜金**: 日本の祝日ならカウントしない、それ以外は営業日
   */
  const isBusinessDayForDeadline = date => {
    const day = date.getDay();
    if (day === 0) return false;
    if (day === 6) {
      return !isJapanesePublicHoliday(date);
    }
    if (isJapanesePublicHoliday(date)) return false;
    return true;
  };

  /**
   * 巡回日から提出期日を計算する（上記の営業日で N 日目の日付）
   * **巡回日その日は常にカウントしない**。翌日以降だけを数える。
   * 例: N=3・祝なし・金曜巡回 → 土(1)→月(2)→火(3) で期日火曜／月曜巡回なら翌火・水・木で期日木曜。
   * @param {Date|string} patrolDate - 巡回日
   * @returns {Date} 提出期日
   */
  const calcSubmitDeadline = patrolDate => {
    const start = parsePatrolDateLocal(patrolDate);
    if (!start) {
      throw new Error('巡回日が不正です');
    }
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    let count = 0;
    const n = Number(APP_CONFIG.businessDaysToSubmit) || 3;
    while (count < n) {
      date.setDate(date.getDate() + 1);
      if (isBusinessDayForDeadline(date)) count++;
    }
    return date;
  };

  /**
   * Date を YYYY/MM/DD 形式の文字列に変換する
   */
  const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd}`;
  };

  /**
   * Date を YYYY年MM月DD日 形式の文字列に変換する
   */
  const formatDateJa = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  /**
   * 現在日時を ISO 文字列で返す
   */
  const nowIso = () => new Date().toISOString();

  /**
   * JSON を安全にパースする
   */
  const safeJsonParse = (value, fallback) => {
    if (value === null || value === undefined || value === '') return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };

  /**
   * ファイル名に使えない文字をサニタイズする
   */
  const sanitizeName = (value) =>
    String(value || '')
      .replace(/[\\/#$%*?:<>|"]/g, '-')
      .trim() || 'untitled';

  /**
   * シート上の日付文字列（YYYY/MM/DD 等）をローカル日付の Date にする
   */
  const parseDateOnly = s => {
    const t = String(s || '').trim();
    if (!t) return null;
    const m = t.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(t);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const getScriptTimeZone = () => {
    try {
      return Session.getScriptTimeZone() || 'Asia/Tokyo';
    } catch (e) {
      return 'Asia/Tokyo';
    }
  };

  const getTodayStart = () => {
    const todayText = Utilities.formatDate(new Date(), getScriptTimeZone(), 'yyyy/MM/dd');
    return parseDateOnly(todayText);
  };

  /**
   * 期限アラート: 提出期日を過ぎ、案件が未完了で、未提出の明細が残る場合に true
   */
  /**
   * スプレッドシートの日付（Date / yyyy/MM/dd 文字列 / ISO）を日本向けカレンダー表示に統一
   * （アップロード画面で UTC のまま解釈され日付がずれるのを防ぐ）
   */
  const formatDisplayDateJst = (v) => {
    if (v == null || v === '') return '';
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
      return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy年M月d日');
    }
    const s = String(v).trim();
    const m = s.match(/^(\d{4})[.\/](\d{1,2})[.\/](\d{1,2})/);
    if (m) {
      return (
        m[1] + '年' + parseInt(m[2], 10) + '月' + parseInt(m[3], 10) + '日'
      );
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy年M月d日');
    }
    return s;
  };

  const getDeadlineAlertState = (submitDeadlineStr, overallStatus, pendingCount) => {
    const completed =
      APP_CONFIG &&
      APP_CONFIG.status &&
      APP_CONFIG.status.case &&
      overallStatus === APP_CONFIG.status.case.completed;
    if (completed) {
      return { isOverdue: false, isDueToday: false, isDeadlineAlert: false, daysOverdue: 0, deadlineState: 'none', message: '' };
    }
    const deadline = parseDateOnly(submitDeadlineStr);
    if (!deadline) {
      return { isOverdue: false, isDueToday: false, isDeadlineAlert: false, daysOverdue: 0, deadlineState: 'none', message: '' };
    }
    const pend = Number(pendingCount) || 0;
    if (pend <= 0) {
      return { isOverdue: false, isDueToday: false, isDeadlineAlert: false, daysOverdue: 0, deadlineState: 'none', message: '' };
    }
    const today = getTodayStart();
    if (deadline.getTime() > today.getTime()) {
      return { isOverdue: false, isDueToday: false, isDeadlineAlert: false, daysOverdue: 0, deadlineState: 'none', message: '' };
    }
    if (deadline.getTime() === today.getTime()) {
      return {
        isOverdue: false,
        isDueToday: true,
        isDeadlineAlert: true,
        daysOverdue: 0,
        deadlineState: 'today',
        message: '本日が提出期限です'
      };
    }
    const ms = today.getTime() - deadline.getTime();
    const days = Math.max(1, Math.floor(ms / 86400000));
    return {
      isOverdue: true,
      isDueToday: false,
      isDeadlineAlert: true,
      daysOverdue: days,
      deadlineState: 'overdue',
      message: '提出期限を過ぎています'
    };
  };

  /**
   * 種別が是正後写真不要か（旧「良好」および「注意」）
   * @param {string} kind
   * @return {boolean}
   */
  const isNoAfterPhotoRequiredKind = kind => {
    const k = String(kind || '').trim();
    const cfg = APP_CONFIG.issueKinds || {};
    return k === cfg.legacyGood || k === cfg.notice || k === '良好' || k === '注意';
  };

  return {
    generateCaseId,
    generateDetailId,
    calcSubmitDeadline,
    formatDate,
    formatDateJa,
    nowIso,
    safeJsonParse,
    sanitizeName,
    parseDateOnly,
    getDeadlineAlertState,
    formatDisplayDateJst,
    isNoAfterPhotoRequiredKind
  };
})();
