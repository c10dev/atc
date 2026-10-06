// NET RETRY(ATC-561, docs/linear-retry.md): 네트워크 수준 실패를 짧게 다시 시도하는 순수 부품. 의존성이 없다(server/ 밖의 atcctl.mjs도 이 파일을 가져온다).
// 사건: SUPERVISOR에게 `오류: fetch failed`가 닿았는데 atcctl → atc 서버 구간인지 atc 서버 → Linear 구간인지 알 수 없었다. 그래서 구간(hop)과 원인 종류를 늘 같이 적는다.

export type Hop = "atc-server-to-linear" | "atcctl-to-atc-server";
export const HOP_LABEL: Record<Hop, string> = { "atc-server-to-linear": "atc server → Linear", "atcctl-to-atc-server": "atcctl → atc server" };

export type CauseClass = "dns" | "connect" | "timeout" | "tls" | "network" | "http" | "other"; // other: 네트워크 실패로 보이지 않는 오류(GraphQL 오류 등). 다시 시도하지 않는다
export interface Cause {
  cls: CauseClass;
  code: string | null; // ENOTFOUND, ECONNRESET, UND_ERR_HEADERS_TIMEOUT … 또는 HTTP 상태 글자
  status?: number;
  // 요청이 상대에게 닿았을 수 있나. 닿기 전에 실패(DNS·연결 거절·연결 시간 초과)면 false: 쓰기도 다시 보내도 중복이 없다
  mayHaveSent: boolean;
}

