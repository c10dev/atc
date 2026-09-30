import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import type { ClearanceOp } from "./clearances.ts";
import { hashOf, parseVoiceOverrides, radioPhraseOf, roleOf, ROLES, voiceOf } from "./radio-phrase.ts";
import { mountRadio } from "./radio-run.ts";
import { radioOf, type RadioInput, type Transmission } from "./radio.ts";
import { PHRASE_CHARS, PHRASE_MAX } from "./voice-phrase.ts";
import type { TtsConfig } from "./tts.ts";

// 캐시는 임시 상태 폴더에(운영 폴더를 건드리지 않는다)
const dir = mkdtempSync(join(tmpdir(), "atc-radio-"));
config.stateDir = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const T0 = "2026-09-30T10:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const empty: RadioInput = { clearances: [], proposals: [], crewChanges: [], reports: [], mcc: [], rts: [] };
const issue = (id: string, min: number, extra: Partial<Extract<ClearanceOp, { op: "issue" }>> = {}): ClearanceOp => ({
  op: "issue", id, at: at(min), to: "s1", toName: "TEAM_G", type: "GO AROUND", stand: null, flight: "ATC-147", text: "SECRET FREE TEXT: rm -rf / and 한국어", ...extra,
});
const of = (i: Partial<RadioInput>) => radioOf({ ...empty, ...i });

test("CLEARANCE 호출과 답: 예시 문구 그대로", () => {
  const txs = of({ clearances: [issue("C-0001", 0), { op: "readback", id: "C-0001", at: at(1) }] });
  assert.equal(radioPhraseOf(txs[0]), "GOLF, Tower, go around, ATC one four seven.");
  assert.equal(radioPhraseOf(txs[1]), "Tower, GOLF, readback, go around, ATC one four seven.");
});

test("CLEARANCE 종류마다 동사, ROGER·UNABLE·STANDBY", () => {
  const types = { LAND: "land", "GO AROUND": "go around", HOLD: "hold", CONTINUE: "continue", INFO: "information", TRAFFIC: "traffic", REPORT: "report" } as const;
  for (const [type, verb] of Object.entries(types)) {
    const [call] = of({ clearances: [issue("C-1", 0, { type: type as never })] });
    assert.equal(radioPhraseOf(call), `GOLF, Tower, ${verb}, ATC one four seven.`);
  }
  const txs = of({ clearances: [issue("C-1", 0, { type: "INFO" }), { op: "roger", id: "C-1", at: at(1) }, issue("C-2", 2), { op: "unable", id: "C-2", at: at(3), reason: "free reason" }, issue("C-3", 4), { op: "standby", id: "C-3", at: at(5) }] });
  const p = (id: string) => radioPhraseOf(txs.find((t) => t.id === id)!);
  assert.equal(p("C-1#roger"), "Tower, GOLF, roger, information, ATC one four seven.");
  assert.equal(p("C-2#unable"), "Tower, GOLF, unable, go around, ATC one four seven.");
  assert.equal(p("C-3#standby"), "Tower, GOLF, standby, go around, ATC one four seven.");
});

test("FLIGHT PLAN · RECALL · CREW CHANGE · ARRIVED", () => {
  const create = { op: "create", id: "D-0169", at: T0, kind: "ASSIGN", flight: "ATC-169", aircraft: "s", aircraftName: "TEAM_E", registration: "TEAM_E", airport: "ATCC", score: 1, factors: [] } as never;
  const txs = of({
    proposals: [create, { op: "send", id: "D-0169", at: at(1), message: "SECRET message" }, { op: "accept", id: "D-0169", at: at(2) }, { op: "recall", id: "D-0169", at: at(3), reason: "r", message: "SECRET recall" }, { op: "recalled", id: "D-0169", at: at(4) }],
    crewChanges: [{ op: "created", id: "CC-0001", registration: "TEAM_E", at: T0 } as never, { op: "sent", id: "CC-0001", at: at(5), message: "SECRET crew" }, { op: "acknowledged", id: "CC-0001", at: at(6) }],
    reports: [{ op: "report", flight: "ATC-169", at: at(7), proposal: "D-0169", pr: 12, result: null, tier: "auto", tests: null, discretion: 0, blocked: "none" }],
  });
  const p = (id: string) => radioPhraseOf(txs.find((t) => t.id === id)!);
  assert.equal(p("D-0169"), "ECHO, Delivery, flight plan, ATC one six niner.");
  assert.equal(p("D-0169#readback"), "Delivery, ECHO, readback, flight plan, ATC one six niner.");
  assert.equal(p("D-0169#recall"), "ECHO, Delivery, recall, ATC one six niner.");
  assert.equal(p("D-0169#recall#readback"), "Delivery, ECHO, readback, recall, ATC one six niner.");
  assert.equal(p("CC-0001"), "ECHO, Company, crew change.");
  assert.equal(p("CC-0001#readback"), "Company, ECHO, readback, crew change.");
  assert.equal(radioPhraseOf(txs.find((t) => t.kind === "ARRIVED")!), "Company, ECHO, arrived, ATC one six niner.");
});

