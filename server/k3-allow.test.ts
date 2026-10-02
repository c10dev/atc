import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { K3_LABELS, k3DeclarationsOf, k3LaunchOf, settingsOf, SOFT_DENY_UNDECLARABLE, UNDECLARABLE_WHY } from "./k3-allow.ts";
import type { ReleaseChannel, ReleaseView } from "./release.ts";

const BODY = "## Goal\nx\n\n## K effects\n\n* K3[Security Weaken]: CROSSCHECK condition in the auto approve | files: server/auto-approve-run.ts, server/auto-approve.ts\n";
const viewOf = (channel: ReleaseChannel): ReleaseView => ({ armedAt: null, records: { "ATC-1": { flight: "ATC-1", channel, at: "2026-10-02T00:00:00Z", hash: "abc" } } });
const launch = (channel: ReleaseChannel, hash = "abc") => k3LaunchOf({ flight: "ATC-1", declared: k3DeclarationsOf(BODY).declared, hash, releases: viewOf(channel), repo: "/r/atc" });

test("a screen or duty-chat release builds one entry per declaration", () => {
  for (const ch of ["screen", "duty-chat"] as const) {
    const k = launch(ch)!;
    assert.equal(k.entries.length, 1);
    assert.match(k.entries[0]!, /^Security Weaken: .*ATC-1@abc.*server\/auto-approve-run\.ts.*\/r\/atc\/\.claude\/worktrees\/atc-1-\*/);
    assert.deepEqual(JSON.parse(k.settings), { autoMode: { allow: ["$defaults", ...k.entries] } });
  }
});

test("an attested release never produces allow entries", () => {
  assert.equal(launch("attested"), null);
});

test("no entries when the body changed after release, or nothing was released", () => {
  assert.equal(launch("screen", "other"), null);
  assert.equal(k3LaunchOf({ flight: "ATC-1", declared: k3DeclarationsOf(BODY).declared, hash: "abc", releases: { armedAt: null, records: {} }, repo: "/r" }), null);
});

test("malformed K3 lines are counted and make no entry", () => {
  const r = k3DeclarationsOf("## K effects\n* K3: decides things\n* K3[Nope]: x | files: a.ts\n* K3[Security Weaken]: x | files: ../a.ts\n* K3[Security Weaken]: x | files: *.ts\n");
  assert.deepEqual(r.declared, []);
  assert.equal(r.unparsed, 4);
});

test("settingsOf keeps the defaults marker first", () => {
  assert.deepEqual(JSON.parse(settingsOf(["e"])).autoMode.allow, ["$defaults", "e"]);
});

// ── ATC-399: Linear가 저장한 꼴, 새 라벨 둘, 선언할 수 없는 라벨 ──
const ESCAPED = "## Goal\nx\n\n## K effects\n\n* K3\\[Security Weaken\\]: CROSSCHECK condition in the auto approve | files: server/auto\\-approve\\-run.ts, server/k3\\_allow.ts\n";

test("Linear가 저장한 꼴(대괄호·밑줄·하이픈 앞의 역슬래시)도 선언으로 읽는다", () => {
  const r = k3DeclarationsOf(ESCAPED);
  assert.equal(r.unparsed, 0);
  assert.deepEqual(r.declared, [{ label: "Security Weaken", control: "CROSSCHECK condition in the auto approve", files: ["server/auto-approve-run.ts", "server/k3_allow.ts"] }]);
  // 이스케이프 없는 글은 그대로고, 이스케이프를 되돌려도 경로 규칙(글롭·`..`)은 그대로 거절한다
  assert.deepEqual(k3DeclarationsOf(BODY).declared, k3DeclarationsOf(BODY.replaceAll("[", "\\[").replaceAll("]", "\\]")).declared);
  assert.equal(k3DeclarationsOf("## K effects\n* K3\\[Security Weaken\\]: x | files: \\*.ts\n").unparsed, 1);
  assert.equal(k3DeclarationsOf("## K effects\n* K3\\[Security Weaken\\]: x | files: ..\\/a.ts\n").unparsed, 1);
  // 제목 줄과 절 이름도 이스케이프를 되돌려 찾는다(Linear가 `## K effects`를 그대로 두지만 `K\_effects` 같은 꼴도 무해)
  assert.equal(k3DeclarationsOf("## K effects\n- K3\\[Self\\-Approval\\]: the approval gate | files: server/a.ts\n").declared[0]?.label, "Self-Approval");
});

