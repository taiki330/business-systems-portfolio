import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import path from "path";

/**
 * dotenv 相当の最小ローダー（新規依存追加を避けるため自前実装）。
 * e2e/.env.e2e が無ければ何もしない（CI 等で環境変数を直接渡す運用にも対応）。
 */
function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// RPCを直接検証するE2Eでも公開Supabase設定を使えるようにする。
// 資格情報は引き続きe2e/.env.e2e側で管理する。
loadEnvFile(path.join(__dirname, ".env.local"));
loadEnvFile(path.join(__dirname, "e2e", ".env.e2e"));

/**
 * Phase 3 E2E テスト設定。
 *
 * 実行には実際の Supabase プロジェクト（.env.local の NEXT_PUBLIC_SUPABASE_URL）に対する
 * admin / center / vendor 各ロールの本物のログイン資格情報が必要（e2e/.env.e2e、
 * e2e/.env.e2e.example 参照）。RLS/RPC は auth.uid() を見るため、ログインなしでは
 * データ変更を伴うテストは実行できない。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // 同一データを共有するシナリオがあるため直列実行
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "e2e-report" }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
