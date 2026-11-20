import {
  ScoutRequest,
  ShiftPeriod,
  Store,
  StoreJoinRequest,
  Worker,
  WorkerAvailabilitySlotWithWorker,
} from "@/lib/types/database";

export const MOCK_STORES: Store[] = [
  {
    id: "mock-store-1",
    company_id: "mock-company-1",
    name: "渋谷店",
    owner_user_id: null,
    created_at: "2026-06-01T09:00:00Z",
    hourly_wage: 1200,
    area: "東京都渋谷区",
    companies: { name: "はれのひダイニング" },
  },
  {
    id: "mock-store-2",
    company_id: "mock-company-2",
    name: "恵比寿店",
    owner_user_id: null,
    created_at: "2026-06-02T09:00:00Z",
    hourly_wage: 1150,
    area: "東京都渋谷区",
    companies: { name: "トラットリア・ルーチェ" },
  },
  {
    id: "mock-store-3",
    company_id: "mock-company-3",
    name: "渋谷店",
    owner_user_id: null,
    created_at: "2026-06-03T09:00:00Z",
    hourly_wage: 1100,
    area: "東京都渋谷区",
    companies: { name: "炭火やきとり とりまる" },
  },
  {
    id: "mock-store-4",
    company_id: "mock-company-4",
    name: "梅田店",
    owner_user_id: null,
    created_at: "2026-06-04T09:00:00Z",
    hourly_wage: 1250,
    area: "大阪府大阪市北区",
    companies: { name: "シフルンカフェ" },
  },
  {
    id: "mock-store-5",
    company_id: "mock-company-5",
    name: "難波店",
    owner_user_id: null,
    created_at: "2026-06-05T09:00:00Z",
    hourly_wage: 1200,
    area: "大阪府大阪市中央区",
    companies: { name: "大衆酒場 まるいち" },
  },
  {
    id: "mock-store-6",
    company_id: "mock-company-6",
    name: "三宮店",
    owner_user_id: null,
    created_at: "2026-06-06T09:00:00Z",
    hourly_wage: 1150,
    area: "兵庫県神戸市中央区",
    companies: { name: "麺処 こむぎ" },
  },
  {
    id: "mock-store-7",
    company_id: "mock-company-7",
    name: "元町店",
    owner_user_id: null,
    created_at: "2026-06-07T09:00:00Z",
    hourly_wage: 1180,
    area: "兵庫県神戸市中央区",
    companies: { name: "ベーカリー こむぎ堂" },
  },
  {
    id: "mock-store-8",
    company_id: "mock-company-8",
    name: "京都駅前店",
    owner_user_id: null,
    created_at: "2026-06-08T09:00:00Z",
    hourly_wage: 1130,
    area: "京都府京都市下京区",
    companies: { name: "定食 あおば" },
  },
];

export const MOCK_WORKERS: Worker[] = [
  {
    id: "mock-worker-1",
    name: "田中 花子",
    current_store: "はれのひダイニング 渋谷店",
    business_type: "居酒屋",
    job_type: null,
    experience_years: 2,
    skill_tags: ["ホール", "接客", "ドリンク"],
    skills: null,
    bio: "明るく元気に接客します！",
    verification_status: "verified",
    created_at: "2026-06-01T09:00:00Z",
  },
  {
    id: "mock-worker-2",
    name: "鈴木 太郎",
    current_store: "はれのひダイニング 渋谷店",
    business_type: "居酒屋",
    job_type: null,
    experience_years: 1,
    skill_tags: ["キッチン"],
    skills: null,
    bio: null,
    verification_status: "verified",
    created_at: "2026-06-05T10:00:00Z",
  },
  {
    id: "mock-worker-3",
    name: "佐藤 美咲",
    current_store: "はれのひダイニング 渋谷店",
    business_type: "居酒屋",
    job_type: null,
    experience_years: 3,
    skill_tags: ["ホール", "レジ", "接客"],
    skills: "バーカウンター経験あり",
    bio: null,
    verification_status: "verified",
    created_at: "2026-06-10T11:00:00Z",
  },
  {
    id: "mock-worker-4",
    name: "高橋 健太",
    current_store: "はれのひダイニング 渋谷店",
    business_type: "居酒屋",
    job_type: null,
    experience_years: 0,
    skill_tags: ["ホール"],
    skills: null,
    bio: null,
    verification_status: "unverified",
    is_minor: true, // サンプル：18歳未満の印と、深夜勤務の規制の表示を確認するため
    created_at: "2026-06-15T09:00:00Z",
  },
  {
    id: "mock-worker-5",
    name: "伊藤 さくら",
    current_store: "はれのひダイニング 渋谷店",
    business_type: "居酒屋",
    job_type: null,
    experience_years: 1,
    skill_tags: ["ドリンク", "キッチン"],
    skills: null,
    bio: null,
    verification_status: "verified",
    created_at: "2026-06-18T10:00:00Z",
  },
];

