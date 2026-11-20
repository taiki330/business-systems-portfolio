import { WorkerAvailabilitySlotWithWorker } from "@/lib/types/database";
import { formatSlotTime } from "@/lib/utils/availability";
import { getMonthDays, weekdayShort } from "@/lib/utils/calendar";

type MonthCalendarGridProps = {
  baseDate: string;
  slots: WorkerAvailabilitySlotWithWorker[];
  onDayClick: (date: string) => void;
};

type DayEntry = {
  name: string;
  time: string;
  status: WorkerAvailabilitySlotWithWorker["status"];
};

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

function lastName(fullName: string): string {
  return fullName.split(/\s+/)[0] ?? fullName;
}

const STATUS_STYLE: Record<string, string> = {
  pending:  "bg-brand-yellow-light text-brand-yellow-dark",
  assigned: "bg-brand-blue-light text-brand-blue",
  released: "bg-chip text-ink-soft",
};

export function MonthCalendarGrid({
  baseDate,
  slots,
  onDayClick,
}: MonthCalendarGridProps) {
  const [year, month] = baseDate.split("-").map(Number);
  const cells = getMonthDays(year, month);
  const today = new Date().toISOString().slice(0, 10);

  const entriesByDate = slots.reduce<Record<string, DayEntry[]>>((acc, slot) => {
    if (!slot.work_date || slot.status === "cancelled") return acc;
    acc[slot.work_date] ??= [];
    acc[slot.work_date].push({
      name: lastName(slot.workers.name),
      time: `${formatSlotTime(slot.start_time)}〜${formatSlotTime(slot.end_time)}`,
      status: slot.status,
    });
    return acc;
  }, {});

  return (
    <div className="w-full">
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            className={`py-2 text-center text-xs font-semibold ${
              i === 5 ? "text-brand-blue" : i === 6 ? "text-red-500" : "text-ink-soft"
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((dateStr, i) => {
          if (!dateStr) {
            return <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-line bg-paper" />;
          }

          const entries = entriesByDate[dateStr] ?? [];
          const day = Number(dateStr.split("-")[2]);
          const wd = weekdayShort(dateStr);
          const isToday = dateStr === today;
          const isSat = wd === "土";
          const isSun = wd === "日";

          return (
            <button
              key={dateStr}
              onClick={() => onDayClick(dateStr)}
              className="min-h-[80px] border-b border-r border-line p-1 text-left transition-colors hover:bg-brand-blue-light"
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  isToday
                    ? "bg-brand-blue text-white"
                    : isSat
                    ? "text-brand-blue"
                    : isSun
                    ? "text-red-500"
                    : "text-ink-soft"
                }`}
              >
                {day}
              </span>

              {entries.length > 0 && (
                <div className="mt-1 flex flex-col gap-0.5">
                  {entries.slice(0, 4).map((e, idx) => (
                    <span
                      key={idx}
                      className={`truncate rounded px-1 py-0.5 text-[10px] font-semibold leading-tight ${STATUS_STYLE[e.status] ?? STATUS_STYLE.pending}`}
                    >
                      {e.name} {e.time}
                    </span>
                  ))}
                  {entries.length > 4 && (
                    <span className="px-1 text-[10px] text-ink-soft">
                      +{entries.length - 4}人
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
