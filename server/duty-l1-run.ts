// DUTY L1의 쓰기 길(D7a, docs/duty.md 3.4·3.5). 외부 부작용: git worktree를 만들고 지우며, Linear에 쓴다.
//   POST /api/duty/stand       {name}  → .claude/worktrees/duty-<name>을 origin/main에서 새 브랜치 claude/duty-<name>으로 만들고 node_modules를 하드링크한다
//   POST /api/duty/stand-done  {name}  → 그 STAND를 치운다(duty-*만, 고치던 것이 없거나 이미 머지됐을 때만)
//   POST /api/duty/linear      {action: create|update|comment, …} → Linear ATC 팀에 서버의 키로 쓴다(판정은 duty-linear.ts)
// - 부르는 것은 DUTY 세션의 atcctl뿐이다(Origin 헤더가 있으면 어느 사이트든 403: 브라우저가 이 길을 쏘지 못하게. 화면에는 이 길의 버튼이 없다). 모델은 git 명령을 만들지 않는다: 이름만 주고 서버가 돌린다
// - duty.json의 `l1`이 꺼져 있으면(기본) 세 길 모두 403이다. 운영 서버에서는 SUPERVISOR가 켜기 전까지 STAND도 Linear 쓰기도 없다
// - 한 번 부를 때마다 FLIGHT RECORDER 한 줄(`by: "DUTY"`, 본문은 적지 않는다, 거절·실패도)
import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { forgetIssue } from "./detail-run.ts";
import { loadDutyConfig } from "./duty-config.ts";
import { DUTY_TEAM, issueVerdict, type LinearOp, parseLinearBody, resolveLabels, stateVerdict } from "./duty-linear.ts";
import { standBranch, standDoneVerdict, standNameOf, standPath, worktreePaths } from "./duty-stand.ts";
import { record } from "./recorder.ts";
import { createDutyComment, createDutyIssue, type CreateInput, type DutyIssueRead, type DutyTeam, fetchDutyIssue, fetchDutyTeam, fetchProjectId, updateDutyIssue, type UpdateInput } from "./sources/linear-write.ts";

const run = promisify(execFile);
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface L1Deps {
  repo: string;
  enabled: () => boolean;
  git: (args: string[]) => Promise<string>; // git -C <repo> …(실패하면 던진다. e.code가 종료 코드)
  linkModules: (from: string, to: string) => Promise<void>; // cp -al
  team: () => Promise<DutyTeam | null>;
  issue: (key: string) => Promise<DutyIssueRead | null>;
  projectId: (name: string) => Promise<string | null>;
  create: (i: CreateInput) => Promise<{ key: string; url: string }>;
  update: (id: string, i: UpdateInput) => Promise<{ key: string; state: string }>;
  comment: (issueId: string, body: string) => Promise<{ id: string }>;
  forget: (key: string) => void;
  record: typeof record;
  now: () => Date;
}

const repoGit = (repo: string) => async (args: string[]) => (await run("git", ["-C", repo, ...args], { timeout: 60_000, maxBuffer: 4 << 20 })).stdout;
export const defaultL1Deps: L1Deps = {
  repo: REPO,
  enabled: () => loadDutyConfig().l1,
  git: repoGit(REPO),
  linkModules: async (from, to) => void (await run("cp", ["-al", from, to], { timeout: 120_000 })),
  team: () => fetchDutyTeam(DUTY_TEAM),
  issue: fetchDutyIssue,
  projectId: fetchProjectId,
  create: createDutyIssue,
  update: updateDutyIssue,
  comment: createDutyComment,
  forget: forgetIssue,
  record,
  now: () => new Date(),
};

// STAND를 만들고 지우는 일은 한 줄로 세운다(같은 이름·같은 저장소 잠금 경합을 막는다)
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => {
  const next = chain.then(f, f);
  chain = next.catch(() => {});
  return next;
};

export type Reply = { status: 200 | 400 | 403 | 404 | 409 | 502 | 503; body: Record<string, unknown> };
const fail = (status: Reply["status"], error: string): Reply => ({ status, body: { error } });
const msgOf = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0].slice(0, 300);