test("GROUND: INSPECTION · LAND · ESCALATE · RTS", () => {
  const txs = of({
    mcc: [
      { op: "inspect", at: at(0), pr: 254, head: "h", verdict: "pass", text: "SECRET", model: "claude-opus-5-5", p0: 0, p1: 0, p2: 0 },
      { op: "inspect", at: at(1), pr: 5, head: "h", verdict: "findings", text: "SECRET", model: "claude-opus-5-5", p0: 1, p1: 0, p2: 0 },
      { op: "land", at: at(2), pr: 254, head: "h", tier: "auto", result: "ok", detail: "SECRET" },
      { op: "land", at: at(3), pr: 254, head: "h", tier: "auto", result: "rejected" },
      { op: "escalate", at: at(4), pr: 260, head: "h", reason: "SECRET" },
      { op: "rts", at: at(5), from: "a", to: "bbbbbbb", result: "started" },
    ],
    rts: [{ at: at(6), from: "a", to: "bbbbbbb", result: "ok" }, { at: at(7), from: "a", to: "bbbbbbb", result: "rollback" }],
  });
  assert.deepEqual(txs.map(radioPhraseOf), [
    "Ground, inspection pass, pull request two five four.",
    "Ground, inspection findings, pull request five.",
    "Ground, landed, pull request two five four.",
    "Ground, landing rejected, pull request two five four.",
    "Ground, escalate, pull request two six zero.",
    "Ground, return to service started.",
    "Ground, return to service complete.",
    "Ground, return to service rolled back.",
  ]);
});

test("모르는 kind·모르는 결과는 문구 없음, 호출 없는 답은 kind 없이", () => {
  const base = { freq: "TOWER", from: "TOWER", to: "GOLF (TEAM_G)", aircraft: "TEAM_G", flight: "ATC-1" } as const;
  assert.equal(radioPhraseOf({ ...base, kind: "MYSTERY" }), null);
  assert.equal(radioPhraseOf({ ...base, kind: "MYSTERY", replyTo: "x" }), null);
  assert.equal(radioPhraseOf({ ...base, kind: "READBACK", replyTo: "x", re: "MYSTERY" }), null);
  assert.equal(radioPhraseOf({ ...base, kind: "READBACK", from: "GOLF (TEAM_G)", to: "TOWER", replyTo: "x" }), "Tower, GOLF, readback, ATC one.");
  assert.equal(radioPhraseOf({ freq: "GROUND", from: "MCC", to: "ALL", kind: "RTS", result: "??" }), null);
  assert.equal(radioPhraseOf({ freq: "GROUND", from: "MCC", to: "ALL", kind: "MYSTERY" }), null);
});

test("문구에는 body·text·message가 들어가지 않고, 글자 집합과 길이 제한을 지킨다", () => {
  const txs = of({
    clearances: [issue("C-0001", 0, { toName: "Team Q", flight: "ATC-99999999" }), { op: "unable", id: "C-0001", at: at(1), reason: "한국어 사유 <script>" }],
    mcc: [{ op: "escalate", at: at(2), pr: 1, head: "h", reason: "SECRET 한국어" }],
  });
  for (const t of txs) {
    const p = radioPhraseOf(t);
    assert.ok(p, t.id);
    assert.equal(p.replace(PHRASE_CHARS, ""), p);
    assert.ok(p.length <= PHRASE_MAX);
    for (const secret of ["SECRET", "rm -rf", "한국어", "script", "사유"]) assert.ok(!p.includes(secret), `${t.id}: ${p}`);
  }
  const long = radioPhraseOf({ freq: "TOWER", from: "TOWER", to: "x", aircraft: "A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z".replaceAll(",", ",TEAM_"), kind: "LAND", flight: "ATC-1" });
  assert.ok(long === null || long.length <= PHRASE_MAX);
});