const DNS = new Set(["ENOTFOUND", "EAI_AGAIN"]);
const CONNECT_NEVER_SENT = new Set(["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
const CONNECT_MAYBE = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CLOSED"]);
const TIMEOUT = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ETIMEDOUT"]);
const TLS = /^(ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_|UNABLE_TO_VERIFY|SELF_SIGNED|ERR_OSSL)/;

export const RETRY_STATUSES: readonly number[] = [429, 502, 503, 504];

// 던져진 오류 → 원인. fetch는 `TypeError: fetch failed`에 진짜 원인을 cause로 단다(cause의 cause까지 본다)
export function causeOf(err: unknown): Cause {
  const e = err as { name?: unknown; code?: unknown; status?: unknown; cause?: unknown } | null;
  if (e && typeof e.status === "number") return { cls: "http", code: String(e.status), status: e.status, mayHaveSent: true };
  for (let o: unknown = err, i = 0; o && typeof o === "object" && i < 4; o = (o as { cause?: unknown }).cause, i++) {
    const x = o as { name?: unknown; code?: unknown };
    const code = typeof x.code === "string" ? x.code : null;
    if (code && DNS.has(code)) return { cls: "dns", code, mayHaveSent: false };
    if (code && CONNECT_NEVER_SENT.has(code)) return { cls: "connect", code, mayHaveSent: false };
    if (code && CONNECT_MAYBE.has(code)) return { cls: "connect", code, mayHaveSent: true };
    if (code && TIMEOUT.has(code)) return { cls: "timeout", code, mayHaveSent: true };
    if (code && TLS.test(code)) return { cls: "tls", code, mayHaveSent: false };
    if (x.name === "TimeoutError" || x.name === "AbortError") return { cls: "timeout", code: String(x.name), mayHaveSent: true };
  }
  const msg = String((err as { message?: unknown } | null)?.message ?? "");
  if (/fetch failed|network|socket hang up|terminated/i.test(msg)) return { cls: "network", code: null, mayHaveSent: true };
  return { cls: "other", code: null, mayHaveSent: true };
}

// 다시 시도할 만한 원인인가: DNS·연결·시간 초과·네트워크, HTTP 429·502·503·504. TLS와 그 밖의 4xx는 아니다
export const retryable = (c: Cause): boolean => (c.cls === "http" ? RETRY_STATUSES.includes(c.status ?? 0) : c.cls !== "tls" && c.cls !== "other");

// 한 번 실패한 호출이 HTTP 응답일 때 던지는 오류(Retry-After를 실어 나른다)
export class HttpFailure extends Error {
  status: number;
  retryAfterMs: number | null;
  response?: unknown; // 이 실패를 만든 HTTP 응답(있으면). 호출한 쪽이 마지막에 그 응답의 본문을 읽을 수 있게
  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "HttpFailure";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// Retry-After 머리(초 또는 날짜) → ms. 모르면 null
export function retryAfterMs(h: string | null | undefined, now = Date.now()): number | null {
  if (!h) return null;
  const n = Number(h);
  if (Number.isFinite(n) && n >= 0) return Math.round(n * 1000);
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

export const BACKOFF_BASE_MS = 250;
export const BACKOFF_MAX_MS = 5_000; // Retry-After가 아무리 길어도 이 이상은 기다리지 않는다(서버 호출이 오래 매이지 않게)
// n번째 재시도(1부터)의 기다림: 250ms, 1s … (4배씩) ± 20% 지터. 429는 Retry-After가 더 길면 그것(상한 안에서)
export function backoffMs(retry: number, rand: () => number = Math.random, retryAfter: number | null = null): number {
  const base = BACKOFF_BASE_MS * 4 ** Math.max(0, retry - 1);
  const jittered = Math.round(base * (0.8 + 0.4 * rand()));
  return Math.min(BACKOFF_MAX_MS, Math.max(jittered, retryAfter ?? 0));
}

export type Outcome = "retry" | "recovered" | "gave-up";
export interface AttemptEvent {
  attempt: number; // 1부터. 이 시도의 번호
  outcome: Outcome;
  cause: Cause;
}

export interface RetryOptions {
  retries: number; // 0이면 다시 시도하지 않는다(지금과 같다)
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
  // false를 돌려주면 그 실패는 다시 시도하지 않는다(보냈는지 모르는 쓰기)
  canRetry?: (c: Cause) => boolean;
  onEvent?: (e: AttemptEvent) => void;
  // 다시 시도하기 직전에 부른다. 값을 돌려주면 그것이 결과다(이미 적용된 쓰기를 찾았다)
  beforeRetry?: (c: Cause) => Promise<unknown | undefined>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// run을 부르고, 다시 시도할 만한 네트워크 실패면 retries번까지 다시 한다. 결과는 마지막 시도의 값이나 오류.
// 시도마다 오류를 던질 뿐이라 시간 초과는 run이 정한다(각 시도가 자기 타임아웃을 가진다)
export async function withRetry<T>(run: (attempt: number) => Promise<T>, o: RetryOptions): Promise<T> {
  const sleep = o.sleep ?? realSleep;
  let failed = false;
  let lastCause: Cause | null = null;
  for (let attempt = 1; ; attempt++) {
    try {
      const v = await run(attempt);
      if (failed) o.onEvent?.({ attempt, outcome: "recovered", cause: lastCause! });
      return v;
    } catch (e) {
      const c = causeOf(e);
      lastCause = c;
      const again = attempt <= o.retries && retryable(c) && (o.canRetry ? o.canRetry(c) : true);
      o.onEvent?.({ attempt, outcome: again ? "retry" : "gave-up", cause: c });
      if (!again) throw annotate(e, c);
      failed = true;
      await sleep(backoffMs(attempt, o.rand, e instanceof HttpFailure ? e.retryAfterMs : null));
      const found = await o.beforeRetry?.(c);
      if (found !== undefined) {
        o.onEvent?.({ attempt: attempt + 1, outcome: "recovered", cause: c });
        return found as T;
      }
    }
  }
}
// 원인 종류를 오류 글에 붙인다: `fetch failed [dns ENOTFOUND]`. 이미 붙었으면 그대로. 그 밖의 오류(GraphQL 오류 등)는 건드리지 않는다
export const causeText = (c: Cause) => `${c.cls}${c.code ? ` ${c.code}` : ""}`;
function annotate(e: unknown, c: Cause): unknown {
  if (!(e instanceof Error) || e.message.endsWith("]")) return e;
  if (e instanceof HttpFailure && c.code && e.message.includes(c.code)) return e; // `HTTP 401`은 이미 상태를 말한다
  if (!(e instanceof HttpFailure) && c.code === null && !/fetch failed|terminated|socket|network/i.test(e.message)) return e;
  e.message = `${e.message} [${causeText(c)}]`;
  return e;
}

// 사람이 읽는 오류: `fetch failed (atc server → Linear) [dns ENOTFOUND]`. 구간 이름을 앞 글 뒤에 붙인다
export function hopText(message: string, hop: Hop): string {
  const m = message.replace(/\s*\((atc server → Linear|atcctl → atc server)\)/, "");
  const i = m.search(/\s\[[^\]]+\]$/);
  return i < 0 ? `${m} (${HOP_LABEL[hop]})` : `${m.slice(0, i)} (${HOP_LABEL[hop]})${m.slice(i)}`;
}

// ── 횟수 설정 ──
export const RETRY_VALUES = ["0", "1", "2", "3"] as const;
export const DEFAULT_RETRIES = 2;
// 파일의 값 → 횟수. 없거나 모르는 값이면 기본(2). 0은 지금처럼 다시 시도하지 않는다
export function parseRetries(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 3 ? n : DEFAULT_RETRIES;
}
