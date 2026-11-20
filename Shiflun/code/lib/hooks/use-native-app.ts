"use client";

import { useSyncExternalStore } from "react";
import { isNativeApp } from "@/lib/native";

const noop = () => () => {};

/** スマホのアプリの中で開いているか。サーバーでの描画とブラウザでは false。 */
export function useNativeApp(): boolean {
  return useSyncExternalStore(noop, isNativeApp, () => false);
}
