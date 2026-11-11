#!/usr/bin/env node
/**
 * router.js の PAGE_ROUTES と manual.config.json の screens を突き合わせる。
 * ------------------------------------------------------------------
 * 画面が増えたときは、router.js に1行足して `npm run manual:sync` を実行するだけで
 * マニュアル側の画面一覧に自動で追加される（既存の設定は書き換えない）。
 *
 *   node tools/manual/sync-screens.mjs           … 差分を表示して追記
 *   node tools/manual/sync-screens.mjs --check   … 差分の表示だけ（書き込まない）
 */
import fs from 'node:fs';
import { loadConfig, saveConfig, abs, argFlag, log } from './lib/config.mjs';

const argv = process.argv.slice(2);
const checkOnly = !!argFlag(argv, 'check');
const cfg = loadConfig();

const routerPath = abs(cfg.source.routerFile || 'router.js');
if (!fs.existsSync(routerPath)) {
  console.error(`router ファイルが見つかりません: ${cfg.source.routerFile}`);
  process.exit(1);
}

const text = fs.readFileSync(routerPath, 'utf8');
const block = /PAGE_ROUTES\s*=\s*\{([\s\S]*?)\n\s*\};/.exec(text);
if (!block) {
  console.error('router.js から PAGE_ROUTES を読み取れませんでした。');
  process.exit(1);
}

const routes = [...block[1].matchAll(
  /^\s*'([^']+)'\s*:\s*\{\s*file\s*:\s*'([^']+)'\s*,\s*title\s*:\s*'([^']+)'/gm
)].map((m) => ({ key: m[1], file: m[2], title: m[3] }));

log(`router.js の画面ルート: ${routes.length} 件`);

const known = new Map(cfg.screens.map((s) => [s.key, s]));
const added = [];
let maxOrder = Math.max(0, ...cfg.screens.map((s) => s.order ?? 0));

for (const route of routes) {
  const existing = known.get(route.key);
  if (existing) {
    if (existing.html !== `${route.file}.html`) {
      log(`! ${route.key}: HTMLファイル名が router と異なります（config: ${existing.html} / router: ${route.file}.html）`);
    }
    continue;
  }
  maxOrder += 10;
  const screen = {
    key: route.key,
    title: route.title,
    category: cfg.categories?.[cfg.categories.length - 1]?.key || 'admin',
    order: maxOrder,
    html: `${route.file}.html`,
    scripts: guessScripts(route.file),
    query: { page: route.key }
  };
  cfg.screens.push(screen);
  added.push(screen);
}

const orphans = cfg.screens.filter(
  (s) => !routes.some((r) => r.key === s.key) && !s.query?.p && s.query?.page
);

if (added.length) {
  log('\n【追加された画面】');
  for (const s of added) log(`  + ${s.key}（${s.title}） → ${s.html}`);
} else {
  log('追加された画面はありません。');
}

if (orphans.length) {
  log('\n【router.js に無いのに config に残っている画面】');
  for (const s of orphans) log(`  - ${s.key}（${s.title}）… 廃止済みなら manual.config.json から削除してください`);
}

if (added.length && !checkOnly) {
  saveConfig(cfg);
  log('\nmanual.config.json を更新しました。category / order / title を必要に応じて調整してください。');
  log('続けて: npm run manual:capture -- --only=' + added.map((s) => s.key).join(','));
  log('        npm run manual:evidence -- --only=' + added.map((s) => s.key).join(','));
} else if (added.length && checkOnly) {
  log('\n--check のため書き込みませんでした。');
}

function guessScripts(file) {
  const candidate = `${file.toLowerCase()}.js`;
  return fs.existsSync(abs(candidate)) ? [candidate] : [];
}
