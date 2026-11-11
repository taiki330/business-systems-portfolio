/**
 * manual.config.json の読み込みとパス解決。
 * 「プロジェクトルート＝このツールの2階層上」という前提だけをここに閉じ込める。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOOL_DIR = path.resolve(HERE, '..');
export const ROOT = path.resolve(TOOL_DIR, '..', '..');
export const CONFIG_PATH = path.join(TOOL_DIR, 'manual.config.json');

export function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const cfg = JSON.parse(raw);
  cfg.screens = (cfg.screens || []).slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return cfg;
}

export function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/** プロジェクトルート基準の相対パスを絶対パスにする */
export function abs(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** 対象画面を --only=key1,key2 で絞り込む */
export function selectScreens(cfg, argv) {
  const only = argFlag(argv, 'only');
  if (!only) return cfg.screens;
  const keys = only.split(',').map((s) => s.trim()).filter(Boolean);
  const picked = cfg.screens.filter((s) => keys.includes(s.key));
  const missing = keys.filter((k) => !cfg.screens.some((s) => s.key === k));
  if (missing.length) throw new Error(`manual.config.json に無い画面キー: ${missing.join(', ')}`);
  return picked;
}

export function argFlag(argv, name) {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  const eq = hit.indexOf('=');
  return eq < 0 ? true : hit.slice(eq + 1);
}

export function log(...args) {
  console.log(...args);
}
