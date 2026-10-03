// 벤치마크 주의(attention) 분 계산(docs/research/atc-vs-solo.md 4절, ATC-464): ActivityWatch 내보내기와 실험 창 파일에서
// 팔·배치·이슈별 active / tethered / away / excluded 분을 낸다. 전부 순수 함수이고 파일 입출력은 attention-run.ts가 한다.
// 구간마다 한 상태로 나뉜다: AFK → away, 아니면 센 창 + 입력 있음 → active, 센 창 + 입력 없음 → tethered, 센 창 아님 → excluded,
// AFK 기록이 없는 구간 → nodata.

export type Rule = { id: string; app?: string; title?: string }; // app·title은 대소문자 무시 정규식, 둘 다 주면 둘 다 맞아야 한다
export type Config = {
  rules: Rule[]; // 앞의 규칙이 먼저. 어느 것에도 안 맞는 창은 excluded
  inputHoldSec: number; // 입력 이벤트 뒤 이만큼은 입력이 있는 것으로 본다
  timerFlagRatio: number; // 수동 타이머와 active의 차가 이 비율을 넘으면 표시
  timerFlagMinMin: number; // 단, 차가 이 분 이상일 때만
};

export type AwEvent = { timestamp: string; duration: number; data: Record<string, unknown> };
export type AwBucket = { id?: string; type?: string; hostname?: string; events: AwEvent[] };
export type AwExport = { buckets: Record<string, AwBucket> };

export type TimerPair = { start: string; end: string };
export type SubWindow = { start: string; end: string; issue: string };
export type ExperimentWindow = {
  start: string;
  end: string;
  arm: string;
  batch: string;
  issues: string[];
  subWindows?: SubWindow[]; // 한 배치의 이슈 몇 개가 따로 구분되는 구간만
  timer?: TimerPair[];
};

export type Minutes = { active: number; tethered: number; away: number; excluded: number; nodata: number };
export type WindowResult = Minutes & {
  arm: string;
  batch: string;
  issues: string[];
  byRule: Record<string, { active: number; tethered: number }>;
  timerMinutes: number | null;
  timerDiff: number | null; // timerMinutes - active
  timerFlag: boolean;
  inputBucket: boolean; // false면 입력 이벤트가 없어 not-afk를 입력 있음으로 봤다(tethered가 0)
  subWindows: { issue: string; minutes: Minutes }[];
};
export type Report = {
  windows: WindowResult[];
  byArm: Record<string, Minutes>;
  byBatch: Record<string, Minutes>; // 키: "<arm>/<batch>"
  byIssue: Record<string, Minutes>; // 키: "<arm>/<issue>", 하위 구간이 있는 이슈만
};

export const zeroMinutes = (): Minutes => ({ active: 0, tethered: 0, away: 0, excluded: 0, nodata: 0 });

export function parseConfig(raw: unknown): Config {
  const c = raw as Partial<Config> | null;
  if (!c || !Array.isArray(c.rules) || c.rules.length === 0) throw new Error("설정: rules가 비어 있다");
  const ids = new Set<string>();
  for (const r of c.rules) {
    if (!r || typeof r.id !== "string" || !r.id) throw new Error("설정: 규칙에 id가 없다");
    if (ids.has(r.id)) throw new Error(`설정: 규칙 id가 겹친다: ${r.id}`);
    ids.add(r.id);
    if (r.app === undefined && r.title === undefined) throw new Error(`설정: ${r.id}에 app 또는 title이 있어야 한다`);
    for (const k of ["app", "title"] as const) if (r[k] !== undefined) new RegExp(r[k] as string, "i"); // 잘못된 정규식이면 던진다
  }
  const num = (v: unknown, d: number) => (typeof v === "number" && v >= 0 ? v : d);
  return { rules: c.rules, inputHoldSec: num(c.inputHoldSec, 10), timerFlagRatio: num(c.timerFlagRatio, 0.25), timerFlagMinMin: num(c.timerFlagMinMin, 5) };
}

export function matchRule(rules: Rule[], app: string, title: string): string | null {
  for (const r of rules) {
    if (r.app !== undefined && !new RegExp(r.app, "i").test(app)) continue;
    if (r.title !== undefined && !new RegExp(r.title, "i").test(title)) continue;
    return r.id;
  }
  return null;
}

type Iv<T> = { s: number; e: number; v: T };

