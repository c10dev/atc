import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { Context, MiddlewareHandler } from "hono";

// SUPERVISOR 자격(ATC-373, docs/autonomy.md 1.4·C12). 이 서버의 SUPERVISOR 전용 동작은 localhost Origin만으로는 받지 않는다:
// 같은 호스트의 어느 프로세스든 Origin 헤더는 쓸 수 있기 때문이다. 대신 SUPERVISOR의 화면(Mac의 브라우저·ANNUNCIATOR 앱)만 가진 비밀을 요구한다.
//   - 비밀은 화면이 만들어 그 기기에만 둔다(서버·호스트 어디에도 평문으로 없다). 서버는 sha256 해시만 안다.
//   - 해시는 root 소유 파일(기본 /etc/atc/supervisor.sha256, 한 줄에 하나)에 둔다. 서비스 사용자(에이전트와 같은 사용자)는 읽을 수는 있어도 쓰지 못한다.
//   - 파일이 없거나, 서비스 사용자가 쓸 수 있거나, 비어 있으면 SUPERVISOR 전용 동작은 모두 거절한다(fail-closed).
// 순수 부분(해시 대조, 허용 목록)과 파일 읽기를 나눈다. 비밀과 해시는 로그에 쓰지 않는다.

export const HEADER = "x-atc-supervisor";
export const DEFAULT_HASH_FILE = "/etc/atc/supervisor.sha256";
export const MIN_SECRET_LEN = 32;

export const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

// ── 해시 파일 ──

export type HashState =
  | { state: "ok"; hashes: string[] }
  | { state: "unpaired" } // 파일이 없거나 해시가 한 줄도 없다
  | { state: "insecure"; why: string }; // 서비스 사용자가 쓸 수 있는 파일이라 믿지 않는다

export interface FileFacts {
  text: string | null; // 못 읽으면 null
  uid: number; // 파일 소유자
  mode: number; // st_mode
}

// 순수: 파일 사실 → 상태. serviceUid는 이 서버를 돌리는 사용자, allowUserOwned는 개발용(시험 서버)
export function hashStateOf(f: FileFacts | null, o: { serviceUid: number | null; allowUserOwned?: boolean }): HashState {
  if (!f || f.text === null) return { state: "unpaired" };
  if (!o.allowUserOwned) {
    if (f.uid !== 0) return { state: "insecure", why: "the hash file is not owned by root, so a session running as the service user could rewrite it" };
    if (f.mode & 0o022) return { state: "insecure", why: "the hash file is group- or world-writable" };
  }
  const hashes = f.text.split("\n").map((l) => l.trim().toLowerCase()).filter((l) => /^[0-9a-f]{64}$/.test(l));
  return hashes.length ? { state: "ok", hashes } : { state: "unpaired" };
}

export function readHashState(file: string, o: { allowUserOwned?: boolean } = {}): HashState {
  let facts: FileFacts | null = null;
  try {
    const st = statSync(file);
    facts = { text: readFileSync(file, "utf8"), uid: st.uid, mode: st.mode };
  } catch {
    facts = null;
  }
  return hashStateOf(facts, { serviceUid: process.getuid?.() ?? null, ...o });
}

// 2초 안에서는 지난 읽기를 쓴다(요청마다 파일을 읽지 않는다). 파일이 바뀌면 곧 반영된다
let cache: { at: number; file: string; value: HashState } | null = null;
export function currentHashState(now = Date.now()): HashState {
  const file = process.env.ATC_SUPERVISOR_HASH_FILE || DEFAULT_HASH_FILE;
  if (cache && cache.file === file && now - cache.at < 2000) return cache.value;
  const value = readHashState(file, { allowUserOwned: process.env.ATC_SUPERVISOR_ALLOW_USER_FILE === "1" });
  cache = { at: now, file, value };
  return value;
}
export const resetHashCache = () => void (cache = null);

// ── 대조 ──

// 순수: 비밀이 해시 목록의 하나와 맞는가(시간이 일정하게 비교한다)
export function secretMatches(secret: string | undefined | null, hashes: readonly string[]): boolean {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LEN || secret.length > 512) return false;
  const got = Buffer.from(sha256hex(secret), "hex");
  let ok = false;
  for (const h of hashes) if (timingSafeEqual(got, Buffer.from(h, "hex"))) ok = true;
  return ok;
}

