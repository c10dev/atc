import type { Row, SqlRunner } from "../migration-rehearsal.ts";

// 마이그레이션 리허설(ATC-368)이 시험·실전 DB에 SQL을 보내는 길. Supabase Management API `POST /v1/projects/{ref}/database/query` 하나와
// 복원점을 읽는 `GET /v1/projects/{ref}/database/backups`(읽기)뿐이다. 토큰(K2)은 요청 머리에만 쓰고, 오류 메시지·기록에는 어떤 꼴로도 싣지 않는다.
// 이 파일은 시험에서 호출하지 않는다: 시험은 fetchFn을 넣거나 migration-rehearsal.ts의 가짜 SqlRunner를 쓴다(실제 DB 호출 없음).

const BASE = "https://api.supabase.com/v1/projects";

// 공급자 오류 본문에서 행 값이 들어갈 수 있는 부분을 걷어 낸다: Postgres의 DETAIL 줄, `Key (열)=(값)`, JSON의 detail 칸. 기록과 화면에 남는 글이라 값이 새지 않게
export function scrub(text: string): string {
  return text
    .replace(/\\?"detail\\?"\s*:\s*\\?"(?:[^"\\]|\\.)*\\?"/gi, '"detail":"[removed]"')
    .replace(/DETAIL:[^\n"]*/g, "DETAIL: [removed]")
    .replace(/Key \([^)]*\)=\([^)]*\)/g, "Key [removed]");
}

// 메시지에서 토큰과 Bearer 값을 지운다. 응답 본문의 일부도 토큰을 되울릴 수 있다고 보고 한 번 더 거른다
export function redact(text: string, token: string): string {
  let t = text;
  if (token) t = t.split(token).join("[redacted]");
  return t.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

export function supabaseRunner(projectRef: string, token: string, fetchFn: typeof fetch = fetch): SqlRunner {
  return {
    async query(sql: string): Promise<Row[]> {
      if (!token) throw new Error("마이그레이션 토큰이 없음(.env.local SUPABASE_MIGRATE_TOKEN)");
      let res: Response;
      try {
        res = await fetchFn(`${BASE}/${encodeURIComponent(projectRef)}/database/query`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query: sql }),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (e) {
        throw new Error(redact(`DB 호출 실패: ${String((e as Error).message ?? e)}`, token));
      }
      const text = await res.text().catch(() => "");
      if (!res.ok) throw new Error(redact(`DB가 거절함(HTTP ${res.status}): ${scrub(text).slice(0, 240)}`, token));
      try {
        const body = text ? JSON.parse(text) : [];
        return Array.isArray(body) ? (body as Row[]) : [];
      } catch {
        return [];
      }
    },
  };
}

// 복원점(PITR이 켜져 있으면 지금 시각, 아니면 maxAgeHours 안의 가장 새 백업). 둘 다 없으면 던진다. 응답 모양을 못 읽으면 던진다(가정하지 않는다)
export async function readRestorePoint(projectRef: string, token: string, o: { now: number; maxAgeHours: number; fetchFn?: typeof fetch }): Promise<string> {
  if (!token) throw new Error("마이그레이션 토큰이 없음");
  let res: Response;
  try {
    res = await (o.fetchFn ?? fetch)(`${BASE}/${encodeURIComponent(projectRef)}/database/backups`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new Error(redact(`백업 목록을 못 읽음: ${String((e as Error).message ?? e)}`, token));
  }
  if (!res.ok) throw new Error(`백업 목록을 못 읽음(HTTP ${res.status})`);
  return restorePointOf(await res.json().catch(() => null), o.now, o.maxAgeHours);
}

export function restorePointOf(body: unknown, now: number, maxAgeHours: number): string {
  const b = body && typeof body === "object" ? (body as { pitr_enabled?: unknown; backups?: unknown }) : null;
  if (!b) throw new Error("백업 응답을 읽지 못함");
  if (b.pitr_enabled === true) return `PITR ${new Date(now).toISOString()}`;
  const times = (Array.isArray(b.backups) ? b.backups : []).flatMap((x) => {
    const r = x as { status?: unknown; inserted_at?: unknown } | null;
    const t = r && typeof r.inserted_at === "string" ? Date.parse(r.inserted_at) : NaN;
    return r?.status === "COMPLETED" && Number.isFinite(t) ? [t] : [];
  });
  const latest = Math.max(...times, -Infinity);
  if (!Number.isFinite(latest)) throw new Error("PITR이 꺼져 있고 완료된 백업도 없음");
  if (now - latest > maxAgeHours * 3_600_000) throw new Error(`가장 새 백업이 ${maxAgeHours}시간보다 오래됨`);
  return `backup ${new Date(latest).toISOString()}`;
}
