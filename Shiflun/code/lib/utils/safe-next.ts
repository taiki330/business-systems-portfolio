/** 戻り先はアプリ内のパスだけを受け付ける（外部サイトへの転送に使われないようにする）。 */
export function safeNext(value: unknown, fallback = "/") {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : fallback;
}
