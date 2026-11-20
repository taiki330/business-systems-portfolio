// アプリ（Capacitor）用のオフライン画面 public/offline.html を、接続先のURLを埋め込んで作る。
// `npm run cap:sync` の中で実行する（capacitor.config.ts と同じく CAPACITOR_SERVER_URL を使う）。
import { readFile, writeFile } from "node:fs/promises";

const serverUrl = process.env.CAPACITOR_SERVER_URL || "http://localhost:3000";
let parsed;
try {
  parsed = new URL(serverUrl);
} catch {
  console.error(`CAPACITOR_SERVER_URL が URL として読めません: ${serverUrl}`);
  process.exit(1);
}
if (!["https:", "http:"].includes(parsed.protocol)) {
  console.error(`CAPACITOR_SERVER_URL は http(s) にしてください: ${serverUrl}`);
  process.exit(1);
}

const template = await readFile(new URL("../resources/offline.template.html", import.meta.url), "utf8");
// JS の文字列に入れるので、JSON 文字列として埋め込む（引用符などの混入を防ぐ）。
const html = template.replace('"{{SERVER_URL}}"', JSON.stringify(parsed.href));
await writeFile(new URL("../public/offline.html", import.meta.url), html);
console.log(`public/offline.html を作りました（接続先: ${parsed.href}）`);