// 겹치면 뒤 구간이 시작하는 곳에서 앞 구간을 자른다. 결과는 시작 순으로 겹치지 않는다
function disjoint<T>(ivs: Iv<T>[]): Iv<T>[] {
  const sorted = ivs.filter((i) => i.e > i.s).sort((a, b) => a.s - b.s || a.e - b.e);
  const out: Iv<T>[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && last.e > cur.s) last.e = cur.s;
    if (last && last.e <= last.s) out.pop();
    out.push({ ...cur });
  }
  return out;
}

function at<T>(ivs: Iv<T>[], t: number): T | undefined {
  let lo = 0;
  let hi = ivs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const iv = ivs[mid];
    if (t < iv.s) hi = mid - 1;
    else if (t >= iv.e) lo = mid + 1;
    else return iv.v;
  }
  return undefined;
}

const ms = (iso: string) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`시각을 읽을 수 없다: ${iso}`);
  return t;
};
const toIv = (e: AwEvent): { s: number; e: number } => ({ s: ms(e.timestamp), e: ms(e.timestamp) + Math.max(0, e.duration) * 1000 });
const MIN = 60_000;

export type Streams = {
  windows: Iv<string | null>[]; // 값: 규칙 id 또는 null(안 센다)
  afk: Iv<boolean>[];
  input: Iv<true>[];
  hasInputBucket: boolean;
};

// 버킷 종류(type)로 고른다. host를 주면 그 호스트의 버킷만
export function buildStreams(exp: AwExport, config: Config, host?: string): Streams {
  const wins: Iv<string | null>[] = [];
  const afk: Iv<boolean>[] = [];
  const inp: Iv<true>[] = [];
  let hasInputBucket = false;
  for (const [key, b] of Object.entries(exp.buckets ?? {})) {
    if (host && b.hostname !== host) continue;
    const type = b.type ?? "";
    const label = `${key} ${type}`;
    if (type === "currentwindow" || /window/i.test(label)) {
      for (const ev of b.events) {
        const app = String(ev.data.app ?? "");
        const title = String(ev.data.title ?? "");
        wins.push({ ...toIv(ev), v: matchRule(config.rules, app, title) });
      }
    } else if (type === "afkstatus" || /afk/i.test(label)) {
      for (const ev of b.events) afk.push({ ...toIv(ev), v: ev.data.status === "afk" });
    } else if (/input/i.test(label)) {
      hasInputBucket = true;
      const hold = config.inputHoldSec * 1000;
      for (const ev of b.events) {
        const d = ev.data;
        const n = ["presses", "clicks", "deltaX", "deltaY", "scrollX", "scrollY"].reduce((a, k) => a + Math.abs(Number(d[k] ?? 0)), 0);
        if (n > 0) {
          const iv = toIv(ev);
          inp.push({ s: iv.s, e: iv.e + hold, v: true });
        }
      }
    }
  }
  // 입력은 겹침을 합쳐야 한다(자르면 덮는 시간이 줄어든다)
  const merged: Iv<true>[] = [];
  for (const iv of inp.sort((a, b) => a.s - b.s)) {
    const last = merged[merged.length - 1];
    if (last && iv.s <= last.e) last.e = Math.max(last.e, iv.e);
    else merged.push({ ...iv });
  }
  return { windows: disjoint(wins), afk: disjoint(afk), input: merged, hasInputBucket };
}

// [start, end) 구간의 분을 센다. 경계는 모든 스트림의 가장자리에서 끊는다
export function minutesIn(st: Streams, start: number, end: number, rules: Rule[]): { minutes: Minutes; byRule: Record<string, { active: number; tethered: number }> } {
  const edges = new Set<number>([start, end]);
  for (const list of [st.windows, st.afk, st.input] as Iv<unknown>[][]) {
    for (const iv of list) {
      if (iv.s > start && iv.s < end) edges.add(iv.s);
      if (iv.e > start && iv.e < end) edges.add(iv.e);
    }
  }
  const pts = [...edges].sort((a, b) => a - b);
  const m = zeroMinutes();
  const byRule: Record<string, { active: number; tethered: number }> = {};
  for (const r of rules) byRule[r.id] = { active: 0, tethered: 0 };
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = (pts[i + 1] - pts[i]) / MIN;
    const mid = (pts[i] + pts[i + 1]) / 2;
    const afk = at(st.afk, mid);
    if (afk === undefined) m.nodata += len;
    else if (afk) m.away += len;
    else {
      const rule = at(st.windows, mid);
      if (rule == null) m.excluded += len;
      else {
        // 입력 이벤트가 없는 내보내기에서는 not-afk를 입력 있음으로 본다
        const input = st.hasInputBucket ? at(st.input, mid) === true : true;
        if (input) {
          m.active += len;
          byRule[rule].active += len;
        } else {
          m.tethered += len;
          byRule[rule].tethered += len;
        }
      }
    }
  }
  return { minutes: m, byRule };
}