export type Verdict = "valid" | "invalid" | "missing" | "unpaired" | "insecure";
export function verdictOf(secret: string | undefined | null, st: HashState): Verdict {
  if (st.state === "unpaired") return "unpaired";
  if (st.state === "insecure") return "insecure";
  if (!secret) return "missing";
  return secretMatches(secret, st.hashes) ? "valid" : "invalid";
}

export const verdictFor = (c: Pick<Context, "req">, now = Date.now()): Verdict => verdictOf(c.req.header(HEADER), currentHashState(now));

// ── 에이전트가 쓰는 길(허용 목록) ──
// atcctl·SQUELCH가 부르는 쓰기 라우트. 이 밖의 쓰기(POST·PUT·PATCH·DELETE)는 모두 SUPERVISOR 자격이 필요하다(기본 거절).
// controller/atcctl.mjs가 부르는 쓰기는 supervisor-auth.test.ts가 이 목록과 맞는지 읽어서 확인한다. 라우트를 더하려면 그 라우트를 에이전트가 불러도 되는지 먼저 본다.
const S = "[^/]+";
const AGENT_WRITE: readonly RegExp[] = [
  /^\/api\/controller\/ack$/,
  /^\/api\/clearances$/,
  new RegExp(`^/api/clearances/${S}/(readback|roger|unable|standby|cancel|undeliverable)$`),
  new RegExp(`^/api/dispatch/proposals/${S}/(note|hold|briefing|release|accept|decline|recall-send|recalled|arrived|standby|await-supervisor|undelivered|crosscheck)$`),
  /^\/api\/dispatch\/report$/,
  new RegExp(`^/api/dispatch/standfree/${S}/arrived$`),
  /^\/api\/releases\/attest$/,
  new RegExp(`^/api/fleet/crew-changes/${S}/(send|readback|unable|standby)$`),
  /^\/api\/schedule\/(slips|routes)\/ack$/,
  /^\/api\/schedule\/wip$/,
  new RegExp(`^/api/schedule/wip/${S}/(touch|done)$`),
  /^\/api\/schedule\/ops$/,
  new RegExp(`^/api/schedule/ops/${S}/(release|crosscheck)$`),
  new RegExp(`^/api/duty/charters/${S}/seen$`),
  /^\/api\/duty\/(card|note|charter|stand|stand-done|linear)$/,
  /^\/api\/following\/ack$/,
  /^\/api\/decisions(\/default)?$/, // DECISION 카드를 올린다(ATC-352): 답은 SUPERVISOR 자격이 필요한 /answer뿐이다
  new RegExp(`^/api/decisions/${S}/(withdraw|ack)$`),
  /^\/api\/mcc\/(rts|(inspect|escalate|land)\/\d+)$/,
  new RegExp(`^/api/landing/review/${S}/\\d+$`),
  new RegExp(`^/api/relay/${S}/(issued|undeliverable)$`),
  new RegExp(`^/api/squelch/${S}$`),
  /^\/api\/exceptions$/, // 예외 판정(ATC-558): 관제 세션이 팀의 UNABLE·질문·침묵을 판정에 묻는다. 표시(/api/judges/exceptions/:id/mark)는 SUPERVISOR 자격
];

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
export const isWrite = (method: string) => !SAFE.has(method.toUpperCase());
export const isAgentRoute = (method: string, path: string) => method.toUpperCase() === "POST" && AGENT_WRITE.some((r) => r.test(path));

// 이 요청에 SUPERVISOR 자격이 필요한가: /api 아래 쓰기이고 에이전트 길이 아니다
export const needsSupervisor = (method: string, path: string) => path.startsWith("/api/") && isWrite(method) && !isAgentRoute(method, path);

// 서버 전체에 거는 문(index.ts가 어느 라우트보다 먼저 건다). 자격이 맞지 않으면 403
export function supervisorGate(now: () => number = Date.now): MiddlewareHandler {
  return async (c, next) => {
    if (!needsSupervisor(c.req.method, new URL(c.req.url).pathname)) return next();
    const v = verdictFor(c, now());
    if (v === "valid") return next();
    return c.json({ error: "SUPERVISOR credential required", reason: v }, 403);
  };
}
