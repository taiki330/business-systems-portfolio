export type VerificationStatus = "unverified" | "verified";

/** 将来のシフト連動用（Phase 2 では UI 未実装） */
export type AvailabilitySlotType = "available" | "preferred";

export type ShiftRequestStatus =
  | "pending"
  | "assigned"
  | "released"
  | "cancelled"
  | "attended";

export type Worker = {
  id: string;
  /** 同意した規約の版。本人専用の worker_private から、ログイン中の本人の分だけ読み込む。未適用のDBやモックでは undefined、未同意は null。 */
  terms_version?: string | null;
  terms_agreed_at?: string | null;
  name: string;
  current_store: string;
  business_type: string;
  /** @deprecated Phase 2 以降は skill_tags を使用 */
  job_type: string | null;
  experience_years: number;
  skill_tags: string[];
  /** スキルタグ以外の補足（自由記述） */
  skills: string | null;
  bio: string | null;
  verification_status: VerificationStatus;
  created_at: string;
  /** Phase 7 で追加。Phase 8 の Auth 導入まで未使用 */
  user_id?: string | null;
  /** Phase 7 で追加。current_store（自由入力）の正規化先 */
  current_store_id?: string | null;
  preferred_areas?: string[];
  completed_scout_count?: number;
  /** 18歳未満か。全店舗に見せる（深夜勤務の規制を確認できるように）。親権者の氏名・同意日時は worker_private（本人専用）。 */
  is_minor?: boolean;
  /** 所属店舗を最後に変えた日時（migration 026。7日に1回まで）。 */
  store_changed_at?: string | null;
  /** 利用停止にした日時（migration 026。停止中でなければ null）。 */
  suspended_at?: string | null;
  /** migration 023 で追加。退会した日時（退会していなければ null）。 */
  deleted_at?: string | null;
  /** migration 024 で追加。写真の保存先（未登録は null）と、画面表示用の短時間だけ有効なURL。 */
  photo_path?: string | null;
  photo_url?: string | null;
};

export type CheckinMethod = "self_report" | "gps" | "qr";

export type WorkerAvailabilitySlot = {
  id: string;
  worker_id: string;
  slot_type: AvailabilitySlotType;
  status: ShiftRequestStatus;
  reviewed_at: string | null;
  work_date: string | null;
  /** 曜日繰り返し（Phase 5-B では未使用） */
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  created_at: string;
  /** Phase 7 で追加。assigned / released 先の店舗の正規化先 */
  store_id?: string | null;
  /** Phase 8-A で追加。スカウト経由で作成された勤務枠の店舗名・企業名（自店舗のシフトでは null） */
  store_name?: string | null;
  company_name?: string | null;
  /** Phase 8-A で追加。この勤務枠のもとになったスカウト（自店舗のシフトでは null） */
  scout_request_id?: string | null;
  /** Phase 8-A で追加。スカウトの提示時給を引き継ぐ（自店舗のシフトでは null＝賃金未把握） */
  hourly_wage?: number | null;
  clock_in_at?: string | null;
  clock_out_at?: string | null;
  clock_in_lat?: number | null;
  clock_in_lng?: number | null;
  clock_out_lat?: number | null;
  clock_out_lng?: number | null;
  checkin_method?: CheckinMethod;
};

export type ManagerVerification = {
  id: string;
  worker_id: string;
  manager_name: string;
  store_name: string;
  manager_comment: string;
  verified: boolean;
  created_at: string;
  /** Phase 7 で追加。store_name（自由入力）の正規化先 */
  store_id?: string | null;
};

export type ScoutRequestStatus = "pending" | "accepted" | "rejected";

export type ScoutRequest = {
  id: string;
  worker_id: string;
  company_name: string;
  store_name: string | null;
  preferred_work_date: string | null;
  preferred_start_time: string | null;
  preferred_end_time: string | null;
  offered_hourly_wage: number | null;
  message: string;
  status: ScoutRequestStatus;
  created_at: string;
  /**
   * Phase 7 で追加。company_name / store_name（自由入力）の正規化先。
   * company_id は持たない。企業情報は stores.company_id から辿る。
   */
  store_id?: string | null;
  break_minutes?: number;
  work_minutes?: number | null;
  offered_total_yen?: number | null;
  service_fee_percent?: number | null;
  service_fee_yen?: number | null;
  store_total_yen?: number | null;
  workers?: { name: string } | null;
};

export type ShiftPeriodStatus = "open" | "closed" | "draft";

export type ShiftPeriod = {
  id: string;
  store_name: string;
  title: string;
  start_date: string;
  end_date: string;
  submission_deadline: string | null;
  status: ShiftPeriodStatus;
  created_at: string;
  /** Phase 7 で追加。store_name（自由入力）の正規化先 */
  store_id?: string | null;
};

/** Phase 7 で追加 */
export type Company = {
  id: string;
  name: string;
  created_at: string;
};

/** Phase 7 で追加。1 company : N stores */
export type Store = {
  id: string;
  company_id: string;
  name: string;
  owner_user_id: string | null;
  created_at: string;
  hourly_wage?: number | null;
  area?: string | null;
  companies?: { name: string } | null;
  /** 同意した規約の版（migration 020）。未適用のDBやモックでは undefined、未同意は null。 */
  terms_version?: string | null;
  terms_agreed_at?: string | null;
  /** migration 023 で追加。退会した日時（退会していなければ null）。 */
  deleted_at?: string | null;
  /** migration 026 で追加。利用停止にした日時（停止中でなければ null）。 */
  suspended_at?: string | null;
  /** migration 024 で追加。写真の保存先（未登録は null）と、画面表示用の短時間だけ有効なURL。 */
  photo_path?: string | null;
  photo_url?: string | null;
};

