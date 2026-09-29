// 세션이 어디서 도는가(ATC-76): BACKGROUND(`claude --bg`, atc가 띄움), DESKTOP(Claude 데스크톱 앱의 원격 세션),
// TERMINAL(셸에서 연 `claude`). atc가 멈추고 다시 띄울 수 있는 것은 BACKGROUND뿐이라, STOP·RESTART·REFRESH가 이것을 본다.
// 여기는 순수 함수만(화면도 쓴다). 프로세스 읽기는 session-proc.ts. 설계: docs/fleet.md 8.5

export type SessionOrigin = "background" | "desktop" | "terminal" | "unknown";

export const ORIGIN_BADGE: Record<SessionOrigin, string> = { background: "BG", desktop: "DESKTOP", terminal: "TERM", unknown: "?" };

// `--permission-mode <m>`이나 `--permission-mode=<m>`(마지막 것). 없으면 null
export function permissionModeOf(argv: readonly string[] | null): string | null {
  let mode: string | null = null;
  for (let i = 0; i < (argv?.length ?? 0); i++) {
    const a = argv![i];
    if (a === "--permission-mode" && argv![i + 1] && !argv![i + 1].startsWith("--")) mode = argv![i + 1];
    else if (a.startsWith("--permission-mode=")) mode = a.slice("--permission-mode=".length) || mode;
  }
  return mode;
}

const DESKTOP = /\/\.claude\/remote\//; // ~/.claude/remote/ccd-cli/<버전>(세션), ~/.claude/remote/srv/<해시>/server(부모)
const BG = /^(bg-spare|bg-pty-host|--bg-spare|--bg-pty-host)$/; // 백그라운드 daemon이 띄운 세션(`claude bg-spare …`)
// 셸에서 연 claude: `claude`, `…/bin/claude`, 설치된 실행 파일 `…/claude/versions/<버전>`
const PLAIN = /(^|\/)claude$|\/claude\/versions\/[\w.-]+$/;

export interface OriginInput {
  kind?: string | null; // 세션 파일(bg·interactive)이나 `claude agents --json`(background·interactive)의 kind
  entrypoint?: string | null; // 세션 파일의 entrypoint(claude-desktop·cli). 프로세스를 못 읽을 때만 본다
  argv: readonly string[] | null; // /proc/<pid>/cmdline. 못 읽었으면 null
  parentArgv?: readonly string[] | null;
}

// 순수. 백그라운드는 kind가 정한다. 나머지는 명령줄: ~/.claude/remote/ 아래면 DESKTOP, 그냥 claude면 TERMINAL, 그 밖은 모름
export function originOf(i: OriginInput): SessionOrigin {
  if (i.kind === "background" || i.kind === "bg") return "background";
  const argv = i.argv ?? [];
  const parent = i.parentArgv ?? [];
  if (argv.slice(0, 2).some((a) => BG.test(a)) || parent.slice(0, 2).some((a) => BG.test(a))) return "background";
  if (DESKTOP.test(argv[0] ?? "") || DESKTOP.test(parent[0] ?? "")) return "desktop";
  if (PLAIN.test(argv[0] ?? "")) return "terminal";
  if (!i.argv) return i.entrypoint === "claude-desktop" ? "desktop" : "unknown";
  return "unknown";
}

export const isBackground = (o: SessionOrigin | null | undefined) => o === "background";

const ORIGIN_TITLE: Record<SessionOrigin, string> = {
  background: "atc가 띄운 백그라운드 세션(claude --bg) — atc가 STOP·다시 띄우기를 한다. claude attach로 열 수 있다",
  desktop: "Claude 데스크톱 앱의 원격 세션 — atc가 멈추거나 다시 띄우지 않는다. 앱 연결에 달려 있다",
  terminal: "셸에서 연 claude — atc가 멈추거나 다시 띄우지 않는다",
  unknown: "출처를 모름 — 프로세스 명령줄을 읽지 못했거나 알 수 없는 모양. atc가 멈추거나 다시 띄우지 않는다",
};
// FLEET 줄·카드의 작은 표시(순수): BG·DESKTOP·TERM과 permission mode. id는 툴팁에만
// id: 백그라운드의 jobId(ATC-98). 있으면 툴팁이 `BG <jobId> — claude attach <jobId>`를 싣고, attach가 그 명령이다(카드의 복사 버튼)
export function originBadgeOf(origin: SessionOrigin | null | undefined, permissionMode: string | null | undefined, id?: string | null) {
  if (!origin) return null;
  const mode = permissionMode ?? null;
  const jobId = origin === "background" && id ? id : null;
  const attach = jobId ? attachCommandOf(jobId) : null;
  const title = [ORIGIN_TITLE[origin], jobId ? `BG ${jobId} — ${attach}` : null, `permission mode ${mode ?? "모름"}`].filter(Boolean).join(" · ");
  return { origin, badge: ORIGIN_BADGE[origin], mode, title, attach };
}
// 백그라운드 세션을 여는 명령
export const attachCommandOf = (jobId: string) => `claude attach ${jobId}`;

