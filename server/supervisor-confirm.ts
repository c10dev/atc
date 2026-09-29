import type { Session } from "./model.ts";

// SUPERVISOR CONFIRM AT AIRCRAFT(ATC-120, docs/dispatch.md "ATC-120 as built").
// 사용자 등급 파일(deploy/landing-tier.mjs의 USER: guard, .claude/, 루트 CLAUDE.md, .github/, package*.json, hooks/, deploy/)을 만질 FLIGHT는
// AIRCRAFT가 SUPERVISOR의 go를 세션 안에서 직접 묻는다. 승인할 때 그걸 미리 알리려고 예측 경로로 표시만 한다.
// atc도 OCC도 그 go를 대신 보내지 않는다 — 여기 문구는 SUPERVISOR가 AIRCRAFT 세션에 직접 붙여 넣는 한 줄이다.

// deploy/는 사용자 등급이라 타입 파일을 두지 않고 동적으로 읽는다(mcc.ts와 같다). 서버는 ESM이라 최상위 await로 한 번 읽는다
type TierOf = (files: string[]) => { tier: "auto" | "flagged" | "user"; reasons: { file: string; tier: string; why: string }[] };
const { tierOf } = (await import(new URL("../deploy/landing-tier.mjs", import.meta.url).href)) as { tierOf: TierOf };

// 사용자 등급 경로만(순수). 예측이 비었거나 어느 경로도 사용자 등급이 아니면 빈 배열 — 모르는 경로로는 표시를 세우지 않는다
export function supervisorConfirmOf(predicted: readonly string[], tier: TierOf = tierOf): string[] {
  const out: string[] = [];
  for (const p of predicted) if (!out.includes(p) && tier([p]).tier === "user") out.push(p);
  return out;
}

const SHOWN = 4;
const pathsText = (paths: readonly string[]) => (paths.length > SHOWN ? `${paths.slice(0, SHOWN).join(", ")} and ${paths.length - SHOWN} more` : paths.join(", "));

// SUPERVISOR가 그 AIRCRAFT 세션에 붙여 넣을 한 줄(서버가 만든다). 승인 뜻은 SUPERVISOR가 거기서 직접 친 것이다 — atc는 보내지 않는다
export function confirmLineOf(p: { id: string; flight: string; supervisorConfirm?: string[] }): string | null {
  if (!p.supervisorConfirm?.length) return null;
  return `${p.id} (${p.flight}): SUPERVISOR go for ${pathsText(p.supervisorConfirm)} edits in this FLIGHT.`;
}

// 그 세션을 여는 법
export const confirmOpenOf = (registration: string | null) => `${registration ?? "그 REGISTRATION"} 세션 열기: 터미널에서 \`claude agents\` → ${registration ?? "그 REGISTRATION"} 선택`;

// 표시 한 벌: DISPATCH 카드와 승인 창이 그대로 쓴다
export function confirmViewOf(p: { id: string; flight: string; supervisorConfirm?: string[]; registration?: string; aircraftName: string | null }) {
  const line = confirmLineOf(p);
  return line ? { paths: p.supervisorConfirm!, line, open: confirmOpenOf(p.registration ?? p.aircraftName) } : null;
}

// ── 대기 경보: CAPTAIN이 READBACK도 거절도 아닌 채 사용자의 go를 기다린다 ──
export interface AwaitAlert {
  key: string;
  message: string;
  sessionIds: string[];
}
export const AWAIT_NEXT = "SUPERVISOR가 그 AIRCRAFT 세션에서 직접 go를 친다(atc는 대신 보내지 않는다)";
export function awaitSupervisorAlerts(
  proposals: { id: string; flight: string; kind: string; status: string; aircraftName: string | null; awaitSupervisor?: { at: string; reason: string } }[],
  sessions: Pick<Session, "id" | "name" | "status">[],
): AwaitAlert[] {
  const out: AwaitAlert[] = [];
  for (const p of proposals) {
    if (p.kind !== "ASSIGN" || p.status !== "sent" || !p.awaitSupervisor) continue;
    const ids = sessions.filter((s) => s.status !== "dead" && s.name === p.aircraftName).map((s) => s.id);
    out.push({
      key: `health|AWAIT-SUPERVISOR|${p.id}`,
      sessionIds: ids,
      message: `AWAITING SUPERVISOR — ${p.aircraftName ?? "AIRCRAFT"}의 CAPTAIN이 ${p.id}(${p.flight})에서 사용자의 go를 기다림: ${p.awaitSupervisor.reason} — ${AWAIT_NEXT}`,
    });
  }
  return out;
}
