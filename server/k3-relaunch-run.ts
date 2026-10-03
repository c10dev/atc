import { loadDispatchConfig } from "./dispatch.ts";
import { allFleetPlan } from "./fleet-plan-run.ts";
import { type K3RelaunchMisfires, k3RelaunchMisfiresOf } from "./k3-relaunch.ts";
import { readRecords } from "./recorder.ts";

const WINDOW_MS = 7 * 86_400_000;

// 지금 상태에서 센 K3 RELAUNCH 오작동(읽기만). FLEET PLAN 카드와 FLIGHT RECORDER의 STOP·LAUNCH 줄(카드 id가 같다)을 견준다. 7일 안
export function k3RelaunchMisfiresNow(now = Date.now()): K3RelaunchMisfires {
  const records = readRecords(now - WINDOW_MS).flatMap((r) => {
    if (r.kind !== "fleet" || (r.op !== "stop" && r.op !== "launch")) return [];
    const proposal = (r as { proposal?: string }).proposal;
    return [{ t: r.t, op: r.op as string, aircraft: r.aircraft, ok: r.ok, ...(proposal ? { proposal } : {}) }];
  });
  const proposals = allFleetPlan().filter((p) => Date.parse(p.at) >= now - WINDOW_MS);
  return k3RelaunchMisfiresOf({ proposals, records, timeoutMin: loadDispatchConfig().launchCardTimeoutMin, now });
}
