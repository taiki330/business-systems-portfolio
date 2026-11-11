import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures/auth";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function credentials(role: "admin" | "center") {
  return {
    email: process.env[`E2E_${role.toUpperCase()}_EMAIL`],
    password: process.env[`E2E_${role.toUpperCase()}_PASSWORD`],
  };
}

async function signedInClient(role: "admin" | "center") {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { email, password } = credentials(role);
  if (!url || !anonKey || !email || !password) return null;

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${role} login failed: ${error.message}`);
  return client;
}

test.describe("自社資材の返却権限と台帳リンク", () => {
  test("adminは返却RPCの権限を通過し、数量検証で安全に停止する", async () => {
    const client = await signedInClient("admin");
    test.skip(!client, "Supabase公開設定またはadmin資格情報がありません");

    const { error } = await client!.rpc("return_from_site", {
      p_product_id: ZERO_UUID,
      p_site_id: ZERO_UUID,
      p_quantity: 0,
      p_memo: null,
      p_returned_by: null,
    });

    expect(error?.message).toContain("quantity_must_be_positive");
    expect(error?.message).not.toContain("permission_denied");
    await client!.auth.signOut();
  });

  test("centerは返却RPCを直接呼んでも権限で拒否される", async () => {
    const client = await signedInClient("center");
    test.skip(!client, "Supabase公開設定またはcenter資格情報がありません");

    const { error } = await client!.rpc("return_from_site", {
      p_product_id: ZERO_UUID,
      p_site_id: ZERO_UUID,
      p_quantity: 0,
      p_memo: null,
      p_returned_by: null,
    });

    expect(error?.message).toContain("permission_denied");
    await client!.auth.signOut();
  });

  test("adminから返却記録の台帳ID列を参照できる", async () => {
    const client = await signedInClient("admin");
    test.skip(!client, "Supabase公開設定またはadmin資格情報がありません");

    const { error } = await client!
      .from("stock_returns")
      .select("id,site_ledger_id,center_ledger_id")
      .limit(1);

    expect(error).toBeNull();
    await client!.auth.signOut();
  });
});
