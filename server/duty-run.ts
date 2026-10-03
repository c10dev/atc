// DUTY 서버 런타임(ATC-220, docs/duty.md 3, 5장 D2): `claude -p` stream-json 프로세스 하나를 이 서버가 쥔다.
// 외부에 나가는 동작: `claude` 프로세스를 띄우고 stdin에 글을 쓴다(deploy/landing-tier.mjs SIDE_EFFECT에 올라 있는 파일).
// 기본은 꺼짐(duty.json enabled). 꺼져 있으면 프로세스를 띄우지 않고, 켜진 프로세스도 끈다.
// 계산은 순수 조각에 있다: duty-stream.ts(파서), duty-machine.ts(상태 기계), duty-log.ts(기록·그림 검사), duty-config.ts(설정).
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { dutyArgvOf } from "../duty/spawn.mjs";
import { accountFolders } from "./accounts.ts";
import { accountNotice } from "./duty-chat.ts";
import { canResumeOn, effectiveDutyFolder } from "./duty-account.ts";
import { cleanEnv } from "./clean-env.ts";
import { config } from "./config.ts";
import { type DutyConfig, loadDutyConfig, saveDutyConfig } from "./duty-config.ts";
import { imageCheck, logLineOf, pageOf, TEXT_MAX, type DutyLogLine } from "./duty-log.ts";
import { type DutyAction, type DutyEventIn, type DutyMsg, type DutyState, initialState, step } from "./duty-machine.ts";
import type { DraftLine } from "./duty-drafts.ts";
import { createDutyParser, type DutyEvent, type DutyRate, type DutyTurnUsage } from "./duty-stream.ts";
import { fromThisApp } from "./origin.ts";

export const DUTY_CAP_DEFAULT = 250_000; // 컨텍스트 CAP(CONTROL RECYCLE의 관제 세션 기본과 같은 값). 이 CAP으로 스스로 재시작하는 것은 아직 없다(NEW SHIFT는 손으로)
const IDLE_TICK_MS = 30_000;
const CLOSE_GRACE_MS = 10_000; // stdin을 닫은 뒤 이만큼 안에 안 끝나면 SIGTERM
const BODY_MAX = 8 * 1024 * 1024; // 그림(base64)을 싣는 JSON 본문 상한

export interface DutyStatus {
  enabled: boolean;
  state: "idle" | "thinking" | "down";
  error: string | null;
  account: string;
  sessionId: string | null; // 앞 8자
  model: string | null;
  context: number | null;
  cap: number;
  costUsd: number | null;
  rates: DutyRate[];
  queued: number;
  blocked: boolean;
  malformed: number;
}

export interface DutyOpts {
  stateDir: string;
  claudeBin: string;
  dutyDir?: string;
  loadConfig: () => DutyConfig;
  // ACCOUNT 라벨 → Claude 설정 폴더. 못 찾으면 null(그 폴더가 없다)
  accountDir: (label: string) => string | null;
  now?: () => number;
  idleTickMs?: number;
  idleMs?: number; // 시험용: duty.idleMin(분) 대신 이 값(ms)
}

export type DutyCardEvent = { type: "card"; queueKind: string; key: string; draft: string } | { type: "draft"; draftKind: "note" | "charter" | "retire"; draft: string; text: string; until: string | null };
type Emitted = DutyEvent | DutyCardEvent | ({ type: "status" } & DutyStatus);
type Feed = (e: Emitted & { t: string }) => void;

export class DutyRuntime {
  private s: DutyState;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private exited: Promise<void> = Promise.resolve();
  private stderrLast = "";
  private parser = createDutyParser();
  private listeners = new Set<Feed>();
  private last: { model: string | null; context: number | null; costUsd: number | null; rates: DutyRate[] } = { model: null, context: null, costUsd: null, rates: [] };
  private badBase = 0;
  private reviewing = false; // 서버가 시작한 REVIEW 턴이 도는 중(ATC-396): 이 동안 Linear 제안은 Backlog에만
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  private readonly o: DutyOpts;
  private readonly onExit = () => void this.proc?.kill("SIGTERM"); // 서버가 끝나면 자식도 끝낸다

