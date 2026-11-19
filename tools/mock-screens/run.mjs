#!/usr/bin/env node
/**
 * 資材発注システムの「実アプリ(Next.js)」を、モック Supabase + ダミーデータで動かして撮影する。
 *
 *   node tools/mock-screens/run.mjs
 *
 * 前提: 資材管理実装/web で `npm install` 済み。Supabase や顧客データには一切接続しない。
 * 出力: サンプル建設/資材発注/docs/screenshots/*.png
 */
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMockSupabase } from './mock-supabase.mjs';
import { tables, rpc, users } from './fixtures.mjs';
import { shoot, BASE } from './shoot.mjs';
import { SHOTS as ALL, PROBE } from './shots.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const webDir = path.join(root, 'サンプル建設', '資材発注', '資材管理実装', 'web');
const outDir = process.env.OUT_DIR ?? path.join(root, 'サンプル建設', '資材発注', 'docs', 'screenshots');

const SHOTS = process.env.PROBE ? PROBE : ALL;


const mock = await startMockSupabase({ tables, rpc, users: Object.values(users) });
const port = new URL(BASE).port || '3100';
const next = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev', '-p', port], {
  cwd: webDir, shell: process.platform === 'win32',
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'mock-service' },
  stdio: 'ignore',
});
try {
  for (let i = 0; i < 90; i++) {
    try { await fetch(BASE + '/login'); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  for (const role of ['admin', 'vendor', 'center']) {
    const shots = SHOTS.filter((s) => s.role === role);
    await shoot(outDir, shots, users[role], { width: 1440, height: 900 });
  }
} finally {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(next.pid), '/T', '/F']);
  else next.kill();
  mock.close();
}
process.exit(0);
