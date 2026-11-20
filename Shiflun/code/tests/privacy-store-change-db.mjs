// Checks migration 026 against an in-memory PostgreSQL: private worker data, changing the workplace,
// the night-work rule for under-18 workers, and account suspension.
// Same approach as auth-rls-db.mjs: each query runs as the API role Supabase would use.
// PGLITE_MODULE may point at a temporary install's dist/index.js (no app dependency needed).
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
let checks = 0;
const pass = (label) => console.log(`PASS ${++checks}: ${label}`);
const check = (condition, label) => { assert.ok(condition, label); pass(label); };
const admin = async (sql, params = []) => (await db.query(sql, params)).rows;

async function as(claims, sql, params = []) {
  await db.exec(claims ? "SET ROLE authenticated" : "SET ROLE anon");
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [claims ? JSON.stringify(claims) : ""]);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec("RESET ROLE"); await db.query("SELECT set_config('request.jwt.claims', '', false)"); }
}
const user = (id, extra = {}) => ({ sub: id, role: "authenticated", aal: "aal1", ...extra });
const denied = async (promise, label, pattern) => { await assert.rejects(promise, pattern, label); pass(label); };

try {
  await db.exec(await readFile(new URL("./supabase-stubs.sql", import.meta.url), "utf8"));
  const root = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(root)).filter((n) => n.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(file, root), "utf8"));

  const ids = {};
  for (const name of ["adult", "minor", "other", "ownerS", "ownerT", "ownerU", "reviewer", "reviewer2"]) {
    ids[name] = randomUUID();
    await admin("INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES ($1,$2,$3)", [ids[name], `${name}@example.com`, name.startsWith("reviewer") ? JSON.stringify({ role: "identity_reviewer" }) : null]);
  }
  const U = (name) => user(ids[name]);
  const reviewer = user(ids.reviewer, { aal: "aal2", app_metadata: { role: "identity_reviewer" }, email: "reviewer@example.com" });
  const reviewerAal1 = user(ids.reviewer, { app_metadata: { role: "identity_reviewer" } });
  const today = (await admin("SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date,'YYYY-MM-DD') AS d"))[0].d;
  const days = async (n) => (await admin("SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date + $1::int,'YYYY-MM-DD') AS d", [n]))[0].d;
  const tomorrow = await days(1);

  const store = async (owner, name) => (await as(U(owner), "SELECT create_scouting_store($1,$2,'大阪市北区',1200,'terms-v4',now()) AS id", [`${name}社`, name]))[0].id;
  const storeS = await store("ownerS", "S店"), storeT = await store("ownerT", "T店"), storeU = await store("ownerU", "U店");
  const register = (who, storeId, { minor = false, guardian = null, terms = "terms-v4" } = {}) => as(U(who),
    "SELECT register_worker('名前',$1,'カフェ',ARRAY['ホール'],1,'自己紹介',$2,$3,$4,now()) AS id", [storeId, minor, guardian, terms]);

  // --- private worker data ------------------------------------------------
  const adult = (await register("adult", storeS, { guardian: "不要" }))[0].id;
  await denied(register("minor", storeS, { minor: true }), "a minor must give a guardian name", /親権者/);
  const minor = (await register("minor", storeS, { minor: true, guardian: "保護者 花子" }))[0].id;
  await denied(as(U("other"), "SELECT register_worker('名前',$1,'カフェ',ARRAY['ホール'],1,NULL,false,NULL,NULL,now())", [storeS]), "registration needs a consent record", /同意/);
  await denied(as(U("other"), "SELECT register_worker('名前',$1,'カフェ',ARRAY['ホール'],1,NULL,false,NULL,'terms-v4',now())", [randomUUID()]), "registration needs an existing store", /店舗が見つかりません/);
  const other = (await register("other", storeT))[0].id;
  check((await admin("SELECT guardian_name FROM worker_private WHERE worker_id=$1", [adult]))[0].guardian_name === null, "an adult's guardian record stays empty even if one is sent");
  const priv = (await admin("SELECT guardian_name, guardian_consented_at, terms_version FROM worker_private WHERE worker_id=$1", [minor]))[0];
  check(priv.guardian_name === "保護者 花子" && priv.guardian_consented_at !== null && priv.terms_version === "terms-v4", "a minor's guardian and consent are recorded when registering");
  check((await admin("SELECT is_minor FROM workers WHERE id=$1", [minor]))[0].is_minor === true, "the under-18 flag is on the profile");

  check((await as(U("ownerS"), "SELECT worker_id FROM worker_private")).length === 0, "a store sees no private worker data");
  check((await as(reviewer, "SELECT worker_id FROM worker_private")).length === 0, "even a reviewer sees no private worker data");
  check((await as(U("minor"), "SELECT worker_id FROM worker_private")).map((r) => r.worker_id).join() === minor, "a worker reads only their own private data");
  check((await as(U("other"), "SELECT worker_id FROM worker_private WHERE worker_id=$1", [minor])).length === 0, "a worker cannot read another worker's private data");
  await denied(as(U("minor"), "UPDATE worker_private SET guardian_name='別人' WHERE worker_id=$1", [minor]), "the guardian record cannot be edited later", /permission denied/);
  check((await as(U("minor"), "UPDATE worker_private SET terms_version='terms-v5', terms_agreed_at=now() WHERE worker_id=$1 RETURNING worker_id", [minor])).length === 1, "a worker can record consent to a new version");
  check((await as(U("other"), "UPDATE worker_private SET terms_version='x', terms_agreed_at=now() WHERE worker_id=$1 RETURNING worker_id", [minor])).length === 0, "a worker cannot record consent for someone else");
  await denied(as(U("ownerS"), "SELECT guardian_name FROM workers"), "the guardian column no longer exists on the shared profile", /guardian_name/);
  await denied(as(U("ownerS"), "SELECT terms_version FROM workers"), "the consent columns no longer exist on the shared profile", /terms_version/);
  await denied(as(U("minor"), "INSERT INTO worker_private(worker_id) VALUES ($1)", [adult]), "private rows cannot be created directly", /permission denied/);

  // --- under-18 night rule ------------------------------------------------
  const scout = (workerId, owner, storeId, start, end, wage = 1200) => as(U(owner),
    "INSERT INTO scout_requests(worker_id,store_id,company_name,store_name,preferred_work_date,preferred_start_time,preferred_end_time,offered_hourly_wage,break_minutes,service_fee_percent,message) VALUES ($1,$2,'x','x',$3,$4,$5,$6,0,20,'お願いします') RETURNING id",
    [workerId, storeId, tomorrow, start, end, wage]);
  await denied(scout(minor, "ownerS", storeS, "18:00", "22:30"), "a minor cannot be scouted past 22:00", /18歳未満/);
  await denied(scout(minor, "ownerS", storeS, "04:00", "09:00"), "a minor cannot be scouted before 05:00", /18歳未満/);
  await denied(scout(minor, "ownerS", storeS, "21:00", "23:00"), "a shift that crosses 22:00 is refused", /18歳未満/);
  check((await scout(minor, "ownerS", storeS, "17:00", "22:00")).length === 1, "a minor can be scouted for a shift ending exactly at 22:00");
  check((await scout(minor, "ownerS", storeS, "05:00", "10:00")).length === 1, "a minor can be scouted for a shift starting exactly at 05:00");
  check((await scout(adult, "ownerS", storeS, "18:00", "23:30")).length === 1, "an adult can still be scouted late at night");

  const slot = (who, start, end, date = tomorrow) => as(U(who),
    "INSERT INTO worker_availability_slots(worker_id,slot_type,status,work_date,start_time,end_time) VALUES ((SELECT id FROM workers WHERE user_id=$1),'available','pending',$2,$3,$4) RETURNING id", [ids[who], date, start, end]);
  await denied(slot("minor", "20:00", "23:00"), "a minor cannot register hours past 22:00", /18歳未満/);
  await denied(slot("minor", "03:00", "08:00"), "a minor cannot register hours before 05:00", /18歳未満/);
  check((await slot("minor", "17:00", "22:00")).length === 1, "a minor can register hours up to 22:00");
  check((await slot("adult", "20:00", "23:30")).length === 1, "an adult can register late hours");
  check((await admin("SELECT violates_minor_night_rule('17:00','22:00') AS a, violates_minor_night_rule('17:00','22:01') AS b, violates_minor_night_rule('04:59','09:00') AS c, violates_minor_night_rule('05:00','09:00') AS d"))
    .every((r) => r.a === false && r.b === true && r.c === true && r.d === false), "the night-rule boundaries are 22:00 and 05:00");
  await denied(as(U("minor"), "UPDATE workers SET is_minor=false WHERE id=$1", [minor]), "a minor cannot switch off the under-18 flag", /permission denied/);

  // --- changing the workplace ---------------------------------------------
  await denied(as(null, "SELECT change_my_store($1)", [storeT]), "signed-out visitors cannot change a workplace", /permission denied/);
  await denied(as(U("ownerS"), "SELECT change_my_store($1)", [storeT]), "a login without a worker profile cannot change a workplace", /プロフィールが見つかりません/);
  await denied(as(U("adult"), "SELECT change_my_store($1)", [storeS]), "choosing the current store is refused", /すでにこの店舗/);
  await denied(as(U("adult"), "SELECT change_my_store($1)", [randomUUID()]), "an unknown store is refused", /店舗が見つかりません/);

  // The store verifies the adult; the adult has wishes in several states and a scout-based shift.
  await admin("INSERT INTO manager_verifications(worker_id,manager_name,manager_comment,verified,store_id,store_name) VALUES ($1,'店長','よく働く',true,$2,'S店')", [adult, storeS]);
  check((await admin("SELECT verification_status FROM workers WHERE id=$1", [adult]))[0].verification_status === "verified", "(setup) the worker is verified by the current store");
  const adultSlotPending = (await slot("adult", "10:00", "12:00", await days(3)))[0].id;
  const adultSlotReleased = (await slot("adult", "10:00", "12:00", await days(4)))[0].id;
  await admin("UPDATE worker_availability_slots SET status='released' WHERE id=$1", [adultSlotReleased]);
  const adultSlotAssigned = (await slot("adult", "13:00", "15:00", await days(5)))[0].id;
  await admin("UPDATE worker_availability_slots SET status='assigned' WHERE id=$1", [adultSlotAssigned]);
  await denied(as(U("adult"), "SELECT change_my_store($1)", [storeT]), "an upcoming confirmed shift blocks the change", /確定している勤務/);
  await admin("UPDATE worker_availability_slots SET status='pending' WHERE id=$1", [adultSlotAssigned]);

  const scoutTA = (await scout(adult, "ownerT", storeT, "09:00", "11:00", 1200))[0].id;
  await as(U("adult"), "SELECT respond_to_scout($1,$2,'accepted')", [scoutTA, adult]);
  await admin("INSERT INTO staff_messages(worker_id,store_id,sender_role,client_message_id,body) VALUES ($1,$2,'worker',gen_random_uuid(),'前の店のメッセージ')", [adult, storeS]);

  check((await as(U("adult"), "SELECT change_my_store($1) AS id", [storeT]))[0].id === storeT, "a worker can change to another store");
  const moved = (await admin("SELECT current_store, current_store_id, verification_status, store_changed_at FROM workers WHERE id=$1", [adult]))[0];
  check(moved.current_store === "T店" && moved.current_store_id === storeT && moved.store_changed_at !== null, "the workplace and its name change");
  check(moved.verification_status === "unverified", "the manager verification is cleared");
  check((await admin("SELECT id FROM manager_verifications WHERE worker_id=$1", [adult])).length === 1, "the old verification record is kept as history");
  check((await admin("SELECT id FROM worker_availability_slots WHERE id = ANY($1::uuid[])", [[adultSlotPending, adultSlotReleased, adultSlotAssigned]])).length === 0, "wishes made for the old store are withdrawn");
  check((await admin("SELECT id FROM worker_availability_slots WHERE scout_request_id=$1", [scoutTA])).length === 1, "a shift from another store's scout stays");
  check((await admin("SELECT id FROM staff_messages WHERE worker_id=$1 AND store_id=$2", [adult, storeS])).length === 1, "chat history stays with the old store");
  check((await as(U("ownerT"), "SELECT worker_name FROM store_join_requests WHERE worker_id=$1 AND store_id=$2", [adult, storeT])).length === 1, "the new store sees the self-report");
  check((await as(U("ownerS"), "SELECT id FROM worker_availability_slots WHERE worker_id=$1 AND status='released'", [adult])).length === 0, "the old store no longer sees the worker's wishes");
  await denied(as(U("adult"), "SELECT change_my_store($1)", [storeU]), "a second change within 7 days is refused", /7日に1回/);
  await admin("UPDATE workers SET store_changed_at = now() - interval '8 days' WHERE id=$1", [adult]);
  check((await as(U("adult"), "SELECT change_my_store($1) AS id", [storeU]))[0].id === storeU, "the worker can change again after 7 days");
  await admin("UPDATE stores SET deleted_at=now(), owner_user_id=NULL WHERE id=$1", [storeS]);
  await admin("UPDATE workers SET store_changed_at = NULL WHERE id=$1", [adult]);
  await denied(as(U("adult"), "SELECT change_my_store($1)", [storeS]), "a closed store cannot be chosen", /店舗が見つかりません/);
  await admin("UPDATE stores SET deleted_at=NULL, owner_user_id=$2 WHERE id=$1", [storeS, ids.ownerS]);

  // --- suspension ---------------------------------------------------------
  await admin("INSERT INTO auth.sessions(user_id) VALUES ($1), ($1)", [ids.other]);
  await denied(as(U("ownerT"), "SELECT suspend_account($1,NULL,'迷惑行為',NULL)", [other]), "a store owner cannot suspend accounts", /審査担当/);
  await denied(as(reviewerAal1, "SELECT suspend_account($1,NULL,'迷惑行為',NULL)", [other]), "a reviewer without two-step sign-in cannot suspend", /審査担当/);
  await denied(as(null, "SELECT suspend_account($1,NULL,'x',NULL)", [other]), "signed-out visitors cannot suspend", /permission denied/);
  await denied(as(reviewer, "SELECT suspend_account($1,$2,'x',NULL)", [other, storeT]), "exactly one of worker or store must be named", /どちらか一方/);
  await denied(as(reviewer, "SELECT suspend_account($1,NULL,'   ',NULL)", [other]), "a reason is required", /理由/);
  await denied(as(reviewer, "SELECT suspend_account($1,NULL,'x',NULL)", [randomUUID()]), "an unknown account is refused", /見つかりません/);

  const report = (await as(U("other"), "SELECT report_chat('worker','staff',NULL,$1,$2,NULL,'harassment','困っています') AS id", [other, storeT]))[0].id;
  const pendingScout = (await scout(other, "ownerT", storeT, "10:00", "12:00"))[0].id;
  const suspension = (await as(reviewer, "SELECT suspend_account($1,NULL,'繰り返しの迷惑行為',$2) AS id", [other, report]))[0].id;
  const banned = (await admin("SELECT banned_until FROM auth.users WHERE id=$1", [ids.other]))[0].banned_until;
  check(banned !== null && new Date(banned) > new Date(Date.now() + 365 * 24 * 3600 * 1000), "the login is banned for a long time");
  check((await admin("SELECT id FROM auth.sessions WHERE user_id=$1", [ids.other])).length === 0, "the current sign-ins are ended");
  check((await admin("SELECT suspended_at FROM workers WHERE id=$1", [other]))[0].suspended_at !== null, "the worker profile is marked suspended");
  const rec = (await admin("SELECT email, suspended_by, report_id, lifted_at FROM account_suspensions WHERE id=$1", [suspension]))[0];
  check(rec.email === "other@example.com" && rec.suspended_by === "reviewer@example.com" && rec.report_id === report && rec.lifted_at === null, "the suspension is recorded with who did it and why");
  const handled = (await admin("SELECT status, resolution_note FROM chat_reports WHERE id=$1", [report]))[0];
  check(handled.status === "resolved" && handled.resolution_note.includes("繰り返しの迷惑行為"), "the report is marked handled with the reason");
  await denied(as(reviewer, "SELECT suspend_account($1,NULL,'もう一度',NULL)", [other]), "an already suspended login cannot be suspended twice", /すでに利用停止/);
  await denied(scout(other, "ownerT", storeT, "10:00", "12:00"), "a suspended worker cannot be scouted", /ご利用いただけない/);
  check((await as(reviewer, "SELECT id FROM account_suspensions")).length === 1, "a reviewer can read the suspension list");
  check((await as(U("ownerT"), "SELECT id FROM account_suspensions")).length === 0, "others cannot read the suspension list");

  // A suspended store: its pending scouts are declined, and nobody can message it.
  const storeScout = (await scout(adult, "ownerU", storeU, "10:00", "12:00"))[0].id;
  const storeSuspension = (await as(reviewer, "SELECT suspend_account(NULL,$1,'店舗の規約違反',NULL) AS id", [storeU]))[0].id;
  check((await admin("SELECT status FROM scout_requests WHERE id=$1", [storeScout]))[0].status === "rejected", "a suspended store's pending scouts are declined");
  check((await admin("SELECT suspended_at FROM stores WHERE id=$1", [storeU]))[0].suspended_at !== null, "the store is marked suspended");
  await denied(as(U("adult"), "SELECT change_my_store($1)", [storeU]), "a suspended store cannot be chosen as a workplace", /店舗が見つかりません/);
  const reviewerWorker = (await register("reviewer2", storeT))[0].id;
  await denied(as(reviewer, "SELECT suspend_account($1,NULL,'x',NULL)", [reviewerWorker]), "a reviewer's own login cannot be suspended from this screen", /審査担当のアカウント/);

  // Lifting a suspension restores the login.
  await denied(as(U("other"), "SELECT lift_suspension($1,'解除')", [suspension]), "only a reviewer can lift a suspension", /審査担当/);
  await denied(as(reviewer, "SELECT lift_suspension($1,'  ')", [suspension]), "a reason is required to lift a suspension", /理由/);
  await as(reviewer, "SELECT lift_suspension($1,'本人から謝罪があった')", [suspension]);
  check((await admin("SELECT banned_until FROM auth.users WHERE id=$1", [ids.other]))[0].banned_until === null, "lifting the suspension unbans the login");
  check((await admin("SELECT suspended_at FROM workers WHERE id=$1", [other]))[0].suspended_at === null, "lifting the suspension clears the mark");
  check((await admin("SELECT lifted_by, lift_note FROM account_suspensions WHERE id=$1", [suspension]))[0].lift_note === "本人から謝罪があった", "the lift is recorded");
  await denied(as(reviewer, "SELECT lift_suspension($1,'もう一度')", [suspension]), "a suspension cannot be lifted twice", /すでに解除/);
  check((await scout(other, "ownerT", storeT, "10:00", "12:00")).length === 1, "a worker can be scouted again after the suspension is lifted");
  void pendingScout; void storeSuspension;

  // --- leaving still works with the split data ----------------------------
  await as(U("minor"), "SELECT delete_my_account()");
  check((await admin("SELECT worker_id FROM worker_private WHERE worker_id=$1", [minor])).length === 0, "leaving deletes the private data (guardian and consent records)");
  check((await admin("SELECT is_minor, name FROM workers WHERE id=$1", [minor]))[0].name === "退会済みユーザー", "leaving still anonymises the profile");

  console.log(`Privacy, workplace, night rule and suspension checks passed: ${checks}`);
} finally { await db.close(); }
