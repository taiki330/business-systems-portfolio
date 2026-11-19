/**
 * 起動済みの実アプリ(BASE)をダミーの管理者セッションで開き、画面を撮影する。
 *   node shoot.mjs <出力先ディレクトリ> [パス ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'gas-screenshots', 'package.json'));
const { chromium } = require('playwright');

export const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const SUPABASE_URL = process.env.MOCK_SUPABASE_URL ?? 'http://localhost:54321';

export function sessionCookie(user) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', exp: 4102444800 })}.mock`;
  const session = {
    access_token: jwt, refresh_token: 'mock-refresh', token_type: 'bearer',
    expires_in: 31536000, expires_at: 4102444800, user,
  };
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  return {
    name: `sb-${ref}-auth-token`,
    value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'),
    url: BASE,
  };
}

export async function shoot(outDir, shots, user, { width = 1280, height = 800 } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1.5, locale: 'ja-JP' });
  await ctx.addCookies([sessionCookie(user)]);
  const page = await ctx.newPage();
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = 'nextjs-portal{display:none!important}html,body{background:#fafafa}'; document.head.appendChild(st); }); });
  for (const s of shots) {
    const res = await page.goto(BASE + s.path, { waitUntil: 'networkidle', timeout: 90000 });
    const file = path.join(outDir, `${s.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const bad = await page.evaluate(() => /読み込みに失敗|読み込みエラー|Application error|Unhandled|取得に失敗/.test(document.body.innerText));
    const empty = await page.evaluate(() => /ありません|0 件/.test(document.body.innerText));
    console.log(res?.status(), page.url().replace(BASE, ''), bad ? '[ERROR表示]' : '', empty ? '[空表示あり]' : '', '->', file);
  }
  await browser.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { users } = await import('./fixtures.mjs');
  const user = users[process.env.ROLE ?? 'admin'];
  const [out, ...paths] = process.argv.slice(2);
  await shoot(out, paths.map((p) => ({ path: p, name: p.replace(/\W+/g, '_') || 'home' })), user);
}
