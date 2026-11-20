export function formatWorkDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export function formatSlotTime(time: string): string {
  return time.slice(0, 5);
}

export function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function isValidTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value);
}

export function toDbTime(value: string): string {
  return `${value}:00`;
}

export type AvailabilityDateOption = {
  value: string;
  label: string;
};

function formatLocalDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getNextAvailabilityDateOptions(
  count = 14,
): AvailabilityDateOption[] {
  const options: AvailabilityDateOption[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < count; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    options.push({
      value: formatLocalDateValue(date),
      label: date.toLocaleDateString("ja-JP", {
        month: "numeric",
        day: "numeric",
        weekday: "short",
      }),
    });
  }

  return options;
}
