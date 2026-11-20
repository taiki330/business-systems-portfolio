// Integration test: actual server actions + supabase-js + local in-memory PostgreSQL with the RLS rules applied.
// Start tests/local-matching-server.mjs first. Never points at the app's .env.
// The fixture runs each request as the user named in the x-test-user header, so this exercises the same
// "server action → signed-in user's client → RLS" path as production, switching who is signed in per step.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
const api = "http://127.0.0.1:55170";
const nativeRequire = createRequire(import.meta.url);

/** A supabase-js client signed in as `uid` (null = signed out). getUser answers from the fixture's login. */
function clientFor(uid) {
  const client = createClient(api, "local-ui-test-key", { global: { headers: uid ? { "x-test-user": uid } : {} }, auth: { persistSession: false, autoRefreshToken: false } });
  client.auth.getUser = async () => (uid ? { data: { user: { id: uid, app_metadata: {}, user_metadata: {} } }, error: null } : { data: { user: null }, error: new Error("Auth session missing") });
  return client;
}
let signedIn = null;
const signInAs = (uid) => { signedIn = uid; };

const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const url = new URL(`../${name.replace(/^@\//, "")}.ts`, import.meta.url);
  const source = readFileSync(url, "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {}; modules.set(name, exports);
  vm.runInNewContext(outputText, {
    exports, console, process: { env: {} },
    require(dependency) {
      if (dependency === "@/lib/supabase/server") return { createServerClient: async () => clientFor(signedIn), isSupabaseConfigured: () => true };
      if (dependency === "next/cache") return { revalidatePath() {} };
      if (dependency === "next/navigation") return { redirect(location) { throw Object.assign(new Error("redirect"), { location }); } };
      // React's request cache only applies inside a server render; outside one it must not share results across sign-ins.
      if (dependency === "react") return { cache: (fn) => fn };
      return dependency.startsWith("@/") ? load(dependency) : nativeRequire(dependency);
    },
  });
  return exports;
}
const form = (values) => { const result = new FormData(); for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) result.append(key, String(item)); return result; };
let count = 0;
const check = (condition, description) => { assert.ok(condition, description); console.log(`PASS ${++count}: ${description}`); };
const newLogin = async () => (await (await fetch(`${api}/test/users`, { method: "POST" })).json()).id;

const stores = load("@/lib/actions/stores");
const profiles = load("@/lib/actions/profile");
const scouting = load("@/lib/actions/scouts");
const messaging = load("@/lib/actions/messages");
const notifications = load("@/lib/actions/notifications");
const searching = load("@/lib/actions/search");
const workers = load("@/lib/actions/workers");
const shifts = load("@/lib/actions/shifts");
const { CONSENT_VERSION } = load("@/lib/legal/versions");
const { japanDate } = load("@/lib/utils/matching");
const day = japanDate();
const owner = await newLogin();
const workerLogin = await newLogin();
const strangerLogin = await newLogin();

signInAs(null);
check(Boolean((await stores.saveStoreSettings({}, form({ name: "店", company_name: "社", area: "エリア", hourly_wage: 1200, terms_version: CONSENT_VERSION, terms_agreed_at: new Date().toISOString() }))).error), "signed-out visitors cannot register a store");

signInAs(owner);
const savedStore = await stores.saveStoreSettings({}, form({ name: "操作テスト店舗", company_name: "操作テスト企業", area: "テストエリア", hourly_wage: 1200, terms_version: CONSENT_VERSION, terms_agreed_at: new Date().toISOString() }));
check(savedStore.success, "store action persists store and rate for the signed-in owner");
const storeId = savedStore.storeId;
check(Boolean((await stores.saveStoreSettings({}, form({ store_id: randomUUID(), area: "別エリア", hourly_wage: 1300 }))).success) && (await stores.getStore(storeId)).store.area === "別エリア", "settings save updates the owner's own store even if another id is submitted");

signInAs(workerLogin);
// ワーカーの登録は register_worker だけ（migration 026）。直接 workers へ挿入はできない。
const direct = await clientFor(workerLogin).from("workers").insert({ user_id: workerLogin, name: "直接", current_store: "操作テスト店舗", business_type: "カフェ", experience_years: 1, skill_tags: ["ホール"] });
check(Boolean(direct.error), "a worker profile cannot be inserted directly");
const inserted = await clientFor(workerLogin).rpc("register_worker", { p_name: "操作テストワーカー", p_store_id: storeId, p_business_type: "カフェ", p_skill_tags: ["ホール"], p_experience_years: 1, p_bio: null, p_is_minor: false, p_guardian_name: null, p_terms_version: "terms-test", p_terms_agreed_at: new Date().toISOString() });
assert.ifError(inserted.error);
const workerId = inserted.data;
const workerActor = { role: "worker", id: workerId };
const storeActor = { role: "store", id: storeId };
const profile = await profiles.saveWorkerProfile({}, form({ worker_id: randomUUID(), name: "操作テストワーカー", business_type: "カフェ", experience_years: 2, skill_tags: ["ホール"], preferred_areas: "テストエリア、梅田", bio: "新しい自己紹介" }));
check(profile.success && profile.worker.id === workerId && profile.worker.preferred_areas.includes("テストエリア"), "profile action edits the signed-in worker, ignoring a submitted id");
const wish = await clientFor(workerLogin).from("worker_availability_slots").insert({ worker_id: workerId, slot_type: "available", status: "pending", work_date: day, start_time: "10:00", end_time: "16:00" }).select("id").single();
assert.ifError(wish.error);

