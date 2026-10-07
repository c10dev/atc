import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { connect as netConnect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { config } from "./config.ts";
import { type CheckedSend, isChecked } from "./send-checks.ts";
import { isRealStateDir, realHome, underNodeTest } from "./state-guard.ts";

// SESSION SOCKET WRITER(ATC-562): atc 서버가 AIRCRAFT 세션에 글을 쓰는 단 하나의 곳. 세션 소켓에 닿는 코드는 이 파일에만 있다.
// 쓰는 것은 send-checks.ts가 만든 CheckedSend뿐이다(타입과 WeakSet). 글을 고치지 않고, 받는 세션은 보낼 때 세션 id로 다시 찾는다(ATC-353).
// 길(Claude Code 2.1.292에서 확인, docs/occ.md "Server send"): 세션 파일(<설정 폴더>/sessions/<pid>.json)의 messagingSocketPath에
// 한 연결로 두 줄을 쓴다 — {"type":"auth","token":<peerToken>} 한 줄, 그다음 봉투 {msgV:1, msg_id, type:"user", message:{role:"user", content:<cross-session-message from-name="ATC">…}, priority:"next"} 한 줄.
// peerToken은 같은 폴더의 <pid>.<sha256(소켓 경로)>.key에서 보낼 때마다 읽고 메모리에서만 쓴다: 기록·로그·오류 글에 싣지 않는다.
// Claude Code가 이 길을 바꾸면: 세션 파일의 peerProtocol이 1이 아니거나 소켓 경로 꼴이 다르면 쓰기 전에 거절하고, 쓴 뒤 대화 기록에서 msg_id가 보이지 않으면(server-send-run.ts) OCC에 넘긴다.

export const PEER_PROTOCOL = 1; // 확인한 Claude Code 세션 파일의 peerProtocol
export const SENDER_NAME = "ATC"; // 받는 세션이 보는 보낸 이(from-name). 답 주소는 글의 끝줄(ATC-169: 이름 "OCC"로 SendMessage)
const WRITE_TIMEOUT_MS = 5000;

// 세션 파일에서 쓰는 칸만(그 밖은 읽지 않는다)
export interface SessionRecord {
  pid: number;
  sessionId: string;
  name?: string;
  kind?: string; // bg | interactive
  cwd?: string;
  messagingSocketPath?: string;
  peerProtocol?: number;
  status?: string; // busy | idle (확인할 때 받는 세션이 턴 중인지)
  configDir: string; // 읽은 설정 폴더(ACCOUNT). 키 파일은 같은 폴더에 있다
}

// 설정 폴더들의 sessions/에서 그 세션 id의 파일. 없으면 null
export function findSessionRecord(sessionId: string, configDirs: readonly string[]): SessionRecord | null {
  for (const dir of configDirs) {
    let names: string[] = [];
    try {
      names = readdirSync(join(dir, "sessions"));
    } catch {
      continue;
    }
    for (const f of names) {
      if (!/^\d+\.json$/.test(f)) continue;
      try {
        const r = JSON.parse(readFileSync(join(dir, "sessions", f), "utf8")) as Record<string, unknown>;
        if (r.sessionId !== sessionId) continue;
        return {
          pid: Number(r.pid),
          sessionId,
          ...(typeof r.name === "string" ? { name: r.name } : {}),
          ...(typeof r.kind === "string" ? { kind: r.kind } : {}),
          ...(typeof r.cwd === "string" ? { cwd: r.cwd } : {}),
          ...(typeof r.messagingSocketPath === "string" ? { messagingSocketPath: r.messagingSocketPath } : {}),
          ...(typeof r.peerProtocol === "number" ? { peerProtocol: r.peerProtocol } : {}),
          ...(typeof r.status === "string" ? { status: r.status } : {}),
          configDir: dir,
        };
      } catch {}
    }
  }
  return null;
}

// ── 어느 프로세스가 쓸 수 있나(ATC-562) ──
// 운영 서버만 세션에 쓴다: 포트 7700이고 상태 폴더가 진짜 운영 폴더(~/.local/state/atc, ATC-564 isRealStateDir)이고 node --test가 아닐 때.
// 시험 서버(7702-7799, 임시 상태 폴더)와 시험은 쓰지 않는다 — 같은 기계의 진짜 세션이 ~/.claude에 보이기 때문이다.
// 예외 하나: ATC_SERVER_SEND_TEST=1을 명시한 프로세스는 cwd가 OS 임시 폴더(또는 ATC_SERVER_SEND_TEST_ROOT) 아래인 세션에만 쓴다(버리는 세션으로 하는 끝까지 확인)
export interface WriterPlace {
  port: number;
  stateDir: string;
  home: string;
  test: boolean; // node --test 아래
  env: { ATC_SERVER_SEND_TEST?: string; ATC_SERVER_SEND_TEST_ROOT?: string };
  tmp: string;
}
export const PRODUCTION_PORT = 7700;
export type WriterMode = "production" | "test-opt-in";
export function writerModeOf(w: WriterPlace): WriterMode | null {
  if (!w.test && w.port === PRODUCTION_PORT && isRealStateDir(w.stateDir, w.home)) return "production";
  if (w.env.ATC_SERVER_SEND_TEST === "1") return "test-opt-in";
  return null;
}
const under = (dir: string, root: string) => {
  const d = resolve(dir);
  const r = resolve(root);
  return d === r || d.startsWith(r + "/");
};
// 이 프로세스가 이 세션(cwd)에 써도 되나. 안 되면 사유(순수)
export function writerPlaceWhy(w: WriterPlace, targetCwd: string | null | undefined): string | null {
  const mode = writerModeOf(w);
  if (mode === "production") return null;
  if (mode === null) return `운영 서버가 아님(포트 ${w.port}, 상태 폴더 ${w.stateDir}) — 세션에 쓰지 않는다(시험 서버는 진짜 세션에 쓰지 않는다)`;
  const root = w.env.ATC_SERVER_SEND_TEST_ROOT || w.tmp;
  if (!targetCwd || !under(targetCwd, root)) return `ATC_SERVER_SEND_TEST: 받는 세션의 cwd(${targetCwd ?? "없음"})가 ${root} 아래가 아님 — 쓰지 않는다`;
  return null;
}
// 지금 이 프로세스(쓸 때마다 읽는다: 시험이 config.stateDir·환경을 바꾼다)
export const writerPlaceNow = (): WriterPlace => ({
  port: config.port,
  stateDir: config.stateDir,
  home: realHome(),
  test: underNodeTest(),
  env: { ATC_SERVER_SEND_TEST: process.env.ATC_SERVER_SEND_TEST, ATC_SERVER_SEND_TEST_ROOT: process.env.ATC_SERVER_SEND_TEST_ROOT },
  tmp: tmpdir(),
});

// 이 세션 파일로 써도 되나(순수). 안 되면 사유. 백그라운드 세션만(데스크톱·터미널 세션은 확인하지 않아 OCC 몫)
const SOCK = /^(?:\/run\/user\/\d+\/cc-socks|\/tmp\/cc-socks(?:-\d+)?)\/(\d+)\.sock$/;
export function socketTargetWhy(r: Pick<SessionRecord, "pid" | "kind" | "messagingSocketPath" | "peerProtocol">): string | null {
  if (r.kind !== "bg") return `background 세션이 아님(${r.kind ?? "kind 없음"}) — OCC가 보낸다`;
  if (r.peerProtocol !== PEER_PROTOCOL) return `세션 파일의 peerProtocol이 ${r.peerProtocol ?? "없음"}(확인한 것은 ${PEER_PROTOCOL}) — Claude Code가 바뀌었을 수 있어 쓰지 않는다`;
  const m = r.messagingSocketPath ? SOCK.exec(r.messagingSocketPath) : null;
  if (!m) return "세션 파일의 messagingSocketPath가 확인한 꼴(…/cc-socks/<pid>.sock)이 아님 — 쓰지 않는다";
  if (Number(m[1]) !== r.pid) return "소켓 경로의 pid가 세션 pid와 다름 — 쓰지 않는다";
  return null;
}

export const keyFileOf = (r: Pick<SessionRecord, "pid" | "messagingSocketPath" | "configDir">) =>
  join(r.configDir, "sessions", `${r.pid}.${createHash("sha256").update(r.messagingSocketPath ?? "").digest("hex")}.key`);

// 글 안의 봉투 태그는 Claude Code 보내는 쪽처럼 무디게 한다(글이 봉투를 닫지 못하게)
export const neutralize = (text: string) => text.replace(/<(\/?cross-session-message)/gi, "<\\$1");

// 쓰는 두 줄(순수). token이 null이면 인증 줄 없이
export function frameOf(token: string | null, text: string, msgId: string, fromName = SENDER_NAME): string {
  const content = `<cross-session-message from-name="${fromName}">\n${neutralize(text)}\n</cross-session-message>`;
  const envelope = { msgV: 1, msg_id: msgId, type: "user", message: { role: "user", content }, priority: "next" };
  return (token ? JSON.stringify({ type: "auth", token }) + "\n" : "") + JSON.stringify(envelope) + "\n";
}

export type DeliverResult =
  | { ok: true; msgId: string; pid: number; configDir: string; cwd: string | null }
  | { ok: false; stage: "unchecked" | "place" | "session" | "target" | "key" | "write"; why: string; cause: "absent" | "stale-address" | "other" };

export interface DeliverDeps {
  configDirs: readonly string[];
  place?: WriterPlace; // 시험이 바꿔 끼운다. 없으면 writerPlaceNow()
  connect?: (path: string) => Socket;
  newId?: () => string;
}

// 검사를 통과한 발송 하나를 그 세션의 소켓에 쓴다. 보낼 때 세션 id로 세션 파일을 다시 읽고, 이름이 검사한 이름과 같아야 쓴다
export async function deliverChecked(send: CheckedSend, deps: DeliverDeps): Promise<DeliverResult> {
  if (!isChecked(send)) return { ok: false, stage: "unchecked", why: "send-checks가 만든 발송이 아님 — 쓰지 않는다", cause: "other" };
  const r = findSessionRecord(send.sessionId, deps.configDirs);
  if (!r) return { ok: false, stage: "session", why: `no live session ${send.sessionId.slice(0, 8)} (${send.to}) at delivery`, cause: "absent" };
  if ((r.name ?? "") !== send.to) return { ok: false, stage: "session", why: `세션 이름이 검사 뒤 바뀜(${send.to} → ${r.name ?? "없음"}) — 쓰지 않는다`, cause: "stale-address" };
  // 운영 서버가 아니면(시험 서버·시험) 소켓을 열지 않는다. 시험 opt-in은 임시 폴더 아래 세션만
  const place = writerPlaceWhy(deps.place ?? writerPlaceNow(), r.cwd);
  if (place) return { ok: false, stage: "place", why: place, cause: "other" };
  const why = socketTargetWhy(r);
  if (why) return { ok: false, stage: "target", why, cause: "other" };
  let token: string;
  try {
    const k = JSON.parse(readFileSync(keyFileOf(r), "utf8")) as { peerToken?: unknown };
    if (typeof k.peerToken !== "string" || !/^[0-9a-f]{16,}$/i.test(k.peerToken)) throw new Error("peerToken 꼴이 아님");
    token = k.peerToken;
  } catch (e) {
    // 키 파일 내용은 오류 글에 싣지 않는다
    return { ok: false, stage: "key", why: `세션 키를 읽지 못함(${(e as NodeJS.ErrnoException).code ?? "형식"}) — 쓰지 않는다`, cause: "other" };
  }
  const msgId = (deps.newId ?? randomUUID)();
  const frame = frameOf(token, send.text, msgId);
  const open = deps.connect ?? ((path: string) => netConnect({ path }));
  const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
    let done = false;
    const finish = (e: NodeJS.ErrnoException | null) => {
      if (done) return;
      done = true;
      resolve(e);
    };
    const s = open(r.messagingSocketPath!);
    s.setTimeout(WRITE_TIMEOUT_MS, () => {
      s.destroy();
      finish(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
    });
    s.on("error", (e: NodeJS.ErrnoException) => finish(e));
    s.on("connect", () => {
      s.write(frame);
      s.end();
    });
    s.on("close", (hadError: boolean) => finish(hadError ? Object.assign(new Error("closed with error"), { code: "ECLOSED" }) : null));
  });
  if (err) {
    const code = err.code ?? "error";
    return { ok: false, stage: "write", why: `socket write failed: ${code}`, cause: code === "ENOENT" || code === "ECONNREFUSED" ? "stale-address" : "other" };
  }
  return { ok: true, msgId, pid: r.pid, configDir: r.configDir, cwd: r.cwd ?? null };
}

// 받는 세션의 대화 기록 경로(sources/claude.ts transcriptPath와 같은 이름)
export const transcriptOf = (configDir: string, cwd: string, sessionId: string) => `${join(configDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), sessionId)}.jsonl`;
