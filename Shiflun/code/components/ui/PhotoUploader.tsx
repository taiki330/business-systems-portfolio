"use client";

import { ChangeEvent, useRef, useState } from "react";
import { removeProfilePhoto, uploadProfilePhoto } from "@/lib/actions/photos";
import { ParticipantRole } from "@/lib/types/database";
import { Photo } from "@/components/ui/Photo";

const MAX_EDGE = 800;

/**
 * 選んだ写真を、長辺800px以内の JPEG に縮める。
 * 通信量を減らすのと、撮影場所などの付帯情報（EXIF）を送らないため。
 */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), "image/jpeg", 0.85));
}

type Props = {
  role: ParticipantRole;
  /** 写真がないときに頭文字を出すための名前。 */
  name: string;
  url: string | null;
  /** 保存・削除が済んだら呼ぶ（画面全体の情報を取り直すため）。 */
  onChange?: () => void | Promise<void>;
};

/** プロフィール写真（ワーカー）・店舗写真の登録。写真は任意。 */
export function PhotoUploader({ role, name, url, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = role === "worker" ? "プロフィール写真" : "店舗の写真";

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.set("photo", await shrink(file), "photo.jpg");
      const result = await uploadProfilePhoto(role, form);
      if (result.error) { setError(result.error); return; }
      setCurrent(result.url ?? null);
      await onChange?.();
    } catch {
      setError("この画像は読み込めませんでした。別の写真でお試しください。");
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError(null);
    const result = await removeProfilePhoto(role);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    setCurrent(null);
    await onChange?.();
  }

  return <div>
    <p className="app-label">{label}<span className="ml-2 text-xs font-medium text-ink-soft">任意</span></p>
    <div className="flex items-center gap-4">
      <Photo src={current} name={name} className={role === "worker" ? "size-24" : "h-24 w-32"} />
      <div className="min-w-0 flex-1 space-y-2">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} aria-label={`${label}を選ぶ`} tabIndex={-1} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="app-secondary w-full">{busy ? "処理中…" : current ? "写真を変更する" : "写真を選ぶ"}</button>
        {current && <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-11 w-full text-sm font-medium text-ink-soft underline underline-offset-2 hover:text-ink disabled:opacity-50">写真を削除する</button>}
      </div>
    </div>
    <p className="mt-2 text-xs leading-relaxed text-ink-soft">{role === "worker"
      ? "登録すると、人材を探しているお店に表示されます。登録しなくても利用できます。"
      : "登録すると、スカウトを受け取ったワーカーに表示されます。お店の外観や店内の写真がおすすめです。"}</p>
    {error && <p role="alert" className="app-error mt-2">{error}</p>}
  </div>;
}