  constructor(o: DutyOpts) {
    this.o = o;
    this.now = o.now ?? Date.now;
    this.s = initialState(this.readSession());
    this.timer = setInterval(() => this.tick(), o.idleTickMs ?? IDLE_TICK_MS);
    this.timer.unref();
    process.on("exit", this.onExit);
  }

  private file = (name: string) => join(this.o.stateDir, name);
  private sessionAccount: string | null = null; // 저장된 대화가 시작된 ACCOUNT(ATC-242). 옛 파일엔 없다
  private readSession(): string | null {
    try {
      const j = JSON.parse(readFileSync(this.file("duty-session.json"), "utf8")) as { sessionId?: unknown; account?: unknown };
      this.sessionAccount = typeof j.account === "string" ? j.account : null;
      return typeof j.sessionId === "string" ? j.sessionId : null;
    } catch {
      return null;
    }
  }
  private saveSession() {
    const f = this.file("duty-session.json");
    mkdirSync(dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ sessionId: this.s.sessionId, account: this.sessionAccount, updatedAt: new Date(this.now()).toISOString() })}\n`);
    renameSync(tmp, f);
  }
  private append(line: DutyLogLine) {
    const f = this.file("duty.jsonl");
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, `${JSON.stringify(line)}\n`);
  }

  subscribe(fn: Feed): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit(e: Emitted) {
    const t = new Date(this.now()).toISOString();
    for (const l of this.listeners) l({ ...e, t });
  }
  private emitState() {
    const st = this.status();
    this.emit({ type: "state", state: st.state, queued: st.queued, blocked: st.blocked, ...(st.error ? { error: st.error } : {}) });
  }

  status(): DutyStatus {
    const cfg = this.o.loadConfig();
    return {
      enabled: cfg.enabled,
      state: this.s.phase,
      error: this.s.error,
      account: cfg.account,
      sessionId: this.s.sessionId ? this.s.sessionId.slice(0, 8) : null,
      model: this.last.model,
      context: this.last.context,
      cap: DUTY_CAP_DEFAULT,
      costUsd: this.last.costUsd,
      rates: this.last.rates,
      queued: this.s.queue.length,
      blocked: this.s.blocked,
      malformed: this.badBase + this.parser.malformed(),
    };
  }

  // 글을 보낸다. sent: 바로 썼다, queued: 턴이 도는 중이라 줄 세웠다("DUTY is answering"), refused: 보낼 수 없다(reason)
  async send(text: string, image?: { mediaType: string; base64: string }): Promise<{ verdict: "sent" | "queued" | "refused"; reason?: string }> {
    const cfg = this.o.loadConfig();
    if (!cfg.enabled) return { verdict: "refused", reason: "DUTY가 꺼져 있습니다(설정 → DUTY)" };
    if (this.s.closing) await this.exited; // 끝나는 중인 프로세스에는 쓰지 않는다
    if (!this.s.alive && this.o.accountDir(cfg.account) === null) return { verdict: "refused", reason: `ACCOUNT ${cfg.account}를 찾지 못함(fleet.json accounts)` };
    const msg: DutyMsg = { text };
    if (image) {
      const chk = imageCheck(image.mediaType, image.base64);
      if (!chk.ok) return { verdict: "refused", reason: chk.error };
      const name = `${new Date(this.now()).toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.${chk.ext}`;
      const f = join(this.o.stateDir, "duty-images", name);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, Buffer.from(image.base64, "base64"));
      msg.image = { mediaType: chk.mediaType, file: name };
    }
    const r = this.apply({ kind: "message", msg });
    if (r.verdict === "refused") return { verdict: "refused", reason: this.s.error ? `DUTY가 내려가 있습니다: ${this.s.error}` : "DUTY가 내려가 있습니다. NEW SHIFT로 다시 시작합니다" };
    return { verdict: r.verdict ?? "sent" };
  }

  // REVIEW 턴이 도는 중인가(duty-l1-run.ts가 Todo를 막는 데 쓴다)
  reviewTurn(): boolean {
    return this.reviewing && this.s.phase === "thinking";
  }

  // REVIEW(ATC-396): 서버가 스스로 턴을 시작한다. 돌고 있거나 줄 선 글이 있으면 시작하지 않는다(SUPERVISOR의 글이 먼저다).
  // line은 대화 기록에 남는 한 줄, text는 DUTY에게 가는 지시문
  async sendReview(text: string, line: string): Promise<{ verdict: "sent" | "refused"; reason?: string }> {
    const cfg = this.o.loadConfig();
    if (!cfg.enabled) return { verdict: "refused", reason: "off" };
    if (this.s.phase === "thinking" || this.s.queue.length || this.s.closing) return { verdict: "refused", reason: "busy" };
    if (this.s.phase === "down" && this.s.blocked) return { verdict: "refused", reason: "down" };
    if (!this.s.alive && this.o.accountDir(cfg.account) === null) return { verdict: "refused", reason: "account" };
    const r = this.apply({ kind: "message", msg: { text, review: line } });
    if (r.verdict === "refused") return { verdict: "refused", reason: "down" };
    return { verdict: "sent" };
  }

  // D3: 받아들여진 초안을 대화의 이 자리에 적는다(카드는 큐 줄을 가리킬 뿐이다). 글 이벤트와 같은 길이라 순서가 섞이지 않는다
  recordDraft(d: DraftLine) {
    const t = new Date(this.now()).toISOString();
    if (d.kind === "card") {
      this.append({ t, kind: "card", queueKind: d.card.queueKind, key: d.card.key, draft: d.id });
      this.emit({ type: "card", queueKind: d.card.queueKind, key: d.card.key, draft: d.id });
    } else {
      const draftKind = d.kind === "retire-card" ? "retire" : d.kind;
      const text = d.kind === "retire-card" ? "" : d.text;
      const until = d.kind === "note" ? d.until : null;
      this.append({ t, kind: "draft", draftKind, draft: d.id, text, until });
      this.emit({ type: "draft", draftKind, draft: d.id, text, until });
    }
  }

  stop() {
    this.apply({ kind: "stop" });
  }
  async newShift() {
    const wasAlive = this.s.alive;
    this.append({ t: new Date(this.now()).toISOString(), kind: "shift" });
    this.apply({ kind: "new-shift" });
    this.saveSession();
    this.emit({ type: "shift" });
    if (wasAlive) await this.exited;
    this.emitState();
  }
  // 설정이 바뀌었을 때(설정 창): 끄면 프로세스를 끝내고, ACCOUNT가 바뀌면 새 대화로 시작한다
  async configChanged(prev: DutyConfig, next: DutyConfig) {
    if (prev.enabled && !next.enabled) this.apply({ kind: "disable" });
    else if (prev.account !== next.account) {
      // ATC-242: 돌고 있는 턴은 옛 ACCOUNT에서 끝나고(reconfigure는 끝난 뒤 프로세스를 닫는다), 다음 글부터 새 ACCOUNT의 새 대화다. 바뀐 것을 한 줄 남긴다
      const t = new Date(this.now()).toISOString();
      this.append({ t, kind: "account", from: prev.account, to: next.account, by: "SUPERVISOR" });
      this.emit({ type: "notice", text: accountNotice(prev.account, next.account) });
      this.apply({ kind: "reconfigure" });
      this.sessionAccount = next.account;
    } else return;
    this.saveSession();
    this.emit({ type: "status", ...this.status() }); // 켜짐·ACCOUNT가 바뀌었다: 화면이 헤더를 다시 정한다
  }

  private tick() {
    const cfg = this.o.loadConfig();
    this.apply({ kind: "idle-tick", idleMs: this.o.idleMs ?? cfg.idleMin * 60_000 });
  }

  // 상태 기계에 사건을 넣고, 나온 할 일을 실행한다
  private apply(e: DutyEventIn): { verdict?: "sent" | "queued" | "refused" } {
    const before = `${this.s.phase}|${this.s.queue.length}|${this.s.error ?? ""}`;
    const r = step(this.s, e, this.now());
    this.s = r.state;
    for (const a of r.actions) this.run(a);
    if (before !== `${this.s.phase}|${this.s.queue.length}|${this.s.error ?? ""}`) this.emitState();
    return { verdict: r.verdict };
  }

  private run(a: DutyAction) {
    switch (a.do) {
      case "spawn":
        return this.spawnProc(a.resume);
      case "write":
        return this.writeMsg(a.msg);
      case "interrupt":
        return void this.proc?.stdin.write(`${JSON.stringify({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } })}\n`);
      case "close-stdin": {
        const p = this.proc;
        if (!p) return;
        p.stdin.end();
        const guard = setTimeout(() => p.kill("SIGTERM"), CLOSE_GRACE_MS);
        guard.unref();
        void this.exited.then(() => clearTimeout(guard));
        return;
      }
      case "kill":
        return void this.proc?.kill("SIGTERM");
    }
  }

  private spawnProc(resume: boolean) {
    const cfg = this.o.loadConfig();
    const dir = this.o.accountDir(cfg.account);
    // 저장된 대화가 다른 ACCOUNT에서 시작됐으면(duty.json을 손으로 고쳤거나 서버가 내려가 있는 사이 바뀜) --resume이 안 되니 새 대화로 띄운다
    const res = resume && canResumeOn(this.sessionAccount, cfg.account);
    const argv = dutyArgvOf({ claudeBin: this.o.claudeBin, ...(this.o.dutyDir ? { dir: this.o.dutyDir } : {}), ...(res && this.s.sessionId ? { sessionId: this.s.sessionId } : {}), resume: res });
    this.s = { ...this.s, sessionId: argv.sessionId };
    this.sessionAccount = cfg.account;
    this.saveSession();
    this.badBase += this.parser.malformed();
    this.parser = createDutyParser();
    this.stderrLast = "";
    // DUTY의 atcctl은 자기를 띄운 서버에 말한다(기본값 7700이면 시험 서버(7702)의 DUTY가 운영에 말하게 된다)
    const p = spawn(argv.command, argv.args, { cwd: argv.cwd, env: { ...cleanEnv(dir), ATC_URL: `http://127.0.0.1:${config.port}` }, stdio: ["pipe", "pipe", "pipe"] });
    this.proc = p;
    let done = false;
    this.exited = new Promise<void>((resolve) => {
      const finish = (error?: string) => {
        if (done) return;
        done = true;
        this.reviewing = false;
        if (this.proc === p) this.proc = null;
        resolve();
        this.apply({ kind: "exit", ...(error ? { error } : {}) });
      };
      p.on("error", (err) => finish(String(err.message)));
      p.on("close", (code, sig) => finish(this.stderrLast || (code === 0 ? undefined : `exit ${code ?? sig}`)));
    });
    p.stdin.on("error", () => {}); // 끝난 프로세스에 쓰면 EPIPE: 종료 사건이 따로 온다
    p.stderr.on("data", (b: Buffer) => {
      const line = b.toString("utf8").split("\n").map((l) => l.trim()).filter(Boolean).pop();
      if (line) this.stderrLast = line.slice(0, 300);
    });
    createInterface({ input: p.stdout }).on("line", (line) => this.onLine(line));
  }

  private writeMsg(m: DutyMsg) {
    const p = this.proc;
    if (!p) return;
    const content: Record<string, unknown>[] = [];
    if (m.image) {
      try {
        const data = readFileSync(join(this.o.stateDir, "duty-images", m.image.file)).toString("base64");
        content.push({ type: "image", source: { type: "base64", media_type: m.image.mediaType, data } });
      } catch {}
    }
    if (m.text || !content.length) content.push({ type: "text", text: m.text });
    p.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`);
    // 사용자 글은 서버가 적는다(스트림이 되울리는 줄(--replay-user-messages)은 파서가 이벤트로 내지 않는다)
    const t = new Date(this.now()).toISOString();
    if (m.review) {
      // REVIEW 턴(ATC-396): SUPERVISOR가 쓴 글이 아니다. 긴 지시문은 기록하지 않고 한 줄만 남긴다
      this.reviewing = true;
      this.append({ t, kind: "notice", text: m.review });
      this.emit({ type: "notice", text: m.review });
      return;
    }
    this.append({ t, kind: "user", text: m.text, ...(m.image ? { image: m.image.file } : {}) });
    this.emit({ type: "user", text: m.text, ...(m.image ? { image: m.image.file } : {}) });
  }

  private onLine(line: string) {
    for (const e of this.parser.feed(line)) {
      if (e.type === "init") {
        this.last.model = e.model ?? this.last.model;
        continue;
      }
      if (e.type === "state") {
        this.reviewing = false; // 턴이 끝났다: 줄 선 글이 이어 써져도 그것은 SUPERVISOR의 글이다
        this.apply({ kind: "result" }); // 큐에 남은 글이 있으면 여기서 이어 쓴다
        continue;
      }
      if (e.type === "usage") {
        if (e.turn) {
          this.last.context = e.turn.context || this.last.context;
          this.last.costUsd = e.turn.costUsd ?? this.last.costUsd;
        }
        if (e.rates.length) this.last.rates = e.rates;
      }
      const t = new Date(this.now()).toISOString();
      const l = logLineOf(e, t);
      if (l) this.append(l);
      this.emit(e);
    }
  }

  history(before?: number) {
    let raw = "";
    try {
      raw = readFileSync(this.file("duty.jsonl"), "utf8");
    } catch {}
    return pageOf(raw, before);
  }

  // 시험과 종료용: 프로세스가 끝나기를 기다린다
  async settled() {
    await this.exited;
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    process.off("exit", this.onExit);
    this.proc?.kill("SIGTERM");
  }
}

export type { DutyTurnUsage };

// 이 서버의 하나뿐인 DUTY. 처음 쓸 때 만든다(꺼져 있으면 아무것도 띄우지 않는다)
let singleton: DutyRuntime | null = null;
export function duty(): DutyRuntime {
  singleton ??= new DutyRuntime({
    stateDir: config.stateDir,
    claudeBin: config.claudeBin,
    loadConfig: () => loadDutyConfig(),
    accountDir: (label) => effectiveDutyFolder(label, accountFolders(), config.claudeDir).folder?.dir ?? null,
  });
  return singleton;
}

// 설정 창의 DUTY 스위치: duty.json에 쓰고 실행 중인 프로세스에 반영한다
export async function setDutyConfig(patch: Partial<Pick<DutyConfig, "enabled" | "account" | "idleMin" | "charter" | "review" | "l1">>): Promise<DutyConfig> {
  const prev = loadDutyConfig();
  const next = saveDutyConfig(patch);
  await duty().configChanged(prev, next);
  return next;
}

export function mountDutyRun(app: Hono, rt: () => DutyRuntime = duty, onSupervisorText?: (text: string) => void) {
  const gate = (c: Context): Response | null => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    if (!rt().status().enabled) return c.json({ error: "DUTY가 꺼져 있습니다(설정 → DUTY)", off: true }, 409);
    return null;
  };

  app.post("/api/duty/message", async (c) => {
    const denied = gate(c);
    if (denied) return denied;
    const raw = await c.req.text();
    if (raw.length > BODY_MAX) return c.json({ error: "본문이 너무 큽니다" }, 413);
    let body: Record<string, unknown>;
    try {
      const p = JSON.parse(raw);
      body = p && typeof p === "object" && !Array.isArray(p) ? p : {};
    } catch {
      return c.json({ error: "본문은 JSON이어야 합니다" }, 400);
    }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const img = body.image && typeof body.image === "object" ? (body.image as Record<string, unknown>) : null;
    if (!text && !img) return c.json({ error: "글이 비어 있습니다" }, 400);
    if (text.length > TEXT_MAX) return c.json({ error: `글이 너무 깁니다(최대 ${TEXT_MAX}자)` }, 413);
    const r = await rt().send(text, img ? { mediaType: String(img.mediaType), base64: String(img.data) } : undefined);
    if (r.verdict === "refused") return c.json({ error: r.reason }, 409);
    onSupervisorText?.(text); // 발권 기록(ATC-362): SUPERVISOR가 직접 쓴 글만 이 길로 온다(Origin 검사 뒤)
    if (r.verdict === "queued") return c.json({ queued: true, note: "DUTY is answering — 차례를 기다립니다" }, 202);
    return c.json({ queued: false });
  });

  app.post("/api/duty/stop", (c) => {
    const denied = gate(c);
    if (denied) return denied;
    rt().stop();
    return c.json({ ok: true });
  });

  app.post("/api/duty/new-shift", async (c) => {
    const denied = gate(c);
    if (denied) return denied;
    await rt().newShift();
    return c.json({ ok: true });
  });

  app.get("/api/duty/history", (c) => {
    const b = c.req.query("before");
    const before = b === undefined ? undefined : Number(b);
    if (before !== undefined && !(Number.isInteger(before) && before >= 0)) return c.json({ error: "before는 0 이상의 정수" }, 400);
    return c.json(rt().history(before));
  });

  app.get("/api/duty/status", (c) => c.json(rt().status()));
}
