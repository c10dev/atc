// DUTY L1의 쓰기 길(D7a, docs/duty.md 3.4·3.5). 외부 부작용: git worktree를 만들고 지우며, Linear에 쓴다.
//   POST /api/duty/stand       {name}  → .claude/worktrees/duty-<name>을 origin/main에서 새 브랜치 claude/duty-<name>으로 만들고 node_modules를 하드링크한다
//   POST /api/duty/stand-done  {name}  → 그 STAND를 치운다(duty-*만, 고치던 것이 없거나 이미 머지됐을 때만)
//   POST /api/duty/linear      {action: create|update|comment, …} → Linear ATC 팀에 서버의 키로 쓴다(판정은 duty-linear.ts)
// - 부르는 것은 DUTY 세션의 atcctl뿐이다(Origin 헤더가 있으면 어느 사이트든 403: 브라우저가 이 길을 쏘지 못하게. 화면에는 이 길의 버튼이 없다). 모델은 git 명령을 만들지 않는다: 이름만 주고 서버가 돌린다
// - duty.json의 `l1`이 꺼져 있으면(기본) 세 길 모두 403이다. 운영 서버에서는 SUPERVISOR가 켜기 전까지 STAND도 Linear 쓰기도 없다
// - 한 번 부를 때마다 FLIGHT RECORDER 한 줄(`by: "DUTY"`, 본문은 적지 않는다, 거절·실패도)
import { execFile } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { forgetIssue } from "./detail-run.ts";
import { loadDutyConfig } from "./duty-config.ts";
import { DUTY_TEAM, issueVerdict, type LinearOp, parseLinearBody, resolveLabels, stateVerdict } from "./duty-linear.ts";
import { standBranch, standDoneVerdict, standNameOf, standPath, worktreePaths } from "./duty-stand.ts";
import { record } from "./recorder.ts";
import { createRelease, releaseHashOf, sectionsOf, type ReleaseLine } from "./release.ts";
import { k3DeclarationsOf } from "./k3-allow.ts";
import { workOrderCheck, workOrderRejection } from "./work-order-check.ts";
import { createDutyBlocks, createDutyComment, createDutyIssue, type CreateInput, type DutyIssueRead, type DutyTeam, fetchDutyIssue, fetchDutyTeam, fetchProjectId, updateDutyIssue, type UpdateInput } from "./sources/linear-write.ts";

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
  blocks: (blockerId: string, blockedId: string) => Promise<void>;
  forget: (key: string) => void;
  record: typeof record;
  now: () => Date;
  // REVIEW 턴(ATC-396, 선택): 서버가 시작한 턴이 도는 동안 제안은 Backlog에만(원칙 10), 열린 이슈가 이미 다루는 것은 만들지 않는다
  reviewTurn?: () => boolean;
  openSimilar?: (title: string) => Promise<string | null>; // 비슷한 열린 이슈의 key
  onProposal?: (key: string, title: string) => void;
  onWrite?: (key: string, action: "comment" | "update") => void; // REVIEW 턴이 이미 있는 이슈에 쓴 것(ATC-566)
  // 비슷한 제목 검사(ATC-488): 모든 DUTY 턴의 create에서 열린 ATC 이슈와 거의 같은 제목을 거절한다(스위치 duplicateTitle이 꺼지면 duplicateOn이 false)
  duplicateOn?: () => boolean;
  duplicateOpen?: (title: string) => Promise<{ key: string; title: string } | null>;
  // 채팅 발권(ATC-471, 선택): `create --release`. turn은 지금 도는 DUTY 턴을 시작한 SUPERVISOR 글(REVIEW 턴·턴 없음이면 null), on은 스위치 chatRelease, append는 발권 기록
  chatRelease?: { on: () => boolean; turn: () => string | null; append: (l: ReleaseLine) => void };
}

