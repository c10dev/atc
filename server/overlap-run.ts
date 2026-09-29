import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classOf } from "./crew.ts";
import { DONE_STATES, candidateTeamsOf, isCandidateTicket, loadDispatchConfig, type FilesInFlight } from "./dispatch.ts";
import { type Holder, pathsOfBody } from "./overlap.ts";
import { regKey } from "./registration.ts";
import type { Snapshot, Ticket } from "./model.ts";
import { readGithub } from "./sources/github.ts";
import { fetchIssueDetail } from "./sources/linear.ts";

// 파일 겹침(ATC-71)의 입출력: STAND(워크트리)의 바뀐 파일(읽기 전용 git), 열린 PR의 파일(github.ts가 head별로 캐시), 이슈 본문(Linear).
// DISPATCH 주기(5분)에만 갱신하고, planner는 캐시를 동기로 읽는다. 계산은 overlap.ts.

const run = promisify(execFile);
const git = async (cwd: string, args: string[]) =>
  (await run("git", ["-C", cwd, ...args], { timeout: 15_000, maxBuffer: 8 << 20, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } })).stdout;
const lines = (out: string) => out.split("\n").map((l) => l.trim()).filter(Boolean);

// STAND의 커밋된 변경: `head@merge-base`별 캐시(head가 바뀔 때만 다시 읽는다)
const committed = new Map<string, string[]>();
let holders: Holder[] = [];
const bodies = new Map<string, { text: string | null; at: number; updatedAt: string | null }>();
let pending: Promise<void> | null = null;

const BODY_TTL_MS = 30 * 60_000;
const BODY_MAX_PER_CYCLE = 8; // Linear를 한 주기에 이만큼만 더 읽는다

// `git status --porcelain` 줄에서 경로: "R  a -> b"는 b, 따옴표는 벗긴다
export function statusPaths(out: string): string[] {
  return out.split("\n").filter((l) => l.length > 3).map((l) => l.slice(3).split(" -> ").pop()!.replace(/^"|"$/g, ""));
}

export async function standFiles(path: string, base: string): Promise<string[] | null> {
  try {
    let mb = "";
    for (const ref of [`origin/${base}`, base]) {
      try {
        mb = (await git(path, ["merge-base", "HEAD", ref])).trim();
        if (mb) break;
      } catch {}
    }
    if (!mb) return null;
    const head = (await git(path, ["rev-parse", "HEAD"])).trim();
    const key = `${path}@${head}@${mb}`;
    let done = committed.get(key);
    if (!done) {
      done = lines(await git(path, ["diff", "--name-only", mb, "HEAD"]));
      committed.set(key, done);
    }
    return [...new Set([...done, ...statusPaths(await git(path, ["status", "--porcelain=v1", "-uall"]))])];
  } catch {
    return null; // 읽지 못하면 이 STAND는 겹침에 넣지 않는다(막지 않는 쪽)
  }
}

export async function refreshOverlap(s: Snapshot, now = Date.now()): Promise<void> {
  if (pending) return pending;
  pending = doRefresh(s, now).catch(() => {}).finally(() => (pending = null));
  return pending;
}

