// Checks migration 023 (account deletion, chat blocks and reports, contact form) against an in-memory PostgreSQL.
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
  // The Storage API deletes files as the signed-in role; the stub only grants SELECT and INSERT.
  await db.exec("GRANT DELETE ON storage.objects TO authenticated");
  const root = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(root)).filter((n) => n.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(file, root), "utf8"));

  const ids = {};
  for (const name of ["workerA", "workerB", "ownerS", "ownerT", "reviewer", "both"]) {
    ids[name] = randomUUID();
    await admin("INSERT INTO auth.users(id) VALUES ($1)", [ids[name]]);
  }
  const A = user(ids.workerA), B = user(ids.workerB), S = user(ids.ownerS), T = user(ids.ownerT), Both = user(ids.both);
  const reviewer = user(ids.reviewer, { aal: "aal2", app_metadata: { role: "identity_reviewer" } });
  const reviewerAal1 = user(ids.reviewer, { app_metadata: { role: "identity_reviewer" } });
  const days = async (n) => (await admin("SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date + $1::int,'YYYY-MM-DD') AS d", [n]))[0].d;
  const today = await days(0), tomorrow = await days(1), later = await days(2);

  const storeS = (await as(S, "SELECT create_scouting_store('S社','S店','大阪市北区',1300,'terms-v4',now()) AS id"))[0].id;
  const storeT = (await as(T, "SELECT create_scouting_store('T社','T店','大阪市中央区',1100,'terms-v4',now()) AS id"))[0].id;
  const insertWorker = async (claims, _userId, storeId, name, minor = false) => (await as(claims,
    "SELECT register_worker($1,$2,'カフェ',ARRAY['ホール'],1,'自己紹介',$3,$4,'terms-v4',now()) AS id", [name, storeId, minor, minor ? "保護者" : null]))[0].id;
  const workerA = await insertWorker(A, ids.workerA, storeS, "Aさん");
  const workerB = await insertWorker(B, ids.workerB, storeT, "Bさん");
  const wage = (storeId) => (storeId === storeS ? 1300 : 1100);
  const sendScout = (claims, storeId, workerId, date, start = "13:00", end = "15:00") => as(claims,
    "INSERT INTO scout_requests(worker_id,store_id,company_name,store_name,preferred_work_date,preferred_start_time,preferred_end_time,offered_hourly_wage,break_minutes,service_fee_percent,message) VALUES ($1,$2,'x','x',$3,$4,$5,$6,0,20,'お願いします') RETURNING id",
    [workerId, storeId, date, start, end, wage(storeId)]);
  const scoutMessage = (claims, scoutId, role, senderId, body = "こんにちは") => as(claims,
    "INSERT INTO scout_messages(scout_id,sender_role,sender_id,client_message_id,body) VALUES ($1,$2,$3,$4,$5) RETURNING id", [scoutId, role, senderId, randomUUID(), body]);
  const staffMessage = (claims, workerId, storeId, role, body = "シフトの相談です") => as(claims,
    "INSERT INTO staff_messages(worker_id,store_id,sender_role,client_message_id,body) VALUES ($1,$2,$3,$4,$5) RETURNING id", [workerId, storeId, role, randomUUID(), body]);

  // --- profile and store photos (migration 024) ---------------------------
  const photo = (claims, name) => as(claims, "INSERT INTO storage.objects(bucket_id,name) VALUES ('profile-photos',$1) RETURNING id", [name]);
  check((await photo(A, `workers/${workerA}/1.jpg`)).length === 1, "a worker can upload into their own photo folder");
  await denied(photo(A, `workers/${workerB}/1.jpg`), "a worker cannot upload into another worker's photo folder", /row-level security/);
  await denied(photo(A, `stores/${storeS}/1.jpg`), "a worker cannot upload a store photo", /row-level security/);
  check((await photo(S, `stores/${storeS}/1.jpg`)).length === 1, "an owner can upload their store photo");
  await denied(photo(S, `stores/${storeT}/1.jpg`), "an owner cannot upload another store's photo", /row-level security/);
  check((await as(A, "UPDATE workers SET photo_path=$1 WHERE id=$2 RETURNING id", [`workers/${workerA}/1.jpg`, workerA])).length === 1, "a worker can set their own photo");
  await denied(as(A, "UPDATE workers SET photo_path=$1 WHERE id=$2", [`workers/${workerB}/1.jpg`, workerA]), "a profile cannot point at someone else's photo", /workers_photo_path_own/);
  check((await as(S, "UPDATE stores SET photo_path=$1 WHERE id=$2 RETURNING id", [`stores/${storeS}/1.jpg`, storeS])).length === 1, "an owner can set their store photo");
  check((await as(A, "SELECT name FROM storage.objects WHERE bucket_id='profile-photos'")).map((r) => r.name).sort().join() === [`stores/${storeS}/1.jpg`, `workers/${workerA}/1.jpg`].sort().join(), "a worker sees their own photo and store photos");
  check((await as(B, "SELECT name FROM storage.objects WHERE bucket_id='profile-photos'")).map((r) => r.name).join() === `stores/${storeS}/1.jpg`, "a worker cannot see another worker's photo");
  check((await as(T, "SELECT name FROM storage.objects WHERE bucket_id='profile-photos' AND name LIKE 'workers/%'")).length === 1, "stores can see worker photos");
  await denied(as(null, "SELECT name FROM storage.objects WHERE bucket_id='profile-photos'").then((r) => { if (!r.length) throw new Error("row-level security: nothing visible"); }), "signed-out visitors cannot see photos", /row-level security|permission denied/);
  check((await as(B, "DELETE FROM storage.objects WHERE name=$1 RETURNING id", [`workers/${workerA}/1.jpg`])).length === 0, "a worker cannot delete another worker's photo");

  // --- push notification devices (migration 025) --------------------------
  const deviceToken = "device-token-0123456789abcdef";
  await denied(as(null, "SELECT register_push_token($1,'ios')", [deviceToken]), "signed-out visitors cannot register a device", /permission denied/);
  await denied(as(A, "INSERT INTO push_tokens(user_id,token,platform) VALUES ($1,$2,'ios')", [ids.workerA, deviceToken]), "devices cannot be inserted directly", /permission denied/);
  await denied(as(A, "SELECT register_push_token($1,'windows')", [deviceToken]), "only iOS and Android devices are accepted", /端末の種類/);
  await as(A, "SELECT register_push_token($1,'ios')", [deviceToken]);
  check((await admin("SELECT user_id FROM push_tokens WHERE token=$1", [deviceToken]))[0].user_id === ids.workerA, "a signed-in user can register this device");
  await denied(as(A, "SELECT * FROM push_tokens"), "users cannot read device registrations", /permission denied/);
  await as(S, "SELECT register_push_token($1,'ios')", [deviceToken]);
  check((await admin("SELECT user_id FROM push_tokens WHERE token=$1", [deviceToken])).map((r) => r.user_id).join() === ids.ownerS, "signing in as someone else on the same device moves it to the new login");
  await as(A, "SELECT unregister_push_token($1)", [deviceToken]);
  check((await admin("SELECT id FROM push_tokens WHERE token=$1", [deviceToken])).length === 1, "a user cannot unregister someone else's device");
  await as(S, "SELECT unregister_push_token($1)", [deviceToken]);
  check((await admin("SELECT id FROM push_tokens WHERE token=$1", [deviceToken])).length === 0, "signing out unregisters this device");
  for (let i = 0; i < 12; i++) await as(B, "SELECT register_push_token($1,'android')", [`android-device-token-${String(i).padStart(4, "0")}`]);
  check((await admin("SELECT count(*)::int AS n FROM push_tokens WHERE user_id=$1", [ids.workerB]))[0].n === 10, "one login keeps at most 10 devices");

  // --- blocks -------------------------------------------------------------
  // Store T scouts worker A; A accepts and they chat.
  const scoutTA = (await sendScout(T, storeT, workerA, today))[0].id;
  await as(A, "SELECT respond_to_scout($1,$2,'accepted')", [scoutTA, workerA]);
  const msgFromT = (await scoutMessage(T, scoutTA, "store", storeT, "失礼な内容"))[0].id;
  await scoutMessage(A, scoutTA, "worker", workerA);

  await denied(as(null, "SELECT * FROM chat_blocks"), "anon cannot read blocks", /permission denied/);
  await denied(as(A, "INSERT INTO chat_blocks(worker_id,store_id,blocked_by) VALUES ($1,$2,'worker')", [workerB, storeT]), "a worker cannot block on behalf of another worker", /row-level security/);
  await denied(as(A, "INSERT INTO chat_blocks(worker_id,store_id,blocked_by) VALUES ($1,$2,'store')", [workerA, storeT]), "a worker cannot create the store's block", /row-level security/);
  await as(A, "INSERT INTO chat_blocks(worker_id,store_id,blocked_by) VALUES ($1,$2,'worker')", [workerA, storeT]);
  check((await as(A, "SELECT id FROM chat_blocks")).length === 1, "the worker sees their own block");
  check((await as(T, "SELECT id FROM chat_blocks")).length === 0, "the blocked store cannot read the block");
  await denied(scoutMessage(T, scoutTA, "store", storeT), "a blocked store cannot message the worker", /送受信できません/);
  await denied(scoutMessage(A, scoutTA, "worker", workerA), "the blocker cannot message either until they unblock", /送受信できません/);
  await denied(sendScout(T, storeT, workerA, tomorrow), "a blocked store cannot send a new scout", /スカウトを送れません/);
  check((await as(T, "SELECT * FROM my_blocked_worker_ids()")).map((r) => r.my_blocked_worker_ids).join() === workerA, "search can hide workers in a block relation from the store");
  check((await as(S, "SELECT * FROM my_blocked_worker_ids()")).length === 0, "other stores are not affected by the block");
  check((await as(T, "DELETE FROM chat_blocks WHERE worker_id=$1 RETURNING id", [workerA])).length === 0, "the blocked side cannot remove the block");
  check((await as(A, "DELETE FROM chat_blocks WHERE worker_id=$1 AND store_id=$2 RETURNING id", [workerA, storeT])).length === 1, "the blocker can unblock");
  check((await scoutMessage(T, scoutTA, "store", storeT)).length === 1, "messages work again after unblocking");

  // Staff chat: store S blocks its staff member A.
  const staffMsgFromA = (await staffMessage(A, workerA, storeS, "worker", "しつこい連絡"))[0].id;
  await as(S, "INSERT INTO chat_blocks(worker_id,store_id,blocked_by) VALUES ($1,$2,'store')", [workerA, storeS]);
  await denied(staffMessage(A, workerA, storeS, "worker"), "a blocked staff member cannot message the store", /送受信できません/);
  await as(S, "DELETE FROM chat_blocks WHERE worker_id=$1 AND store_id=$2", [workerA, storeS]);

  // --- reports ------------------------------------------------------------
  const report = (claims, role, kind, scoutId, workerId, storeId, messageId, reason = "harassment", detail = "困っています") => as(claims,
    "SELECT report_chat($1,$2,$3,$4,$5,$6,$7,$8) AS id", [role, kind, scoutId, workerId, storeId, messageId, reason, detail]);
  await denied(as(null, "SELECT report_chat('worker','scout',NULL,NULL,NULL,NULL,'spam',NULL)"), "anon cannot report", /permission denied/);
  await denied(as(A, "INSERT INTO chat_reports(reporter_role,worker_id,store_id,kind,reason) VALUES ('worker',$1,$2,'scout','spam')", [workerA, storeT]), "reports cannot be inserted directly", /permission denied/);
  await denied(report(B, "worker", "scout", scoutTA, workerA, storeT, msgFromT), "a non-participant cannot report a conversation", /参加者/);
  await denied(report(S, "store", "scout", scoutTA, workerA, storeS, null), "another store cannot report someone else's scout chat", /参加者/);
  await denied(report(A, "worker", "scout", scoutTA, workerA, storeT, staffMsgFromA), "a message from another conversation cannot be attached", /見つかりません/);
  await denied(report(T, "store", "scout", scoutTA, workerA, storeT, msgFromT), "a participant cannot report their own message", /自分のメッセージ/);
  await denied(report(A, "worker", "scout", scoutTA, workerA, storeT, msgFromT, "bogus"), "the reason must be one of the choices", /理由/);
  const reportId = (await report(A, "worker", "scout", scoutTA, workerA, storeT, msgFromT))[0].id;
  check((await admin("SELECT message_body FROM chat_reports WHERE id=$1", [reportId]))[0].message_body === "失礼な内容", "the report keeps a copy of the message taken from the database");
  check((await report(S, "store", "staff", null, workerA, storeS, staffMsgFromA, "spam", null)).length === 1, "a store can report a staff chat message");
  check((await report(A, "worker", "staff", null, workerA, storeS, null, "other", "全体について")).length === 1, "a conversation can be reported without picking a message");
  check((await as(A, "SELECT id FROM chat_reports")).length === 0 && (await as(T, "SELECT id FROM chat_reports")).length === 0, "participants cannot read reports");
  check((await as(reviewerAal1, "SELECT id FROM chat_reports")).length === 0, "a reviewer without two-step sign-in cannot read reports");
  check((await as(reviewer, "SELECT id FROM chat_reports")).length === 3, "a reviewer with two-step sign-in can read reports");
  check((await as(reviewer, "UPDATE chat_reports SET status='resolved',resolved_at=now(),resolved_by='審査',resolution_note='注意した' WHERE id=$1 RETURNING id", [reportId])).length === 1, "the reviewer can mark a report handled");
  await denied(as(reviewer, "UPDATE chat_reports SET message_body='書き換え' WHERE id=$1", [reportId]), "the reviewer cannot rewrite the reported message", /permission denied/);

  // --- contact form -------------------------------------------------------
  check((await as(null, "SELECT submit_contact_inquiry('Guest@Example.com','account','ログインできません') AS id")).length === 1, "anon can send an inquiry");
  check((await admin("SELECT email, user_id FROM contact_inquiries"))[0].email === "guest@example.com", "the inquiry stores a normalised email");
  await as(A, "SELECT submit_contact_inquiry('a@example.com','deletion','退会したいです')");
  check((await admin("SELECT user_id FROM contact_inquiries WHERE email='a@example.com'"))[0].user_id === ids.workerA, "a signed-in inquiry records the login");
  await denied(as(null, "SELECT submit_contact_inquiry('not-an-email','other','x')"), "an invalid email is refused", /メールアドレス/);
  await denied(as(null, "SELECT submit_contact_inquiry('g@example.com','nope','x')"), "an unknown category is refused", /種類/);
  await denied(as(null, "SELECT submit_contact_inquiry('g@example.com','other','   ')"), "an empty body is refused", /1〜2000文字/);
  await denied(as(null, "SELECT * FROM contact_inquiries"), "anon cannot read inquiries", /permission denied/);
  await denied(as(null, "INSERT INTO contact_inquiries(email,category,body) VALUES ('x@example.com','other','x')"), "inquiries cannot be inserted directly", /permission denied/);
  check((await as(A, "SELECT id FROM contact_inquiries")).length === 0, "users cannot read inquiries");
  check((await as(reviewer, "SELECT id FROM contact_inquiries")).length === 2, "the reviewer can read inquiries");
  for (let i = 0; i < 4; i++) await as(null, "SELECT submit_contact_inquiry('guest@example.com','other','もう一度')");
  await denied(as(null, "SELECT submit_contact_inquiry('guest@example.com','other','6通目')"), "one address cannot flood the form", /時間をおいて/);

  // --- account deletion: worker -------------------------------------------
  await denied(as(null, "SELECT delete_my_account()"), "anon cannot call account deletion", /permission denied/);
  // Worker B: one worked shift with a payout (kept), one future accepted scout, one pending scout, a wish, an identity document.
  const worked = (await sendScout(S, storeS, workerB, today, "09:00", "11:00"))[0].id;
  await as(B, "SELECT respond_to_scout($1,$2,'accepted')", [worked, workerB]);
  await as(B, "UPDATE worker_availability_slots SET status='attended',clock_in_at=now(),checkin_method='self_report' WHERE scout_request_id=$1", [worked]);
  await scoutMessage(B, worked, "worker", workerB, "本日はありがとうございました");
  const future = (await sendScout(S, storeS, workerB, tomorrow))[0].id;
  await as(B, "SELECT respond_to_scout($1,$2,'accepted')", [future, workerB]);
  const pending = (await sendScout(S, storeS, workerB, later))[0].id;
  await as(B, "INSERT INTO worker_availability_slots(worker_id,slot_type,status,work_date,start_time,end_time) VALUES ($1,'available','pending',$2,'18:00','20:00')", [workerB, later]);
  await as(B, "INSERT INTO storage.objects(bucket_id,name) VALUES ('identity-documents',$1)", [`${workerB}/1.jpg`]);
  await as(B, "INSERT INTO identity_verifications(worker_id,status,full_name_kana,birth_date,document_type,document_storage_path,provider,submitted_at) VALUES ($1,'pending','ビー','2000-01-01','license',$2,'manual',now())", [workerB, `${workerB}/1.jpg`]);
  await staffMessage(B, workerB, storeT, "worker");
  const storeNotesBefore = (await admin("SELECT count(*)::int AS n FROM app_notifications WHERE recipient_store_id=$1 AND kind='scout_rejected'", [storeS]))[0].n;

  await as(B, "SELECT delete_my_account()");
  check((await admin("SELECT id FROM auth.users WHERE id=$1", [ids.workerB])).length === 0, "the worker's login is removed");
  const gone = (await admin("SELECT * FROM workers WHERE id=$1", [workerB]))[0];
  check(gone.name === "退会済みユーザー" && gone.user_id === null && gone.deleted_at !== null && gone.bio === null && gone.current_store_id === null && gone.skill_tags.length === 0, "the worker's profile is anonymised");
  check((await admin("SELECT status FROM worker_availability_slots WHERE worker_id=$1", [workerB])).map((r) => r.status).join() === "attended", "only the worked shift is kept");
  check((await admin("SELECT id FROM payouts WHERE worker_id=$1", [workerB])).length === 1, "the payout record for the worked shift is kept");
  check((await admin("SELECT id FROM scout_messages WHERE scout_id=$1", [worked])).length === 1, "chat history is kept for the store");
  check((await admin("SELECT status FROM scout_requests WHERE id=$1", [worked]))[0].status === "accepted", "the worked scout keeps its status");
  check((await admin("SELECT status FROM scout_requests WHERE id = ANY($1::uuid[])", [[future, pending]])).every((r) => r.status === "rejected"), "upcoming and unanswered scouts are declined");
  check((await admin("SELECT count(*)::int AS n FROM app_notifications WHERE recipient_store_id=$1 AND kind='scout_rejected'", [storeS]))[0].n === storeNotesBefore + 2, "the store is told about the declined scouts");
  check((await admin("SELECT id FROM identity_verifications WHERE worker_id=$1", [workerB])).length === 0, "the identity submission is removed");
  check((await admin("SELECT folder FROM identity_document_purges WHERE purged_at IS NULL")).map((r) => r.folder).join() === workerB, "the identity documents are queued for deletion");
  check((await admin("SELECT id FROM app_notifications WHERE recipient_worker_id=$1", [workerB])).length === 0, "the worker's notifications are removed");
  check((await as(S, "SELECT name FROM workers WHERE id=$1", [workerB]))[0].name === "退会済みユーザー", "the store sees the past worker as a deleted user");
  await denied(sendScout(S, storeS, workerB, later), "a deleted worker cannot be scouted", /退会/);
  await denied(scoutMessage(S, worked, "store", storeS), "a deleted worker cannot be messaged", /退会/);
  check((await as(B, "SELECT id FROM workers")).length === 0, "the old login no longer reaches any profile");

  // Purge queue: only a two-step reviewer can read it and delete the files.
  check((await as(S, "SELECT id FROM identity_document_purges")).length === 0 && (await as(reviewerAal1, "SELECT id FROM identity_document_purges")).length === 0, "the purge queue is hidden from stores and one-step reviewers");
  check((await as(A, "DELETE FROM storage.objects WHERE name LIKE $1 RETURNING id", [`${workerB}/%`])).length === 0, "workers cannot delete identity documents");
  check((await as(reviewer, "DELETE FROM storage.objects WHERE name LIKE $1 RETURNING id", [`${workerB}/%`])).length === 1, "the reviewer can delete a deleted worker's identity documents");
  check((await as(reviewer, "UPDATE identity_document_purges SET purged_at=now(),purged_by='審査' WHERE folder=$1 RETURNING id", [workerB])).length === 1, "the reviewer can mark the purge done");

  // The same email can register again from scratch.
  await admin("INSERT INTO auth.users(id) VALUES ($1)", [ids.workerB]);
  check((await insertWorker(B, ids.workerB, storeT, "Bさん(再)")) !== workerB, "a deleted worker can register again as a new profile");

  // --- account deletion: store --------------------------------------------
  // Store T: a worked shift with an unpaid payout (kept), a future accepted scout, a pending scout.
  const tWorked = (await sendScout(T, storeT, workerA, today, "16:00", "17:00"))[0].id;
  await as(A, "SELECT respond_to_scout($1,$2,'accepted')", [tWorked, workerA]);
  await as(A, "UPDATE worker_availability_slots SET status='attended',clock_in_at=now(),checkin_method='self_report' WHERE scout_request_id=$1", [tWorked]);
  const tFuture = (await sendScout(T, storeT, workerA, tomorrow))[0].id;
  await as(A, "SELECT respond_to_scout($1,$2,'accepted')", [tFuture, workerA]);
  const tPending = (await sendScout(T, storeT, workerA, later))[0].id;
  await as(T, "SELECT delete_my_account()");
  check((await admin("SELECT id FROM auth.users WHERE id=$1", [ids.ownerT])).length === 0, "the owner's login is removed");
  const closed = (await admin("SELECT * FROM stores WHERE id=$1", [storeT]))[0];
  check(closed.owner_user_id === null && closed.deleted_at !== null && closed.name === "T店", "the store is closed but keeps its name for records");
  check((await admin("SELECT status FROM payouts WHERE store_id=$1 AND worker_id=$2", [storeT, workerA])).map((r) => r.status).join() === "pending", "unpaid payout records remain after the store leaves");
  check((await admin("SELECT id FROM scout_requests WHERE id=$1", [tPending])).length === 0, "unanswered scouts from the store are withdrawn");
  check((await admin("SELECT status FROM scout_requests WHERE id=$1", [tFuture]))[0].status === "rejected", "upcoming work at the store is cancelled");
  check((await admin("SELECT id FROM worker_availability_slots WHERE scout_request_id=$1", [tFuture])).length === 0, "the cancelled shift leaves the worker's schedule");
  check((await admin("SELECT id FROM worker_availability_slots WHERE scout_request_id=$1 AND status='attended'", [tWorked])).length === 1, "the worked shift at the store is kept");
  check((await as(A, "SELECT title FROM app_notifications WHERE scout_id=$1 AND kind='scout_rejected'", [tFuture])).some((r) => r.title === "勤務予定が取り消されました"), "the worker is told the shift was cancelled");
  check((await admin("SELECT id FROM app_notifications WHERE recipient_store_id=$1", [storeT])).length === 0, "the store's notifications are removed");
  check((await as(T, "SELECT * FROM my_blocked_worker_ids()")).length === 0 && (await as(T, "SELECT id FROM scout_requests")).length === 0, "the old owner login no longer reaches the store");
  await denied(scoutMessage(A, tWorked, "worker", workerA), "a closed store cannot be messaged", /退会/);
  await denied(as(A, "UPDATE workers SET current_store_id=$1 WHERE id=$2", [storeT, workerA]), "a closed store cannot be chosen as a workplace", /店舗が見つかりません/);

  // --- account deletion: one login with both a worker profile and a store --
  const storeBoth = (await as(Both, "SELECT create_scouting_store('両方社','両方店','神戸市',1000,'terms-v4',now()) AS id"))[0].id;
  const workerBoth = await insertWorker(Both, ids.both, storeS, "両方さん");
  await as(Both, "SELECT delete_my_account()");
  check((await admin("SELECT deleted_at FROM workers WHERE id=$1", [workerBoth]))[0].deleted_at !== null && (await admin("SELECT deleted_at FROM stores WHERE id=$1", [storeBoth]))[0].deleted_at !== null, "a login with both roles leaves both");

  // A leaving worker's photo is cleared, and they can remove their own files first.
  check((await as(A, "DELETE FROM storage.objects WHERE name=$1 RETURNING id", [`workers/${workerA}/1.jpg`])).length === 1, "a worker can delete their own photo file");
  await as(A, "SELECT delete_my_account()");
  check((await admin("SELECT photo_path, deleted_at FROM workers WHERE id=$1", [workerA]))[0].photo_path === null, "a deleted worker keeps no photo");
  await admin("INSERT INTO auth.users(id) VALUES ($1)", [ids.workerA]);
  const workerA2 = await insertWorker(A, ids.workerA, storeS, "Aさん(再)");

  // --- existing rules still hold ------------------------------------------
  await denied(as(A, "UPDATE workers SET deleted_at=now() WHERE id=$1", [workerA2]), "a worker cannot mark themselves deleted directly", /permission denied/);
  await denied(as(S, "UPDATE stores SET deleted_at=now() WHERE id=$1", [storeS]), "an owner cannot mark the store deleted directly", /permission denied/);
  await denied(admin("UPDATE workers SET user_id=NULL WHERE id=$1", [workerA2]), "an active worker must stay linked to a login", /workers_login_or_deleted/);

  console.log(`Account and safety checks passed: ${checks}`);
} finally { await db.close(); }
