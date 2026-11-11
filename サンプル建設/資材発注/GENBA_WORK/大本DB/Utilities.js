/**
 * 大本DBプロジェクト共通ユーティリティ。
 * 他プロジェクト（職人進捗管理・現場確認）の normalizeSiteName と同一ロジックを維持すること。
 */

/**
 * 現場名のマスタ照合・重複判定用に正規化する。
 * - 全角英数字（０-９Ａ-Ｚａ-ｚ）→ 半角
 * - 前後の空白削除、途中の連続空白は半角スペース1つに
 * - ㈱・（株）・(株) および括弧の混在を "(株)" に統一
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeSiteName(value) {
  if (value === null || value === undefined) return '';
  var s = String(value);
  // ㈱ (U+337F)
  s = s.replace(/\u337F/g, '(株)');
  // （株） 全角括弧
  s = s.replace(/\uFF08\u682A\uFF09/g, '(株)');
  // （株) / (株） など括弧混在
  s = s.replace(/\uFF08\u682A\)/g, '(株)');
  s = s.replace(/\(\u682A\uFF09/g, '(株)');
  // 全角英数字 → 半角（0xFEE0）
  s = s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
  });
  // 全角スペース → 半角スペース扱いのため一旦半角に
  s = s.replace(/\u3000/g, ' ');
  s = s.trim();
  s = s.replace(/\s+/g, ' ');
  return s;
}

/**
 * 同期・フォルダ名寄せ用エイリアス（要件上の Utilities.normalizeName と同一）。
 * @param {*} value
 * @returns {string}
 */
function normalizeName(value) {
  return normalizeSiteName(value);
}