// ── STAND ──
export async function makeStand(d: L1Deps, raw: unknown): Promise<Reply> {
  const n = standNameOf(raw);
  if (!n.ok) return fail(400, n.error);
  const path = standPath(d.repo, n.name);
  const branch = standBranch(n.name);
  return serial(async () => {
    if (existsSync(path)) return fail(409, `이미 있음: ${path} — 이어서 쓰거나 stand-done 뒤에 다른 이름으로`);
    try {
      await d.git(["fetch", "-q", "origin"]);
      await d.git(["worktree", "add", "--no-track", path, "-b", branch, "origin/main"]);
    } catch (e) {
      return fail(502, `STAND를 만들지 못함: ${msgOf(e)}`);
    }
    let modules = false;
    try {
      if (existsSync(resolve(d.repo, "node_modules"))) {
        await d.linkModules(resolve(d.repo, "node_modules"), resolve(path, "node_modules"));
        modules = true;
      }
    } catch {
      // node_modules 없이도 문서는 쓴다
    }
    return { status: 200, body: { ok: true, name: n.name, path, branch, base: "origin/main", nodeModules: modules } };
  });
}

export async function finishStand(d: L1Deps, raw: unknown): Promise<Reply> {
  const n = standNameOf(raw);
  if (!n.ok) return fail(400, n.error);
  const path = standPath(d.repo, n.name);
  const branch = standBranch(n.name);
  return serial(async () => {
    try {
      const registered = worktreePaths(await d.git(["worktree", "list", "--porcelain"])).some((p) => {
        try {
          return realpathSync(p) === realpathSync(path);
        } catch {
          return p === path;
        }
      });
      if (!registered) return standDoneVerdictReply(false, false, false);
      const dirty = (await d.git(["-C", path, "status", "--porcelain"])).trim() !== "";
      // 머지됨 = 푸시한 적이 있는 브랜치(origin/<브랜치>가 있다)의 끝이 origin/main 안에 있다. 푸시한 적 없는 새 브랜치는 늘 main의 조상이라 "머지됨"이 아니다
      await d.git(["fetch", "-q", "origin"]).catch(() => "");
      const remote = `refs/remotes/origin/${branch}`;
      const merged = await d
        .git(["rev-parse", "--verify", "-q", remote])
        .then(() => d.git(["merge-base", "--is-ancestor", remote, "origin/main"]))
        .then(() => true)
        .catch(() => false);
      const v = standDoneVerdictReply(true, dirty, merged);
      if (v.status !== 200) return v;
      await d.git(["worktree", "remove", ...(dirty ? ["--force"] : []), path]);
      return { status: 200, body: { ok: true, name: n.name, removed: path, branchKept: branch } };
    } catch (e) {
      return fail(502, `STAND를 치우지 못함: ${msgOf(e)}`);
    }
  });
}
function standDoneVerdictReply(registered: boolean, dirty: boolean, merged: boolean): Reply {
  const v = standDoneVerdict({ registered, dirty, merged });
  return v.ok ? { status: 200, body: {} } : fail(v.status, v.error);
}

