import assert from "node:assert/strict";
import { test } from "node:test";
import { deliveryOf, launchModeOf, manualStepsOf, originBadgeOf, originOf, permissionModeOf } from "./session-origin.ts";
import { deliveryMapOf } from "./proposals.ts";
import type { Session } from "./model.ts";

// 2026-09-28~29 이 호스트에서 본 명령줄 모양(경로·버전만 남김)
const CCD = ["/home/u/.claude/remote/ccd-cli/2.1.281", "--output-format", "stream-json", "--input-format", "stream-json", "--model", "claude-opus-5-5", "--permission-prompt-tool", "stdio", "--permission-mode", "auto"];
const SRV = ["/home/u/.claude/remote/srv/90fca6e6/server", "--serve", "--socket", "/home/u/.claude/remote/run/adca18bd/rpc.sock"];
const BG_SPARE = ["claude", "bg-spare", "--bg-spare", "/tmp/cc-daemon-1000/401ce1a9/spare/b459facc.claim.sock"];
const PTY = ["claude", "bg-pty-host", "--bg-pty-host", "/tmp/cc-daemon-1000/401ce1a9/spare/b459facc.pty.sock", "200", "50"];

test("출처: kind가 background면 BACKGROUND, ccd-cli는 DESKTOP, 그냥 claude는 TERMINAL, 그 밖은 모름", () => {
  assert.equal(originOf({ kind: "background", argv: null }), "background");
  assert.equal(originOf({ kind: "bg", argv: CCD }), "background"); // 세션 파일의 kind
  assert.equal(originOf({ kind: "interactive", argv: BG_SPARE, parentArgv: PTY }), "background"); // daemon이 띄운 것
  assert.equal(originOf({ kind: "interactive", argv: CCD, parentArgv: SRV }), "desktop");
  assert.equal(originOf({ argv: ["node", "x.js"], parentArgv: SRV }), "desktop"); // 부모가 데스크톱 서버
  assert.equal(originOf({ kind: "interactive", argv: ["claude"], parentArgv: ["-bash"] }), "terminal");
  assert.equal(originOf({ argv: ["/home/u/.local/bin/claude", "--permission-mode", "default"] }), "terminal");
  assert.equal(originOf({ argv: ["/home/u/.local/share/claude/versions/2.1.284", "--resume", "x"] }), "terminal");
  assert.equal(originOf({ argv: ["node", "/opt/other/cli.js"], parentArgv: ["tmux"] }), "unknown");
  assert.equal(originOf({ argv: ["claude-helper"] }), "unknown"); // 이름이 claude로 끝나지 않음
  // 프로세스를 못 읽으면 세션 파일의 entrypoint만 본다
  assert.equal(originOf({ argv: null, entrypoint: "claude-desktop" }), "desktop");
  assert.equal(originOf({ argv: null, entrypoint: "cli" }), "unknown");
});

test("permission mode: --permission-mode <m>와 --permission-mode=<m>, 마지막 것, 없으면 null", () => {
  assert.equal(permissionModeOf(CCD), "auto");
  assert.equal(permissionModeOf(["claude", "--permission-mode=acceptEdits"]), "acceptEdits");
  assert.equal(permissionModeOf(["claude", "--permission-mode", "default", "--permission-mode", "plan"]), "plan");
  assert.equal(permissionModeOf(["claude", "--permission-mode", "--verbose"]), null); // 값 없이 다음 옵션
  assert.equal(permissionModeOf(["claude", "--permission-prompt-tool", "stdio"]), null);
  assert.equal(permissionModeOf(BG_SPARE), null);
  assert.equal(permissionModeOf(null), null);
});

test("손 절차: 출처마다 어디서 닫고, 무엇을 하는지", () => {
  assert.match(manualStepsOf("desktop", "TEAM_E", "stop"), /^TEAM_E는 데스크톱\(Claude 앱\) 세션 — atc가 멈추지 않는다\. SUPERVISOR: Claude 앱에서 그 세션을 닫는다/);
  assert.match(manualStepsOf("terminal", "TEAM_E", "stop"), /터미널 세션 — atc가 멈추지 않는다\. SUPERVISOR: 그 터미널에서 \/exit로 claude를 닫는다$/);
  assert.match(manualStepsOf("desktop", "TEAM_E", "refresh"), /다시 띄우지 않는다\. SUPERVISOR: Claude 앱의 그 세션에서 \/clear, 그다음 FLEET 카드의 CREW BRIEFING/);
  assert.match(manualStepsOf("unknown", "TEAM_E", "restart"), /백그라운드가 아닌 세션 — atc가 다시 띄우지 않는다\. SUPERVISOR: 그 세션 창을 닫고, 새 세션을 이름 TEAM_E로 열어/);
});

