/**
 * Shared helper utilities.
 */
const UtilitiesEx = (() => {
  const isBlank = value =>
    value === null || value === undefined || String(value).trim() === '';

  const sanitizeName = value =>
    String(value || '')
      .replace(/[\\/#$%*?:<>|"]/g, '-')
      .trim() || 'untitled';

  const safeJsonParse = (value, fallback) => {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch (err) {
      console.warn('JSON parse failed', err);
      return fallback;
    }
  };

  const safeJsonStringify = (value, fallback = '{}') => {
    try {
      return JSON.stringify(value);
    } catch (err) {
      console.warn('JSON stringify failed', err);
      return fallback;
    }
  };

  const nowIso = () => new Date().toISOString();

  /**
   * 現場名のマスタ照合・重複判定用に正規化する。
   * （大本DB・現場確認の normalizeSiteName と同一ロジック）
   */
  const normalizeSiteName = value => {
    if (value === null || value === undefined) return '';
    let s = String(value);
    s = s.replace(/\u337F/g, '(株)');
    s = s.replace(/\uFF08\u682A\uFF09/g, '(株)');
    s = s.replace(/\uFF08\u682A\)/g, '(株)');
    s = s.replace(/\(\u682A\uFF09/g, '(株)');
    s = s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    );
    s = s.replace(/\u3000/g, ' ');
    s = s.trim();
    s = s.replace(/\s+/g, ' ');
    return s;
  };

  /**
   * フォーム⇔現場一覧の名寄せ用。normalizeSiteName に加え ASCII の大文字小文字を統一する。
   */
  const normalizeName = value =>
    normalizeSiteName(value).toLowerCase();

  const SITE_ID_IN_TEXT_PATTERN = /SITE-\d+/i;

  /**
   * 文字列から最初の SITE-xxx 形式の現場IDを取り出す（大文字に統一）。
   * @param {string} text
   * @returns {string} 見つからなければ ''
   */
  const extractSiteIdFromText = text => {
    const m = String(text || '').match(SITE_ID_IN_TEXT_PATTERN);
    return m ? m[0].toUpperCase() : '';
  };

  return {
    isBlank,
    sanitizeName,
    normalizeSiteName,
    normalizeName,
    extractSiteIdFromText,
    safeJsonParse,
    safeJsonStringify,
    nowIso
  };
})();
/**
 * ブラウザ側からUtilitiesExの機能を使うための中継役
 */
function normalizeSiteNameDirect(name) {
  return UtilitiesEx.normalizeSiteName(name);
}