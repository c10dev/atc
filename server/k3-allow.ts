// K3 발권이 classifier에 닿는 길(ATC-372, docs/autonomy.md C9). 순수 함수만. 읽기·LAUNCH는 session-control.ts.
// SUPERVISOR가 발권한 FLIGHT가 선언한 K3 효과(이슈 본문 `## K effects`의 `K3[<라벨>]: <바꾸는 통제> | files: <경로, …>` 줄)로만
// FLIGHT별 `--settings`의 `autoMode.allow` 항목을 만든다. 서버만 만들고(발권 기록과 지금 본문의 해시가 같을 때만), 항목은 그 선언 말고는 없다.
// 항목은 이슈가 말한 soft_deny 라벨(Security Weaken …)을 이름으로 대고, 통제·파일·STAND·발권 id를 적는다.
import type { ReleaseChannel, ReleaseRecord, ReleaseView } from "./release.ts";
import { releaseStateOf } from "./release.ts";

// K3로 선언할 수 있는 라벨: `claude auto-mode defaults`의 soft_deny 가운데 K3에 닿는 것(ATC-372 이슈 "Map each declared K effect", ATC-399가 둘을 더했다).
// 나머지 soft_deny 라벨은 선언할 수 없다(SOFT_DENY_UNDECLARABLE): 이유와 함께 docs/autonomy.md C9에 모두 적는다
export const K3_LABELS = ["Security Weaken", "Self-Approval", "Permission Grant", "Self-Modification", "Merge Without Review", "Security Test Removal", "Instruction Poisoning"] as const;
export type K3Label = (typeof K3_LABELS)[number];

// 선언할 수 없는 soft_deny 라벨(`claude auto-mode defaults` 2026-10-02의 72개 가운데 나머지 65개)과 이유 묶음(ATC-399). 새 라벨은 이 표에도 K3_LABELS에도 없으면 선언할 수 없다.
// docs/autonomy.md·autonomy.ko.md C9의 표가 이 표와 같다(k3-allow.test.ts가 견준다). 라벨을 선언 가능으로 올리려면 다음 발권에서 K3_LABELS로 옮기고 allowEntryOf에 그 라벨의 "must name" 문구를 더한다
export type UndeclarableWhy = "production" | "destruction" | "exfiltration" | "outside-code" | "bypass";
export const UNDECLARABLE_WHY: Record<UndeclarableWhy, string> = {
  production: "Acts on production, shared or third-party systems. A released FLIGHT is code only (CODE_ONLY), so no declared effect maps to it.",
  destruction: "Destroys data that a revert PR cannot bring back. A code FLIGHT has no need for it.",
  exfiltration: "Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it.",
  "outside-code": "Brings code or packages from outside into the run. Supply-chain risk that a released declaration cannot judge.",
  bypass: "Switches off a check that auto mode itself relies on (logging, TLS, CI, sandbox, the classifier). A declaration cannot approve its own bypass.",
};
export const SOFT_DENY_UNDECLARABLE: Record<string, UndeclarableWhy> = {
  "Cloud Storage Mass Delete": "production",
  "Production Deploy": "production",
  "Remote Shell Writes": "production",
  "Sensitive Remote Exec": "production",
  "Production Reads": "production",
  "Blind Apply": "production",
  "Protected-Scope IaC Apply": "production",
  "Shared Cluster Mutation": "production",
  "Modify Shared Resources": "production",
  "DNS / Domain / Cert Changes": "production",
  "Node Lifecycle Operations": "production",
  "Cluster-Wide Workload Creation": "production",
  "Interfere With Workloads": "production",
  "Secret-Store Writes": "production",
  "Feature Flag Writes": "production",
  "Account & Standing-Rule Changes": "production",
  "Real-World Transactions": "production",
  "External System Writes": "production",
  "Unrequested Commit in a Connected App": "production",
  "ChatOps Trigger Comments": "production",
  "Third-Party Attack": "production",
  "Git Destructive": "destruction",
  "Irreversible Local Destruction": "destruction",
  "Unverifiable Deletion Target": "destruction",
  "Shared Scratch Sweep": "destruction",
  "Irreversible Deletion (general)": "destruction",
  "Unverifiable Deletion Scope": "destruction",
  "Code That Leaks When Run": "exfiltration",
  "Credential Leakage": "exfiltration",
  "Credential Materialization": "exfiltration",
  "Credential Exploration": "exfiltration",
  "PII Data Handling": "exfiltration",
  "Exfil Scouting": "exfiltration",
  "Traffic Redirection": "exfiltration",
  "Remote Repoint": "exfiltration",
  "Out-of-Place Publication": "exfiltration",
  "Sensitive-Source Provenance": "exfiltration",
  "Excess Sensitive Detail": "exfiltration",
  "Unrequested Artifact Publish": "exfiltration",
  "Live-Shared Artifact Sensitive Delta": "exfiltration",
  "Sandbox Network Callback": "exfiltration",
  "Command Network Lists": "exfiltration",
  "Containment Escape": "exfiltration",
  "Create Public Surface": "exfiltration",
  "Public Data-Sharing Upload": "exfiltration",
  "Expose Local Services": "exfiltration",
  "External Ingress Tunnel": "exfiltration",
  "Browser Navigate Exfil": "exfiltration",
  "Browser Input Exfil": "exfiltration",
  "Browser JS Exfil": "exfiltration",
  "Browser File Upload Exfil": "exfiltration",
  "Browser Shortcut Execution": "exfiltration",
  "Code from External": "outside-code",
  "Untrusted Code Integration": "outside-code",
  "Package Registry Bypass": "outside-code",
  "Logging/Audit Tampering": "bypass",
  "TLS/Auth Weaken": "bypass",
  "Safety Bypass Flag": "bypass",
  "Create Unsafe Agents": "bypass",
  "CI Bypass": "bypass",
  "Create RCE Surface": "bypass",
  "Unauthorized Persistence": "bypass",
  "Tmux Self Drive": "bypass",
  "Auto-Mode Bypass": "bypass",
  "Session Transcript Tampering": "bypass",
};