test("백그라운드 세션의 permission mode: 세션 시작 전후 2분 안의 성공한 LAUNCH 기록", () => {
  const recs = [
    { t: "2026-09-29T01:00:00Z", ok: true, permissionMode: "acceptEdits" }, // 옛 LAUNCH
    { t: "2026-09-29T02:00:05Z", ok: false, permissionMode: "default" }, // 실패
    { t: "2026-09-29T02:00:10Z", ok: true, permissionMode: "auto" },
  ];
  assert.equal(launchModeOf(recs, "2026-09-29T02:00:00Z"), "auto");
  assert.equal(launchModeOf(recs, Date.parse("2026-09-29T01:00:30Z")), "acceptEdits");
  assert.equal(launchModeOf(recs, "2026-09-29T05:00:00Z"), null); // 이 세션을 띄운 기록이 없다(손으로 띄운 claude --bg)
  assert.equal(launchModeOf(recs, null), null);
});

test("표시: BG·DESKTOP·TERM과 permission mode, BG id는 툴팁에만, 세션이 없으면 null", () => {
  assert.deepEqual(originBadgeOf("desktop", "auto"), { origin: "desktop", badge: "DESKTOP", mode: "auto", title: originBadgeOf("desktop", "auto")!.title, attach: null });
  assert.match(originBadgeOf("desktop", "auto")!.title, /데스크톱 앱의 원격 세션 .* permission mode auto$/);
  const bg = originBadgeOf("background", null, "efbbe208")!;
  assert.equal(bg.badge, "BG");
  // ATC-98: 툴팁은 `BG <jobId> — claude attach <jobId>`, attach가 복사할 명령
  assert.match(bg.title, /BG efbbe208 — claude attach efbbe208 · permission mode 모름$/);
  assert.equal(bg.attach, "claude attach efbbe208");
  assert.equal(originBadgeOf("desktop", "auto", "efbbe208")!.attach, null); // background가 아니면 id를 싣지 않는다
  assert.equal(originBadgeOf("terminal", "default")!.badge, "TERM");
  assert.equal(originBadgeOf(null, "auto"), null);
});

test("2b 전달: 둘 다 알고 다를 때만 경고, 데스크톱이면 앱에서 승인하라는 말", () => {
  assert.equal(deliveryOf({ origin: "desktop", permissionMode: "auto" }, "auto").warn, null);
  assert.equal(deliveryOf({ origin: "desktop", permissionMode: null }, "auto").warn, null); // 모르면 경고하지 않는다
  assert.equal(deliveryOf({ origin: "desktop", permissionMode: "default" }, null).warn, null);
  const w = deliveryOf({ origin: "desktop", permissionMode: "default" }, "auto").warn!;
  assert.equal(w.label, "MODE default ≠ OCC auto");
  assert.match(w.title, /NO READBACK.*데스크톱 세션이면 앱에서 메시지를 승인/);
  assert.doesNotMatch(deliveryOf({ origin: "terminal", permissionMode: "plan" }, "auto").warn!.title, /데스크톱/);
  assert.deepEqual(deliveryOf(null, "auto"), { origin: null, mode: null, occMode: "auto", warn: null });
});

test("2b 전달 맵: 제안 AIRCRAFT마다 한 번, OCC는 살아 있는 OCC 세션의 mode", () => {
  const sess = (name: string, over: Partial<Session> = {}) => ({ id: name, agent: "claude", name, status: "idle", pid: 1, cwd: "/w", startedAt: "", lastActiveAt: null, repo: null, workspacePath: null, ...over }) as Session;
  const s = { sessions: [sess("OCC", { origin: "background", permissionMode: "auto" }), sess("TEAM_E", { origin: "desktop", permissionMode: "default" }), sess("TEAM_F", { origin: "desktop", permissionMode: "auto" }), sess("TEAM_G", { status: "dead", permissionMode: "plan" })] };
  const m = deliveryMapOf(s, [{ aircraftName: "TEAM_E" }, { aircraftName: "TEAM_E" }, { aircraftName: "TEAM_F" }, { aircraftName: "TEAM_G" }, { aircraftName: null }]);
  assert.deepEqual(Object.keys(m), ["TEAM_E", "TEAM_F", "TEAM_G"]);
  assert.equal(m.TEAM_E.warn?.label, "MODE default ≠ OCC auto");
  assert.equal(m.TEAM_F.warn, null);
  assert.deepEqual(m.TEAM_G, { origin: null, mode: null, occMode: "auto", warn: null }); // 죽은 세션은 보지 않는다
  assert.equal(deliveryMapOf({ sessions: [sess("TEAM_E", { permissionMode: "default" })] }, [{ aircraftName: "TEAM_E" }]).TEAM_E.warn, null); // OCC가 없으면 모름
});
