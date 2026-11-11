import { test, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { hasCredentials, loginAs, type Role } from "../e2e/fixtures/auth";
import { SCREEN_GROUPS } from "./screens.config";

/**
 * 利用者マニュアル用のスクリーンショットを、ロールごとに全画面分撮る。
 *
 * - 対象・URL・ロールは screens.config.ts が正本。
 * - 動的セグメント（[id] 等）を含む画面は、URL を直接組み立てず、
 *   一覧など先に開いたページ内の実際のリンクから見つけて遷移する
 *   （実データが無ければスキップし、失敗させない＝実行環境非依存）。
 * - 出力先: docs/manual/screenshots/<role>/<slug>-<view>.png
 *
 * 実行: npm run manual:screenshots （e2e/.env.e2e の認証情報が必要）
 */

const OUT_DIR = path.join(__dirname, "..", "..", "..", "docs", "manual", "screenshots");
const ROLES: Role[] = ["admin", "center", "vendor"];

// DB の id 列はすべて uuid（gen_random_uuid()）。"[id]" セグメントだけ uuid 形式に
// 限定することで、"/stock/progress/export" のような静的な兄弟パス（CSV出力等）を
// 詳細画面と誤検出しないようにする。"[key]" 等（enum 値のルート）は従来通り任意文字列
// にマッチさせる（例: /menu/[key] の key は "stock"/"lease" 等の固定文字列で uuid ではない）。
const UUID_SEGMENT = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

function hrefRegexFromRoutePath(routePath: string): RegExp {
  const escaped = routePath
    .split("/")
    .map((segment) => {
      if (!segment.startsWith("[") || !segment.endsWith("]")) {
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      return segment === "[id]" ? UUID_SEGMENT : "[^/]+";
    })
    .join("/");
  return new RegExp(`^${escaped}$`);
}

async function findFirstMatchingHref(page: Page, pattern: RegExp): Promise<string | null> {
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.find((href) => pattern.test(href.split("?")[0])) ?? null;
}

test.describe.serial("manual screenshots", () => {
  for (const role of ROLES) {
    test(`capture screens (role=${role})`, async ({ browser }, testInfo) => {
      testInfo.setTimeout(180_000);
      if (!hasCredentials(role)) {
        test.skip(true, `E2E_${role.toUpperCase()}_EMAIL/PASSWORD 未設定のためスキップ`);
        return;
      }

      const roleDir = path.join(OUT_DIR, role);
      fs.mkdirSync(roleDir, { recursive: true });

      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();

      // next dev のデバッグインジケーター（画面左下の "N" バッジ、<nextjs-portal> 要素）は
      // マニュアルに不要。CSS の display:none は要素内部の inline !important に負けて
      // 効かないことがあるため、要素そのものを DOM から削除する。ページ読み込み直後は
      // まだ挿入されていないことがある（数秒遅れて追加される）ので、撮影直前に毎回呼ぶ。
      async function removeDevIndicator(): Promise<void> {
        await page.evaluate(() => {
          document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
        });
      }

      try {
        // ログイン前画面（ログイン後にしか撮れないため、ロールごとに毎回ここで撮る）
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await removeDevIndicator();
        await page.screenshot({ path: path.join(roleDir, "login.png"), fullPage: true });

        await loginAs(page, role);

        // 同一グループ内で参照できるよう、グループごとに解決済み URL を保持する
        const resolvedByGroup = new Map<string, Map<string, string>>();

        for (const group of SCREEN_GROUPS) {
          if (group.slug === "login") continue; // 上で撮影済み
          const resolved = new Map<string, string>();
          resolvedByGroup.set(group.slug, resolved);

          for (const view of group.views) {
            if (!view.roles.includes(role)) continue;

            let targetPath: string | null = null;

            if (view.deriveFrom) {
              const base = resolved.get(view.deriveFrom.view);
              targetPath = base ? base + view.deriveFrom.suffix : null;
            } else if (view.discoverFrom) {
              const fromPath = resolved.get(view.discoverFrom);
              if (fromPath) {
                await page.goto(fromPath);
                await page.waitForLoadState("networkidle");
                targetPath = await findFirstMatchingHref(page, hrefRegexFromRoutePath(view.path));
              }
            } else {
              targetPath = view.path;
            }

            if (!targetPath) {
              console.warn(
                `[manual] skip ${group.slug}.${view.name}: URL を解決できませんでした（データ未登録の可能性）`,
              );
              continue;
            }

            await page.goto(targetPath);
            await page.waitForLoadState("networkidle");
            resolved.set(view.name, targetPath);

            await removeDevIndicator();
            const file = path.join(roleDir, `${group.slug}-${view.name}.png`);
            await page.screenshot({ path: file, fullPage: true });
          }
        }
      } finally {
        await context.close();
      }
    });
  }
});
