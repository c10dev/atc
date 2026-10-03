import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { defaultL1Deps, finishStand, type L1Deps, makeStand, mountDutyL1, writeLinear } from "./duty-l1-run.ts";
import type { RecordLine } from "./recorder.ts";

const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });

// 시험 저장소: 로컬 bare origin과 그 복제본(scratch clone). GitHub에도 Linear에도 닿지 않는다
function scratch() {
  const root = mkdtempSync(join(tmpdir(), "duty-l1-"));
  const bare = join(root, "origin.git");
  const repo = join(root, "clone");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  execFileSync("git", ["clone", "-q", bare, repo]);
  writeFileSync(join(repo, "README.md"), "hi\n");
  mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(repo, "node_modules", "pkg", "index.js"), "1");
  writeFileSync(join(repo, ".gitignore"), "node_modules\n.claude/worktrees\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "init");
  sh(repo, "branch", "-M", "main");
  sh(repo, "push", "-q", "-u", "origin", "main");
  return { root, bare, repo, done: () => rmSync(root, { recursive: true, force: true }) };
}

const gitDep = (repo: string) => async (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
function deps(repo: string, over: Partial<L1Deps> = {}): { d: L1Deps; lines: RecordLine[] } {
  const lines: RecordLine[] = [];
  const d: L1Deps = {
    ...defaultL1Deps,
    repo,
    enabled: () => true,
    git: gitDep(repo),
    linkModules: async (from, to) => void execFileSync("cp", ["-al", from, to]),
    record: ((l: RecordLine) => void lines.push(l)) as L1Deps["record"],
    now: () => new Date("2026-10-01T00:00:00Z"),
    forget: () => {},
    ...over,
  };
  return { d, lines };
}

test("STAND: origin/main에서 새 브랜치 claude/duty-<이름>, node_modules 하드링크, 같은 이름은 409", async () => {
  const s = scratch();
  try {
    const { d } = deps(s.repo);
    const r = await makeStand(d, "charter-desk");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const path = join(s.repo, ".claude", "worktrees", "duty-charter-desk");
    assert.deepEqual(r.body, { ok: true, name: "charter-desk", path, branch: "claude/duty-charter-desk", base: "origin/main", nodeModules: true });
    assert.equal(readFileSync(join(path, "README.md"), "utf8"), "hi\n");
    assert.equal(sh(path, "rev-parse", "--abbrev-ref", "HEAD").trim(), "claude/duty-charter-desk");
    assert.equal(sh(path, "rev-parse", "HEAD").trim(), sh(s.repo, "rev-parse", "origin/main").trim());
    assert.throws(() => sh(path, "rev-parse", "--abbrev-ref", "@{upstream}"), "upstream을 origin/main으로 잡지 않는다(--no-track)");
    assert.ok(existsSync(join(path, "node_modules", "pkg", "index.js")));
    const again = await makeStand(d, "charter-desk");
    assert.equal(again.status, 409);
    for (const bad of ["", "A", "a/b", "../x", "atc-1", undefined, 5]) assert.equal((await makeStand(d, bad)).status, 400, String(bad));
  } finally {
    s.done();
  }
});

test("STAND: 문서를 쓰고 커밋해 로컬 bare origin에 푸시할 수 있다(GitHub에 닿지 않는다)", async () => {
  const s = scratch();
  try {
    const { d } = deps(s.repo);
    await makeStand(d, "topic");
    const path = join(s.repo, ".claude", "worktrees", "duty-topic");
    writeFileSync(join(path, "docs-topic.md"), "# Topic\n");
    sh(path, "add", "-A");
    sh(path, "commit", "-q", "-m", "Add topic design draft");
    sh(path, "push", "-q", "-u", "origin", "claude/duty-topic");
    assert.match(execFileSync("git", ["-C", s.bare, "branch", "--list", "claude/duty-topic"], { encoding: "utf8" }), /claude\/duty-topic/);
    assert.equal(execFileSync("git", ["-C", s.bare, "show", "claude/duty-topic:docs-topic.md"], { encoding: "utf8" }), "# Topic\n");
  } finally {
    s.done();
  }
});

test("STAND: node_modules가 심볼릭 링크면 링크하지 않는다(STAND가 운영의 node_modules를 가리키지 않게)", async () => {
  const s = scratch();
  try {
    const { d } = deps(s.repo);
    rmSync(join(s.repo, "node_modules"), { recursive: true });
    symlinkSync(tmpdir(), join(s.repo, "node_modules"));
    const r = await makeStand(d, "nolink");
    assert.equal(r.status, 200);
    assert.equal((r.body as { nodeModules: boolean }).nodeModules, false);
    assert.equal(existsSync(join(s.repo, ".claude", "worktrees", "duty-nolink", "node_modules")), false);
  } finally {
    s.done();
  }
});

test("stand-done: 깨끗하면 치우고(브랜치는 남긴다), 고치던 것이 있고 머지 전이면 409, 없는 STAND는 404", async () => {
  const s = scratch();
  try {
    const { d } = deps(s.repo);
    await makeStand(d, "a");
    await makeStand(d, "b");
    const pa = join(s.repo, ".claude", "worktrees", "duty-a");
    const pb = join(s.repo, ".claude", "worktrees", "duty-b");
    writeFileSync(join(pb, "wip.md"), "x");
    const dirty = await finishStand(d, "b");
    assert.equal(dirty.status, 409);
    assert.ok(existsSync(pb), "고치던 것이 있으면 치우지 않는다");
    const ok = await finishStand(d, "a");
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(existsSync(pa), false);
    assert.match(sh(s.repo, "branch", "--list", "claude/duty-a"), /claude\/duty-a/, "브랜치는 남는다");
    assert.equal((await finishStand(d, "a")).status, 404);
    assert.equal((await finishStand(d, "never")).status, 404);
    assert.equal((await finishStand(d, "../x")).status, 400);
    // 같은 폴더가 있어도 STAND로 등록돼 있지 않으면 치우지 않는다(다른 것을 지우지 않는다)
    const fake = join(s.repo, ".claude", "worktrees", "duty-fake");
    mkdirSync(fake, { recursive: true });
    writeFileSync(join(fake, "keep.md"), "x");
    assert.equal((await finishStand(d, "fake")).status, 404);
    assert.ok(existsSync(join(fake, "keep.md")));
    // 이미 머지된 브랜치면 남은 변경이 있어도 치운다
    sh(pb, "add", "-A");
    sh(pb, "commit", "-q", "-m", "wip");
    sh(pb, "push", "-q", "-u", "origin", "claude/duty-b");
    sh(s.repo, "push", "-q", "origin", "claude/duty-b:main");
    writeFileSync(join(pb, "left.md"), "y");
    sh(s.repo, "fetch", "-q", "origin");
    assert.equal((await finishStand(d, "b")).status, 200);
    assert.equal(existsSync(pb), false);
  } finally {
    s.done();
  }
});

test("stand-done은 duty-* 밖의 워크트리를 치우지 않는다", async () => {
  const s = scratch();
  try {
    const { d } = deps(s.repo);
    const team = join(s.repo, ".claude", "worktrees", "atc-1-x");
    sh(s.repo, "worktree", "add", "-q", team, "-b", "worktree-atc-1-x", "origin/main");
    for (const name of ["atc-1-x", "1-x", "x"]) assert.notEqual((await finishStand(d, name)).status, 200, name);
    assert.ok(existsSync(team));
  } finally {
    s.done();
  }
});

// ── 길(라우트) ──
const post = (app: Hono, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

function fake(over: Partial<L1Deps> = {}) {
  const calls: unknown[][] = [];
  const s = { id: "sid", name: "", type: "" };
  void s;
  const issue = { id: "i1", key: "ATC-7", team: "ATC", state: { name: "Todo", type: "unstarted" }, labels: [{ id: "L0", name: "old" }], states: [{ id: "sb", name: "Backlog", type: "backlog" }, { id: "st", name: "Todo", type: "unstarted" }, { id: "ss", name: "In Progress", type: "started" }] };
  const o: Partial<L1Deps> = {
    team: async () => ({ id: "T", states: issue.states, labels: [{ id: "L1", name: "rating:SEC" }, { id: "L2", name: "wake:J" }] }),
    issue: async (k) => (k === "ATC-7" ? issue : k === "VOC-1" ? { ...issue, id: "v", key: "VOC-1", team: "VOC" } : k === "ATC-8" ? { ...issue, id: "i8", key: "ATC-8", state: { name: "In Progress", type: "started" } } : null),
    projectId: async (n) => (n === "DUTY" ? "P1" : null),
    create: async (i) => (calls.push(["create", i]), { key: "ATC-99", url: "https://linear.app/x/ATC-99" }),
    update: async (id, i) => (calls.push(["update", id, i]), { key: "ATC-7", state: "Todo" }),
    comment: async (id, b) => (calls.push(["comment", id, b]), { id: "c1" }),
    ...over,
  };
  return { o, calls };
}

test("길: l1이 꺼져 있으면 세 길 모두 403이고 아무것도 하지 않는다(운영 기본)", async () => {
  const s = scratch();
  try {
    const app = new Hono();
    const { calls, o } = fake();
    const { d, lines } = deps(s.repo, { ...o, enabled: () => false });
    mountDutyL1(app, d);
    for (const [path, body] of [["/api/duty/stand", { name: "x" }], ["/api/duty/stand-done", { name: "x" }], ["/api/duty/linear", { action: "comment", key: "ATC-7", body: "x" }]] as const) {
      const r = await post(app, path, body);
      assert.equal(r.status, 403, path);
      assert.match(((await r.json()) as { error: string }).error, /L1이 꺼져 있음/);
    }
    assert.equal(calls.length, 0);
    assert.equal(existsSync(join(s.repo, ".claude", "worktrees", "duty-x")), false);
    assert.equal(lines.length, 0, "꺼져 있을 때는 기록도 없다");
  } finally {
    s.done();
  }
});

test("길: Origin 헤더가 있는 요청(브라우저)은 어느 사이트든 403, atcctl(Origin 없음)만 받는다", async () => {
  const s = scratch();
  try {
    const app = new Hono();
    const { calls, o } = fake();
    const { d } = deps(s.repo, o);
    mountDutyL1(app, d);
    for (const origin of ["http://evil.example", "http://localhost:7700", "http://127.0.0.1:7700", "null", ""]) {
      const r = await post(app, "/api/duty/linear", { action: "comment", key: "ATC-7", body: "x" }, { origin });
      assert.equal(r.status, 403, origin);
    }
    assert.equal(calls.length, 0);
    assert.equal((await post(app, "/api/duty/linear", { action: "comment", key: "ATC-7", body: "x" })).status, 200);
    assert.equal(calls.length, 1);
  } finally {
    s.done();
  }
});

test("길: Linear create — priority 필수·상태 Backlog/Todo·없는 라벨·프로젝트는 거절, 성공하면 한 줄 기록(본문 없음)", async () => {
  const s = scratch();
  try {
    const app = new Hono();
    const { calls, o } = fake();
    const { d, lines } = deps(s.repo, o);
    mountDutyL1(app, d);
    const good = { action: "create", title: "Work order", body: "## Goal\nSecret body text\n\n## Done when\nx\n\n## K effects\nNone\n\n## Measure\nNone", priority: 2, state: "Todo", parent: "ATC-7", project: "DUTY", labels: ["RATING:SEC"] };
    const r = await post(app, "/api/duty/linear", good);
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    assert.deepEqual(await r.json(), { ok: true, key: "ATC-99", url: "https://linear.app/x/ATC-99", state: "Todo" });
    assert.deepEqual(calls[0], ["create", { teamId: "T", title: "Work order", description: "## Goal\nSecret body text\n\n## Done when\nx\n\n## K effects\nNone\n\n## Measure\nNone", priority: 2, stateId: "st", labelIds: ["L1"], parentId: "i1", projectId: "P1" }]);
    assert.deepEqual(lines.at(-1), { t: "2026-10-01T00:00:00.000Z", kind: "duty", op: "linear", by: "DUTY", ok: true, action: "create", key: "ATC-99", state: "Todo" });
    assert.ok(!JSON.stringify(lines).includes("Secret body text"), "본문은 기록하지 않는다");
    const n = calls.length;
    for (const [patch, status, re] of [
      [{ priority: undefined }, 400, /priority/],
      [{ state: "In Progress" }, 400, /state/],
      [{ state: "Done" }, 400, /state/],
      [{ labels: ["nope"] }, 400, /없는 라벨/],
      [{ project: "Nope" }, 400, /없는 프로젝트/],
      [{ parent: "VOC-1" }, 400, /parent/],
      [{ parent: "ATC-404" }, 404, /찾을 수 없음/],
      [{ team: "VOC" }, 400, /알 수 없는 칸/],
    ] as const) {
      const bad = await post(app, "/api/duty/linear", { ...good, ...patch });
      assert.equal(bad.status, status, JSON.stringify(patch));
      assert.match(((await bad.json()) as { error: string }).error, re);
    }
    assert.equal(calls.length, n, "거절된 것은 Linear를 부르지 않는다");
    const failed = lines.filter((l) => l.kind === "duty" && !l.ok);
    assert.equal(failed.length, 8, "거절도 기록한다");
  } finally {
    s.done();
  }
});

test("길: Linear update·comment — ATC 팀만, 상태는 Backlog↔Todo만, 라벨은 더하기만", async () => {
  const s = scratch();
  try {
    const app = new Hono();
    const { calls, o } = fake();
    const { d } = deps(s.repo, o);
    mountDutyL1(app, d);
    const u = await post(app, "/api/duty/linear", { action: "update", key: "ATC-7", title: "New", priority: 3, state: "Backlog", labels: ["wake:J"] });
    assert.equal(u.status, 200, JSON.stringify(await u.clone().json()));
    assert.deepEqual(calls.at(-1), ["update", "i1", { title: "New", priority: 3, stateId: "sb", labelIds: ["L0", "L2"] }]);
    assert.equal((await post(app, "/api/duty/linear", { action: "comment", key: "ATC-7", body: "note" })).status, 200);
    assert.deepEqual(calls.at(-1), ["comment", "i1", "note"]);
    const n = calls.length;
    for (const body of [
      { action: "update", key: "VOC-1", priority: 2 }, // 다른 팀
      { action: "comment", key: "VOC-1", body: "x" },
      { action: "update", key: "ATC-8", state: "Todo" }, // In Progress에서는 옮기지 않는다
      { action: "update", key: "ATC-7", state: "In Progress" },
      { action: "update", key: "ATC-7", state: "Done" },
      { action: "update", key: "ATC-7", labels: ["nope"] },
      { action: "update", key: "ATC-404", priority: 2 },
      { action: "delete", key: "ATC-7" },
      { action: "update", key: "ATC-7" },
    ]) assert.notEqual((await post(app, "/api/duty/linear", body)).status, 200, JSON.stringify(body));
    assert.equal(calls.length, n);
  } finally {
    s.done();
  }
});

test("길: Linear 오류는 502(키가 없으면 503)로 돌려주고 기록한다", async () => {
  const s = scratch();
  try {
    const app = new Hono();
    const { o } = fake({ comment: async () => { throw new Error("HTTP 500"); } });
    const { d, lines } = deps(s.repo, o);
    mountDutyL1(app, d);
    const r = await post(app, "/api/duty/linear", { action: "comment", key: "ATC-7", body: "x" });
    assert.equal(r.status, 502);
    const last = lines.at(-1);
    assert.equal(last?.kind === "duty" && last.ok, false);
    const { o: o2 } = fake({ issue: async () => { throw new Error("Linear 미연결"); } });
    const app2 = new Hono();
    mountDutyL1(app2, deps(s.repo, o2).d);
    assert.equal((await post(app2, "/api/duty/linear", { action: "comment", key: "ATC-7", body: "x" })).status, 503);
    const bad = await writeLinear(deps(s.repo, o).d, { action: "comment", key: "ATC-7", body: "x" });
    assert.equal(bad.status, 502);
  } finally {
    s.done();
  }
});

test("길: STAND 만들기·치우기는 기록되고(by DUTY), 잘못된 이름은 400", async () => {
  const s = scratch();
  try {
    const app = new Hono();
    const { d, lines } = deps(s.repo);
    mountDutyL1(app, d);
    assert.equal((await post(app, "/api/duty/stand", { name: "x1" })).status, 200);
    assert.equal((await post(app, "/api/duty/stand", { name: "X 1" })).status, 400);
    assert.equal((await post(app, "/api/duty/stand", {})).status, 400);
    assert.equal((await post(app, "/api/duty/stand-done", { name: "x1" })).status, 200);
    assert.deepEqual(
      lines.map((l) => (l.kind === "duty" ? [l.op, l.ok] : null)),
      [["stand", true], ["stand", false], ["stand", false], ["stand-done", true]],
    );
  } finally {
    s.done();
  }
});

// ── 본문 모양 점검(ATC-469) ──
const okBody = "## Goal\nx\n\n## Done when\nx\n\n## K effects\nNone\n\n## Measure\nNone";

test("본문 모양: 빠진 절·읽히지 않는 K3 줄은 400이고 Linear에 아무것도 쓰지 않는다. create와 본문을 싣는 update만 본다", async () => {
  const s = scratch();
  try {
    const app = new Hono();
    const { calls, o } = fake();
    const { d } = deps(s.repo, o);
    mountDutyL1(app, d);
    const n = calls.length;
    for (const [body, re] of [["## Goal\nx", /Done when.*K effects/], [`${okBody.replace("None\n\n## Measure", "K3: none\n\n## Measure")}`, /K3/], ["one line body", /Goal.*Done when.*K effects/]] as const) {
      for (const req of [{ action: "create", title: "T", priority: 3, body }, { action: "update", key: "ATC-7", body }]) {
        const r = await post(app, "/api/duty/linear", req);
        assert.equal(r.status, 400, body);
        assert.match(((await r.json()) as { error: string }).error, re);
      }
    }
    assert.equal(calls.length, n, "거절이면 create·update를 부르지 않는다");
    // 본문이 없는 update와 comment는 보지 않는다
    assert.equal((await post(app, "/api/duty/linear", { action: "update", key: "ATC-7", priority: 2 })).status, 200);
    assert.equal((await post(app, "/api/duty/linear", { action: "comment", key: "ATC-7", body: "x" })).status, 200);
  } finally {
    s.done();
  }
});

test("본문 모양: Measure가 없으면 만들고 warning을 싣는다. REVIEW 턴 제안과 update에도 같다", async () => {
  const s = scratch();
  try {
    const app = new Hono();
    const { calls, o } = fake();
    const { d } = deps(s.repo, { ...o, reviewTurn: () => true });
    mountDutyL1(app, d);
    const noMeasure = okBody.replace("\n\n## Measure\nNone", "");
    const r = (await (await post(app, "/api/duty/linear", { action: "create", title: "T", priority: 3, body: noMeasure })).json()) as { ok: boolean; warning?: string };
    assert.ok(r.ok && /Measure.*None/.test(r.warning ?? ""));
    assert.ok(calls.some((c) => c[0] === "create"));
    const u = (await (await post(app, "/api/duty/linear", { action: "update", key: "ATC-7", body: noMeasure })).json()) as { ok: boolean; warning?: string };
    assert.ok(u.ok && /Measure/.test(u.warning ?? ""));
    const clean = (await (await post(app, "/api/duty/linear", { action: "update", key: "ATC-7", body: okBody })).json()) as { warning?: string };
    assert.equal(clean.warning, undefined);
  } finally {
    s.done();
  }
});

// ── REVIEW 턴과 --blocked-by (ATC-396) ──
const createBody = { action: "create", title: "Speed up the thing", body: "## Goal\nx\n\n## Done when\nx\n\n## K effects\nNone\n\n## Measure\nNone", priority: 3 };

test("REVIEW 턴: 제안은 Backlog만(Todo는 만들기도 올리기도 403), 비슷한 열린 이슈가 있으면 409, 만든 제안은 알린다", async () => {
  const s = scratch();
  try {
    const app = new Hono();
    const { calls, o } = fake();
    const proposed: [string, string][] = [];
    let similar: string | null = null;
    const { d } = deps(s.repo, { ...o, reviewTurn: () => true, openSimilar: async () => similar, onProposal: (k, t) => void proposed.push([k, t]) });
    mountDutyL1(app, d);
    const todo = await post(app, "/api/duty/linear", { ...createBody, state: "Todo" });
    assert.equal(todo.status, 403);
    assert.match(((await todo.json()) as { error: string }).error, /Backlog/);
    assert.equal((await post(app, "/api/duty/linear", { action: "update", key: "ATC-7", state: "Todo" })).status, 403);
    assert.equal(calls.length, 0);
    similar = "ATC-55";
    const dup = await post(app, "/api/duty/linear", { ...createBody, state: "Backlog" });
    assert.equal(dup.status, 409);
    assert.match(((await dup.json()) as { error: string }).error, /ATC-55/);
    assert.equal(calls.length, 0);
    similar = null;
    const ok = await post(app, "/api/duty/linear", { ...createBody, state: "Backlog" });
    assert.equal(ok.status, 200);
    assert.deepEqual(proposed, [["ATC-99", "Speed up the thing"]]);
    assert.equal((calls[0]![1] as { stateId: string }).stateId, "sb");
  } finally {
    s.done();
  }
});

test("REVIEW 턴이 아니면(SUPERVISOR의 글에 답하는 중) Todo도 만들 수 있고 중복 검사·제안 알림은 없다", async () => {
  const s = scratch();
  try {
    const app = new Hono();
    const { calls, o } = fake();
    const proposed: string[] = [];
    const { d } = deps(s.repo, { ...o, reviewTurn: () => false, openSimilar: async () => "ATC-55", onProposal: (k) => void proposed.push(k) });
    mountDutyL1(app, d);
    assert.equal((await post(app, "/api/duty/linear", { ...createBody, state: "Todo" })).status, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(proposed, []);
  } finally {
    s.done();
  }
});

test("blockedBy: 막는 FLIGHT를 먼저 읽고, 이슈를 만든 뒤 막는 관계를 건다. 없는 FLIGHT면 이슈를 만들지 않는다", async () => {
  const s = scratch();
  try {
    const app = new Hono();
    const { calls, o } = fake();
    const rels: [string, string][] = [];
    const { d } = deps(s.repo, {
      ...o,
      issue: async (k) => (k === "ATC-7" ? { id: "i7", key: "ATC-7", team: "ATC", state: { name: "Todo", type: "unstarted" }, labels: [], states: [] } : k === "ATC-99" ? { id: "i99", key: "ATC-99", team: "ATC", state: { name: "Backlog", type: "backlog" }, labels: [], states: [] } : null),
      blocks: async (blocker, blocked) => void rels.push([blocker, blocked]),
    });
    mountDutyL1(app, d);
    const missing = await post(app, "/api/duty/linear", { ...createBody, blockedBy: ["ATC-12"] });
    assert.equal(missing.status, 404);
    assert.equal(calls.length, 0);
    const ok = await post(app, "/api/duty/linear", { ...createBody, blockedBy: ["ATC-7"] });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, key: "ATC-99", url: "https://linear.app/x/ATC-99", state: "Backlog", blockedBy: ["ATC-7"] });
    assert.deepEqual(rels, [["i7", "i99"]]);
    // 관계가 실패하면 이슈는 남고 경고가 온다
    const { d: d2 } = deps(s.repo, { ...o, issue: d.issue, blocks: async () => Promise.reject(new Error("relation refused")) });
    const app2 = new Hono();
    mountDutyL1(app2, d2);
    const warn = (await (await post(app2, "/api/duty/linear", { ...createBody, blockedBy: ["ATC-7"] })).json()) as { ok: boolean; key: string; warning?: string };
    assert.ok(warn.ok && warn.key === "ATC-99" && /relation refused/.test(warn.warning ?? ""));
  } finally {
    s.done();
  }
});