// ── Linear ──
export async function writeLinear(d: L1Deps, op: LinearOp): Promise<Reply> {
  try {
    if (op.action === "create") {
      const team = await d.team();
      if (!team) return fail(502, `Linear에 ${DUTY_TEAM} 팀이 없음`);
      const to = team.states.find((s) => s.name === op.state && (s.type === "backlog" || s.type === "unstarted"));
      if (!to) return fail(400, `${DUTY_TEAM} 팀에 ${op.state} 상태가 없음`);
      const labels = resolveLabels(op.labels, team.labels);
      if (labels.missing.length) return fail(400, `없는 라벨: ${labels.missing.join(", ")} (새 라벨은 만들지 않는다)`);
      const input: CreateInput = { teamId: team.id, title: op.title, description: op.body, priority: op.priority, stateId: to.id, labelIds: labels.ids };
      if (op.parent) {
        const p = await d.issue(op.parent);
        if (!p) return fail(404, `parent ${op.parent}를 찾을 수 없음`);
        const v = issueVerdict(p);
        if (!v.ok) return fail(v.status, v.error);
        input.parentId = p.id;
      }
      if (op.project) {
        const id = await d.projectId(op.project);
        if (!id) return fail(400, `없는 프로젝트: ${op.project}`);
        input.projectId = id;
      }
      const r = await d.create(input);
      return { status: 200, body: { ok: true, key: r.key, url: r.url, state: op.state } };
    }
    const issue = await d.issue(op.key);
    if (!issue) return fail(404, `${op.key}를 찾을 수 없음`);
    const v = issueVerdict(issue);
    if (!v.ok) return fail(v.status, v.error);
    if (op.action === "comment") {
      await d.comment(issue.id, op.body);
      return { status: 200, body: { ok: true, key: issue.key } };
    }
    const input: UpdateInput = {};
    if (op.title !== undefined) input.title = op.title;
    if (op.body !== undefined) input.description = op.body;
    if (op.priority !== undefined) input.priority = op.priority;
    if (op.state !== undefined) {
      const s = stateVerdict(issue.state, op.state, issue.states);
      if (!s.ok) return fail(s.status, s.error);
      input.stateId = s.stateId;
    }
    if (op.labels !== undefined) {
      const team = await d.team();
      if (!team) return fail(502, `Linear에 ${DUTY_TEAM} 팀이 없음`);
      const labels = resolveLabels(op.labels, team.labels);
      if (labels.missing.length) return fail(400, `없는 라벨: ${labels.missing.join(", ")} (새 라벨은 만들지 않는다)`);
      input.labelIds = [...new Set([...issue.labels.map((l) => l.id), ...labels.ids])]; // 더하기만 한다(있는 라벨을 떼지 않는다)
    }
    const r = await d.update(issue.id, input);
    return { status: 200, body: { ok: true, key: r.key, state: r.state } };
  } catch (e) {
    const m = msgOf(e);
    return fail(/미연결/.test(m) ? 503 : 502, m);
  }
}

export function mountDutyL1(app: Hono, d: L1Deps = defaultL1Deps) {
  // 공통: Origin 검사 → 스위치 → 본문. 기록은 결과가 나온 뒤 한 줄
  const route = (path: string, op: "stand" | "stand-done" | "linear", handle: (body: unknown) => Promise<{ reply: Reply; line: Record<string, unknown> }>) =>
    app.post(path, async (c) => {
      if (c.req.header("origin") !== undefined) return c.json({ error: "브라우저 요청은 받지 않는다 — DUTY 세션의 atcctl만" }, 403); // atcctl은 Origin을 보내지 않는다
      if (!d.enabled()) return c.json({ error: "DUTY L1이 꺼져 있음(duty.json의 l1, SUPERVISOR가 켠다)" }, 403);
      const body = await c.req.json().catch(() => null);
      const { reply, line } = await handle(body);
      d.record({ t: d.now().toISOString(), kind: "duty", op, by: "DUTY", ok: reply.status === 200, ...line, ...(reply.status === 200 ? {} : { error: String(reply.body.error ?? "") }) } as Parameters<typeof record>[0]);
      return c.json(reply.body, reply.status);
    });

  const nameOf = (b: unknown) => (b && typeof b === "object" ? (b as { name?: unknown }).name : undefined);
  route("/api/duty/stand", "stand", async (b) => ({ reply: await makeStand(d, nameOf(b)), line: { name: String(nameOf(b) ?? "").slice(0, 60) } }));
  route("/api/duty/stand-done", "stand-done", async (b) => ({ reply: await finishStand(d, nameOf(b)), line: { name: String(nameOf(b) ?? "").slice(0, 60) } }));
  route("/api/duty/linear", "linear", async (b) => {
    const p = parseLinearBody(b);
    if (!p.ok) return { reply: fail(400, p.error), line: {} };
    const reply = await writeLinear(d, p.op);
    const key = p.op.action === "create" ? (reply.body.key as string | undefined) : p.op.key;
    if (reply.status === 200 && key) d.forget(key);
    return { reply, line: { action: p.op.action, ...(key ? { key } : {}), ...(reply.status === 200 && reply.body.state ? { state: String(reply.body.state) } : {}) } };
  });
}
