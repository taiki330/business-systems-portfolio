"use client";

export function CheckinQrForm({ defaultStoreName }: { defaultStoreName: string }) {
  return (
    <form method="GET" className="flex gap-2 rounded-xl border border-line bg-white p-4">
      <input
        type="text"
        name="store"
        defaultValue={defaultStoreName}
        required
        placeholder="例：シフルン食堂 三宮店"
        className="flex-1 rounded-xl border border-line px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none"
      />
      <button
        type="submit"
        className="app-primary"
      >
        QR発行
      </button>
    </form>
  );
}