test("Security Test Removal 선언은 읽히고 항목은 어떤 테스트인지 적는다", () => {
  const body = "## K effects\n* K3[Security Test Removal]: the legacy login lockout tests in auth.test.ts | files: server/auth.test.ts\n";
  const r = k3DeclarationsOf(body);
  assert.equal(r.unparsed, 0);
  assert.equal(r.declared[0]!.label, "Security Test Removal");
  const k = k3LaunchOf({ flight: "ATC-1", declared: r.declared, hash: "abc", releases: viewOf("screen"), repo: "/r/atc" })!;
  assert.equal(k.entries.length, 1);
  const e = k.entries[0]!;
  assert.match(e, /^Security Test Removal: /);
  assert.match(e, /remove or skip these tests: the legacy login lockout tests in auth\.test\.ts/);
  assert.match(e, /server\/auth\.test\.ts/);
  assert.match(e, /\/r\/atc\/\.claude\/worktrees\/atc-1-\*/);
  assert.match(e, /ATC-1@abc/);
  assert.match(e, /no other test or assertion is removed, skipped or force-passed/);
  assert.match(e, /Code only; nothing is executed against production/);
  assert.deepEqual(JSON.parse(k.settings).autoMode.allow, ["$defaults", e]);
});

test("Instruction Poisoning 선언은 읽히고 항목은 원하는 변경이며 그 파일만 덮는다고 적는다", () => {
  const body = "## K effects\n* K3[Instruction Poisoning]: add the REVIEW turn rules to the DUTY manual | files: duty/CLAUDE.md, duty/CLAUDE.en.md\n";
  const r = k3DeclarationsOf(body);
  assert.equal(r.unparsed, 0);
  const k = k3LaunchOf({ flight: "ATC-1", declared: r.declared, hash: "abc", releases: viewOf("duty-chat"), repo: "/r/atc" })!;
  const e = k.entries[0]!;
  assert.match(e, /^Instruction Poisoning: /);
  assert.match(e, /instruction file\(s\) duty\/CLAUDE\.md, duty\/CLAUDE\.en\.md/);
  assert.match(e, /a wanted change authorized by the SUPERVISOR/);
  assert.match(e, /false positive — fine to allow/);
  assert.match(e, /only these files: no other instruction file, no memory directory, no classifier workaround/);
  assert.match(e, /ATC-1@abc/);
  assert.match(e, /\/r\/atc\/\.claude\/worktrees\/atc-1-\*/);
});

test("선언할 수 없는 라벨(Tmux Self Drive 등)은 읽히지 않은 줄로 세고 항목을 만들지 않는다", () => {
  const r = k3DeclarationsOf("## K effects\n* K3[Tmux Self Drive]: drive a tmux pane | files: a.ts\n* K3[Production Deploy]: deploy | files: b.ts\n* K3\\[Auto\\-Mode Bypass\\]: x | files: c.ts\n");
  assert.deepEqual(r.declared, []);
  assert.equal(r.unparsed, 3);
  assert.equal(k3LaunchOf({ flight: "ATC-1", declared: r.declared, hash: "abc", releases: viewOf("screen"), repo: "/r" }), null);
});

