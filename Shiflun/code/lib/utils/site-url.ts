import { headers } from "next/headers";

export async function getSiteOrigin(): Promise<string> {
  const headerList = await headers();
  const host =
    headerList.get("x-forwarded-host") ?? headerList.get("host");

  if (!host) {
    return "http://localhost:3000";
  }

  const forwardedProto = headerList.get("x-forwarded-proto");
  const protocol =
    forwardedProto ??
    (host.includes("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${protocol}://${host}`;
}

export function buildManagerVerifyUrl(origin: string, workerId: string): string {
  return `${origin}/managers/verify/${workerId}`;
}

export function buildManagerShiftsUrl(origin: string, workerId: string): string {
  return `${origin}/managers/shifts/${workerId}`;
}