// K 효과가 있는 작업 지시서인가(ATC-471): K3 줄이 있거나 `## K effects`가 None으로 시작하지 않는다. 있으면 발권은 화면에서만
export function declaresKEffects(body: string): boolean {
  const k3 = k3DeclarationsOf(body);
  if (k3.declared.length > 0 || k3.unparsed > 0 || k3.lines > 0 || k3.none > 0) return true;
  return !/^none\b/i.test(sectionsOf(body).k);
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
  blocks: createDutyBlocks,
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
const fail = (status: Reply["status"], error: string, more: Record<string, unknown> = {}): Reply => ({ status, body: { error, ...more } });
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
      // 진짜 폴더일 때만 하드링크한다(심볼릭 링크를 그대로 복사하면 STAND가 운영의 node_modules를 가리키고 git add -A가 링크를 담는다)
      if (lstatSync(resolve(d.repo, "node_modules")).isDirectory()) {
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
    // REVIEW 턴(ATC-396): 스스로 낸 제안은 Backlog까지만. Todo는 SUPERVISOR가 RELEASE 화면에서 쏜다(원칙 10)
    const reviewing = d.reviewTurn?.() === true;
    if (reviewing && "state" in op && op.state === "Todo") return fail(403, "REVIEW 턴에는 Todo로 두지 않는다 — 제안은 Backlog에, 발권은 SUPERVISOR가 RELEASE 화면에서(원칙 10)");
    // 본문 모양(ATC-469): create와, 본문을 싣는 update만. 거절이면 Linear에 아무것도 쓰지 않는다
    const bodyText = op.action === "create" || op.action === "update" ? op.body : undefined;
    const shape = bodyText === undefined ? null : workOrderCheck(bodyText);
    if (shape && shape.errors.length) return fail(400, workOrderRejection(shape.errors));
    const shapeWarning = shape?.warnings.length ? shape.warnings.join("; ") : undefined;
    // 채팅 발권(ATC-471): 아무것도 만들기 전에 거른다. 스위치 → SUPERVISOR 글이 시작한 턴 → K 효과 순
    let releaseWords: string | null = null;
    if (op.action === "create" && op.release) {
      const refuse = (why: "switch-off" | "no-supervisor-turn" | "k-effects") => d.record({ t: d.now().toISOString(), kind: "policy", op: "chat-release", event: "refused", why, flight: null });
      if (!d.chatRelease?.on()) {
        refuse("switch-off");
        return fail(403, "채팅 발권이 꺼져 있음(설정 창 CHAT RELEASE) — 이슈는 만들지 않았다. RELEASE 화면에서 발권한다(Backlog로 만들고 SUPERVISOR가 쏜다)");
      }
      releaseWords = d.chatRelease.turn();
      if (releaseWords === null) {
        refuse("no-supervisor-turn");
        return fail(403, "--release는 SUPERVISOR 글이 시작한 DUTY 턴에서만 받는다(REVIEW 턴·턴 없음·다른 길은 안 됨) — 이슈는 만들지 않았다. Backlog로 만들고 SUPERVISOR가 RELEASE 화면에서 쏜다");
      }
      if (declaresKEffects(op.body)) {
        refuse("k-effects");
        return fail(409, "K 효과가 있는 작업 지시서는 채팅으로 발권하지 않는다 — fire this one on the RELEASE screen(Backlog로 만들어 SUPERVISOR가 화면에서 쏜다). 이슈는 만들지 않았다");
      }
    }
    if (op.action === "create") {
      if (reviewing) {
        const same = await d.openSimilar?.(op.title);
        if (same) return fail(409, `${same}가 비슷한 일을 이미 다룸 — 새로 만들지 않는다(필요하면 ${same}에 댓글로 근거를 더한다)`);
      }
      // 비슷한 제목(ATC-488): REVIEW 턴이 아닌 모든 DUTY 턴에서도. 명시한 --same-title-ok면 넘기고 세어 둔다. 취소·중복·끝난 이슈는 세지 않는다
      let override: string | null = null;
      if (!reviewing && d.duplicateOn?.() !== false && d.duplicateOpen) {
        const twin = await d.duplicateOpen(op.title);
        if (twin && !op.sameTitleOk) {
          d.record({ t: d.now().toISOString(), kind: "policy", op: "duplicate-title", event: "refused", flight: null, of: twin.key });
          return fail(409, `${twin.key}(${twin.title.slice(0, 80)})와 제목이 거의 같음 — 새로 만들지 않는다(같은 일이면 ${twin.key}에 댓글로 더한다. 일부러 비슷하게 만든다면 --same-title-ok)`, { existing: twin.key });
        }
        if (twin) override = twin.key;
      }
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
      // 막는 FLIGHT는 만들기 전에 읽어 둔다: 없는 key로 이슈만 남는 일이 없게
      const blockers: { id: string; key: string }[] = [];
      for (const k of op.blockedBy ?? []) {
        const b = await d.issue(k);
        if (!b) return fail(404, `blockedBy ${k}를 찾을 수 없음`);
        const v = issueVerdict(b);
        if (!v.ok) return fail(v.status, v.error);
        blockers.push({ id: b.id, key: b.key });
      }
      const r = await d.create(input);
      let blockedBy: string[] = [];
      let blockNote: string | undefined;
      if (blockers.length) {
        // 이슈는 이미 만들어졌다. 관계가 실패해도 이슈를 지우지 않고(지우지 못한다) 알린다
        const made = await d.issue(r.key);
        try {
          if (!made) throw new Error(`${r.key}를 다시 읽지 못함`);
          for (const b of blockers) await d.blocks(b.id, made.id);
          blockedBy = blockers.map((b) => b.key);
        } catch (e) {
          blockNote = `이슈 ${r.key}는 만들었지만 막는 관계를 걸지 못함: ${msgOf(e)}`;
        }
      }
      // 채팅 발권(ATC-471): 이슈가 만들어진 뒤에 적는다. 해시는 Linear가 저장한 본문을 다시 읽어서(스냅숏이 읽는 것과 같다. DUTY가 보낸 본문의 해시는 이스케이프 때문에 달라 곧바로 stale로 읽힌다).
      // 다시 읽지 못하면 발권을 적지 않는다: 이슈는 Todo로 남고 SUPERVISOR가 화면에서 쏜다
      let released = false;
      let releaseNote: string | undefined;
      if (op.release && releaseWords !== null) {
        try {
          const stored = (await d.issue(r.key))?.description;
          const line = createRelease(r.key, stored, releaseWords, d.now());
          if (!line.ok) throw new Error(line.error);
          d.chatRelease!.append(line.value);
          released = true;
        } catch (e) {
          releaseNote = `이슈 ${r.key}는 만들었지만 발권을 적지 못함: ${msgOf(e)} — RELEASE 화면에서 발권한다`;
        }
      }
      if (override) d.record({ t: d.now().toISOString(), kind: "policy", op: "duplicate-title", event: "override", flight: r.key, of: override });
      if (reviewing) d.onProposal?.(r.key, op.title);
      return { status: 200, body: { ok: true, key: r.key, url: r.url, state: op.state, ...(blockedBy.length ? { blockedBy } : {}), ...(op.release ? { released } : {}), ...(blockNote || releaseNote || shapeWarning ? { warning: [blockNote, releaseNote, shapeWarning].filter(Boolean).join("; ") } : {}) } };
    }
    const issue = await d.issue(op.key);
    if (!issue) return fail(404, `${op.key}를 찾을 수 없음`);
    const v = issueVerdict(issue);
    if (!v.ok) return fail(v.status, v.error);
    if (op.action === "comment") {
      await d.comment(issue.id, op.body);
      if (reviewing) d.onWrite?.(issue.key, "comment");
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
    if (reviewing) d.onWrite?.(r.key, "update");
    return { status: 200, body: { ok: true, key: r.key, state: r.state, ...(shapeWarning ? { warning: shapeWarning } : {}) } };
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