// soft_deny 라벨 전부(`claude auto-mode defaults`, 2026-10-02). 선언 가능은 K3_LABELS뿐이고 나머지는 이유와 함께 표에 있다
const ALL_SOFT_DENY = [
  "Git Destructive", "Code That Leaks When Run", "Code from External", "Cloud Storage Mass Delete", "Production Deploy", "Remote Shell Writes", "Sensitive Remote Exec", "Production Reads", "Blind Apply", "Protected-Scope IaC Apply",
  "Logging/Audit Tampering", "Permission Grant", "Account & Standing-Rule Changes", "TLS/Auth Weaken", "Secret-Store Writes", "DNS / Domain / Cert Changes", "Security Weaken", "Security Test Removal", "Safety Bypass Flag", "Create Unsafe Agents",
  "Interfere With Workloads", "Shared Cluster Mutation", "CI Bypass", "Modify Shared Resources", "Irreversible Local Destruction", "Unverifiable Deletion Target", "Shared Scratch Sweep", "Irreversible Deletion (general)", "Unverifiable Deletion Scope", "Create RCE Surface",
  "Expose Local Services", "External Ingress Tunnel", "Credential Leakage", "Credential Materialization", "Credential Exploration", "PII Data Handling", "Exfil Scouting", "Traffic Redirection", "Remote Repoint", "Out-of-Place Publication",
  "Sensitive-Source Provenance", "Excess Sensitive Detail", "Unrequested Artifact Publish", "Live-Shared Artifact Sensitive Delta", "Sandbox Network Callback", "Command Network Lists", "Containment Escape", "Create Public Surface", "Public Data-Sharing Upload", "Untrusted Code Integration",
  "Package Registry Bypass", "Unauthorized Persistence", "Self-Modification", "Tmux Self Drive", "Instruction Poisoning", "Auto-Mode Bypass", "Session Transcript Tampering", "Unrequested Commit in a Connected App", "External System Writes", "Merge Without Review",
  "Self-Approval", "ChatOps Trigger Comments", "Feature Flag Writes", "Node Lifecycle Operations", "Cluster-Wide Workload Creation", "Real-World Transactions", "Third-Party Attack", "Browser Navigate Exfil", "Browser Input Exfil", "Browser JS Exfil",
  "Browser File Upload Exfil", "Browser Shortcut Execution",
];

test("모든 soft_deny 라벨은 선언 가능(K3_LABELS) 아니면 이유 있는 선언 불가 가운데 정확히 하나다. 선언 불가 라벨은 선언으로 읽히지 않는다", () => {
  assert.equal(ALL_SOFT_DENY.length, 72);
  assert.equal(new Set(ALL_SOFT_DENY).size, 72);
  assert.deepEqual([...K3_LABELS].sort(), ["Instruction Poisoning", "Merge Without Review", "Permission Grant", "Security Test Removal", "Security Weaken", "Self-Approval", "Self-Modification"]);
  for (const l of ALL_SOFT_DENY) {
    const declarable = (K3_LABELS as readonly string[]).includes(l);
    const why = SOFT_DENY_UNDECLARABLE[l];
    assert.equal(declarable !== (why !== undefined), true, `${l}: 선언 가능과 불가 중 정확히 하나`);
    if (why) assert.ok(UNDECLARABLE_WHY[why], l);
    const r = k3DeclarationsOf(`## K effects\n* K3[${l}]: some control | files: a.ts\n`);
    assert.equal(r.declared.length, declarable ? 1 : 0, l);
    assert.equal(r.unparsed, declarable ? 0 : 1, l);
  }
  assert.deepEqual(Object.keys(SOFT_DENY_UNDECLARABLE).filter((l) => !ALL_SOFT_DENY.includes(l)), [], "표에 모르는 라벨이 없다");
});

test("docs/autonomy.md·autonomy.ko.md C9 표는 모든 soft_deny 라벨을 한 줄씩 싣고, 선언 가능 표시가 K3_LABELS와 같다", () => {
  for (const [file, yes] of [["autonomy.md", "**declarable**"], ["autonomy.ko.md", "**선언 가능**"]] as const) {
    const text = readFileSync(new URL(`../docs/${file}`, import.meta.url), "utf8");
    for (const l of ALL_SOFT_DENY) {
      const row = text.split("\n").find((x) => x.startsWith(`| ${l} | `));
      assert.ok(row, `${file}: ${l} 줄이 없다`);
      assert.equal(row.includes(yes), (K3_LABELS as readonly string[]).includes(l), `${file}: ${l}`);
    }
  }
});