export type ParticipantRole = "worker" | "store";
export type Participant = { role: ParticipantRole; id: string };
export type ChatMessage = {
  id: string;
  sequence: number;
  scout_id: string;
  sender_role: ParticipantRole;
  sender_id: string;
  body: string;
  created_at: string;
};
/** 所属スタッフと店長の会話（シフト相談など）。 */
export type StaffMessage = {
  id: string;
  sequence: number;
  worker_id: string;
  store_id: string;
  sender_role: ParticipantRole;
  body: string;
  created_at: string;
};
/** 画面で扱うメッセージの共通部分。 */
export type ThreadMessage = Pick<ChatMessage, "id" | "sequence" | "sender_role" | "body" | "created_at">;
export type ChatThread = {
  kind: "staff" | "scout";
  /** staff: worker_id / scout: scout_id */
  id: string;
  title: string;
  subtitle: string;
  lastMessage: ThreadMessage | null;
  unread: number;
};
export type AppNotification = {
  id: string;
  kind: "scout_received" | "scout_accepted" | "scout_rejected" | "message" | "staff_message";
  scout_id: string | null;
  message_id: string | null;
  staff_message_id: string | null;
  staff_worker_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type WorkerAvailabilitySlotWithWorker = WorkerAvailabilitySlot & {
  workers: {
    id: string;
    name: string;
    current_store: string;
  };
};

export type JoinRequestStatus = "pending" | "approved" | "rejected";

export type StoreJoinRequest = {
  id: string;
  worker_name: string;
  skill_tags: string[];
  store_name: string;
  message: string | null;
  experience_years: number | null;
  bio: string | null;
  status: JoinRequestStatus;
  created_at: string;
};

/** Phase 8-B で追加。店舗所属は自己申告制になり、店長は事後に「通報」できる。 */
export type WorkerFlagStatus = "open" | "resolved" | "dismissed";

export type WorkerFlag = {
  id: string;
  worker_id: string;
  store_name: string;
  reporter_name: string;
  reason: string;
  status: WorkerFlagStatus;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

/** Phase 9-A で追加。docs/legal/02_money-flow.md 案A（無仲介・手動記録）の暫定実装 */
export type PayoutStatus = "pending" | "paid";
export type PayoutMethod = "manual" | "platform";

export type Payout = {
  id: string;
  slot_id: string;
  scout_id: string | null;
  worker_id: string;
  store_id: string | null;
  store_name: string | null;
  wage_amount_yen: number;
  service_fee_yen: number;
  status: PayoutStatus;
  payout_method: PayoutMethod;
  provider: string;
  provider_reference_id: string | null;
  marked_paid_by: string | null;
  paid_at: string | null;
  note: string | null;
  created_at: string;
  /** join 表示用（ワーカー名） */
  workers?: { name: string } | null;
};

/** Phase 9-B で追加。本番のeKYCベンダー導入までの暫定的な本人確認フロー */
export type IdentityVerificationStatus = "unverified" | "pending" | "verified" | "rejected";
export type IdentityDocumentType = "license" | "my_number_card" | "passport" | "residence_card";

export type IdentityVerification = {
  id: string;
  worker_id: string;
  status: IdentityVerificationStatus;
  full_name_kana: string | null;
  birth_date: string | null;
  document_type: IdentityDocumentType | null;
  document_storage_path: string | null;
  provider: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewer_name: string | null;
  reject_reason: string | null;
  created_at: string;
  /** join 表示用 */
  workers?: { name: string; current_store: string } | null;
};

/** migration 023 で追加。チャットの通報（運営の審査担当だけが読める）。 */
export type ChatReportReason = "harassment" | "inappropriate" | "spam" | "fraud" | "other";
export type ModerationStatus = "open" | "resolved";

export type ChatReport = {
  id: string;
  reporter_role: ParticipantRole;
  worker_id: string;
  store_id: string;
  kind: "scout" | "staff";
  scout_id: string | null;
  message_id: string | null;
  /** 通報時点のメッセージ本文の写し（メッセージを選ばずに通報した場合は null）。 */
  message_body: string | null;
  message_sent_at: string | null;
  reason: ChatReportReason;
  detail: string | null;
  status: ModerationStatus;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
};

/** migration 023 で追加。お問い合わせ（運営の審査担当だけが読める）。 */
export type ContactCategory = "account" | "deletion" | "report" | "bug" | "other";

export type ContactInquiry = {
  id: string;
  user_id: string | null;
  email: string;
  category: ContactCategory;
  body: string;
  status: ModerationStatus;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
};

/** migration 026 で追加。利用停止の記録（運営の審査担当だけが読める）。 */
export type AccountSuspension = {
  id: string;
  user_id: string;
  email: string | null;
  worker_id: string | null;
  store_id: string | null;
  reason: string;
  report_id: string | null;
  suspended_by: string;
  suspended_at: string;
  lifted_at: string | null;
  lifted_by: string | null;
  lift_note: string | null;
  workers?: { name: string } | null;
  stores?: { name: string } | null;
};

export type TableName =
  | "workers"
  | "manager_verifications"
  | "scout_requests"
  | "worker_availability_slots"
  | "shift_periods"
  | "store_join_requests";

export type TableCheckResult = {
  table: TableName;
  ok: boolean;
  count: number | null;
  error: string | null;
};

export type ConnectionCheckResult = {
  configured: boolean;
  connected: boolean;
  message: string;
  tables: TableCheckResult[];
};
