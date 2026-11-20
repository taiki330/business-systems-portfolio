// Local test fixture: a small PostgREST-compatible adapter over an in-memory DB.
// Bind only to loopback; no .env loading, no connection to a real Supabase project.
// Each request runs as the API role Supabase would use, so the RLS rules from migration 022 apply:
// the x-test-user header names the signed-in user (authenticated); without it the request is anon.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
await db.exec(await readFile(new URL("./supabase-stubs.sql", import.meta.url), "utf8"));
const migrationRoot = new URL("../supabase/migrations/", import.meta.url);
for (const file of (await readdir(migrationRoot)).filter((f) => f.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(file, migrationRoot), "utf8"));
const query = async (sql, values = []) => (await db.query(sql, values)).rows;
const newUser = async () => (await query("INSERT INTO auth.users(id) VALUES (gen_random_uuid()) RETURNING id"))[0].id;
const claimsFor = (uid) => (uid ? JSON.stringify({ sub: uid, role: "authenticated", aal: "aal1" }) : "");
/** Seeds as the signed-in user, so the database functions see who is acting. */
async function asUser(uid, fn) {
  await query("SELECT set_config('request.jwt.claims', $1, false)", [claimsFor(uid)]);
  try { return await fn(); } finally { await query("SELECT set_config('request.jwt.claims', '', false)"); }
}
const storeOwner = await newUser();
const store = await asUser(storeOwner, async () => (await query("SELECT create_scouting_store('検証用企業','シフルンカフェ 梅田店','大阪市北区・梅田',1200,'terms-test',now()) AS id"))[0].id);
const people = [
  ["山田 はるか", "カフェ", ["ホール", "レジ"], ["大阪市北区", "梅田"], 2, "verified"],
  ["佐藤 そうた", "居酒屋", ["キッチン", "洗い場"], ["大阪市北区", "難波"], 3, "unverified"],
  ["田中 あおい", "カフェ", ["ホール", "ドリンク"], ["梅田"], 1, "unverified"],
];
const workers = [];
const workerUsers = [];
for (const [name, business, tags, areas, experience, verified] of people) {
  const user = await newUser();
  const worker = (await query("INSERT INTO workers(user_id,name,current_store,current_store_id,business_type,skill_tags,preferred_areas,experience_years,verification_status,bio) VALUES ($8,$1,'シフルンカフェ 梅田店',$7,$2,$3,$4,$5,$6,'笑顔での接客が得意です。新しいお店でも、丁寧にお仕事します。') RETURNING id", [name, business, tags, areas, experience, verified, store, user]))[0].id;
  workers.push(worker);
  workerUsers.push(user);
  await query("INSERT INTO worker_availability_slots(worker_id,slot_type,status,work_date,start_time,end_time) VALUES ($1,'available','released',(now() AT TIME ZONE 'Asia/Tokyo')::date + 1,'10:00','20:00')", [worker]);
}
const scouts = [];
for (let i = 0; i < workers.length; i++) {
  const scout = (await query("INSERT INTO scout_requests(worker_id,store_id,company_name,preferred_work_date,preferred_start_time,preferred_end_time,offered_hourly_wage,break_minutes,service_fee_percent,message) VALUES ($1,$2,'検証用企業',(now() AT TIME ZONE 'Asia/Tokyo')::date + 1,'10:00','15:00',1200,30,20,'ホールのお仕事をお願いしたいです。お会いできるのを楽しみにしています！') RETURNING id", [workers[i], store]))[0].id;
  scouts.push(scout);
  if (i === 1) await asUser(workerUsers[i], () => query("SELECT respond_to_scout($1,$2,'accepted')", [scout, workers[i]]));
  if (i === 2) await asUser(workerUsers[i], () => query("SELECT respond_to_scout($1,$2,'rejected')", [scout, workers[i]]));
}
await query("INSERT INTO scout_messages(scout_id,sender_role,sender_id,client_message_id,body) VALUES ($1,'store',$2,gen_random_uuid(),'承諾ありがとうございます。当日はエプロンをご持参ください。')", [scouts[1], store]);
await query("INSERT INTO staff_messages(worker_id,store_id,sender_role,client_message_id,body) VALUES ($1,$2,'worker',gen_random_uuid(),'来週の土曜、午前だけなら入れます。')", [workers[0], store]);
const tables = new Set(["workers", "stores", "companies", "worker_scout_stats", "scout_requests", "scout_messages", "staff_messages", "app_notifications", "worker_availability_slots", "store_join_requests", "manager_verifications", "worker_flags", "shift_periods"]);
const ident = (name) => { if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error("Invalid identifier"); return `"${name}"`; };
function where(params, values) {
  const clauses = [];
  for (const [name, filter] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(name)) continue;
    const dot = filter.indexOf(".");
    const op = filter.slice(0, dot); const value = filter.slice(dot + 1);
    if (op === "is" && value === "null") { clauses.push(`${ident(name)} IS NULL`); continue; }
    if (op === "in") {
      const list = value.slice(1, -1).split(",").map((v) => v.replace(/^"|"$/g, ""));
      clauses.push(`${ident(name)} IN (${list.map((v) => { values.push(v); return `$${values.length}`; }).join(",")})`); continue;
    }
    const operators = { eq: "=", neq: "<>", lt: "<", gt: ">", lte: "<=", gte: ">=" };
    if (!(op in operators)) throw new Error(`Unsupported test filter: ${op}`);
    values.push(value); clauses.push(`${ident(name)} ${operators[op]} $${values.length}`);
  }
  return clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
}
// PGlite has one session, so requests run one at a time (the role and claims are per session).
let chain = Promise.resolve();
const exclusive = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
const server = createServer((req, res) => exclusive(async () => {
  const uid = req.headers["x-test-user"];
  await db.exec(uid ? "SET ROLE authenticated" : "SET ROLE anon");
  await query("SELECT set_config('request.jwt.claims', $1, false)", [claimsFor(uid)]);
  try { await handle(req, res); } finally { await db.exec("RESET ROLE"); await query("SELECT set_config('request.jwt.claims', '', false)"); }
}));
async function handle(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") { res.end(); return; }
  try {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    let raw = ""; for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) : {};
    let result;
    if (url.pathname === "/test/users" && req.method === "POST") {
      // Test-only: create a login (runs as the fixture's admin connection).
      await db.exec("RESET ROLE");
      result = { id: await newUser() };
    } else if (path.startsWith("rpc/")) {
      const rpc = path.slice(4);
      // 値を並べて返す関数（SETOF uuid）は、PostgREST と同じく値の配列で返す。
      const parameters = rpc === "my_blocked_worker_ids" ? [] : rpc === "respond_to_scout" ? ["p_scout_id", "p_worker_id", "p_status"] : rpc === "create_scouting_store" ? ["p_company_name", "p_store_name", "p_area", "p_hourly_wage", "p_terms_version", "p_terms_agreed_at"]
        : rpc === "register_worker" ? ["p_name", "p_store_id", "p_business_type", "p_skill_tags", "p_experience_years", "p_bio", "p_is_minor", "p_guardian_name", "p_terms_version", "p_terms_agreed_at"]
        : rpc === "change_my_store" ? ["p_store_id"] : null;
      if (!parameters) throw new Error("Unsupported test RPC");
      if (rpc === "my_blocked_worker_ids") result = (await query("SELECT my_blocked_worker_ids AS id FROM my_blocked_worker_ids()")).map((row) => row.id);
      else result = (await query(`SELECT ${ident(rpc)}(${parameters.map((_, i) => `$${i + 1}`).join(",")}) AS result`, parameters.map((p) => body[p])))[0].result;
    } else {
      if (!tables.has(path)) throw new Error(`Unsupported test table: ${path}`);
      if (req.method === "GET" || req.method === "HEAD") {
        const values = []; const condition = where(url.searchParams, values);
        const count = Number((await query(`SELECT count(*) AS n FROM ${ident(path)}${condition}`, values))[0].n);
        const order = (url.searchParams.get("order") ?? "").split(",").filter(Boolean).map((s) => {
          const [col, direction, nulls] = s.split("."); return `${ident(col)} ${direction === "desc" ? "DESC" : "ASC"}${nulls === "nullsfirst" ? " NULLS FIRST" : nulls === "nullslast" ? " NULLS LAST" : ""}`;
        }).join(",");
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 1000), 1000);
        result = await query(`SELECT * FROM ${ident(path)}${condition}${order ? ` ORDER BY ${order}` : ""} LIMIT ${Number.isSafeInteger(limit) ? limit : 1000}`, values);
        res.setHeader("Content-Range", `0-${Math.max(0, result.length - 1)}/${count}`);
      } else if (req.method === "POST") {
        result = [];
        for (const row of Array.isArray(body) ? body : [body]) {
          const keys = Object.keys(row); const values = keys.map((k) => row[k]);
          const conflict = url.searchParams.get("on_conflict");
          const inserted = await query(`INSERT INTO ${ident(path)}(${keys.map(ident).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})${conflict ? ` ON CONFLICT (${conflict.split(",").map(ident).join(",")}) DO NOTHING` : ""} RETURNING *`, values);
          result.push(...inserted);
        }
      } else if (req.method === "PATCH") {
        const keys = Object.keys(body); const values = keys.map((k) => body[k]);
        const condition = where(url.searchParams, values);
        if (!condition) throw new Error("Unscoped update rejected by test adapter");
        result = await query(`UPDATE ${ident(path)} SET ${keys.map((k, i) => `${ident(k)}=$${i + 1}`).join(",")}${condition} RETURNING *`, values);
      } else throw new Error("Unsupported test method");
      if (url.searchParams.get("select")?.includes("companies(")) for (const row of result) row.companies = (await query("SELECT name FROM companies WHERE id=$1", [row.company_id]))[0] ?? null;
      if (url.searchParams.get("select")?.includes("workers(")) for (const row of result) row.workers = (await query("SELECT id,name,current_store FROM workers WHERE id=$1", [row.worker_id]))[0] ?? null;
      if (req.headers.accept?.includes("vnd.pgrst.object")) {
        if (result.length !== 1) { res.statusCode = 406; res.end(JSON.stringify({ code: "PGRST116", message: "Expected one row", details: `The result contains ${result.length} rows` })); return; }
        result = result[0];
      }
    }
    res.end(req.method === "HEAD" ? undefined : JSON.stringify(result));
  } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ code: error.code ?? "TEST", message: error.message })); }
}
server.listen(55170, "127.0.0.1", () => console.log(JSON.stringify({ url: "http://127.0.0.1:55170", storeOwner, store, workerUsers, workers, scouts })));
process.on("SIGINT", () => server.close(async () => { await db.close(); process.exit(0); }));