test("목소리: 자리마다 고정, 콜사인은 안정적, 하나뿐이면 그것", () => {
  const voices = ["v-c", "v-a", "v-b", "v-d"];
  const t = (freq: string, from: string, aircraft?: string) => ({ freq, from, aircraft }) as never;
  assert.deepEqual(ROLES.map((r, i) => voiceOf(t(r === "COMPANY" ? "COMPANY" : r, r === "TOWER" ? "TOWER" : r === "GROUND" ? "MCC" : "OCC"), voices)), ["v-a", "v-b", "v-c", "v-d"]);
  assert.equal(roleOf({ freq: "COMPANY", from: "OCC" }), "COMPANY");
  assert.equal(roleOf({ freq: "DELIVERY", from: "OCC" }), "DELIVERY");
  assert.equal(roleOf({ freq: "TOWER", from: "GOLF (TEAM_G)" }), null);
  // AIRCRAFT: 같은 콜사인은 늘 같은 목소리, 목록 순서와 무관
  const a = voiceOf(t("TOWER", "GOLF (TEAM_G)", "TEAM_G"), voices);
  assert.equal(voiceOf(t("DELIVERY", "GOLF (TEAM_G)", "TEAM_G"), [...voices].reverse()), a);
  assert.ok(voices.includes(a!));
  const spread = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => voiceOf(t("TOWER", "x", `TEAM_${c}`), voices)));
  assert.ok(spread.size > 1);
  // 하나뿐이면 전부 그것, 없으면 null
  assert.equal(voiceOf(t("TOWER", "TOWER"), ["only"]), "only");
  assert.equal(voiceOf(t("TOWER", "x", "TEAM_G"), ["only"]), "only");
  assert.equal(voiceOf(t("TOWER", "TOWER"), []), null);
  // 지정: 설치된 것만, 자리에만
  assert.equal(voiceOf(t("TOWER", "TOWER"), voices, { TOWER: "v-d" }), "v-d");
  assert.equal(voiceOf(t("TOWER", "TOWER"), voices, { TOWER: "missing" }), "v-a");
  assert.equal(voiceOf(t("TOWER", "x", "TEAM_G"), voices, { TOWER: "v-d" }), a);
  assert.equal(hashOf("GOLF"), hashOf("GOLF"));
});

test("parseVoiceOverrides", () => {
  const ok = (n: string) => n !== "bad";
  assert.deepEqual(parseVoiceOverrides("TOWER:a,GROUND:b,NOPE:c,COMPANY:bad,DELIVERY", ok), { TOWER: "a", GROUND: "b" });
  assert.deepEqual(parseVoiceOverrides(undefined, ok), {});
});

// ── 라우트 ──
const fixtures = of({
  clearances: [issue("C-0001", 0), { op: "readback", id: "C-0001", at: at(1) }, issue("C-0002", 2, { type: "WEIRD" as never })],
});
function app(engine = "stub") {
  const a = new Hono();
  const cfg = { engine, piper: "", voices: "", espeak: "", kokoro: "", kokoroModel: "", voice: "", tmpDir: join(dir, "voice-cache") } as TtsConfig;
  mountRadio(a, () => fixtures, () => cfg);
  return a;
}
const ask = (a: Hono, path: string) => a.request(path);

test("GET /api/radio/<id>.wav: 문구가 있는 교신은 WAV, 없거나 모르면 404", async () => {
  const a = app();
  const ok = await ask(a, "/api/radio/C-0001.wav");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "audio/wav");
  assert.equal(Buffer.from(await ok.arrayBuffer()).toString("ascii", 0, 4), "RIFF");
  assert.equal((await ask(a, `/api/radio/${encodeURIComponent("C-0001#readback")}.wav`)).status, 200);
  assert.equal((await ask(a, "/api/radio/C-0002.wav")).status, 404); // 틀이 없는 kind
  assert.equal((await ask(a, "/api/radio/C-9999.wav")).status, 404);
  assert.equal((await ask(a, "/api/radio/C-0001")).status, 400);
  assert.equal((await ask(a, "/api/radio/C-0001.wav?voices=TOWER:stub-two")).status, 200);
});

test("GET /api/radio/<id>.wav: 엔진이 없으면 503", async () => {
  const r = await ask(app("none"), "/api/radio/C-0001.wav");
  assert.equal(r.status, 503);
});