signInAs(owner);
check((await shifts.updateShiftRequestStatus({}, form({ slot_id: wish.data.id, worker_id: workerId, status: "released" }))).success, "the staff member's store releases the shift to other stores");
const search = await searching.searchAvailableWorkers(day, "10:00", "15:00", { area: "テストエリア", skill: "ホール" });
check(!search.error && search.results.some((r) => r.worker.id === workerId), "store search applies area and skill filters to released availability");
const scoutForm = form({ worker_id: workerId, store_id: randomUUID(), preferred_work_date: day, preferred_start_time: "10:00", preferred_end_time: "15:00", break_minutes: 30, expected_hourly_wage: 1300, expected_fee_percent: 20, message: "操作テストの依頼です" });
await assert.rejects(scouting.createScoutRequest({}, scoutForm), (e) => e.location?.endsWith("/scout/success"));

signInAs(workerLogin);
const inbox = await scouting.getScoutsByWorkerId(workerId);
check(!inbox.error && inbox.scouts.length === 1 && inbox.scouts[0].store_id === storeId && Number(inbox.scouts[0].store_total_yen) === 7020 && Number(inbox.scouts[0].offered_total_yen) === 5850, "scout is sent from the signed-in owner's store with worker amount and fee-inclusive total");
const scoutId = inbox.scouts[0].id;
check(Boolean((await messaging.getConversation(workerActor, scoutId)).error), "conversation read is locked before acceptance");
check(Boolean((await messaging.sendChatMessage(workerActor, scoutId, "送れないはず", randomUUID())).error), "server action rejects messages before acceptance");
const notice = await notifications.getNotifications(workerActor);
check(notice.unread === 1, "worker receives a new-scout notification");
check(Boolean((await notifications.getNotifications(storeActor)).error), "a worker cannot read the store's notifications by passing its id");

signInAs(owner);
assert.equal((await notifications.readNotifications(storeActor, notice.notifications.map((n) => n.id))).error, null);
signInAs(workerLogin);
check((await notifications.getNotifications(workerActor)).unread === 1, "store cannot mark another recipient's notifications read");
assert.equal((await notifications.readNotifications(workerActor, notice.notifications.map((n) => n.id))).error, null);
check((await notifications.getNotifications(workerActor)).unread === 0, "notification read state persists");

signInAs(strangerLogin);
check(Boolean((await scouting.updateScoutStatus({}, form({ worker_id: workerId, scout_id: scoutId, status: "accepted" }))).error), "another login cannot accept the scout, even with the worker's id");
signInAs(workerLogin);
const replyForm = form({ scout_id: scoutId, status: "accepted" });
check((await scouting.updateScoutStatus({}, replyForm)).status === "accepted", "worker accepts scout through the action");
await scouting.updateScoutStatus({}, replyForm);
check(!((await messaging.getConversation(workerActor, scoutId)).error), "chat opens after acceptance");
const clientMessageId = randomUUID();
const sent = await messaging.sendChatMessage(workerActor, scoutId, "よろしくお願いします", clientMessageId);
check(!sent.error && sent.message?.body === "よろしくお願いします", "worker sends chat message");
await messaging.sendChatMessage(workerActor, scoutId, "よろしくお願いします", clientMessageId);
signInAs(owner);
const reply = await messaging.sendChatMessage(storeActor, scoutId, "お待ちしています", randomUUID());
check(!reply.error, "store replies to the accepted scout");
const conversation = await messaging.getConversation(storeActor, scoutId);
check(conversation.messages.length === 2, "both messages persist without duplicate retries");

signInAs(strangerLogin);
check(Boolean((await messaging.getConversation(workerActor, scoutId)).error), "another login cannot read the conversation by passing the worker's id");
check(Boolean((await messaging.sendChatMessage(storeActor, scoutId, "なりすまし", randomUUID())).error), "another login cannot post as the store");
check((await clientFor(strangerLogin).from("scout_messages").select("*")).data?.length === 0, "the database returns no messages to another login");

signInAs(workerLogin);
const slotResult = await clientFor(workerLogin).from("worker_availability_slots").select("*").eq("scout_request_id", scoutId);
check(slotResult.data.length === 1, "acceptance action creates one linked shift");
signInAs(strangerLogin);
check(Boolean((await shifts.clockInShift({}, form({ worker_id: workerId, slot_id: slotResult.data[0].id }))).error), "another login cannot clock in for the worker");
signInAs(workerLogin);
check((await shifts.clockInShift({}, form({ slot_id: slotResult.data[0].id }))).success, "today's accepted shift can record attendance");

signInAs(owner);
const profileAfter = await workers.getWorkerById(workerId);
check(profileAfter.worker.completed_scout_count === 1, "profile receives actual usage count after attendance");
const afterAcceptance = await searching.searchAvailableWorkers(day, "10:00", "15:00", { area: "テストエリア" });
check(!afterAcceptance.results.some((r) => r.worker.id === workerId), "confirmed overlapping work is excluded from available search");
console.log(`Action integration checks passed: ${count}`);
