#!/usr/bin/env node
/**
 * Playwright で全画面のスクリーンショットを自動取得する。
 * ------------------------------------------------------------------
 *   node tools/manual/capture.mjs --login          … 初回だけ。手動でGoogleログインする
 *   node tools/manual/capture.mjs                  … 本番URLから全画面を撮る
 *   node tools/manual/capture.mjs --only=receive   … 一部だけ撮り直す
 *   node tools/manual/capture.mjs --source=local   … ログイン不要。ローカルのモックで撮る
 *   node tools/manual/capture.mjs --headed         … ブラウザを表示して確認しながら撮る
 *
 * GASのWebアプリは中身が iframe（googleusercontent）で描画されるため、
 *   1) 中身のフレームを探す → 2) 実際の高さを測る → 3) iframeをその高さに広げる
 *   → 4) iframe要素だけを撮る
 * という手順で、画面全体が縦に切れずに入ったPNGを作る。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { chromium } from 'playwright';
import { loadConfig, abs, ensureDir, selectScreens, argFlag, log, ROOT } from './lib/config.mjs';
import { startMockServer } from './serve-mock.mjs';

const argv = process.argv.slice(2);
const cfg = loadConfig();
const cap = cfg.capture;
const isLogin = !!argFlag(argv, 'login');
const source = argFlag(argv, 'source') || 'remote';
const headed = !!argFlag(argv, 'headed') || isLogin;

if (source === 'remote' && !cfg.source.appUrl) {
  console.error([
    'manual.config.json の source.appUrl が空です。',
    'デプロイ済みWebアプリのURL（https://script.google.com/macros/s/.../exec）を設定してください。',
    'ログイン不要で撮りたい場合は --source=local を使ってください。'
  ].join('\n'));
  process.exit(1);
}

const outDir = ensureDir(abs(cap.outDir));
const authDir = ensureDir(abs(cap.authDir));

let mock = null;
if (source === 'local') {
  mock = await startMockServer(cfg);
  log(`ローカルモックサーバー: ${mock.baseUrl}`);
}

const context = await chromium.launchPersistentContext(authDir, {
  headless: headed ? false : cap.headless !== false,
  viewport: { width: cap.viewport.width, height: cap.viewport.height },
  deviceScaleFactor: cap.deviceScaleFactor || 2,
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo'
});
context.setDefaultNavigationTimeout(cap.navigationTimeoutMs || 60000);

try {
  if (isLogin) {
    await runLogin();
  } else {
    await captureAll();
  }
} finally {
  await context.close();
  mock?.close();
}

/* ---------------------------------------------------------------- */

/**
 * 初回セットアップ：ブラウザを開いて手動ログインしてもらい、セッションを .auth に残す。
 * アプリ本体（googleusercontent のiframe）が描画された時点で成功とみなして自動終了する。
 * 端末から直接実行しているとき（TTY）は Enter でも終了できる。
 */
async function runLogin() {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(cfg.source.appUrl || 'https://accounts.google.com/');
  log('');
  log('ブラウザが開きました。システムが表示される状態までGoogleログインを済ませてください。');
  log('（このログイン状態は tools/manual/.auth に保存され、次回以降は自動で使われます）');
  log('アプリが表示されたことを検知したら自動で終了します。');

  const limitMs = 10 * 60 * 1000;
  const started = Date.now();
  const enter = process.stdin.isTTY ? waitForEnter('完了したら Enter を押してください… ') : null;
  let done = false;
  enter?.then(() => { done = true; });

  while (!done && Date.now() - started < limitMs) {
    const ready = page.frames().some((f) => /googleusercontent/.test(f.url()));
    if (ready) {
      await page.waitForTimeout(1500);
      log('\nアプリの表示を確認しました。ログイン状態を保存します。');
      return;
    }
    await page.waitForTimeout(2000);
  }
  if (!done) log('\n時間内にアプリの表示を確認できませんでした。もう一度実行してください。');
  else log('ログイン状態を保存しました。');
}

async function captureAll() {
  const screens = selectScreens(cfg, argv);
  const page = context.pages()[0] || (await context.newPage());
  const results = [];

  for (const screen of screens) {
    const shots = screen.shots?.length ? screen.shots : [{ name: screen.key }];
    for (const shot of shots) {
      const name = shot.name || screen.key;
      const url = buildUrl(screen, shot);
      // clearStorage 指定の画面は、他の画面が残した localStorage を持ち込まないよう
      // 専用のページで開く（例：使用登録は医院が記憶されていると開いた瞬間に登録される）。
      const clear = shot.clearStorage ?? screen.clearStorage;
      const target = clear ? await context.newPage() : page;
      try {
        if (clear) await target.addInitScript(clearStorageScript, clear);
        await target.setViewportSize({ width: cap.viewport.width, height: cap.viewport.height });
        await target.goto(url, { waitUntil: 'load' });

        const frame = await resolveAppFrame(target);
        const waitFor = shot.waitFor || screen.waitFor;
        if (waitFor) {
          await frame.waitForSelector(waitFor, { timeout: 20000 }).catch(() => {
            log(`  … 待機セレクタ "${waitFor}" は現れませんでした。そのまま撮影します。`);
          });
        }
        await runActions(frame, shot.actions || screen.actions || []);
        // 「読み込み中…」が消えるまで待つ（データ取得が終わる前に撮らないため）
        for (const gone of shot.waitForGone || screen.waitForGone || cap.waitForGone || []) {
          await frame.waitForFunction((s) => !document.querySelector(s), gone, { timeout: 45000 })
            .catch(() => log(`  … "${gone}" が消えませんでした。そのまま撮影します。`));
        }
        await target.waitForTimeout(cap.settleMs ?? 1200);
        await redact(frame);

        const file = path.join(outDir, `${name}.png`);
        await shoot(target, frame, file, shot.maxHeight || screen.maxHeight || cap.maxHeight || 6000);
        results.push({ name, ok: true });
        log(`✓ ${name.padEnd(14)} ${path.relative(ROOT, file)}${clear ? '（localStorageを消して撮影）' : ''}`);
      } catch (err) {
        results.push({ name, ok: false, error: err.message });
        console.error(`× ${name.padEnd(14)} ${err.message}`);
      } finally {
        if (clear) await target.close().catch(() => {});
      }
    }
  }

  const ng = results.filter((r) => !r.ok);
  log(`\n完了: ${results.length - ng.length}/${results.length} 枚`);
  if (ng.length) {
    log('失敗した画面:');
    for (const r of ng) log(`  - ${r.name}: ${r.error}`);
    log('ログイン切れの可能性があります。`npm run manual:login` をやり直してください。');
  }
}

