"use client";

import { useEffect, useState } from "react";
import { isNativeApp } from "@/lib/native";

type Coords = { lat: number; lng: number };

/** アプリでは端末の位置情報（@capacitor/geolocation）を使う。許可の確認画面が端末標準のものになる。 */
async function nativePosition(): Promise<Coords | null> {
  const { Geolocation } = await import("@capacitor/geolocation");
  let permission = await Geolocation.checkPermissions();
  if (permission.location === "prompt" || permission.location === "prompt-with-rationale") permission = await Geolocation.requestPermissions({ permissions: ["location"] });
  if (permission.location !== "granted") return null;
  const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}

function browserPosition(): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

/** 出退勤打刻時に位置情報を取得する。権限拒否・非対応の場合は null のまま（自己申告扱い）。 */
export function useGeolocation() {
  const [coords, setCoords] = useState<Coords | null>(null);

  useEffect(() => {
    let active = true;
    (isNativeApp() ? nativePosition() : browserPosition())
      .catch(() => null)
      .then((result) => { if (active) setCoords(result); });
    return () => { active = false; };
  }, []);

  return coords;
}
