import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { type AttemptEvent, type Cause, type CauseClass, causeOf, HttpFailure, hopText, parseRetries, retryable, retryAfterMs, withRetry } from "./net-retry.ts";
import { record } from "./recorder.ts";

// LINEAR CALL(ATC-561, docs/linear-retry.md): atc 서버 → Linear의 모든 호출이 지나는 한 곳. 네트워크 수준 실패는 짧게 다시 시도하고,
// 시도마다 FLIGHT RECORDER에 구간·종류·원인을 남긴다. 이슈 글·제목·토큰은 기록에 넣지 않는다(있으면 이슈 key만).
// 다시 시도하지 않는 것: GraphQL 오류(200 응답 안의 errors), 429가 아닌 4xx, TLS 오류.

export type LinearOp = "read" | "create" | "update" | "comment";
export interface LinearCallLine {
  t: string;
  kind: "linear-call";
  hop: "atc-server-to-linear" | "atcctl-to-atc-server";
  op: LinearOp;
  attempt: number;
  outcome: "retry" | "recovered" | "gave-up";
  cause: CauseClass;
  code?: string;
  key?: string;
}

export const ATTEMPT_TIMEOUT_MS = 10_000; // 시도마다 따로(다시 시도가 서버의 이벤트 루프를 붙들지 않게)
const SETTING_FILE = () => join(config.stateDir, "linear-retry.json");
let cached: { at: number; n: number } | null = null;
// 다시 시도하는 횟수(0~3, 기본 2). 0이면 지금과 같다. 스위치 파일 하나, SUPERVISOR만 바꾼다(설정 창)
export function loadRetries(file = SETTING_FILE(), now = Date.now()): number {
  const real = file === SETTING_FILE();
  if (real && cached && now - cached.at < 5_000) return cached.n;
  let n = parseRetries(undefined);
  try {
    n = parseRetries(JSON.parse(readFileSync(file, "utf8")).retries);
  } catch {}
  if (real) cached = { at: now, n };
  return n;
}
export function saveRetries(n: number, by = "SUPERVISOR", file = SETTING_FILE()) {
  const from = loadRetries(file);
  if (from === n) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ retries: n }, null, 2) + "\n");
  renameSync(tmp, file);
  cached = null;
  if (file === SETTING_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "linear-retry-count", by, from: String(from), to: String(n) });
}

export const lineOf = (e: AttemptEvent, hop: LinearCallLine["hop"], op: LinearOp, key: string | undefined, now = new Date()): LinearCallLine => ({
  t: now.toISOString(),
  kind: "linear-call",
  hop,
  op,
  attempt: e.attempt,
  outcome: e.outcome,
  cause: e.cause.cls,
  ...(e.cause.code ? { code: e.cause.code } : {}),
  ...(key ? { key } : {}),
});

export interface GqlCall {
  endpoint: string;
  apiKey: string;
  query: string;
  variables: Record<string, unknown>;
  op: LinearOp;
  key?: string; // 이슈 key(기록에만 들어간다)
  // 보냈는지 모르는 실패 뒤, 다시 보내기 전에 이미 적용됐는지 찾는다(쓰기). 값이 있으면 그것이 결과다
  beforeRetry?: (c: Cause) => Promise<unknown | undefined>;
  // 쓰기를 다시 보내도 되는가(기본: 읽기와 멱등한 쓰기). false면 요청이 닿기 전에 실패한 경우에만 다시 보낸다
  idempotent?: boolean;
  retries?: number;
  // 시험이 바꾼다
  fetchFn?: typeof fetch;
  sink?: (l: LinearCallLine) => void;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
  timeoutMs?: number;
}