const add = (a: Minutes, b: Minutes) => {
  for (const k of Object.keys(a) as (keyof Minutes)[]) a[k] += b[k];
};

export function timerMinutes(pairs: TimerPair[] | undefined): number | null {
  if (!pairs || pairs.length === 0) return null;
  return pairs.reduce((a, p) => {
    const d = ms(p.end) - ms(p.start);
    if (d < 0) throw new Error(`타이머 끝이 시작보다 빠르다: ${p.start}`);
    return a + d / MIN;
  }, 0);
}

export function analyze(exp: AwExport, windows: ExperimentWindow[], config: Config, host?: string): Report {
  const st = buildStreams(exp, config, host);
  const rep: Report = { windows: [], byArm: {}, byBatch: {}, byIssue: {} };
  for (const w of windows) {
    const s = ms(w.start);
    const e = ms(w.end);
    if (e <= s) throw new Error(`실험 창의 끝이 시작보다 빠르다: ${w.batch}`);
    const { minutes, byRule } = minutesIn(st, s, e, config.rules);
    const subs = (w.subWindows ?? []).map((sw) => {
      const a = ms(sw.start);
      const b = ms(sw.end);
      if (a < s || b > e || b <= a) throw new Error(`하위 구간이 실험 창 밖이거나 거꾸로다: ${sw.issue}`);
      return { issue: sw.issue, minutes: minutesIn(st, a, b, config.rules).minutes };
    });
    const timer = timerMinutes(w.timer);
    const diff = timer === null ? null : timer - minutes.active;
    const flag = diff !== null && Math.abs(diff) >= config.timerFlagMinMin && Math.abs(diff) > config.timerFlagRatio * Math.max(timer ?? 0, minutes.active);
    rep.windows.push({ ...minutes, arm: w.arm, batch: w.batch, issues: w.issues, byRule, timerMinutes: timer, timerDiff: diff, timerFlag: flag, inputBucket: st.hasInputBucket, subWindows: subs });
    add((rep.byArm[w.arm] ??= zeroMinutes()), minutes);
    add((rep.byBatch[`${w.arm}/${w.batch}`] ??= zeroMinutes()), minutes);
    for (const sw of subs) add((rep.byIssue[`${w.arm}/${sw.issue}`] ??= zeroMinutes()), sw.minutes);
  }
  return rep;
}

const r1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export function formatReport(rep: Report): string {
  const lines = ["| Arm | Batch | Active | Tethered | Away | Excluded | No data | Timer | Timer − active | Flag |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const w of rep.windows) {
    lines.push(
      `| ${w.arm} | ${w.batch} | ${r1(w.active)} | ${r1(w.tethered)} | ${r1(w.away)} | ${r1(w.excluded)} | ${r1(w.nodata)} | ${w.timerMinutes === null ? "–" : r1(w.timerMinutes)} | ${w.timerDiff === null ? "–" : r1(w.timerDiff)} | ${w.timerFlag ? "LARGE" : ""} |`,
    );
  }
  const block = (title: string, rec: Record<string, Minutes>) => {
    if (Object.keys(rec).length === 0) return;
    lines.push("", `${title}`, "", "| Key | Active | Tethered | Away | Excluded | No data |", "|---|---|---|---|---|---|");
    for (const [k, m] of Object.entries(rec)) lines.push(`| ${k} | ${r1(m.active)} | ${r1(m.tethered)} | ${r1(m.away)} | ${r1(m.excluded)} | ${r1(m.nodata)} |`);
  };
  block("Per arm", rep.byArm);
  block("Per batch", rep.byBatch);
  block("Per issue (sub-windows only)", rep.byIssue);
  if (rep.windows.some((w) => !w.inputBucket)) lines.push("", "Note: no input bucket in the export; not-afk was counted as input present, so tethered is 0.");
  return lines.join("\n") + "\n";
}
