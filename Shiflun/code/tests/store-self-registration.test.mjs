import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual server action without connecting to a live database.
function loadModule(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    process: { env: {} },
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

const options = loadModule("../lib/constants/options.ts");
const versions = loadModule("../lib/legal/versions.ts");

const STORE = { id: "registered-store-id", name: "登録済みの店舗" };

const USER = { id: "signed-in-user-id" };

function setup({ connected = true, signedIn = true, alreadyRegistered = false, workerError = null, feedError = null, storeExists = true } = {}) {
  const writes = [];
  const paths = [];
  const client = {
    from(table) {
      if (table === "workers") {
        // 1つのログインにワーカーは1人: 登録前に、このログインのワーカーがいないかを確かめる
        return {
          select(columns) {
            assert.equal(columns, "id");
            return {
              eq(column, value) {
                assert.equal(column, "user_id");
                assert.equal(value, USER.id);
                return { maybeSingle: async () => ({ data: alreadyRegistered ? { id: "existing-worker" } : null, error: null }), insert: undefined };
              },
            };
          },
        };
      }
      if (table === "stores") {
        return {
          select(columns) {
            assert.equal(columns, "id, name");
            return {
              eq(column, value) {
                assert.equal(column, "id");
                return { maybeSingle: async () => ({ data: storeExists && value === STORE.id ? STORE : null, error: null }) };
              },
            };
          },
        };
      }
      return { insert: (row) => client.insertInto(table, row) };
    },
    insertInto(table, row) {
      writes.push({ table, row });
      assert.equal(table, "store_join_requests");
      return Promise.resolve({ error: feedError });
    },
    // ワーカーの登録は register_worker だけ（migration 026）。公開プロフィールと本人専用情報を同時に作る。
    async rpc(name, args) {
      assert.equal(name, "register_worker");
      writes.push({ table: name, row: args });
      return { data: workerError ? null : "new-worker-id", error: workerError };
    },
  };
  const actions = loadModule("../lib/actions/store-requests.ts", {
    "next/cache": { revalidatePath: (path) => paths.push(path) },
    "@/lib/constants/options": options,
    "@/lib/supabase/server": { createServerClient: () => connected ? client : null },
    "@/lib/auth/session": {
      getAuth: async () => ({ supabase: connected ? client : null, user: connected && signedIn ? USER : null }),
      requireStore: async () => ({ supabase: null, store: null, error: "not used" }),
    },
    "@/lib/legal/versions": versions,
  });
  return { actions, writes, paths };
}

const AGREED_AT = new Date(Date.now() - 10 * 60 * 1000).toISOString();

function form() {
  const data = new FormData();
  data.set("worker_name", "初めてのスタッフ");
  data.set("store_id", STORE.id);
  data.set("business_type", options.BUSINESS_TYPES[1]);
  data.append("skill_tags", options.SKILL_TAGS[0]);
  data.set("experience_years", "1");
  data.set("age_bracket", "adult");
  // 同意ページ（/agreement）で「同意する」を押した記録
  data.set("terms_version", versions.CONSENT_VERSION);
  data.set("terms_agreed_at", AGREED_AT);
  return data;
}

test("first worker self-registers without a manager or an existing store worker", async () => {
  const { actions, writes, paths } = setup();
  const result = await actions.submitJoinRequest({}, form());
  assert.equal(result.success, true);
  assert.equal(result.workerId, "new-worker-id");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].table, "register_worker");
  assert.equal(writes[0].row.p_business_type, options.BUSINESS_TYPES[1]);
  assert.equal(writes[0].row.p_store_id, STORE.id); // only the store id is sent; the DB takes the name from the store
  assert.ok(!("p_store_name" in writes[0].row) && !("p_current_store" in writes[0].row));
  assert.ok(!("p_verification_status" in writes[0].row), "the client cannot choose the verification state");
  assert.ok(!("p_user_id" in writes[0].row), "the profile belongs to the signed-in login, which the DB reads itself");
  assert.equal(writes[0].row.p_is_minor, false);
  assert.equal(writes[0].row.p_guardian_name, null);
  assert.equal(writes[0].row.p_terms_version, versions.CONSENT_VERSION);
  assert.equal(writes[0].row.p_terms_agreed_at, AGREED_AT); // the time the agree button was pressed
  assert.equal(writes[1].row.worker_id, "new-worker-id");
  assert.equal(writes[1].row.store_id, STORE.id);
  assert.equal(writes[1].row.store_name, STORE.name);
  assert.equal(writes[1].row.status, "approved"); // compatibility record, not an approval gate
  assert.ok(paths.includes("/managers/staff"));
});

