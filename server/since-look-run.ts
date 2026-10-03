import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import type { Snapshot } from "./model.ts";
import { milestonesNow } from "./milestones-run.ts";
import { fromThisApp } from "./origin.ts";
import { readReleaseLines } from "./release-store.ts";
import { nextLook, type SinceLook, sinceLookOf } from "./since-look.ts";
import type { SupervisorAlert } from "./supervisor-alerts.ts";

// SINCE YOU LAST LOOKED의 읽기와 마커(ATC-383). 계산은 since-look.ts(순수).
// 마커는 모든 클라이언트(브라우저·메뉴 막대)가 같이 쓰는 한 시각이다: `since-look.json`(상태 폴더, 원자적으로 바꿔 쓴다). 앞으로만 가고, 없으면 지금으로 시작한다.
// 읽기 쪽(GET, 요약, 메뉴 막대)은 마커를 옮기지 않는다. 옮기는 것은 SUPERVISOR의 화면이 보냈을 때뿐이다(POST /api/since-look/seen).

const FILE = () => join(config.stateDir, "since-look.json");
export const CACHE_MS = 5_000;

export function readLook(now = Date.now(), persist = true): string {
  try {
    const j = JSON.parse(readFileSync(FILE(), "utf8")) as { at?: unknown };
    if (typeof j.at === "string" && Number.isFinite(Date.parse(j.at))) return j.at;
  } catch {} // 없거나 깨짐: 지금부터 센다
  const at = new Date(now).toISOString();
  if (persist && !existsSync(FILE())) writeLook(at);
  return at;
}

function writeLook(at: string) {
  try {
    mkdirSync(dirname(FILE()), { recursive: true });
    const tmp = `${FILE()}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ at }) + "\n");
    renameSync(tmp, FILE());
  } catch {} // 못 써도 화면은 그려진다(다음에 다시 옮긴다)
}

let cache: { at: number; look: string; value: SinceLook } | null = null;

// 알림 목록(items)에서 막힘(follow|stuck)과 SUPERVISOR 대기(cue call)를 읽고, 발권 기록과 OOOI에서 본 뒤의 일을 센다
// persist=false: 마커 파일이 없어도 만들지 않는다(GET /api/flow는 상태 폴더에 쓰지 않는다, ATC-499)
export function sinceLookNow(s: Pick<Snapshot, "pulls" | "airports">, items: readonly SupervisorAlert[], now = Date.now(), persist = true): SinceLook {
  const look = readLook(now, persist);
  if (cache && cache.look === look && now - cache.at < CACHE_MS) return cache.value;
  let releases: { flight: string; at: string }[] = [];
  let milestones: ReturnType<typeof milestonesNow> = new Map();
  try {
    releases = readReleaseLines().flatMap((l) => (l.op === "release" ? [{ flight: l.flight, at: l.at }] : []));
    milestones = milestonesNow(s, now);
  } catch {} // 기록을 못 읽으면 센 것만 비운다(막힘·대기는 그대로)
  const value = sinceLookOf({
    lastLook: look,
    releases,
    milestones,
    stuckFlights: items.filter((i) => i.key.startsWith("follow|stuck|")).map((i) => i.flight ?? i.key.split("|")[2]!),
    waiting: items.filter((i) => i.cue === "call").map((i) => ({ key: i.key, text: i.text, link: i.link })),
  });
  cache = { at: now, look, value };
  return value;
}

export function mountSinceLook(app: Hono, getSnapshot: () => Promise<Snapshot>, items: () => readonly SupervisorAlert[]) {
  app.get("/api/since-look", async (c) => c.json({ at: new Date().toISOString(), ...sinceLookNow(await getSnapshot(), items()) }));
  // 마커를 앞으로 옮긴다. 본문 { at }(화면이 그린 시각)이 있으면 거기까지, 없으면 지금. SUPERVISOR의 화면만(Origin 검사)
  app.post("/api/since-look/seen", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const body = (await c.req.json().catch(() => null)) as { at?: unknown } | null;
    const now = Date.now();
    const at = nextLook(readLook(now), typeof body?.at === "string" ? body.at : null, now);
    writeLook(at);
    cache = null;
    return c.json({ ok: true, since: at });
  });
}
