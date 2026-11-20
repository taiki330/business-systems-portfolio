// Run against an in-memory PostgreSQL engine; never reads .env or touches Supabase.
// PGLITE_MODULE may point at a temporary install's dist/index.js (no app dependency needed).
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); console.log(`PASS ${++checks}: ${label}`); };
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
try {
  await db.exec(await readFile(new URL("./supabase-stubs.sql", import.meta.url), "utf8"));
  const root = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(root)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) await db.exec(await readFile(new URL(file, root), "utf8"));
  check(files.includes("022_auth_rls.sql"), "all migrations apply in order");
  // 022 以降、ワーカー・店舗はログインユーザーと結びつき、関数はログイン中の本人として呼ぶ。
  const newUser = async () => { const id = randomUUID(); await db.query("INSERT INTO auth.users(id) VALUES ($1)", [id]); return id; };
  const signIn = (uid) => db.query("SELECT set_config('request.jwt.claims', $1, false)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
  const asUser = async (uid, fn) => { await signIn(uid); try { return await fn(); } finally { await signIn(null); } };
  const createStore = async (company, name, area, wage) => { const owner = await newUser(); return asUser(owner, async () => (await rows("SELECT create_scouting_store($1,$2,$3,$4,'terms-test',now()) AS id", [company, name, area, wage]))[0].id); };
  const workerUser = await newUser();
  const otherWorkerUser = await newUser();
  const worker = (await rows("INSERT INTO workers(user_id,name,current_store,business_type,experience_years,skill_tags) VALUES ($1,'テストワーカー','自己申告の店','カフェ',1,ARRAY['ホール']) RETURNING id", [workerUser]))[0].id;
  const otherWorker = (await rows("INSERT INTO workers(user_id,name,current_store,business_type,experience_years,skill_tags) VALUES ($1,'別のワーカー','自己申告の店','カフェ',0,ARRAY['ホール']) RETURNING id", [otherWorkerUser]))[0].id;
  const store = await createStore("テスト企業", "テスト店舗", "大阪市北区", 1200);
  const today = (await rows("SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date,'YYYY-MM-DD') AS day"))[0].day;
  async function offer(start = "10:00", end = "15:00", rest = 30, rate = 1200) {
    return (await rows("INSERT INTO scout_requests(worker_id,store_id,company_name,store_name,preferred_work_date,preferred_start_time,preferred_end_time,offered_hourly_wage,break_minutes,service_fee_percent,message) VALUES ($1,$2,'ignored','ignored',$3,$4,$5,$6,$7,20,'テストのスカウト') RETURNING *", [worker, store, today, start, end, rate, rest]))[0];
  }
  async function chat(scoutId, sender = worker, role = "worker", clientId = randomUUID()) {
    return rows("INSERT INTO scout_messages(scout_id,sender_role,sender_id,client_message_id,body) VALUES ($1,$2,$3,$4,' よろしくお願いします ') ON CONFLICT (scout_id,sender_role,client_message_id) DO NOTHING RETURNING id", [scoutId, role, sender, clientId]);
  }
  const scout = await offer();
  check(Number(scout.offered_total_yen) === 5400 && scout.work_minutes === 270 && scout.store_name === "テスト店舗", "DB derives and snapshots the store offer");
  check(Number(scout.service_fee_yen) === 1080 && Number(scout.store_total_yen) === 6480 && Number(scout.service_fee_percent) === 20, "DB stores the additional 20 percent fee and store total");
  check((await rows("SELECT * FROM app_notifications WHERE recipient_worker_id=$1", [worker])).length === 1, "new scout notifies its worker");
  await assert.rejects(chat(scout.id), /承諾後/); checks++; console.log(`PASS ${checks}: pending scout cannot create a chat`);
  await assert.rejects(offer("10:00", "11:00", 60), /休憩/); checks++; console.log(`PASS ${checks}: invalid net duration rejected`);
  await assert.rejects(offer("10:00", "11:00", 0, 1000), /時給が変更/); checks++; console.log(`PASS ${checks}: stale rate rejected`);
  await assert.rejects(asUser(otherWorkerUser, () => db.query("SELECT respond_to_scout($1,$2,'accepted')", [scout.id, otherWorker])), /見つかりません/);
  await assert.rejects(asUser(otherWorkerUser, () => db.query("SELECT respond_to_scout($1,$2,'accepted')", [scout.id, worker])), /見つかりません/); checks++; console.log(`PASS ${checks}: another worker cannot reply to this scout, even with its worker id`);
  await asUser(workerUser, () => db.query("SELECT respond_to_scout($1,$2,'accepted')", [scout.id, worker]));
  await asUser(workerUser, () => db.query("SELECT respond_to_scout($1,$2,'accepted')", [scout.id, worker]));
  check((await rows("SELECT * FROM worker_availability_slots WHERE scout_request_id=$1", [scout.id])).length === 1, "repeated acceptance creates one shift");
  check((await rows("SELECT * FROM app_notifications WHERE scout_id=$1 AND kind='scout_accepted'", [scout.id])).length === 1, "repeated acceptance creates one notification");
  const conflicting = await offer("12:00", "16:00", 0);
  await assert.rejects(asUser(workerUser, () => db.query("SELECT respond_to_scout($1,$2,'accepted')", [conflicting.id, worker])), /確定済み/);
  check((await rows("SELECT status FROM scout_requests WHERE id=$1", [conflicting.id]))[0].status === "pending" && !(await rows("SELECT * FROM worker_availability_slots WHERE scout_request_id=$1", [conflicting.id])).length, "overlapping acceptance rolls back without a shift");
  const declined = await offer("17:00", "18:00", 0);
  await asUser(workerUser, () => db.query("SELECT respond_to_scout($1,$2,'rejected')", [declined.id, worker]));
  await assert.rejects(chat(declined.id), /承諾後/);
  await assert.rejects(asUser(workerUser, () => db.query("SELECT respond_to_scout($1,$2,'accepted')", [declined.id, worker])), /返信済み/);
  check((await rows("SELECT * FROM app_notifications WHERE scout_id=$1 AND kind='scout_rejected'", [declined.id])).length === 1, "decline locks chat and creates store notification");
  await assert.rejects(chat(scout.id, otherWorker), /参加者/); checks++; console.log(`PASS ${checks}: chat sender must match the scout participant`);
  const retryId = randomUUID();
  await chat(scout.id, worker, "worker", retryId);
  await chat(scout.id, worker, "worker", retryId);
  await chat(scout.id, store, "store");
  check((await rows("SELECT * FROM scout_messages WHERE scout_id=$1", [scout.id])).length === 2, "accepted chat supports both sides and deduplicates retries");
  check((await rows("SELECT * FROM app_notifications WHERE scout_id=$1 AND kind='message'", [scout.id])).length === 2, "messages notify only the other side once");
  await db.query("UPDATE stores SET hourly_wage=1500 WHERE id=$1", [store]);
  const snapshot = (await rows("SELECT offered_hourly_wage,offered_total_yen FROM scout_requests WHERE id=$1", [scout.id]))[0];
  check(Number(snapshot.offered_hourly_wage) === 1200 && Number(snapshot.offered_total_yen) === 5400, "rate changes preserve sent offers");
  const rounded = await offer("19:00", "19:01", 0, 1500);
  check(Number(rounded.offered_total_yen) === 25, "per-minute offer calculation agrees with preview");
  await db.query("UPDATE worker_availability_slots SET status='attended',clock_in_at=now() WHERE scout_request_id=$1", [scout.id]);
  await db.query("INSERT INTO worker_availability_slots(worker_id,slot_type,status,work_date,start_time,end_time,scout_request_id) VALUES ($1,'available','attended',$2,'10:00','15:00',$3)", [worker, today, scout.id]);
  await db.query("INSERT INTO worker_availability_slots(worker_id,slot_type,status,work_date,start_time,end_time) VALUES ($1,'available','attended',$2,'08:00','09:00')", [worker, today]);
  check((await rows("SELECT completed_scout_count FROM worker_scout_stats WHERE worker_id=$1", [worker]))[0].completed_scout_count === 1, "usage counts scout attendance once, excluding ordinary shifts");
  check((await rows("SELECT completed_scout_count FROM worker_scout_stats WHERE worker_id=$1", [otherWorker]))[0].completed_scout_count === 0, "new worker starts at zero");
  async function staffChat(workerId, role, clientId = randomUUID(), storeId = store) {
    return rows("INSERT INTO staff_messages(worker_id,store_id,sender_role,client_message_id,body) VALUES ($1,$2,$3,$4,' 来週のシフトの相談です ') ON CONFLICT (worker_id,store_id,sender_role,client_message_id) DO NOTHING RETURNING *", [workerId, storeId, role, clientId]);
  }
  await assert.rejects(staffChat(otherWorker, "worker"), /所属店舗/); checks++; console.log(`PASS ${checks}: staff chat requires a current store affiliation`);
  await db.query("UPDATE workers SET current_store_id=$1 WHERE id=$2", [store, worker]);
  const staffRetry = randomUUID();
  const [first] = await staffChat(worker, "worker", staffRetry);
  await staffChat(worker, "worker", staffRetry);
  await staffChat(worker, "store");
  check(first.body === "来週のシフトの相談です" && (await rows("SELECT * FROM staff_messages WHERE worker_id=$1", [worker])).length === 2, "staff chat trims, supports both sides and deduplicates retries");
  const staffNotes = await rows("SELECT * FROM app_notifications WHERE kind='staff_message' AND staff_worker_id=$1 ORDER BY created_at", [worker]);
  check(staffNotes.length === 2 && staffNotes.some((n) => n.recipient_store_id === store && !n.recipient_worker_id) && staffNotes.some((n) => n.recipient_worker_id === worker && !n.recipient_store_id) && staffNotes.every((n) => n.scout_id === null), "staff messages notify only the other side, without a scout");
  const otherStore = await createStore("別企業", "別店舗", "大阪市中央区", 1100);
  await assert.rejects(staffChat(worker, "store", randomUUID(), otherStore), /所属店舗/); checks++; console.log(`PASS ${checks}: another store cannot message the staff`);
  await db.query("UPDATE workers SET current_store_id=$1 WHERE id=$2", [otherStore, worker]);
  check((await rows("SELECT * FROM staff_messages WHERE worker_id=$1 AND store_id=$2", [worker, store])).length === 2, "history stays with the previous store after a move");
  await assert.rejects(db.query("INSERT INTO app_notifications(recipient_worker_id,kind,title,body) VALUES ($1,'message','t','b')", [worker]), /subject_check/); checks++; console.log(`PASS ${checks}: scout notifications still require a scout`);
  const agreedAt = "2026-01-02T03:04:05Z";
  const agreedOwner = await newUser();
  const agreed = await asUser(agreedOwner, async () => (await rows("SELECT create_scouting_store('同意企業','同意店舗','神戸市中央区',1100,'terms-v4+privacy-v1',$1) AS id", [agreedAt]))[0].id);
  const consent = (await rows("SELECT terms_version,terms_agreed_at,owner_user_id FROM stores WHERE id=$1", [agreed]))[0];
  check(consent.terms_version === "terms-v4+privacy-v1" && new Date(consent.terms_agreed_at).toISOString() === "2026-01-02T03:04:05.000Z" && consent.owner_user_id === agreedOwner, "store registration records the consent and the signed-in owner");
  await assert.rejects(asUser(await newUser(), () => db.query("SELECT create_scouting_store('企業','店舗','神戸市',1100,NULL,NULL)")), /同意/);
  await assert.rejects(db.query("SELECT create_scouting_store('企業','店舗','神戸市',1100,'terms-v4',now())"), /ログイン/);
  await assert.rejects(asUser(agreedOwner, () => db.query("SELECT create_scouting_store('企業','二号店','神戸市',1100,'terms-v4',now())")), /すでに店舗/); checks++; console.log(`PASS ${checks}: a store needs a signed-in owner, consent, and one store per login`);
  await assert.rejects(db.query("INSERT INTO worker_private(worker_id,terms_version) VALUES ($1,'terms-v3')", [worker]), /worker_private_terms_check/); checks++; console.log(`PASS ${checks}: consent version and time are recorded together`);
  console.log(`Database checks passed: ${checks}`);
} finally { await db.close(); }
