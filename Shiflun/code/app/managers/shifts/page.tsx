import { ShiftCalendarClient } from "@/components/managers/ShiftCalendarClient";
import { getSlotsByPeriod } from "@/lib/actions/shift-periods";
import { addMonths, monthEnd, monthStart, toDateStr } from "@/lib/utils/calendar";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ view?: string; date?: string }>;
};

export default async function ManagerShiftsPage({ searchParams }: PageProps) {
  const { view = "month", date } = await searchParams;

  const today = new Date();
  const baseDate =
    date ?? toDateStr(today.getFullYear(), today.getMonth() + 1, 1);

  const fetchStart = monthStart(addMonths(baseDate, -1));
  const fetchEnd = monthEnd(addMonths(baseDate, 1));

  const { slots } = await getSlotsByPeriod(fetchStart, fetchEnd);

  return (
    <ShiftCalendarClient
      slots={slots}
      initialView={(view === "week" ? "week" : "month") as "month" | "week"}
      initialDate={baseDate}
    />
  );
}
