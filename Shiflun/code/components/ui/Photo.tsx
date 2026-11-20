/**
 * 写真の枠。写真が登録されていないときは、名前の頭文字を出す。
 * 大きさは className で決める（例: "size-16"、"h-24 w-32"）。
 */
export function Photo({ src, name, className = "size-16" }: { src?: string | null; name: string; className?: string }) {
  const initial = name.trim().slice(0, 1) || "?";
  return (
    <span className={`app-photo ${className}`}>
      {/* 署名付きURLは短時間で切れるため、next/image の最適化（キャッシュ）は通さない。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" loading="lazy" /> : <span aria-hidden="true">{initial}</span>}
    </span>
  );
}
