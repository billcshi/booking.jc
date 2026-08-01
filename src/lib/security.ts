import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { requiredSecret as requiredConfiguredSecret } from "../../scripts/config.mjs";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function requiredSecret(name: "ADMIN_USERNAME" | "ADMIN_PASSWORD" | "AGENT_TOKEN" | "SESSION_SECRET") {
  return requiredConfiguredSecret(name, process.env[name]);
}

export async function rateLimit(scope: string, limit: number, windowMs = 15 * 60_000) {
  const h = await headers();
  const trustProxy = process.env.TRUST_PROXY === "1";
  const ip = trustProxy
    ? h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "proxy"
    : `direct:${createHash("sha256").update([h.get("user-agent") ?? "unknown", h.get("accept-language") ?? "unknown"].join("\n")).digest("hex").slice(0,24)}`;
  const key = `${scope}:${ip}`;
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [bucketKey, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(bucketKey);
    if (buckets.size > 5000) buckets.clear();
  }
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

export function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
