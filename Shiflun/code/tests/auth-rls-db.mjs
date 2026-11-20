// Checks the access rules from migration 022 against an in-memory PostgreSQL (never touches Supabase).
// Each query runs as the API role Supabase would use: anon, or authenticated with the signed-in user's JWT claims.
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

/** Runs one statement as a Supabase API role. claims = null → anon. */
async function as(claims, sql, params = []) {
  await db.exec(claims ? "SET ROLE authenticated" : "SET ROLE anon");
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [claims ? JSON.stringify(claims) : ""]);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec("RESET ROLE"); await db.query("SELECT set_config('request.jwt.claims', '', false)"); }
}
const user = (id, extra = {}) => ({ sub: id, role: "authenticated", aal: "aal1", ...extra });
const denied = async (promise, label, pattern = /permission denied|row-level security|変更できません|見つかりません|所属店舗|参加者|violates/) => {
  await assert.rejects(promise, pattern, label); pass(label);
};

try {
  await db.exec(await readFile(new URL("./supabase-stubs.sql", import.meta.url), "utf8"));
  const root = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(root)).filter((n) => n.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(file, root), "utf8"));

  const ids = {};
  for (const name of ["workerA", "workerB", "ownerS", "ownerT", "reviewer", "stranger"]) {
    ids[name] = randomUUID();
    await admin("INSERT INTO auth.users(id) VALUES ($1)", [ids[name]]);
  }
  const A = user(ids.workerA), B = user(ids.workerB), S = user(ids.ownerS), T = user(ids.ownerT), X = user(ids.stranger);
  const reviewerAal1 = user(ids.reviewer, { app_metadata: { role: "identity_reviewer" } });
  const reviewer = user(ids.reviewer, { aal: "aal2", app_metadata: { role: "identity_reviewer" } });
  const today = (await admin("SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date,'YYYY-MM-DD') AS d"))[0].d;

  // --- signed out ---------------------------------------------------------
  for (const table of ["workers", "stores", "scout_requests", "app_notifications", "identity_verifications", "payouts"]) {
    await denied(as(null, `SELECT * FROM ${table}`), `anon cannot read ${table}`, /permission denied/);
  }
  await denied(as(null, "SELECT create_scouting_store('c','s','a',1000,'v',now())"), "anon cannot register a store", /permission denied/);

  // --- stores -------------------------------------------------------------
  const storeS = (await as(S, "SELECT create_scouting_store('S社','S店','大阪市北区',1200,'terms-v4',now()) AS id"))[0].id;
  const storeT = (await as(T, "SELECT create_scouting_store('T社','T店','大阪市中央区',1100,'terms-v4',now()) AS id"))[0].id;
  check((await admin("SELECT owner_user_id FROM stores WHERE id=$1", [storeS]))[0].owner_user_id === ids.ownerS, "a new store belongs to the signed-in owner");
  check((await as(A, "SELECT id FROM stores")).length === 2, "signed-in users can list store names");
  await denied(as(S, "INSERT INTO stores(company_id,name,owner_user_id) SELECT company_id,'偽店',$1 FROM stores LIMIT 1", [ids.ownerS]), "stores cannot be inserted directly", /permission denied/);
  check((await as(T, "UPDATE stores SET hourly_wage=1 WHERE id=$1 RETURNING id", [storeS])).length === 0, "another owner cannot change a store");
  await denied(as(S, "UPDATE stores SET owner_user_id=$1 WHERE id=$2", [ids.ownerT, storeS]), "an owner cannot hand the store to another login", /permission denied/);
  check((await as(S, "UPDATE stores SET hourly_wage=1300 WHERE id=$1 RETURNING id", [storeS])).length === 1, "the owner can change their store's wage");

  // --- workers ------------------------------------------------------------
  // ワーカーの登録は register_worker だけ（登録するのは、ログイン中の本人自身。認証済みの印は付けられない）。
  const insertWorker = (claims, storeId) => as(claims,
    "SELECT register_worker('名前',$1,'カフェ',ARRAY['ホール'],1,NULL,false,NULL,'terms-v4',now()) AS id", [storeId]);
  await denied(as(A, "INSERT INTO workers(user_id,name,current_store,business_type,experience_years,skill_tags) VALUES ($1,'名前','店','カフェ',1,ARRAY['ホール'])", [ids.workerA]), "a worker cannot insert a profile directly", /permission denied/);
  await denied(as(null, "SELECT register_worker('名前',$1,'カフェ',ARRAY['ホール'],1,NULL,false,NULL,'terms-v4',now())", [storeS]), "signed-out visitors cannot register", /permission denied/);
  const workerA = (await insertWorker(A, storeS))[0].id;
  const workerB = (await insertWorker(B, storeT))[0].id;
  check((await admin("SELECT user_id, verification_status FROM workers WHERE id=$1", [workerA]))[0].user_id === ids.workerA, "a registered profile belongs to the signed-in login");
  check((await admin("SELECT verification_status FROM workers WHERE id=$1", [workerA]))[0].verification_status === "unverified", "a new profile starts unverified");
  await denied(insertWorker(A, storeS), "one login can register only one profile", /登録済み/);
  check((await as(A, "SELECT id FROM workers")).map((r) => r.id).join() === workerA, "a worker sees only their own profile");
  check((await as(S, "SELECT id FROM workers")).length === 2, "stores can see worker profiles for scouting");
  check((await as(X, "SELECT id FROM workers")).length === 0, "a login with no profile or store sees no workers");
  await denied(as(A, "UPDATE workers SET verification_status='verified' WHERE id=$1", [workerA]), "a worker cannot mark themselves verified", /permission denied/);
  await denied(as(A, "UPDATE workers SET user_id=$1 WHERE id=$2", [ids.workerB, workerA]), "a worker cannot move their profile to another login", /permission denied/);
  check((await as(A, "UPDATE workers SET bio='よろしく' WHERE id=$1 RETURNING id", [workerB])).length === 0, "a worker cannot edit another worker");
  check((await as(A, "UPDATE workers SET bio='よろしく' WHERE id=$1 RETURNING id", [workerA])).length === 1, "a worker can edit their own profile");

  // --- shifts -------------------------------------------------------------
  await denied(as(A, "INSERT INTO worker_availability_slots(worker_id,slot_type,status,work_date,start_time,end_time) VALUES ($1,'available','pending',$2,'10:00','12:00')", [workerB, today]), "a worker cannot add shifts for someone else");
  await denied(as(A, "INSERT INTO worker_availability_slots(worker_id,slot_type,status,work_date,start_time,end_time) VALUES ($1,'available','attended',$2,'10:00','12:00')", [workerA, today]), "a worker cannot add an already-worked shift");
  const wish = (await as(A, "INSERT INTO worker_availability_slots(worker_id,slot_type,status,work_date,start_time,end_time) VALUES ($1,'available','pending',$2,'10:00','12:00') RETURNING id", [workerA, today]))[0].id;
  check((await as(T, "SELECT id FROM worker_availability_slots WHERE id=$1", [wish])).length === 0, "another store cannot see a staff member's shift wish");
  check((await as(T, "UPDATE worker_availability_slots SET status='released' WHERE id=$1 RETURNING id", [wish])).length === 0, "another store cannot decide a staff member's shift");
  await denied(as(A, "UPDATE worker_availability_slots SET status='assigned' WHERE id=$1", [wish]), "a worker cannot confirm their own shift wish");
  await denied(as(S, "UPDATE worker_availability_slots SET status='attended' WHERE id=$1", [wish]), "the store cannot record attendance for a wish");
  check((await as(S, "UPDATE worker_availability_slots SET status='released',reviewed_at=now() WHERE id=$1 RETURNING id", [wish])).length === 1, "the staff member's store can release the shift to other stores");
  check((await as(T, "SELECT id FROM worker_availability_slots WHERE id=$1", [wish])).length === 1, "released shifts are visible to other stores for search");
  check((await as(B, "SELECT id FROM worker_availability_slots WHERE id=$1", [wish])).length === 0, "other workers cannot see released shifts");

  // --- scouts and scout chat ----------------------------------------------
  const sendScout = (claims, storeId, workerId) => as(claims,
    "INSERT INTO scout_requests(worker_id,store_id,company_name,store_name,preferred_work_date,preferred_start_time,preferred_end_time,offered_hourly_wage,break_minutes,service_fee_percent,message) VALUES ($1,$2,'x','x',$3,'13:00','15:00',$4,0,20,'お願いします') RETURNING id",
    [workerId, storeId, today, storeId === storeS ? 1300 : 1100]);
  await denied(sendScout(S, storeT, workerB), "a store cannot send a scout in another store's name");
  await denied(sendScout(A, storeS, workerB), "a worker cannot send scouts");
  const scout = (await sendScout(S, storeS, workerB))[0].id;
  check((await as(T, "SELECT id FROM scout_requests WHERE id=$1", [scout])).length === 0, "other stores cannot see the scout");
  check((await as(A, "SELECT id FROM scout_requests WHERE id=$1", [scout])).length === 0, "other workers cannot see the scout");
  await denied(as(B, "UPDATE scout_requests SET offered_total_yen=999999 WHERE id=$1", [scout]), "the worker cannot rewrite the offer", /permission denied/);
  await denied(as(A, "SELECT respond_to_scout($1,$2,'accepted')", [scout, workerB]), "another worker cannot accept on the worker's behalf");
  await as(B, "SELECT respond_to_scout($1,$2,'accepted')", [scout, workerB]);
  check((await as(B, "SELECT status FROM worker_availability_slots WHERE scout_request_id=$1", [scout]))[0].status === "assigned", "accepting creates the worker's confirmed shift");
  const scoutChat = (claims, role, senderId) => as(claims, "INSERT INTO scout_messages(scout_id,sender_role,sender_id,client_message_id,body) VALUES ($1,$2,$3,$4,'よろしく') RETURNING id", [scout, role, senderId, randomUUID()]);
  await denied(scoutChat(A, "worker", workerB), "a worker cannot post as another worker");
  await denied(scoutChat(T, "store", storeS), "a store cannot post as another store");
  await scoutChat(B, "worker", workerB);
  await scoutChat(S, "store", storeS);
  check((await as(T, "SELECT id FROM scout_messages")).length === 0 && (await as(A, "SELECT id FROM scout_messages")).length === 0, "outsiders cannot read the scout chat");
  check((await as(B, "SELECT id FROM scout_messages")).length === 2 && (await as(S, "SELECT id FROM scout_messages")).length === 2, "both sides of the scout can read the chat");

  // --- notifications ------------------------------------------------------
  const notesB = await as(B, "SELECT id FROM app_notifications");
  check(notesB.length >= 2 && (await as(A, "SELECT id FROM app_notifications")).length === 0, "notifications are visible only to their recipient");
  check((await as(A, "UPDATE app_notifications SET read_at=now() WHERE id=$1 RETURNING id", [notesB[0].id])).length === 0, "others cannot mark someone's notification read");
  await denied(as(B, "UPDATE app_notifications SET body='x' WHERE id=$1", [notesB[0].id]), "notification text cannot be changed", /permission denied/);
  await denied(as(B, "INSERT INTO app_notifications(recipient_worker_id,scout_id,kind,title,body) VALUES ($1,$2,'message','t','b')", [workerA, scout]), "users cannot create notifications directly", /permission denied/);
  check((await as(B, "UPDATE app_notifications SET read_at=now() WHERE id=$1 RETURNING id", [notesB[0].id])).length === 1, "the recipient can mark a notification read");

  // --- attendance and payouts ---------------------------------------------
  const shift = (await admin("SELECT id FROM worker_availability_slots WHERE scout_request_id=$1", [scout]))[0].id;
  await denied(as(B, "UPDATE worker_availability_slots SET hourly_wage=9999 WHERE id=$1", [shift]), "a worker cannot change the agreed wage", /permission denied/);
  const unconfirmed = (await as(B, "INSERT INTO worker_availability_slots(worker_id,slot_type,status,work_date,start_time,end_time) VALUES ($1,'available','pending',$2,'18:00','20:00') RETURNING id", [workerB, today]))[0].id;
  await denied(as(B, "UPDATE worker_availability_slots SET status='attended',clock_in_at=now(),reviewed_at=now() WHERE id=$1", [unconfirmed]), "a worker can only clock in to a confirmed shift", /変更できません/);
  await as(B, "UPDATE worker_availability_slots SET status='attended',clock_in_at=now(),reviewed_at=now() WHERE id=$1", [shift]);
  await denied(as(B, "UPDATE worker_availability_slots SET status='assigned' WHERE id=$1", [shift]), "a worker cannot undo attendance");
  await as(B, "UPDATE worker_availability_slots SET clock_out_at=now() WHERE id=$1", [shift]);
  await denied(as(B, "UPDATE worker_availability_slots SET clock_out_at=now() WHERE id=$1", [shift]), "a worker cannot clock out twice");
  const payout = (await as(B, "SELECT id,status FROM payouts"))[0];
  check(payout?.status === "pending", "attendance creates a payout record the worker can see");
  check((await as(T, "SELECT id FROM payouts")).length === 0 && (await as(A, "SELECT id FROM payouts")).length === 0, "outsiders cannot see the payout");
  await denied(as(B, "UPDATE payouts SET status='paid' WHERE id=$1", [payout.id]).then((r) => { if (!r.length) throw new Error("見つかりません"); }), "the worker cannot mark their own payout paid");
  await denied(as(S, "UPDATE payouts SET wage_amount_yen=1 WHERE id=$1", [payout.id]), "the store cannot change the payout amount", /permission denied/);
  check((await as(S, "UPDATE payouts SET status='paid',marked_paid_by='店長',paid_at=now() WHERE id=$1 RETURNING id", [payout.id])).length === 1, "the paying store can mark the payout paid");
  check((await as(S, "UPDATE payouts SET status='pending' WHERE id=$1 RETURNING id", [payout.id])).length === 0, "a paid payout cannot be reopened");

  // --- manager verification, staff chat, shift periods, reports -----------
  const verify = (claims, storeId, workerId) => as(claims, "INSERT INTO manager_verifications(worker_id,store_id,manager_name,store_name,manager_comment) VALUES ($1,$2,'店長','店','真面目です') RETURNING id", [workerId, storeId]);
  await denied(verify(T, storeT, workerA), "a store cannot verify someone else's staff");
  await denied(verify(S, storeS, workerB), "a store cannot verify a worker from another store");
  await verify(S, storeS, workerA);
  check((await admin("SELECT verification_status FROM workers WHERE id=$1", [workerA]))[0].verification_status === "verified", "the staff member's store can verify them");
  const staffChat = (claims, workerId, storeId, role) => as(claims, "INSERT INTO staff_messages(worker_id,store_id,sender_role,client_message_id,body) VALUES ($1,$2,$3,$4,'来週の相談') RETURNING id", [workerId, storeId, role, randomUUID()]);
  await denied(staffChat(T, workerA, storeT, "store"), "another store cannot message the staff");
  await denied(staffChat(B, workerA, storeS, "worker"), "a worker cannot message as another worker");
  await staffChat(A, workerA, storeS, "worker");
  await staffChat(S, workerA, storeS, "store");
  check((await as(T, "SELECT id FROM staff_messages")).length === 0 && (await as(B, "SELECT id FROM staff_messages")).length === 0, "outsiders cannot read the staff chat");
  await denied(as(T, "INSERT INTO shift_periods(store_id,store_name,title,start_date,end_date) VALUES ($1,'S店','偽',$2,$2)", [storeS, today]), "a store cannot create shift periods for another store");
  await as(S, "INSERT INTO shift_periods(store_id,store_name,title,start_date,end_date) VALUES ($1,'S店','来週',$2,$2)", [storeS, today]);
  check((await as(A, "SELECT id FROM shift_periods")).length === 1 && (await as(T, "SELECT id FROM shift_periods")).length === 0 && (await as(B, "SELECT id FROM shift_periods")).length === 0, "shift periods are visible to the store and its staff only");
  await denied(as(S, "INSERT INTO worker_flags(worker_id,store_id,store_name,reporter_name,reason) VALUES ($1,$2,'S店','店長','心当たりがない')", [workerB, storeS]), "a store can report only its own staff");
  await as(S, "INSERT INTO worker_flags(worker_id,store_id,store_name,reporter_name,reason) VALUES ($1,$2,'S店','店長','心当たりがない')", [workerA, storeS]);
  check((await as(T, "SELECT id FROM worker_flags")).length === 0 && (await as(A, "SELECT id FROM worker_flags")).length === 0, "reports are visible only to the reporting store");
  await as(A, "INSERT INTO store_join_requests(worker_id,store_id,worker_name,store_name,status) VALUES ($1,$2,'名前','S店','approved')", [workerA, storeS]);
  await denied(as(A, "INSERT INTO store_join_requests(worker_id,store_id,worker_name,store_name,status) VALUES ($1,$2,'名前','S店','approved')", [workerB, storeS]), "a worker cannot record a join for someone else");
  check((await as(S, "SELECT id FROM store_join_requests")).length === 1 && (await as(T, "SELECT id FROM store_join_requests")).length === 0, "join records are visible only to the joined store");
  check((await as(T, "SELECT completed_scout_count FROM worker_scout_stats WHERE worker_id=$1", [workerB]))[0].completed_scout_count === 1, "stores can see every worker's completed scout count");

  // --- identity documents --------------------------------------------------
  const submit = (claims, workerId, path, status = "pending") => as(claims,
    "INSERT INTO identity_verifications(worker_id,status,full_name_kana,birth_date,document_type,document_storage_path,provider,submitted_at) VALUES ($1,$2,'ヤマダ','2000-01-01','license',$3,'manual',now()) ON CONFLICT (worker_id) DO UPDATE SET status=excluded.status,document_storage_path=excluded.document_storage_path,submitted_at=excluded.submitted_at RETURNING id",
    [workerId, status, path]);
  await denied(submit(A, workerB, `${workerB}/1.jpg`), "a worker cannot submit documents for someone else");
  await denied(submit(A, workerA, `${workerA}/1.jpg`, "verified"), "a worker cannot approve their own documents");
  await denied(submit(A, workerA, `${workerB}/1.jpg`), "a worker cannot point at another worker's file");
  await submit(A, workerA, `${workerA}/1.jpg`);
  await denied(as(A, "INSERT INTO storage.objects(bucket_id,name) VALUES ('identity-documents',$1)", [`${workerB}/1.jpg`]), "a worker cannot upload into someone else's folder");
  await as(A, "INSERT INTO storage.objects(bucket_id,name) VALUES ('identity-documents',$1)", [`${workerA}/1.jpg`]);
  check((await as(A, "SELECT id FROM storage.objects")).length === 0 && (await as(S, "SELECT id FROM storage.objects")).length === 0, "workers and stores cannot open identity documents");
  check((await as(S, "SELECT id FROM identity_verifications")).length === 0, "stores cannot see identity submissions");
  check((await as(reviewerAal1, "SELECT id FROM identity_verifications")).length === 0 && (await as(reviewerAal1, "SELECT id FROM storage.objects")).length === 0, "a reviewer without two-step sign-in sees nothing");
  check((await as(user(ids.stranger, { aal: "aal2", user_metadata: { role: "identity_reviewer" } }), "SELECT id FROM storage.objects")).length === 0, "user-editable metadata does not grant the reviewer role");
  check((await as(reviewer, "SELECT id FROM identity_verifications")).length === 1 && (await as(reviewer, "SELECT id FROM storage.objects")).length === 1, "a reviewer with two-step sign-in can review documents");
  check((await as(reviewer, "UPDATE identity_verifications SET status='verified',reviewed_at=now(),reviewer_name='審査' WHERE worker_id=$1 RETURNING id", [workerA])).length === 1, "the reviewer can record the decision");
  await denied(submit(A, workerA, `${workerA}/2.jpg`).then((r) => { if (!r.length) throw new Error("見つかりません"); }), "a verified submission cannot be replaced by the worker");

  console.log(`Access rule checks passed: ${checks}`);
} finally { await db.close(); }