export async function linearGql<T>(c: GqlCall): Promise<T> {
  const doFetch = c.fetchFn ?? fetch;
  const sink = c.sink ?? ((l: LinearCallLine) => record(l));
  const idempotent = c.idempotent ?? c.op === "read";
  try {
    return await withRetry<T>(
      async () => {
        const res = await doFetch(c.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: c.apiKey },
          body: JSON.stringify({ query: c.query, variables: c.variables }),
          signal: AbortSignal.timeout(c.timeoutMs ?? ATTEMPT_TIMEOUT_MS),
        });
        if ([429, 502, 503, 504].includes(res.status)) throw new HttpFailure(res.status, `HTTP ${res.status}`, retryAfterMs(res.headers.get("retry-after")));
        const body = await res.json().catch((e) => (res.ok ? Promise.reject(e) : {}));
        const msg: string | undefined = body.errors?.[0]?.message;
        if (!res.ok) throw new HttpFailure(res.status, msg ?? `HTTP ${res.status}`); // 다시 시도하지 않는 상태(4xx·500)도 기록에는 http 원인으로 남는다
        if (msg !== undefined || body.errors) throw new Error(msg ?? "Linear 오류"); // 200 안의 GraphQL 오류: 다시 시도하지 않고 기록하지 않는다
        return body.data as T;
      },
      {
        retries: c.retries ?? loadRetries(),
        ...(c.sleep ? { sleep: c.sleep } : {}),
        ...(c.rand ? { rand: c.rand } : {}),
        canRetry: (cause) => idempotent || !cause.mayHaveSent || Boolean(c.beforeRetry),
        ...(c.beforeRetry ? { beforeRetry: (cause: Cause) => (cause.mayHaveSent ? c.beforeRetry!(cause) : Promise.resolve(undefined)) } : {}),
        onEvent: (e) => {
          if (e.cause.cls === "other") return; // 네트워크 실패가 아니다(GraphQL 오류 등)
          try {
            sink(lineOf(e, "atc-server-to-linear", c.op, c.key));
          } catch {}
        },
      },
    );
  } catch (e) {
    const cause = causeOf(e);
    // 마지막 시도가 실패해도 쓰기가 이미 적용됐을 수 있다: 한 번 더 찾아보고 있으면 그것이 결과다(중복도, 거짓 실패도 없다)
    if (c.beforeRetry && (c.retries ?? loadRetries()) > 0 && retryable(cause) && cause.mayHaveSent) {
      const found = await c.beforeRetry(cause).catch(() => undefined);
      if (found !== undefined) {
        try {
          sink(lineOf({ attempt: (c.retries ?? loadRetries()) + 1, outcome: "recovered", cause }, "atc-server-to-linear", c.op, c.key));
        } catch {}
        return found as T;
      }
    }
    if (e instanceof Error && cause.cls !== "other") e.message = hopText(e.message, "atc-server-to-linear");
    throw e;
  }
}

// ── 하루 셈(SUPERVISOR 화면) ──
// 구간·원인 종류마다: 실패한 시도 수(다시 시도하기로 한 것 + 포기한 것), 다시 시도해 복구한 호출 수, 끝내 포기한 호출 수. 이것이 MISFIRE 셈이다
export interface CallCount {
  day: string; // UTC
  hop: LinearCallLine["hop"];
  cause: CauseClass;
  failedAttempts: number;
  recovered: number;
  gaveUp: number;
}
export function callCountsOf(lines: readonly LinearCallLine[], fromMs: number, toMs: number): CallCount[] {
  const by = new Map<string, CallCount>();
  for (const l of lines) {
    const t = Date.parse(l.t);
    if (!(t >= fromMs && t < toMs)) continue;
    const day = l.t.slice(0, 10);
    const k = `${day}|${l.hop}|${l.cause}`;
    const c = by.get(k) ?? { day, hop: l.hop, cause: l.cause, failedAttempts: 0, recovered: 0, gaveUp: 0 };
    if (l.outcome === "recovered") c.recovered++;
    else {
      c.failedAttempts++;
      if (l.outcome === "gave-up") c.gaveUp++;
    }
    by.set(k, c);
  }
  return [...by.values()].sort((a, b) => b.day.localeCompare(a.day) || a.hop.localeCompare(b.hop) || a.cause.localeCompare(b.cause));
}

const OPS: readonly string[] = ["read", "create", "update", "comment"];
const OUTCOMES: readonly string[] = ["retry", "recovered", "gave-up"];
const CLASSES: readonly string[] = ["dns", "connect", "timeout", "tls", "network", "http", "other"];
// atcctl이 보낸 시도 기록(POST /api/linear-calls/note)을 줄로. 모르는 값이 있으면 그 줄은 버린다. 글은 실리지 않는다(code는 글자·숫자·밑줄·공백 24자까지)
export function noteLinesOf(raw: unknown, now = new Date()): LinearCallLine[] {
  const events = (raw as { events?: unknown } | null)?.events;
  const out: LinearCallLine[] = [];
  for (const e of Array.isArray(events) ? events.slice(0, 8) : []) {
    const o = e as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !OPS.includes(o.op as string) || !OUTCOMES.includes(o.outcome as string) || !CLASSES.includes(o.cause as string)) continue;
    const attempt = Number(o.attempt);
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > 9) continue;
    const code = typeof o.code === "string" && /^[A-Za-z0-9_ ]{1,24}$/.test(o.code) ? o.code : undefined;
    out.push({ t: now.toISOString(), kind: "linear-call", hop: "atcctl-to-atc-server", op: o.op as LinearOp, attempt, outcome: o.outcome as LinearCallLine["outcome"], cause: o.cause as CauseClass, ...(code ? { code } : {}) });
  }
  return out;
}