test("stores that are not registered in Shiflun cannot be claimed", async () => {
  for (const storeId of ["", "made-up-store-id"]) {
    const { actions, writes } = setup();
    const data = form();
    data.set("store_id", storeId);
    assert.ok((await actions.submitJoinRequest({}, data)).error);
    assert.equal(writes.length, 0);
  }
  const { actions, writes } = setup({ storeExists: false });
  assert.ok((await actions.submitJoinRequest({}, form())).error);
  assert.equal(writes.length, 0);
});

test("free-text store names are ignored even if a client still sends one", async () => {
  const { actions, writes } = setup();
  const data = form();
  data.set("store_name", "架空の店舗");
  assert.equal((await actions.submitJoinRequest({}, data)).success, true);
  assert.equal(writes[0].row.p_store_id, STORE.id);
  assert.ok(!Object.values(writes[0].row).includes("架空の店舗"));
});

test("minors must provide guardian consent, which is recorded", async () => {
  for (const [name, consent] of [["", "on"], ["保護者 花子", null]]) {
    const { actions, writes } = setup();
    const data = form();
    data.set("age_bracket", "minor");
    data.set("guardian_name", name);
    if (consent) data.set("guardian_consent", consent);
    assert.ok((await actions.submitJoinRequest({}, data)).error);
    assert.equal(writes.length, 0);
  }
  const { actions, writes } = setup();
  const data = form();
  data.set("age_bracket", "minor");
  data.set("guardian_name", "保護者 花子");
  data.set("guardian_consent", "on");
  assert.equal((await actions.submitJoinRequest({}, data)).success, true);
  assert.equal(writes[0].row.p_is_minor, true);
  assert.equal(writes[0].row.p_guardian_name, "保護者 花子");
});

test("registration requires a current, recent consent from the agreement page", async () => {
  const hour = 60 * 60 * 1000;
  const cases = [
    [null, AGREED_AT], // never agreed
    ["terms-old+privacy-old", AGREED_AT], // agreed to an older version
    [versions.CONSENT_VERSION, null],
    [versions.CONSENT_VERSION, "not-a-date"],
    [versions.CONSENT_VERSION, new Date(Date.now() - 25 * hour).toISOString()], // expired
    [versions.CONSENT_VERSION, new Date(Date.now() + hour).toISOString()], // in the future
  ];
  for (const [version, agreedAt] of cases) {
    const { actions, writes } = setup();
    const data = form();
    if (version) data.set("terms_version", version); else data.delete("terms_version");
    if (agreedAt) data.set("terms_agreed_at", agreedAt); else data.delete("terms_agreed_at");
    assert.match((await actions.submitJoinRequest({}, data)).error, /同意/);
    assert.equal(writes.length, 0);
  }
});

test("an existing account records consent for the current version only", async () => {
  const updates = [];
  const consent = loadModule("../lib/actions/consent.ts", {
    "@/lib/legal/versions": versions,
    "@/lib/supabase/participant": { validParticipant: (a) => /^[0-9a-f-]{36}$/.test(a.id) },
    "@/lib/supabase/server": { isSupabaseConfigured: () => true },
    "@/lib/auth/session": {
      // ログイン中の本人の立場（id）のときだけクライアントを返す
      authorizeActor: async (actor) => actor.id === id ? {
        from(table) {
          return { update(row) { return { eq(column, value) { updates.push({ table, row, column, id: value }); return { select: () => ({ maybeSingle: async () => ({ data: { id: value }, error: null }) }) }; } }; } };
        },
      } : null,
    },
  });
  const id = "00000000-0000-0000-0000-000000000001";
  assert.ok((await consent.recordConsent({ role: "worker", id: "00000000-0000-0000-0000-000000000002" }, versions.CONSENT_VERSION, AGREED_AT)).error, "someone else's account");
  assert.equal(updates.length, 0);
  assert.equal((await consent.recordConsent({ role: "worker", id }, versions.CONSENT_VERSION, AGREED_AT)).error, null);
  assert.deepEqual(JSON.parse(JSON.stringify(updates)), [{ table: "worker_private", row: { terms_version: versions.CONSENT_VERSION, terms_agreed_at: AGREED_AT }, column: "worker_id", id }]);
  assert.ok((await consent.recordConsent({ role: "store", id }, "terms-old+privacy-old", AGREED_AT)).error);
  assert.equal(updates.length, 1);
});

