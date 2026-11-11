/**
 * REQUIRE_AUTH フラグの単一判定箇所（Fail Closed）。
 *
 * - 既定は「認可 ON」。ローカル開発でのみ明示的に `REQUIRE_AUTH=0` を
 *   設定した場合だけ OFF になる（未設定・誤字・空文字は ON 側に倒れる）。
 * - require-role.ts / ui-capabilities.ts / layout.tsx / middleware.ts は
 *   必ずこの関数経由で判定し、`process.env.REQUIRE_AUTH` を直接見ない。
 *
 * 設計変更の経緯: docs/13 §13-11 Q-B（旧: '1' のときだけ ON）→
 * 本番で未設定のまま倒れる事故を防ぐため、既定 ON / 明示 OFF へ反転。
 */
export function isAuthzEnabled(): boolean {
  return process.env.REQUIRE_AUTH !== "0";
}
