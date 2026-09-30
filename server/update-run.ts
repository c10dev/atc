import type { Hono } from "hono";
import { appendMccRecord, autoRtsInfoOf, autoRtsOf, lastRtsFailureOf, mccDeploys, readMccRecords, rtsDueOf } from "./mcc.ts";
import { airportOf, errText, gh, rtsGuard, rtsState, startRtsUnit } from "./mcc-run.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { type PlanRts, prsOfMessages, type RangePr, rangeRefusalOf, updateStateOf, type UpdateStatus } from "./update.ts";

// UPDATE bar 실행부(ATC-82, docs/mcc.md "UPDATE bar as built"). 상태는 읽기만, 시작은 SUPERVISOR가 이 화면에서 누를 때만.
// 실제 일은 MCC와 같은 atc-rts 유닛(deploy/rts.mjs)이 한다. deploy/는 사용자 등급이라 planRts를 런타임에 읽는다.

export interface RangeInfo {
  prs: RangePr[];
  files: string[];
}
export interface UpdateDeps {
  startUnit: () => Promise<void>;
  guard: () => string | null;
  compare: (slug: string, from: string, to: string) => Promise<RangeInfo>;
  planRts: () => Promise<PlanRts>;
  now: () => number;
}

let planFn: PlanRts | null = null;
export const loadPlanRts = async () => {
  if (!planFn) planFn = ((await import(new URL("../deploy/rts.mjs", import.meta.url).href)) as { planRts: PlanRts }).planRts;
  return planFn;
};
// 커밋 메시지와 바뀐 파일(GitHub compare, REST)
const compareRange = async (slug: string, from: string, to: string): Promise<RangeInfo> => {
  const out = JSON.parse(await gh(["api", `repos/${slug}/compare/${from}...${to}`, "--jq", "{messages: [.commits[].commit.message], files: [.files[].filename]}"])) as { messages: string[]; files: string[] };
  return { prs: prsOfMessages(out.messages), files: out.files };
};
const defaultDeps: UpdateDeps = { startUnit: startRtsUnit, guard: rtsGuard, compare: compareRange, planRts: loadPlanRts, now: Date.now };

