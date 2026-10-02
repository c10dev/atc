import type { AccountFolder } from "./accounts.ts";
import type { FuelConfig, FuelRemaining } from "./fuel-remaining.ts";

// ACCOUNT 요금제·사용량(ATC-348, docs/accounts.md "PLAN and USAGE as built"). 순수 함수만 둔다(설정 창도 쓴다). 실행은 account-usage-run.ts.
// 쓴 몫은 두 곳에서 온다: statusline 기록(FUEL REMAINING, 세션이 돌 때)과 REFRESH가 돌린 `claude -p "/usage"`(세션이 없어도).
// /usage 출력에서는 한도 줄의 %와 reset만 남기고 나머지 줄(email·조직이 섞여도)은 버린다. 읽지 못하면 0 %가 아니라 "알 수 없음"이다.

export interface UsageWindow {
  name: string; // five_hour · seven_day · seven_day:<모델> (statusline 것은 spend_limit도)
  pct: number; // 쓴 몫 0–100
  resetsAt: string | null; // 모르면 null
}

export interface UsageRead {
  at: string; // 읽은 시각
  windows: UsageWindow[];
  reason: string | null; // 창이 하나도 없을 때의 이유
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

// 순수: "Oct 8, 10am (UTC)" · "Oct 2, 6:59am (UTC)" · "3pm (UTC)" → ISO. 해가 없으므로 지금에서 가장 가까운 앞날로 고른다.
// 서버가 TZ=UTC로 돌리므로 (UTC)가 아닌 글은 읽지 않는다(null)
export function resetOf(text: string, now: number): string | null {
  const m = /^(?:([A-Z][a-z]{2}) (\d{1,2}), )?(\d{1,2})(?::(\d{2}))?\s?(am|pm) \(UTC\)$/i.exec(text.trim());
  if (!m) return null;
  const hour = Number(m[3]);
  const minute = m[4] ? Number(m[4]) : 0;
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const h = (hour % 12) + (m[5].toLowerCase() === "pm" ? 12 : 0);
  const today = new Date(now);
  if (m[1]) {
    const month = MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
    const day = Number(m[2]);
    if (month < 0 || day < 1 || day > 31) return null;
    let t = Date.UTC(today.getUTCFullYear(), month, day, h, minute);
    if (t < now - DAY_MS) t = Date.UTC(today.getUTCFullYear() + 1, month, day, h, minute);
    return new Date(t).toISOString();
  }
  let t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h, minute);
  if (t < now - 60_000) t += DAY_MS;
  return new Date(t).toISOString();
}

const LINE = /^Current (session|week \(([^)]{1,40})\)): (\d{1,3}(?:\.\d+)?)% used(?: · resets (.{1,40}))?$/;
const MODEL = /^[\w .-]{1,40}$/;

// 순수: /usage 글 → 한도 창. 다른 줄은 읽지 않는다
export function usageWindowsOf(text: string, now: number): UsageWindow[] {
  const out: UsageWindow[] = [];
  for (const raw of text.split("\n")) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    let name: string;
    if (m[1] === "session") name = "five_hour";
    else if (m[2] === "all models") name = "seven_day";
    else if (MODEL.test(m[2])) name = `seven_day:${m[2]}`;
    else continue;
    if (out.some((w) => w.name === name)) continue;
    out.push({ name, pct: Math.min(100, Number(m[3])), resetsAt: m[4] ? resetOf(m[4], now) : null });
  }
  return out;
}

// 순수: `claude -p "/usage" --output-format json`의 stdout → 읽은 값. 남기는 것은 창과 이유뿐이다
export function usageReadOf(stdout: string, now: number): UsageRead {
  const at = new Date(now).toISOString();
  let d: Record<string, unknown> | null;
  try {
    d = JSON.parse(stdout) as Record<string, unknown> | null;
  } catch {
    return { at, windows: [], reason: stdout.trim() ? "claude 출력을 읽지 못함" : "claude가 답하지 않음(없거나 시간 초과)" };
  }
  if (!d || typeof d !== "object" || d.type !== "result" || typeof d.result !== "string") return { at, windows: [], reason: "claude 출력 모양이 다름" };
  if (d.is_error === true) return { at, windows: [], reason: "claude가 오류를 냄(로그인을 확인)" };
  const windows = usageWindowsOf(d.result, now);
  return { at, windows, reason: windows.length ? null : "/usage에 한도 줄이 없음(API 키 로그인이거나 한도를 받지 못함)" };
}

