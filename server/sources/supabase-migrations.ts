import { join } from "node:path";
import { config } from "../config.ts";
import type { HostedDb } from "../migration-gate.ts";

// 호스티드 DB가 적용한 마이그레이션 버전 읽기(ATC-329). Supabase Management API GET 하나뿐이다. SQL을 돌리거나 적용하지 않는다.
// 토큰은 .env.local의 SUPABASE_ACCESS_TOKEN: 이 읽기에만 쓰고 로그·기록·화면에 쓰지 않는다. 남기는 것은 버전과 개수뿐.
// 실패·꺼짐·토큰 없음은 모두 null(모름). 모름은 게이트가 제외로 본다.

const OFF = new Set(["off", "0", "false", "no"]);

// ATC_HOSTED_DB=off면 읽지 않는다. 운영 상태 폴더가 아니면(시험 서버) ATC_HOSTED_DB=on을 줘야만 읽는다
export function hostedDbReadOn(env: Record<string, string | undefined>, stateDir: string, prodStateDir: string): boolean {
  const v = (env.ATC_HOSTED_DB ?? "").trim().toLowerCase();
  if (OFF.has(v)) return false;
  if (v === "on") return true;
  return stateDir.replace(/\/+$/, "") === prodStateDir.replace(/\/+$/, "");
}

export function versionsOf(body: unknown): string[] | null {
  if (!Array.isArray(body)) return null;
  const out: string[] = [];
  for (const r of body) {
    const v = (r as { version?: unknown } | null)?.version;
    if (typeof v !== "string" || !/^\d+$/.test(v)) return null;
    out.push(v);
  }
  return out;
}

// 운영 설정으로 읽는다: 토큰은 .env.local(config), 시험 서버는 ATC_HOSTED_DB=on이 있을 때만(위)
export function readAppliedFor(db: HostedDb): Promise<string[] | null> {
  return readAppliedVersions(db, {
    token: config.supabaseAccessToken,
    enabled: hostedDbReadOn(process.env, config.stateDir, join(config.home, ".local/state/atc")),
  });
}

// 스냅샷(화면 표시)용: 90초 안의 결과는 다시 읽지 않는다. AUTOLAND 머지 직전에는 이것을 쓰지 않고 readAppliedFor로 새로 읽는다
const cache = new Map<string, { at: number; versions: string[] | null }>();
export async function readAppliedCached(db: HostedDb, now = Date.now(), ttlMs = 90_000): Promise<string[] | null> {
  const hit = cache.get(db.projectRef);
  if (hit && now - hit.at < ttlMs) return hit.versions;
  const versions = await readAppliedFor(db);
  cache.set(db.projectRef, { at: now, versions });
  return versions;
}

export async function readAppliedVersions(db: HostedDb, o: { token: string; enabled: boolean; fetchFn?: typeof fetch }): Promise<string[] | null> {
  if (!o.enabled || !o.token) return null;
  try {
    const res = await (o.fetchFn ?? fetch)(`https://api.supabase.com/v1/projects/${encodeURIComponent(db.projectRef)}/database/migrations`, {
      method: "GET",
      headers: { Authorization: `Bearer ${o.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return versionsOf(await res.json());
  } catch {
    return null;
  }
}
