import { CheckinMethod, ShiftRequestStatus, WorkerAvailabilitySlot } from "@/lib/types/database";

export function normalizeSlot(
  row: Record<string, unknown>,
): WorkerAvailabilitySlot {
  return {
    ...(row as WorkerAvailabilitySlot),
    status: (row.status as ShiftRequestStatus) ?? "pending",
    reviewed_at: (row.reviewed_at as string | null) ?? null,
    work_date: (row.work_date as string | null) ?? null,
    day_of_week:
      row.day_of_week === null || row.day_of_week === undefined
        ? null
        : Number(row.day_of_week),
    store_name: (row.store_name as string | null) ?? null,
    company_name: (row.company_name as string | null) ?? null,
    scout_request_id: (row.scout_request_id as string | null) ?? null,
    hourly_wage:
      row.hourly_wage === null || row.hourly_wage === undefined
        ? null
        : Number(row.hourly_wage),
    clock_in_at: (row.clock_in_at as string | null) ?? null,
    clock_out_at: (row.clock_out_at as string | null) ?? null,
    clock_in_lat:
      row.clock_in_lat === null || row.clock_in_lat === undefined ? null : Number(row.clock_in_lat),
    clock_in_lng:
      row.clock_in_lng === null || row.clock_in_lng === undefined ? null : Number(row.clock_in_lng),
    clock_out_lat:
      row.clock_out_lat === null || row.clock_out_lat === undefined ? null : Number(row.clock_out_lat),
    clock_out_lng:
      row.clock_out_lng === null || row.clock_out_lng === undefined ? null : Number(row.clock_out_lng),
    checkin_method: (row.checkin_method as CheckinMethod) ?? "self_report",
  };
}
