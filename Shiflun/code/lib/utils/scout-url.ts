import { SearchParams } from "@/lib/types/search";

export function buildScoutUrl(workerId: string, params: SearchParams): string {
  const search = new URLSearchParams({
    work_date: params.work_date,
    start_time: params.start_time,
    end_time: params.end_time,
  });

  return `/companies/workers/${workerId}/scout?${search.toString()}`;
}