export interface K3Declaration {
  label: K3Label;
  control: string; // 바꾸는 통제(글)
  files: string[]; // 저장소 기준 상대 경로. 글롭·절대 경로·`..`은 받지 않는다
}

const MAX_CONTROL = 200;
const MAX_FILES = 20;
const FILE_RE = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+-][A-Za-z0-9._@+/-]*$/; // 공백·글롭(*?[])·절대 경로·`..` 없음
// `K3: none`처럼 효과가 없다고 적은 줄(ATC-398): hold되지만 효과가 없었으니 nuisance로 센다
const NO_EFFECT_RE = /^\s*(?:[-*+]\s+)?K3\s*:?\s*(?:none|no|n\/a|nil|없음|해당 없음|[-—–])\s*\.?\s*$/i;
const LINE_RE = /^\s*(?:[-*+]\s+)?K3\s*\[([^\]]+)\]\s*:\s*(.+?)\s*\|\s*files?\s*:\s*(.+?)\s*$/i;

// Linear는 본문을 Markdown으로 저장하며 기호 앞에 역슬래시를 둔다(`K3\[Security Weaken\]: …`, `k3\_allow.ts`).
// CommonMark의 역슬래시 이스케이프(ASCII 기호 앞의 `\`)를 되돌린 줄로 읽는다(ATC-399). 이스케이프가 없는 글은 그대로다
export const unescapeMarkdown = (line: string): string => line.replace(/\\([!-/:-@[-`{-~])/g, "$1");

// 본문 `## K effects`에서 K3 선언을 읽는다. 모양이 맞지 않는 `K3` 줄은 unparsed로 센다(항목을 만들지 않는다: 닫는 쪽으로 틀린다)
export function k3DeclarationsOf(description: string | null | undefined): { declared: K3Declaration[]; unparsed: number; lines: number; none: number } {
  const section = (() => {
    // release.ts sectionsOf는 글을 한 줄로 뭉치므로 줄 단위가 필요한 이 읽기는 `## K effects` 절(같은 절 이름 규칙)만 따로 자른다
    let cur = false;
    const lines: string[] = [];
    for (const raw of (description ?? "").split("\n")) {
      const line = unescapeMarkdown(raw);
      const h = /^#{1,6}\s+(.*?)\s*$/.exec(line);
      if (h) {
        cur = /^(?:k effects?|k 효과)$/i.test(h[1]!.replace(/[:：]$/, ""));
        continue;
      }
      if (cur) lines.push(line);
    }
    return lines;
  })();
  const declared: K3Declaration[] = [];
  let unparsed = 0;
  let lines = 0;
  let none = 0;
  for (const line of section) {
    if (!/^\s*(?:[-*+]\s+)?K3\b/i.test(line)) continue;
    lines++;
    const m = LINE_RE.exec(line);
    const label = m ? K3_LABELS.find((l) => l.toLowerCase() === m[1]!.trim().toLowerCase()) : undefined;
    const control = m ? m[2]!.replace(/\s+/g, " ").trim() : "";
    const files = m ? [...new Set(m[3]!.split(",").map((f) => f.trim().replace(/^`|`$/g, "")).filter(Boolean))] : [];
    if (!label || !control || control.length > MAX_CONTROL || !files.length || files.length > MAX_FILES || !files.every((f) => FILE_RE.test(f))) {
      unparsed++;
      if (NO_EFFECT_RE.test(line)) none++;
      continue;
    }
    declared.push({ label, control, files });
  }
  return { declared, unparsed, lines, none };
}

// 발권 id: 어느 발권(FLIGHT·승인한 내용의 해시)이 이 항목을 낳았나. 발권 기록에는 따로 id가 없어 FLIGHT와 해시로 쓴다
export const releaseIdOf = (flight: string, r: Pick<ReleaseRecord, "hash">) => `${flight}@${r.hash}`;

// STAND(워크트리): 새 AIRCRAFT가 만들 폴더. FLIGHT 키로 이름이 시작한다(`EnterWorktree name=atc-<n>-…`)
export const standOf = (repo: string, flight: string) => `${repo.replace(/\/+$/, "")}/.claude/worktrees/${flight.toLowerCase()}-*`;

export const CODE_ONLY = "Code only; nothing is executed against production during the FLIGHT.";

// autoMode.allow 항목 하나(선언 하나). 라벨을 이름으로 대고, 통제·파일·STAND·발권 id를 말한다
export function allowEntryOf(d: K3Declaration, ctx: { flight: string; release: string; stand: string }): string {
  // 라벨마다 classifier가 "must name"으로 요구하는 글이 다르다(`claude auto-mode defaults`): 아래 둘은 선언의 통제 칸이 그 글을 채운다(ATC-399)
  if (d.label === "Security Test Removal") {
    return (
      `${d.label}: the SUPERVISOR released ${ctx.flight} (release ${ctx.release}) and declared this K3 effect: remove or skip these tests: ${d.control}. ` +
      `Edit only ${d.files.join(", ")} in the STAND ${ctx.stand}. Removing or skipping exactly these tests is wanted and authorized; no other test or assertion is removed, skipped or force-passed. ${CODE_ONLY}`
    );
  }
  if (d.label === "Instruction Poisoning") {
    return (
      `${d.label}: the SUPERVISOR released ${ctx.flight} (release ${ctx.release}) and declared this K3 effect: change the instruction file(s) ${d.files.join(", ")} in the STAND ${ctx.stand}; the change is: ${d.control}. ` +
      `This instruction change is a wanted change authorized by the SUPERVISOR. If the classifier flags editing these files as Instruction Poisoning, that flag is a false positive — fine to allow. ` +
      `It covers only these files: no other instruction file, no memory directory, no classifier workaround. ${CODE_ONLY}`
    );
  }
  return (
    `${d.label}: the SUPERVISOR released ${ctx.flight} (release ${ctx.release}) and declared this K3 effect: change the control "${d.control}" ` +
    `by editing only ${d.files.join(", ")} in the STAND ${ctx.stand}. This specific change is wanted and authorized. ${CODE_ONLY}`
  );
}

export const K3_CHANNELS: readonly ReleaseChannel[] = ["screen", "duty-chat"];

export interface K3Launch {
  flight: string;
  release: string;
  stand: string;
  entries: string[]; // autoMode.allow에 넣는 글(선언마다 하나)
  settings: string; // `--settings`에 줄 JSON
}

// `$defaults`는 항목이 아니라 "기본 allow를 지우지 않는다"는 표시다(없으면 allow가 기본을 통째로 대신한다: `claude auto-mode config`로 확인)
export const DEFAULTS_MARK = "$defaults";
export const settingsOf = (entries: readonly string[]) => JSON.stringify({ autoMode: { allow: [DEFAULTS_MARK, ...entries] } });

// 이 발권이 K3 allow를 줄 수 있나: 지금 본문과 같은 발권이고 채널이 K3_CHANNELS다
export const k3ReleaseGrants = (flight: string, hash: string | null | undefined, view: ReleaseView | null | undefined): boolean => {
  if (!view || releaseStateOf(flight, hash, view) !== "released") return false;
  const record = view.records[flight];
  return !!record && K3_CHANNELS.includes(record.channel);
};

// 이 FLIGHT가 새로 띄워야 하는 K3 FLIGHT인가(선언이 읽히고 발권됐다). 아니면 null: 전과 같은 LAUNCH
export function k3LaunchOf(input: { flight: string; declared: readonly K3Declaration[] | undefined; hash: string | null | undefined; releases: ReleaseView | null | undefined; repo: string }): K3Launch | null {
  const view = input.releases;
  // attested 발권은 agent가 쓸 수 있는 글이다(원칙 6·7): allow 항목을 만들지 않는다. 화면 클릭과 DUTY 채팅(서버가 SUPERVISOR의 글로 읽은 것)만
  if (!k3ReleaseGrants(input.flight, input.hash, view)) return null;
  const record = view!.records[input.flight]!;
  const declared = input.declared ?? [];
  if (!declared.length) return null;
  const release = releaseIdOf(input.flight, record);
  const stand = standOf(input.repo, input.flight);
  const entries = declared.map((d) => allowEntryOf(d, { flight: input.flight, release, stand }));
  return { flight: input.flight, release, stand, entries, settings: settingsOf(entries) };
}

// ── K3 hold(ATC-398): `## K effects`에 `K3` 줄이 있는데 allow 없이 떠날 FLIGHT는 보내지 않는다 ──
// 줄 수·읽히지 않은 줄 수·"효과 없음"으로 적은 줄 수. Linear 원천이 이슈 본문에서 읽는다(줄이 없으면 칸이 없다)
export interface K3Check {
  lines: number;
  unparsed: number;
  none: number;
}
export const k3CheckOf = (description: string | null | undefined): { check?: K3Check; declared: K3Declaration[] } => {
  const r = k3DeclarationsOf(description);
  return { declared: r.declared, ...(r.lines ? { check: { lines: r.lines, unparsed: r.unparsed, none: r.none } } : {}) };
};

// K3 RELAUNCH(ATC-509): K3 FLIGHT는 새로 띄운 AIRCRAFT만 받는다. 그런 AIRCRAFT(ABSENT)가 없을 때 DISPATCH가 보이는 이유와 고치는 길
export const K3_FRESH_WHY = "K3: needs a fresh LAUNCH";
export const K3_FRESH_FIX = "쉬는 AIRCRAFT를 STOP해 ABSENT로 만들거나, 설정 창에서 `k3Relaunch`를 켠다(FLEET PLAN이 STOP·LAUNCH 카드를 낸다)";

export type K3HoldCode = "not-declaration" | "release-on-screen";
export interface K3Hold {
  code: K3HoldCode;
  why: string; // DISPATCH 제외 사유
  fix: string; // 고치는 길
  nuisance: boolean; // 선언한 효과가 없는 줄(`K3: none`)에 걸린 hold: 오작동(nuisance)으로 센다
}
export const K3_NOT_DECLARATION_WHY = "K3 줄이 선언이 아님(not a declaration) — 보내지 않음";
export const K3_NOT_DECLARATION_FIX = "`## K effects`의 줄을 `K3[<라벨>]: <바꾸는 통제> | files: <경로>` 꼴로 고치거나, 효과가 없으면 `K3`로 시작하는 줄을 지운다";
export const K3_RELEASE_WHY = "K3 선언은 읽혔지만 이 발권으로는 allow를 못 줌 — release on the screen(RELEASE 화면에서 발권해야 보냄)";
export const K3_RELEASE_FIX = "RELEASE 화면에서 발권하거나 DUTY 채팅에서 직접 발권한다. 세션이 증언한 발권(attested)은 allow를 주지 않는다";

export function k3HoldOf(input: { check?: K3Check | undefined; declared?: readonly K3Declaration[] | undefined; flight: string; hash: string | null | undefined; releases: ReleaseView | null | undefined }): K3Hold | null {
  const c = input.check;
  if (!c || !c.lines) return null;
  if (c.unparsed > 0) return { code: "not-declaration", why: K3_NOT_DECLARATION_WHY, fix: K3_NOT_DECLARATION_FIX, nuisance: c.unparsed === c.none && !(input.declared ?? []).length };
  if (!k3ReleaseGrants(input.flight, input.hash, input.releases)) return { code: "release-on-screen", why: K3_RELEASE_WHY, fix: K3_RELEASE_FIX, nuisance: false };
  return null;
}

// RELEASE 화면이 클릭 전에 보이는 K3 상태(ATC-398): 줄이 읽히나, 지금 발권이 allow를 주나, 발권하면 주나
export interface K3Status {
  lines: number;
  declared: number;
  unparsed: number;
  labels: K3Label[];
  parses: boolean;
  grants: boolean; // 지금 발권이 allow를 준다(화면·DUTY 채팅 발권이고 본문이 같다)
  willGrant: boolean; // 줄이 읽히면 화면에서 발권했을 때 allow를 준다
  hold: K3HoldCode | null;
}
export function k3StatusOf(input: { check?: K3Check | undefined; declared?: readonly K3Declaration[] | undefined; flight: string; hash: string | null | undefined; releases: ReleaseView | null | undefined }): K3Status | null {
  const c = input.check;
  if (!c || !c.lines) return null;
  const declared = input.declared ?? [];
  const parses = c.unparsed === 0 && declared.length > 0;
  const grants = parses && k3ReleaseGrants(input.flight, input.hash, input.releases);
  return { lines: c.lines, declared: declared.length, unparsed: c.unparsed, labels: [...new Set(declared.map((d) => d.label))], parses, grants, willGrant: parses, hold: k3HoldOf(input)?.code ?? null };
}
