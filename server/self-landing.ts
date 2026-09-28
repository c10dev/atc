import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { foldLander, landerGateOf, type LanderLine } from "../deploy/lander.mjs";
import { config } from "./config.ts";
import type { Snapshot } from "./model.ts";

// SELF-LANDING(docs/self-landing.md). 판단·기록은 서버 밖 lander(deploy/lander.mjs, systemd 타이머 atc-lander)가 한다.
// 서버는 그 상태 파일과 기록을 읽어 LANDING SEQUENCE 머리에 보여 주기만 한다 — 깨진 서버가 lander를 막지 않게.

// lander가 맡는 GitHub 저장소(deploy/lander.mjs와 같은 값). 스냅샷의 PR 중 이 저장소 것만 보인다
const ATC_REPO = process.env.ATC_LANDER_REPO || "chaehy5665/atc";
const isAtcPull = (url: string) => url.includes(`github.com/${ATC_REPO}/pull/`);

function readLines(file: string): LanderLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as LanderLine];
    } catch {
      return [];
    }
  });
}

export function selfLandingView(s: Pick<Snapshot, "pulls">, stateDir = config.stateDir) {
  const lines = readLines(join(stateDir, "self-landing.jsonl"));
  let state: { mode?: string; groundStop?: { reason?: string; pr?: number; at?: string } | null } | null = null;
  try {
    state = JSON.parse(readFileSync(join(stateDir, "self-landing.json"), "utf8"));
  } catch {}
  const fold = new Map(foldLander(lines).map((x) => [x.pr, x]));
  const prs = s.pulls
    .filter((p) => isAtcPull(p.url) && !p.draft)
    .sort((a, b) => a.number - b.number)
    .map((p) => {
      const last = fold.get(p.number)?.last ?? null;
      // 지금 head를 아직 판정하지 않았으면 다음 주기에(옛 head의 판정은 보이되 표시)
      return { number: p.number, head: p.head, evaluated: last ? { head: last.head, verdict: last.verdict, readyExceptReview: last.readyExceptReview, reasons: last.reasons, t: last.t } : null, current: Boolean(last && last.head === p.head) };
    });
  return {
    running: Boolean(state || lines.length), // lander가 한 번이라도 돌았나(타이머를 설치하기 전에는 false)
    mode: state?.mode ?? (lines.length ? "shadow" : null),
    groundStop: state?.groundStop ?? null,
    lastAt: lines.at(-1)?.t ?? null,
    prs,
    gate: landerGateOf(lines),
  };
}
export type SelfLandingView = ReturnType<typeof selfLandingView>;

export function mountSelfLanding(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/self-landing", async (c) => c.json(selfLandingView(await getSnapshot())));
}