async function doRefresh(s: Snapshot, now: number) {
  const cfg = loadDispatchConfig();
  const byKey = new Map(s.tickets.map((t) => [t.key, t]));
  const gh = readGithub(s.airports.map((a) => a.repo));
  const codeOf = (repo: string) => s.airports.find((a) => a.repo === repo)?.code ?? null;
  const nameOf = new Map(s.sessions.filter((x) => x.status !== "dead").map((x) => [x.id, x.name]));
  const teamRe = new RegExp(cfg.teamPattern, "i");
  const teamAt = (path: string | null) => {
    const c = s.claims.find((x) => x.state === "active" && x.workspacePath === path && nameOf.has(x.sessionId) && teamRe.test(nameOf.get(x.sessionId)!));
    return c ? regKey(nameOf.get(c.sessionId), cfg.teamPattern) : null;
  };
  const open = (k: string) => {
    const t = byKey.get(k);
    return !t || !DONE_STATES.has(t.stateType);
  };
  const next = new Map<string, Holder>();
  const holderOf = (flight: string, repo: string): Holder => {
    let h = next.get(flight);
    if (!h) {
      const t = byKey.get(flight);
      h = { flight, team: null, airport: codeOf(repo), wake: t ? classOf(t.labels).wake : "M", files: new Map() };
      next.set(flight, h);
    }
    return h;
  };
  // AIRBORNE·HOLDING FLIGHT의 STAND(활성 점유가 있는 워크트리)
  for (const w of s.workspaces) {
    if (w.isMain || !w.ticketKey || !open(w.ticketKey)) continue;
    const team = teamAt(w.path);
    if (!team) continue;
    const files = await standFiles(w.path, gh.defaultByRepo.get(w.repo) ?? "main");
    if (!files) continue;
    const h = holderOf(w.ticketKey, w.repo);
    h.team = team;
    for (const f of files) h.files.set(f, "STAND");
  }
  // 열린 PR(팀 FLIGHT의 것): github.ts가 head별로 읽어 둔 파일 목록
  for (const [repo, pulls] of gh.byRepo) {
    for (const p of pulls) {
      const key = p.headRefName.match(/[A-Za-z][A-Za-z0-9]*-\d+/)?.[0]?.toUpperCase();
      const pr = s.pulls?.find((x) => x.repo === repo && x.number === p.number);
      const flight = pr?.ticketKey ?? key;
      if (!flight || !p.changed || !open(flight)) continue;
      const h = holderOf(flight, repo);
      h.team ??= teamAt(pr?.standPath ?? null);
      for (const f of p.changed) if (!h.files.has(f)) h.files.set(f, `PR #${p.number}`);
    }
  }
  holders = [...next.values()].filter((h) => h.files.size);

  // 이슈 본문: 곧 배정할 FLIGHT와 그것에 연결된 FLIGHT. 바뀌었거나 30분이 지난 것만, 한 주기에 몇 건만
  const teams = candidateTeamsOf(cfg);
  const wanted = new Set<string>();
  for (const t of s.tickets) {
    if (t.stateType !== "unstarted" || !isCandidateTicket(t, teams)) continue;
    for (const k of [t.key, ...t.related, ...t.blocks, ...t.blockedBy]) wanted.add(k);
  }
  const stale = (t: Ticket | undefined, k: string) => {
    const b = bodies.get(k);
    return !b || now - b.at > BODY_TTL_MS || (t?.updatedAt ?? null) !== b.updatedAt;
  };
  let budget = BODY_MAX_PER_CYCLE;
  for (const k of wanted) {
    if (budget <= 0) break;
    const t = byKey.get(k);
    if (!stale(t, k)) continue;
    budget--;
    try {
      const d = (await fetchIssueDetail(k)) as { description?: unknown };
      bodies.set(k, { text: typeof d.description === "string" ? d.description : null, at: now, updatedAt: t?.updatedAt ?? null });
    } catch {
      bodies.set(k, { text: bodies.get(k)?.text ?? null, at: now, updatedAt: t?.updatedAt ?? null }); // 못 읽으면 다음 TTL까지 쉰다
    }
  }
  for (const k of [...bodies.keys()]) if (!wanted.has(k)) bodies.delete(k);
  for (const k of [...committed.keys()]) if (!s.workspaces.some((w) => k.startsWith(`${w.path}@`))) committed.delete(k);
}

// planner 입력(캐시 그대로). 아직 못 읽은 것은 비어 있다: 처음 한 바퀴는 겹침을 모른 채 배정한다
export function filesInFlight(): FilesInFlight {
  return { holders, bodies: new Map([...bodies].map(([k, v]) => [k, v.text])) };
}

// 본문에서 예측한 경로가 있는 FLIGHT 수(진단용)
export const predictedCount = () => [...bodies.values()].filter((b) => pathsOfBody(b.text).length).length;