// ── 화면 한 칸: 창마다 쓴 몫·남은 몫·reset, 어디서 언제 온 값인가 ──

export const STALE_MS = 30 * 60_000; // 이보다 오래된 값은 "오래됨"으로 보인다

export interface PlanUsageWindow {
  name: string;
  label: string; // 5h · 7d · 7d Fable · spend
  used: number;
  left: number; // 100 − 반올림한 used(둘을 따로 반올림하면 합이 101 %가 된다)
  resetsAt: string | null;
  level: "ok" | "info" | "hold"; // FUEL 임계값(dispatch.json fuel) 기준
}

export interface PlanUsageView {
  windows: PlanUsageWindow[];
  source: "statusline" | "usage" | null; // null: 알 수 없음
  at: string | null;
  from: string | null; // statusline이면 그 값을 적은 세션(REGISTRATION이나 관제 이름)
  stale: boolean;
  reason: string | null; // 알 수 없을 때, 또는 마지막 REFRESH가 실패했을 때
}

const ORDER = (name: string) => (name === "five_hour" ? 0 : name === "seven_day" ? 1 : name.startsWith("seven_day:") ? 2 : 3);
export const windowLabel = (name: string) =>
  name === "five_hour" ? "5h" : name === "seven_day" ? "7d" : name.startsWith("seven_day:") ? `7d ${name.slice(10)}` : name === "spend_limit" ? "spend" : name;
const levelOf = (pct: number, cfg: FuelConfig): PlanUsageWindow["level"] => (pct >= cfg.holdPct ? "hold" : pct >= cfg.infoPct ? "info" : "ok");

// 순수: statusline 값(그 ACCOUNT의 FuelRemaining)과 마지막 /usage 값 가운데 더 새것. reset이 지난 창은 뺀다(그 몫은 이미 0으로 돌아갔지만 지금 값은 모른다)
export function planUsageOf(fuel: FuelRemaining | undefined, read: UsageRead | undefined, cfg: FuelConfig, now: number): PlanUsageView {
  const live = (ws: UsageWindow[]) => ws.filter((w) => w.resetsAt === null || Date.parse(w.resetsAt) > now);
  const fromRead = read ? live(read.windows) : [];
  const failed = read && !fromRead.length ? (read.reason ?? "/usage 값의 reset이 모두 지남") : null;
  const useRead = fromRead.length > 0 && (!fuel || Date.parse(read!.at) >= Date.parse(fuel.at));
  if (!fuel && !useRead) return { windows: [], source: null, at: null, from: null, stale: false, reason: failed ?? "기록 없음(이 ACCOUNT에서 도는 세션이 없다). REFRESH로 읽는다" };
  const at = useRead ? read!.at : fuel!.at;
  const windows = (useRead ? fromRead : fuel!.windows)
    .map((w) => ({ name: w.name, label: windowLabel(w.name), used: w.pct, left: Math.max(0, 100 - Math.round(w.pct)), resetsAt: w.resetsAt, level: levelOf(w.pct, cfg) }))
    .sort((a, b) => ORDER(a.name) - ORDER(b.name) || a.name.localeCompare(b.name));
  return {
    windows,
    source: useRead ? "usage" : "statusline",
    at,
    from: useRead ? null : fuel!.from,
    stale: now - Date.parse(at) > STALE_MS,
    reason: read && failed && Date.parse(read.at) >= Date.parse(at) ? `마지막 REFRESH 실패: ${failed}` : null,
  };
}

// 순수: 폴더 라벨 → 보기. statusline 값은 그 라벨의 ACCOUNT 것(라벨 없이 묶인 AIRCRAFT·관제 값은 폴더를 모르므로 쓰지 않는다), /usage 값은 폴더의 것
export function planUsageViewsOf(
  folders: readonly Pick<AccountFolder, "label" | "dir">[],
  fuelAccounts: readonly FuelRemaining[],
  reads: ReadonlyMap<string, UsageRead>,
  cfg: FuelConfig,
  now: number,
): Record<string, PlanUsageView> {
  return Object.fromEntries(folders.map((f) => [f.label, planUsageOf(fuelAccounts.find((x) => x.account === f.label), reads.get(f.dir), cfg, now)]));
}

// 요금제 칩 글: max → MAX. 모르면 null(칩을 그리지 않는다)
export const planText = (plan: string | null | undefined) => (plan ? plan.toUpperCase() : null);