test("age bracket is required", async () => {
  const { actions, writes } = setup();
  const data = form();
  data.delete("age_bracket");
  assert.ok((await actions.submitJoinRequest({}, data)).error);
  assert.equal(writes.length, 0);
});

test("missing or invalid business type cannot be saved", async () => {
  for (const businessType of ["", "invalid"]) {
    const { actions, writes } = setup();
    const data = form();
    data.set("business_type", businessType);
    assert.ok((await actions.submitJoinRequest({}, data)).error);
    assert.equal(writes.length, 0);
  }
});

test("invalid experience cannot be saved", async () => {
  for (const experience of ["NaN", "Infinity", "-1", "0.5", "100"]) {
    const { actions, writes } = setup();
    const data = form();
    data.set("experience_years", experience);
    assert.ok((await actions.submitJoinRequest({}, data)).error);
    assert.equal(writes.length, 0);
  }
});

test("registration failure does not create a feed record", async () => {
  const { actions, writes } = setup({ workerError: { message: "save failed" } });
  const result = await actions.submitJoinRequest({}, form());
  assert.equal(result.error, "save failed");
  assert.equal(result.success, undefined);
  assert.equal(writes.length, 1);
});

test("feed failure preserves successful registration and warns against re-registering", async () => {
  const { actions } = setup({ feedError: { message: "feed failed" } });
  const result = await actions.submitJoinRequest({}, form());
  assert.equal(result.success, true);
  assert.equal(result.workerId, "new-worker-id");
  assert.match(result.warning, /再登録は不要/);
});

test("registration requires a signed-in login, and one profile per login", async () => {
  for (const options of [{ signedIn: false }, { alreadyRegistered: true }]) {
    const { actions, writes } = setup(options);
    assert.ok((await actions.submitJoinRequest({}, form())).error);
    assert.equal(writes.length, 0);
  }
});

test("mock mode / unavailable DB never pretends to save a registration", async () => {
  const { actions, writes } = setup({ connected: false });
  const result = await actions.submitJoinRequest({}, form());
  assert.ok(result.error);
  assert.equal(result.success, undefined);
  assert.equal(writes.length, 0);
});

test("manager reports a worker without approving, changing, or deleting their registration", async () => {
  const writes = [];
  const client = {
    from(table) {
      assert.equal(table, "worker_flags");
      return { insert: async (row) => { writes.push(row); return { error: null }; } };
    },
  };
  const actions = loadModule("../lib/actions/worker-flags.ts", {
    "next/cache": { revalidatePath() {} },
    "@/lib/supabase/server": { createServerClient: () => client },
    "@/lib/auth/session": { requireStore: async () => ({ supabase: client, store: { id: "own-store-id", name: "自分の店舗" }, error: null }) },
  });
  const data = new FormData();
  data.set("worker_id", "reported-worker");
  data.set("store_name", "テスト店舗");
  data.set("reporter_name", "テスト店長");
  data.set("reason", "自店で働いている人物に心当たりがない");
  assert.equal((await actions.reportWorker({}, data)).success, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].worker_id, "reported-worker");
  assert.equal(writes[0].status, "open");
  assert.equal(writes[0].store_id, "own-store-id"); // the signed-in owner's store, not the submitted name
  assert.equal(writes[0].store_name, "自分の店舗");
});