export const MOCK_SHIFT_PERIODS: ShiftPeriod[] = [
  {
    id: "mock-period-1",
    store_name: "はれのひダイニング 渋谷店",
    title: "2026年7月シフト",
    start_date: "2026-07-01",
    end_date: "2026-07-31",
    submission_deadline: "2026-06-25",
    status: "open",
    created_at: "2026-06-15T09:00:00Z",
  },
  {
    id: "mock-period-2",
    store_name: "はれのひダイニング 渋谷店",
    title: "2026年6月後半シフト",
    start_date: "2026-06-16",
    end_date: "2026-06-30",
    submission_deadline: "2026-06-12",
    status: "closed",
    created_at: "2026-06-01T09:00:00Z",
  },
];

type SlotDef = {
  id: string;
  worker_id: string;
  worker_name: string;
  work_date: string;
  start_time: string;
  end_time: string;
  status: WorkerAvailabilitySlotWithWorker["status"];
};

const TODAY = new Date().toISOString().slice(0, 10);

const SLOT_DEFS: SlotDef[] = [
  // 今日のシフト（デモ用: 田中花子が採用済み）
  { id: "s-today-1", worker_id: "mock-worker-1", worker_name: "田中 花子", work_date: TODAY, start_time: "17:00:00", end_time: "22:00:00", status: "assigned" },
  { id: "s-today-2", worker_id: "mock-worker-2", worker_name: "鈴木 太郎",  work_date: TODAY, start_time: "11:00:00", end_time: "16:00:00", status: "assigned" },
  // 7/1 (水) — 4人
  { id: "s1",  worker_id: "mock-worker-1", worker_name: "田中 花子",  work_date: "2026-07-01", start_time: "17:00:00", end_time: "22:00:00", status: "assigned" },
  { id: "s2",  worker_id: "mock-worker-2", worker_name: "鈴木 太郎",  work_date: "2026-07-01", start_time: "11:00:00", end_time: "16:00:00", status: "assigned" },
  { id: "s3",  worker_id: "mock-worker-3", worker_name: "佐藤 美咲",  work_date: "2026-07-01", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s4",  worker_id: "mock-worker-4", worker_name: "高橋 健太",  work_date: "2026-07-01", start_time: "17:00:00", end_time: "21:00:00", status: "pending" },

  // 7/2 (木) — 2人
  { id: "s5",  worker_id: "mock-worker-1", worker_name: "田中 花子",  work_date: "2026-07-02", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s6",  worker_id: "mock-worker-5", worker_name: "伊藤 さくら", work_date: "2026-07-02", start_time: "11:00:00", end_time: "15:00:00", status: "pending" },

  // 7/3 (金) — 3人
  { id: "s7",  worker_id: "mock-worker-2", worker_name: "鈴木 太郎",  work_date: "2026-07-03", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s8",  worker_id: "mock-worker-3", worker_name: "佐藤 美咲",  work_date: "2026-07-03", start_time: "11:00:00", end_time: "16:00:00", status: "released" },
  { id: "s9",  worker_id: "mock-worker-5", worker_name: "伊藤 さくら", work_date: "2026-07-03", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },

  // 7/4 (土) — 5人（週末）
  { id: "s10", worker_id: "mock-worker-1", worker_name: "田中 花子",  work_date: "2026-07-04", start_time: "11:00:00", end_time: "22:00:00", status: "assigned" },
  { id: "s11", worker_id: "mock-worker-2", worker_name: "鈴木 太郎",  work_date: "2026-07-04", start_time: "11:00:00", end_time: "16:00:00", status: "assigned" },
  { id: "s12", worker_id: "mock-worker-3", worker_name: "佐藤 美咲",  work_date: "2026-07-04", start_time: "17:00:00", end_time: "22:00:00", status: "assigned" },
  { id: "s13", worker_id: "mock-worker-4", worker_name: "高橋 健太",  work_date: "2026-07-04", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s14", worker_id: "mock-worker-5", worker_name: "伊藤 さくら", work_date: "2026-07-04", start_time: "11:00:00", end_time: "16:00:00", status: "pending" },

  // 7/5 (日) — 3人（週末）
  { id: "s15", worker_id: "mock-worker-1", worker_name: "田中 花子",  work_date: "2026-07-05", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s16", worker_id: "mock-worker-3", worker_name: "佐藤 美咲",  work_date: "2026-07-05", start_time: "11:00:00", end_time: "16:00:00", status: "pending" },
  { id: "s17", worker_id: "mock-worker-4", worker_name: "高橋 健太",  work_date: "2026-07-05", start_time: "11:00:00", end_time: "15:00:00", status: "pending" },

  // 7/7 (火) — 2人
  { id: "s18", worker_id: "mock-worker-2", worker_name: "鈴木 太郎",  work_date: "2026-07-07", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s19", worker_id: "mock-worker-5", worker_name: "伊藤 さくら", work_date: "2026-07-07", start_time: "17:00:00", end_time: "21:00:00", status: "pending" },

  // 7/8 (水) — 3人
  { id: "s20", worker_id: "mock-worker-1", worker_name: "田中 花子",  work_date: "2026-07-08", start_time: "17:00:00", end_time: "22:00:00", status: "assigned" },
  { id: "s21", worker_id: "mock-worker-3", worker_name: "佐藤 美咲",  work_date: "2026-07-08", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s22", worker_id: "mock-worker-4", worker_name: "高橋 健太",  work_date: "2026-07-08", start_time: "11:00:00", end_time: "16:00:00", status: "pending" },

  // 7/10 (金) — 4人
  { id: "s23", worker_id: "mock-worker-1", worker_name: "田中 花子",  work_date: "2026-07-10", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s24", worker_id: "mock-worker-2", worker_name: "鈴木 太郎",  work_date: "2026-07-10", start_time: "11:00:00", end_time: "16:00:00", status: "pending" },
  { id: "s25", worker_id: "mock-worker-3", worker_name: "佐藤 美咲",  work_date: "2026-07-10", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s26", worker_id: "mock-worker-5", worker_name: "伊藤 さくら", work_date: "2026-07-10", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },

  // 7/11 (土) — 5人（週末）
  { id: "s27", worker_id: "mock-worker-1", worker_name: "田中 花子",  work_date: "2026-07-11", start_time: "11:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s28", worker_id: "mock-worker-2", worker_name: "鈴木 太郎",  work_date: "2026-07-11", start_time: "11:00:00", end_time: "16:00:00", status: "pending" },
  { id: "s29", worker_id: "mock-worker-3", worker_name: "佐藤 美咲",  work_date: "2026-07-11", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s30", worker_id: "mock-worker-4", worker_name: "高橋 健太",  work_date: "2026-07-11", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s31", worker_id: "mock-worker-5", worker_name: "伊藤 さくら", work_date: "2026-07-11", start_time: "11:00:00", end_time: "16:00:00", status: "pending" },

  // 7/14 (火) — 2人
  { id: "s32", worker_id: "mock-worker-2", worker_name: "鈴木 太郎",  work_date: "2026-07-14", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s33", worker_id: "mock-worker-4", worker_name: "高橋 健太",  work_date: "2026-07-14", start_time: "17:00:00", end_time: "21:00:00", status: "pending" },

  // 7/15 (水) — 3人
  { id: "s34", worker_id: "mock-worker-1", worker_name: "田中 花子",  work_date: "2026-07-15", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
  { id: "s35", worker_id: "mock-worker-3", worker_name: "佐藤 美咲",  work_date: "2026-07-15", start_time: "11:00:00", end_time: "16:00:00", status: "pending" },
  { id: "s36", worker_id: "mock-worker-5", worker_name: "伊藤 さくら", work_date: "2026-07-15", start_time: "17:00:00", end_time: "22:00:00", status: "pending" },
];

export const MOCK_SCOUT_REQUESTS: ScoutRequest[] = [
  {
    id: "mock-scout-1",
    worker_id: "mock-worker-1",
    company_name: "トラットリア・ルーチェ 恵比寿店",
    store_name: "トラットリア・ルーチェ 恵比寿店",
    preferred_work_date: "2026-07-05",
    preferred_start_time: "17:00:00",
    preferred_end_time: "22:00:00",
    offered_hourly_wage: 1200,
    message: "土曜日のホールを手伝っていただけませんか？経験者優遇です。",
    status: "pending",
    created_at: "2026-06-27T10:00:00Z",
  },
  {
    id: "mock-scout-2",
    worker_id: "mock-worker-1",
    company_name: "炭火やきとり とりまる 渋谷店",
    store_name: "炭火やきとり とりまる 渋谷店",
    preferred_work_date: "2026-07-10",
    preferred_start_time: "18:00:00",
    preferred_end_time: "23:00:00",
    offered_hourly_wage: 1100,
    message: "金曜夜のヘルプを探しています。よろしくお願いします！",
    status: "pending",
    created_at: "2026-06-28T09:00:00Z",
  },
];

export const MOCK_JOIN_REQUESTS: StoreJoinRequest[] = [
  {
    id: "mock-req-1",
    worker_name: "山田 翔太",
    skill_tags: ["ホール", "接客"],
    store_name: "はれのひダイニング 渋谷店",
    message: "先日面接していただいた山田です。よろしくお願いします！",
    experience_years: 1,
    bio: "飲食バイト1年目です。明るく頑張ります。",
    status: "approved",
    created_at: "2026-06-26T10:00:00Z",
  },
  {
    id: "mock-req-2",
    worker_name: "林 奈々",
    skill_tags: ["キッチン", "洗い場"],
    store_name: "はれのひダイニング 渋谷店",
    message: null,
    experience_years: 0,
    bio: null,
    status: "approved",
    created_at: "2026-06-27T14:30:00Z",
  },
];

export const MOCK_SLOTS: WorkerAvailabilitySlotWithWorker[] = SLOT_DEFS.map(
  (def) => ({
    id: def.id,
    worker_id: def.worker_id,
    slot_type: "available" as const,
    status: def.status,
    reviewed_at: def.status !== "pending" ? "2026-06-22T09:00:00Z" : null,
    work_date: def.work_date,
    day_of_week: null,
    start_time: def.start_time,
    end_time: def.end_time,
    created_at: "2026-06-20T10:00:00Z",
    workers: { id: def.worker_id, name: def.worker_name, current_store: "はれのひダイニング 渋谷店" },
  }),
);