const RANGE_ERROR_MS = 60_000; // 읽기에 실패하면 이 시간 동안 다시 읽지 않는다
export function mountUpdate(app: Hono, getSnapshot: () => Promise<Snapshot>, head: () => string | null, deps: UpdateDeps = defaultDeps) {
  // 범위(deployed..main)는 두 커밋이 같으면 바뀌지 않으므로 한 번만 읽는다
  const ranges = new Map<string, { at: number; info: RangeInfo | null }>();
  const rangeOf = async (slug: string, from: string, to: string) => {
    const key = `${from}..${to}`;
    const hit = ranges.get(key);
    if (hit && (hit.info || deps.now() - hit.at < RANGE_ERROR_MS)) return hit.info;
    let info: RangeInfo | null = null;
    try {
      info = await deps.compare(slug, from, to);
    } catch (e) {
      console.warn(`[update] compare ${key}: ${errText(e)}`);
    }
    ranges.clear();
    ranges.set(key, { at: deps.now(), info });
    return info;
  };

  function facts(s: Snapshot) {
    const ap = airportOf(s);
    const state = rtsState(readMccRecords());
    const deployed = head();
    const now = deps.now();
    const due = rtsDueOf({ deployed, main: ap.main, mainCi: ap.mainCi, last: state.last, lastStartAt: state.lastStartAt, now }, state.stop, 0);
    return { ap, state, deployed, now, due };
  }

  async function statusOf(s: Snapshot): Promise<UpdateStatus> {
    const f = facts(s);
    const behind = f.deployed && f.ap.main && !f.ap.main.startsWith(f.deployed) && !f.deployed.startsWith(f.ap.main);
    const range = behind ? await rangeOf(f.ap.slug, f.deployed!, f.ap.main!) : null;
    let rangeRefusal: string | null = null;
    if (range && behind) rangeRefusal = rangeRefusalOf(await deps.planRts(), f.deployed!, f.ap.main!, range.files);
    const { kind, why } = updateStateOf({
      deployed: f.deployed,
      main: f.ap.main,
      mainCi: f.ap.mainCi,
      due: f.due,
      stop: f.state.stop,
      last: f.state.last,
      lastStartAt: f.state.lastStartAt,
      rangeRefusal,
      guard: deps.guard(),
      now: f.now,
    });
    const auto = autoRtsInfoOf(f.ap.cfg.mode, f.state.spacingAt, Boolean(behind), f.now);
    return { kind, why, deployed: f.deployed, main: f.ap.main, mainCi: f.ap.mainCi, prs: range?.prs ?? null, refusal: rangeRefusal, last: f.state.last, auto, at: new Date(f.now).toISOString() };
  }

  // 서버의 자동 RTS(ATC-84): mcc 모드가 rts·land+rts일 때 RETURN TO SERVICE가 할 때면 MCC 세션의 /tick을 기다리지 않고 유닛을 시작한다.
  // 판정은 순수 함수(autoRtsOf)가 하고 시작 조건(rtsDueOf, 5분 간격)은 `mcc rts`와 같다. 시작하면 mcc.jsonl에 by "server"로 남긴다
  let passing = false;
  async function pass(s: Snapshot): Promise<{ started: boolean; why: string }> {
    if (passing) return { started: false, why: "이전 점검이 아직 돎" };
    passing = true;
    try {
      const ap = airportOf(s);
      if (!mccDeploys(ap.cfg.mode)) return { started: false, why: `모드 ${ap.cfg.mode}: 자동 배포 꺼짐` };
      const records = readMccRecords();
      const state = rtsState(records);
      const deployed = head();
      const now = deps.now();
      const due = rtsDueOf({ deployed, main: ap.main, mainCi: ap.mainCi, last: state.last, lastStartAt: state.spacingAt, mainReadAt: ap.mainReadAt, lastLandAt: state.lastLandAt, now }, state.stop);
      // 범위 거절은 시작하기 전에 안다(UPDATE 바와 같은 planRts). 할 때가 아니면 GitHub을 읽지 않는다
      let rangeRefusal: string | null = null;
      if (due.due && deployed && ap.main) {
        const range = await rangeOf(ap.slug, deployed, ap.main);
        if (range) rangeRefusal = rangeRefusalOf(await deps.planRts(), deployed, ap.main, range.files);
        else return { started: false, why: "범위를 읽지 못함 — 다음 점검에서 다시" };
      }
      const decision = autoRtsOf({ mode: ap.cfg.mode, due, main: ap.main, rangeRefusal, guard: deps.guard(), last: state.last, lastFailedAt: lastRtsFailureOf(records, ap.main), now });
      if (!decision.start) return { started: false, why: decision.why };
      const base = { at: new Date(now).toISOString(), from: deployed, to: ap.main!, by: "server" as const };
      try {
        await deps.startUnit();
        appendMccRecord({ op: "rts", ...base, result: "started" });
        return { started: true, why: decision.why };
      } catch (e) {
        appendMccRecord({ op: "rts", ...base, result: "failed", detail: errText(e) });
        return { started: false, why: errText(e) };
      }
    } finally {
      passing = false;
    }
  }

  // 화면이 읽는다(읽기만). 저장소를 모르는 동안(GitHub을 아직 안 읽음)은 막대 없음
  app.get("/api/update", async (c) => {
    try {
      return c.json(await statusOf(await getSnapshot()));
    } catch (e) {
      return c.json({ kind: "current", why: errText(e), deployed: head(), main: null, mainCi: "none", prs: null, refusal: null, last: null, at: new Date().toISOString() } satisfies UpdateStatus);
    }
  });

  // SUPERVISOR만(이 화면 Origin). /api/mcc/rts와 같은 점검(rtsDueOf: RTS 진행 중·ROLLBACK 멈춤·CI)에 범위 거절을 더한다.
  // 5분 간격은 두지 않는다(사람이 누른 때가 배포 시점). 대신 방금 시작해 아직 결과가 없으면(starting·running) 거절한다
  // 시험 서버는 유닛을 시작하지 못한다(운영 7700을 배포하므로)
  app.post("/api/update/start", async (c) => {
    if (!fromThisApp(c)) return c.json({ started: false, why: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const blocked = deps.guard();
    if (blocked) return c.json({ started: false, why: blocked }, 409);
    try {
      const s = await getSnapshot();
      const st = await statusOf(s);
      const f = facts(s);
      if (st.kind === "starting" || st.kind === "running") return c.json({ started: false, why: st.why }, 409);
      if (!f.due.due) return c.json({ started: false, why: f.due.why }, 409);
      if (st.refusal) return c.json({ started: false, why: st.refusal }, 409);
      const base = { at: new Date(f.now).toISOString(), from: f.deployed, to: f.ap.main!, by: "supervisor" as const };
      try {
        await deps.startUnit();
        appendMccRecord({ op: "rts", ...base, result: "started" });
        return c.json({ started: true, why: f.due.why });
      } catch (e) {
        appendMccRecord({ op: "rts", ...base, result: "failed", detail: errText(e) });
        return c.json({ started: false, why: errText(e) }, 502);
      }
    } catch (e) {
      return c.json({ started: false, why: errText(e) }, 502);
    }
  });
  return { pass: async () => pass(await getSnapshot()), status: async () => statusOf(await getSnapshot()) };
}
