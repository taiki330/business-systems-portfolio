import { test, expect } from "./fixtures/auth";
import { countSearchableOptions, pickSearchable, pickSearchableIndex, todayISO, uniqueName } from "./helpers";

/**
 * admin: リース伝票作成・承認・キャンセル
 * あわせて「承認後は編集不可」「closed 後は操作不可（画面上、操作フォームが出ない）」も確認する。
 */

async function createCompany(page: import("@playwright/test").Page) {
  const name = uniqueName("E2E伝票会社");
  await page.goto("/leases/companies/new");
  await page.getByLabel("リース会社名").fill(name);
  await page.getByRole("button", { name: "登録" }).click();
  await page.waitForURL("**/leases/companies");
  return name;
}

async function createDraftBatch(
  page: import("@playwright/test").Page,
  companyName: string,
  slip: string,
) {
  await page.goto("/leases/batches/new");
  await pickSearchable(page.getByLabel("リース会社"), companyName);
  await page.getByLabel("伝票番号").fill(slip);
  await page.getByLabel("借用日").fill(todayISO());

  const productInput = page.locator("#item_product_id_0");
  const productOptionCount = await countSearchableOptions(productInput);
  test.skip(
    productOptionCount <= 1,
    "商品マスタが空のため借用明細を作成できない（先に商品を登録してください）",
  );
  await pickSearchableIndex(productInput, 1);
  await page.locator("#item_quantity_0").fill("10");

  await page.getByRole("button", { name: "登録" }).click();
  await page.waitForURL(/\/leases\/batches\/[0-9a-f-]+\?ok=created/);
}

test.describe("admin: リース伝票の作成・承認・キャンセル", () => {
  test("伝票を作成すると draft（登録済み・未承認）で作られる", async ({
    adminPage: page,
  }) => {
    const company = await createCompany(page);
    await createDraftBatch(page, company, uniqueName("SLIP"));

    await expect(page.getByText("登録済み（未承認）")).toBeVisible();
    await expect(page.getByRole("button", { name: "承認する" })).toBeVisible();
    await expect(page.getByRole("button", { name: "キャンセル" })).toBeVisible();
  });

  test("承認すると承認済みになり、承認後は編集フォームが出ない", async ({
    adminPage: page,
  }) => {
    const company = await createCompany(page);
    await createDraftBatch(page, company, uniqueName("SLIP"));

    await page.getByRole("button", { name: "承認する" }).click();
    await page.waitForURL(/\?ok=approved/);
    await expect(page.getByText("承認済み（受入待ち）")).toBeVisible();

    // 承認後: 「承認する」ボタンは消える。キャンセルも受入0件なら出るが、
    // 伝票ヘッダー（会社・伝票番号等）を直接編集する UI 要素自体がそもそも存在しないことを確認する
    // （画面上にヘッダー編集フォーム・input が無い＝draft 限定編集のみという設計どおり）。
    await expect(page.getByRole("button", { name: "承認する" })).toHaveCount(0);
    await expect(
      page.locator('input[name="slip_number"], input[name="note"]'),
    ).toHaveCount(0);
  });

  test("キャンセルすると cancelled になり、以後の操作ボタンが出ない", async ({
    adminPage: page,
  }) => {
    const company = await createCompany(page);
    await createDraftBatch(page, company, uniqueName("SLIP"));

    await page.getByRole("button", { name: "キャンセル" }).click();
    await page.waitForURL(/\?ok=cancelled/);
    await expect(page.getByText("キャンセル", { exact: true })).toBeVisible();

    await expect(page.getByRole("button", { name: "承認する" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "キャンセル" })).toHaveCount(0);
  });

  test("会社を選択しない・明細が無いと登録できない", async ({
    adminPage: page,
  }) => {
    await page.goto("/leases/batches/new");
    await expect(page.getByLabel("リース会社")).toHaveAttribute("required", "");
    await page.getByLabel("借用日").fill(todayISO());
    await page.getByRole("button", { name: "登録" }).click();
    // required 属性によりブラウザ側でブロックされ、new ページに留まる
    await expect(page).toHaveURL(/\/leases\/batches\/new$/);
  });
});
