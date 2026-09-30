// LAUNCH ACCOUNT(ATC-239, docs/accounts.md "LAUNCH ACCOUNT as built"): 다음 LAUNCH가 쓸 ACCOUNT를 종류마다 하나 정하는 설정. 순수.
// fleet.json 최상위 `launchAccount` = { aircraft?: "<라벨>", control?: "<라벨>" }. AIRCRAFT의 home(프로필 account)은 그대로고, 이 설정은 이름을 대지 않은 LAUNCH의 기본만 바꾼다.
// 없으면(또는 "각 home") 전과 같다. 등록부에서 지워진 라벨은 무시하고 home으로 돌아가며 경고로 보인다. 돌고 있는 세션은 옮기지 않는다(그것은 ACCOUNT CHANGE).
import { ACCOUNT_RE } from "./crew.ts";

export const LAUNCH_KINDS = ["aircraft", "control"] as const;
export type LaunchKind = (typeof LAUNCH_KINDS)[number];
export type LaunchAccountSetting = Partial<Record<LaunchKind, string>>;

// 파일에서 읽을 때: 모양이 맞는 칸만(알 수 없는 칸·잘못된 값은 버린다). 옛 파일엔 없다
export function launchSettingOf(raw: unknown): LaunchAccountSetting {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: LaunchAccountSetting = {};
  for (const k of LAUNCH_KINDS) {
    const v = o[k];
    if (typeof v === "string" && ACCOUNT_RE.test(v)) out[k] = v;
  }
  return out;
}

// 실제로 쓸 라벨. 등록된 라벨이면 그것, 아니면 null(home으로)과 경고
export function effectiveLaunchAccount(setting: LaunchAccountSetting, kind: LaunchKind, registered: readonly string[]): { label: string | null; warning: string | null } {
  const label = setting[kind];
  if (!label) return { label: null, warning: null };
  if (registered.includes(label)) return { label, warning: null };
  return { label: null, warning: `LAUNCH ACCOUNT(${kind === "aircraft" ? "AIRCRAFT" : "관제 세션"}) ${label}가 등록부에 없음 — 무시하고 각 home을 쓴다` };
}

// PUT 본문 검사. 본문에 적힌 칸만 바꾼다: 라벨이면 그것(등록된 것만), null·""이면 지운다("각 home"). 모르는 칸이나 잘못된 값은 거절
export type PatchResult = { ok: true; next: LaunchAccountSetting } | { ok: false; error: string; status: 400 | 409 };
export function launchSettingPatchOf(current: LaunchAccountSetting, body: unknown, registered: readonly string[]): PatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "본문은 { aircraft?, control? } 객체", status: 400 };
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !(LAUNCH_KINDS as readonly string[]).includes(k));
  if (unknown.length) return { ok: false, error: `모르는 칸: ${unknown.join(", ")} (aircraft, control)`, status: 400 };
  if (!LAUNCH_KINDS.some((k) => k in b)) return { ok: false, error: "aircraft나 control 중 하나는 있어야 함", status: 400 };
  const next: LaunchAccountSetting = { ...current };
  for (const k of LAUNCH_KINDS) {
    if (!(k in b)) continue;
    const v = b[k];
    if (v === null || v === "") {
      delete next[k];
      continue;
    }
    if (typeof v !== "string" || !ACCOUNT_RE.test(v.trim().toLowerCase())) return { ok: false, error: `${k}는 등록부의 ACCOUNT 라벨(소문자·숫자·-)이거나 비움("각 home")`, status: 400 };
    const label = v.trim().toLowerCase();
    if (!registered.length) return { ok: false, error: "ACCOUNT 등록부가 비어 있음 — 먼저 ACCOUNTS에서 등록한다", status: 409 };
    if (!registered.includes(label)) return { ok: false, error: `등록되지 않은 ACCOUNT: ${label} (등록: ${registered.join(", ")})`, status: 409 };
    next[k] = label;
  }
  return { ok: true, next };
}