// 백그라운드가 아닌 세션을 멈추거나 새로 시작하는 손 절차(atc가 하지 않는다). action: stop(멈춤), restart(새 CREW BRIEFING으로 다시), refresh(대화 비우기)
export function manualStepsOf(origin: SessionOrigin | null | undefined, reg: string, action: "stop" | "restart" | "refresh"): string {
  const what = origin === "desktop" ? "데스크톱(Claude 앱) 세션" : origin === "terminal" ? "터미널 세션" : "백그라운드가 아닌 세션";
  const close = origin === "desktop" ? "Claude 앱에서 그 세션을 닫는다" : origin === "terminal" ? "그 터미널에서 /exit로 claude를 닫는다" : "그 세션 창을 닫는다";
  const inside = origin === "desktop" ? "Claude 앱의 그 세션에서" : origin === "terminal" ? "그 터미널의 claude에서" : "그 세션에서";
  const step =
    action === "stop"
      ? close
      : action === "refresh"
        ? `${inside} /clear, 그다음 FLEET 카드의 CREW BRIEFING을 붙여 넣는다`
        : `${close.replace(/는다$/, "고")}, 새 세션을 이름 ${reg}로 열어 FLEET 카드의 CREW BRIEFING을 붙여 넣는다`;
  return `${reg}는 ${what} — atc가 ${action === "stop" ? "멈추지" : "다시 띄우지"} 않는다. SUPERVISOR: ${step}`;
}

// 2b 전달(ATC-76): FLIGHT PLAN을 받을 세션의 permission mode가 OCC와 다르면, 그 세션이 cross-session 메시지를
// 사용자 승인까지 붙들 수 있다(NO READBACK). 둘 다 알 때만 경고한다(순수). 막지 않는다
export interface Delivery {
  origin: SessionOrigin | null;
  mode: string | null;
  occMode: string | null;
  warn: { label: string; title: string } | null;
}
export function deliveryOf(target: { origin?: SessionOrigin | null; permissionMode?: string | null } | null, occMode: string | null): Delivery {
  const origin = target?.origin ?? null;
  const mode = target?.permissionMode ?? null;
  const warn =
    mode && occMode && mode !== occMode
      ? {
          label: `MODE ${mode} ≠ OCC ${occMode}`,
          title: `이 AIRCRAFT의 permission mode(${mode})가 OCC(${occMode})와 다르다. 모드가 다른 세션은 cross-session 메시지를 사용자 승인까지 붙들 수 있어 FLIGHT PLAN이 NO READBACK이 될 수 있다${origin === "desktop" ? " — 데스크톱 세션이면 앱에서 메시지를 승인하거나 모드를 맞춘다" : ""}`,
        }
      : null;
  return { origin, mode, occMode, warn };
}

// 백그라운드 세션의 permission mode: 그 세션을 띄운 LAUNCH 기록(FLIGHT RECORDER). 세션 시작 전후 2분 안의 성공한 LAUNCH 중 마지막(순수)
export function launchModeOf(records: { t: string; ok: boolean; permissionMode?: string }[], startedAt: string | number | null): string | null {
  const start = typeof startedAt === "number" ? startedAt : startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(start)) return null;
  const near = records.filter((r) => r.ok && r.permissionMode && Math.abs(Date.parse(r.t) - start) <= 2 * 60_000);
  return near.at(-1)?.permissionMode ?? null;
}
