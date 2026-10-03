import { signalsOf } from "./duty-review.ts";
import type { PlanFacts } from "./flow.ts";

// FLOW(ATC-468): DISPATCH 계획에서 표본에 싣는 두 사실을 읽는다. signalsOf가 읽는 것과 같다(놀고 있는 AIRCRAFT, 기다리는 FLIGHT).
// jobs/dispatch.ts가 계획을 세운 뒤 적고 jobs/sample.ts가 표본을 쓸 때 읽는다. 계획을 세운 지 FACTS_FRESH_MS가 지났으면 싣지 않는다(옛 값을 지어내지 않는다)
export const FACTS_FRESH_MS = 10 * 60_000;

export function planFactsOf(plan: unknown): PlanFacts {
  const s = signalsOf({ plan }, [], 0);
  return { available: s.idleAircraft.length, waiting: s.waitingFlights.length };
}

let noted: { at: number; facts: PlanFacts } | null = null;
export const noteFacts = (facts: PlanFacts, now: number) => void (noted = { at: now, facts });
export const factsNow = (now: number): PlanFacts | null => (noted && now - noted.at <= FACTS_FRESH_MS ? noted.facts : null);
export const resetFacts = () => void (noted = null);