/**
 * ページのスクリプトより先に走り、localStorage を消す初期化スクリプト。
 * `clearStorage: true` なら全消し、配列ならそのキーだけ消す。
 */
function clearStorageScript(keys) {
  try {
    if (Array.isArray(keys)) keys.forEach((k) => localStorage.removeItem(k));
    else localStorage.clear();
  } catch (e) { /* 参照できない場合は何もしない */ }
}

/** GASの入れ子iframeの中から、アプリ本体を描画しているフレームを返す */
async function resolveAppFrame(page) {
  if (source === 'local') return page.mainFrame();
  for (let i = 0; i < 30; i++) {
    const candidates = page.frames().filter((f) => /googleusercontent|userCodeAppPanel/.test(f.url()));
    const frame = candidates[candidates.length - 1];
    if (frame) {
      const ready = await frame.evaluate(() => !!document.body && document.body.innerHTML.length > 0)
        .catch(() => false);
      if (ready) return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('アプリのiframeを見つけられませんでした（ログイン画面が出ている可能性があります）');
}

async function runActions(frame, actions) {
  // 値の中の {{clinic}} などは source.defaultQuery の値に置き換える
  const fill = (v) => String(v ?? '').replace(/\{\{(\w+)\}\}/g,
    (_, k) => (cfg.source.defaultQuery || {})[k] ?? '');
  for (const a of actions) {
    if (a.type === 'click') await frame.click(a.selector, { timeout: 10000 });
    else if (a.type === 'fill') await frame.fill(a.selector, fill(a.value));
    else if (a.type === 'select') await frame.selectOption(a.selector, fill(a.value));
    else if (a.type === 'wait') await frame.waitForTimeout(a.ms ?? 1000);
    else if (a.type === 'waitFor') await frame.waitForSelector(a.selector, { timeout: 20000 });
    else throw new Error(`未知のaction: ${a.type}`);
  }
}

/** 個人情報などをぼかす（manual.config.json の capture.redactSelectors） */
async function redact(frame) {
  const selectors = cap.redactSelectors || [];
  if (!selectors.length) return;
  await frame.evaluate((sels) => {
    for (const sel of sels) {
      document.querySelectorAll(sel).forEach((el) => { el.style.filter = 'blur(5px)'; });
    }
  }, selectors).catch(() => {});
}

/** 画面全体（縦に長くても切れない）を1枚のPNGにする */
async function shoot(page, frame, file, maxHeight) {
  // 中身の実際の下端を測る。scrollHeight はビューポート高に引きずられて
  // 余白だらけの画像になりやすいので、要素の位置から求める。
  const height = await frame.evaluate(() => {
    const bottoms = [...document.body.children]
      .filter((el) => el.getClientRects().length)
      .map((el) => el.getBoundingClientRect().bottom + window.scrollY);
    const content = bottoms.length ? Math.max(...bottoms) : 0;
    return Math.ceil(Math.max(content, document.body.scrollHeight > window.innerHeight
      ? document.body.scrollHeight : 0));
  });
  const target = Math.min(Math.max(height + 24, 320), maxHeight || cap.maxHeight || 6000);

  if (source === 'local') {
    await page.setViewportSize({ width: cap.viewport.width, height: target });
    await page.waitForTimeout(200);
    await page.screenshot({ path: file, fullPage: true });
    return;
  }

  // 外側のページと sandbox フレームの iframe を、中身の高さまで広げる
  for (const f of page.frames()) {
    await f.evaluate((h) => {
      document.querySelectorAll('iframe').forEach((el) => {
        el.style.height = `${h}px`;
        el.style.minHeight = `${h}px`;
      });
      document.documentElement.style.overflow = 'hidden';
    }, target).catch(() => {});
  }
  await page.setViewportSize({ width: cap.viewport.width, height: target });
  await page.waitForTimeout(300);

  const outer = page.locator('iframe').first();
  if (await outer.count()) {
    await outer.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: true });
  }
}

function buildUrl(screen, shot) {
  const q = { ...(cfg.source.defaultQuery || {}), ...(screen.query || {}), ...(shot.query || {}) };
  const params = Object.entries(q).filter(([, v]) => v !== '' && v != null);
  if (source === 'local') {
    const qs = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return `${mock.baseUrl}/${screen.key}${qs ? `?${qs}` : ''}`;
  }
  const qs = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return qs ? `${cfg.source.appUrl}?${qs}` : cfg.source.appUrl;
}

function waitForEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(message, () => { rl.close(); resolve(); }));
}
