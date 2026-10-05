// tick:alerts의 동기 시간을 잰다(ATC-537). 운영 크기의 합성 상태(제안 약 3 MB, mcc 약 1.5 MB, FLIGHT RECORDER 하루치)를 임시 폴더에 만든다. 운영 상태는 복사하지 않는다.
// 쓰기: node server/tick-alerts-bench.ts [서버 소스 폴더(기본: 이 폴더)] [반복 횟수(기본 50)]
// 매 반복마다 제안·mcc·recorder에 한 줄씩 덧붙이고(실제 tick처럼 파일이 자란다) runSupervisorAlerts를 부른 시간을 센다.
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const src = resolve(process.argv[2] ?? dirname(fileURLToPath(import.meta.url)));
const rounds = Number(process.argv[3] ?? 50);
const root = mkdtempSync(join(tmpdir(), "atc-bench-"));
const state = join(root, "state");
mkdirSync(join(state, "flight-recorder"), { recursive: true });
process.env.ATC_STATE_DIR = state;
process.env.HOME = root;
process.env.ATC_GITHUB = "off";

const t0 = Date.parse("2026-10-05T00:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const pad = (n: number, w = 4) => String(n).padStart(w, "0");
const J = (o: unknown) => `${JSON.stringify(o)}\n`;

// 제안 약 3 MB: create(요인 여럿)와 이어지는 판정·전이 줄
let proposals = "";
let id = 0;
while (proposals.length < 3_000_000) {
  const key = `D-${pad(++id)}`;
  const at = iso(t0 - (20_000 - id) * 60_000);
  proposals += J({
    op: "create", id: key, at, kind: "ASSIGN", flight: `ATC-${100 + (id % 400)}`, aircraft: `sess-${id % 30}`, aircraftName: `TEAM_${"ABCDEFGH"[id % 8]}`, registration: `TEAM_${"ABCDEFGH"[id % 8]}`, airport: "ATCC", score: 40 + (id % 50),
    factors: Array.from({ length: 6 }, (_, i) => ({ name: `factor-${i}`, value: i * 3, note: "합성 요인 설명 문장입니다. ".repeat(2) })),
  });
  proposals += J({ op: "approve", id: key, at: iso(Date.parse(at) + 60_000) });
  proposals += J({ op: "send", id: key, at: iso(Date.parse(at) + 120_000), message: `[DISPATCH ${key}] FLIGHT PLAN ${"합성 본문 ".repeat(20)}` });
  proposals += J({ op: "accept", id: key, at: iso(Date.parse(at) + 180_000) });
  proposals += J({ op: "depart", id: key, at: iso(Date.parse(at) + 240_000), stand: null, via: "readback" });
  proposals += J({ op: "arrived", id: key, at: iso(Date.parse(at) + 3_600_000), note: "합성 도착 보고" });
}
writeFileSync(join(state, "proposals.jsonl"), proposals);

// mcc 약 1.5 MB
let mcc = "";
let pr = 0;
while (mcc.length < 1_500_000) {
  pr++;
  const head = pad(pr * 7919, 8);
  const at = iso(t0 - (20_000 - pr) * 60_000);
  mcc += J({ op: "inspect", at, pr, head, tier: "auto", verdict: "pass", findings: [], model: "synthetic", detail: "합성 검토 기록 ".repeat(8) });
  mcc += J({ op: "land", at: iso(Date.parse(at) + 60_000), pr, head, tier: "auto", result: "ok" });
}
writeFileSync(join(state, "mcc.jsonl"), mcc);

// FLIGHT RECORDER: 오늘 파일에 3초 이벤트와 5분 표본
const day = join(state, "flight-recorder", `${iso(t0).slice(0, 10)}.jsonl`);
let rec = "";
for (let i = 0; i < 6000; i++) rec += J({ t: iso(t0 + i * 3_000), kind: "sample", airborne: i % 5, holding: 0, claims: 2, conflicts: 0, alerts: 0, landing: 1, pendingClearances: 0 });
writeFileSync(day, rec);

const now0 = t0 + 6000 * 3_000;
const snapshot = {
  at: iso(now0), linear: { enabled: false, error: null, fetchedAt: null }, github: { enabled: false, error: null, fetchedAt: null }, sessions: [], workspaces: [], tickets: [], columns: [], airports: [], claims: [], handoffs: [], alerts: [], clearances: [], pulls: [], atfm: { mains: [], groundStops: [] },
};

const { runSupervisorAlerts, summaryNow, GAP_MS } = (await import(join(src, "supervisor-alerts-run.ts"))) as {
  runSupervisorAlerts: (s: unknown, now: number) => unknown;
  summaryNow: (s: unknown, now: number) => unknown;
  GAP_MS: number;
};
const { createHash } = await import("node:crypto");
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 12);
let firstAlerts = "";
let lastSummary = "";
const times: number[] = [];
const sumTimes: number[] = [];
let now = now0;
for (let i = 0; i < rounds + 1; i++) {
  now += GAP_MS + 1_000;
  appendFileSync(join(state, "proposals.jsonl"), J({ op: "note", id: "D-0001", at: iso(now), text: "합성 메모", caution: false }));
  appendFileSync(join(state, "mcc.jsonl"), J({ op: "hold", at: iso(now), pr: 1 }));
  appendFileSync(day, J({ t: iso(now), kind: "ack", consumer: "bench" }));
  const a = performance.now();
  const ev = runSupervisorAlerts(snapshot, now);
  const b = performance.now();
  const sm = summaryNow(snapshot, now);
  if (i === 0) firstAlerts = digest(ev);
  lastSummary = digest(sm);
  const c = performance.now();
  if (i > 0) {
    // 첫 호출은 처음 읽기라 센다: 따로 적고 평균에서는 뺀다(서버를 켠 첫 tick)
    times.push(b - a);
    sumTimes.push(c - b);
  } else console.log(`first call: alerts ${(b - a).toFixed(1)} ms, summary ${(c - b).toFixed(1)} ms`);
}
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const p = (xs: number[], q: number) => [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.floor(xs.length * q))];
console.log(`src=${src} proposals=${(proposals.length / 1e6).toFixed(1)}MB mcc=${(mcc.length / 1e6).toFixed(1)}MB recorder=${(rec.length / 1e6).toFixed(1)}MB rounds=${rounds}`);
console.log(`tick:alerts mean ${mean(times).toFixed(1)} ms · p50 ${p(times, 0.5).toFixed(1)} · p95 ${p(times, 0.95).toFixed(1)} · max ${Math.max(...times).toFixed(1)}`);
console.log(`summaryNow mean ${mean(sumTimes).toFixed(1)} ms · p95 ${p(sumTimes, 0.95).toFixed(1)}`);
// 같은 합성 상태에서 캐시 전후의 결과가 같은지 보려고 해시를 찍는다(시각은 고정이다)
console.log(`alerts digest ${firstAlerts} · summary digest ${lastSummary}`);
rmSync(root, { recursive: true, force: true });
