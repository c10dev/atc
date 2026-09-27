import assert from "node:assert/strict";
import { test } from "node:test";
import { type Departure, diffDepartures, foldDepartures, matchDepartures } from "./departures.ts";
import type { Claim, Session, Workspace } from "./model.ts";

const TEAM = "^TEAM[\\s_-]?[A-Z]$";
const NOW = "2026-09-27T12:00:00.000Z";
const session = (id: string, name: string) => ({ id, name }) as Session;
const ws = (name: string, branch: string | null, ticketKey: string | null = null, isMain = false): Workspace => ({
  path: `/w/${name}`, name, repo: "/r/atc", isMain, branch, head: "", dirty: 0, lastCommitAt: null, ticketKey,
});
const claim = (sessionId: string, wsName: string, since: string, state: Claim["state"] = "active"): Claim => ({
  sessionId, workspacePath: `/w/${wsName}`, since, lastAt: since, source: "hook", tool: null, state, handedOffTo: null,
});
const sessions = [session("j", "Team_J"), session("h", "TEAM_H"), session("s", "structure")];

test("착수 기록: 첫 스냅샷은 기준선(점유된 STAND만 claim), 그 뒤 새 워크트리는 stand, 첫 TEAM 점유는 claim", () => {
  const state = foldDepartures([]);
  const first = diffDepartures(
    { sessions, workspaces: [ws("atc", "main", null, true), ws("atc-a", "claude/a"), ws("atc-b", "claude/b")], claims: [claim("j", "atc-a", "2026-09-27T10:00:00.000Z"), claim("s", "atc-b", "2026-09-27T10:00:00.000Z")] },
    state,
    { teamPattern: TEAM, now: NOW, baseline: true },
  );
  // 본 체크아웃은 보지 않고, TEAM이 아닌 세션(structure)의 점유는 AIRCRAFT가 아니다
  assert.deepEqual(first, [{ t: "2026-09-27T10:00:00.000Z", flight: null, aircraft: "TEAM_J", stand: "/w/atc-a", branch: "claude/a", repo: "/r/atc", via: "claim" }]);

  // 같은 AIRCRAFT가 계속 점유하면 쓰지 않는다
  assert.deepEqual(diffDepartures({ sessions, workspaces: [ws("atc-a", "claude/a")], claims: [claim("j", "atc-a", "2026-09-27T10:00:00.000Z")] }, state, { teamPattern: TEAM, now: NOW, baseline: false }), []);

  // 새 워크트리: 점유 전이면 stand, 그다음 TEAM 점유가 생기면 claim
  const later = "2026-09-27T12:05:00.000Z";
  const added = diffDepartures({ sessions, workspaces: [ws("atc-c", "claude/voc-7-x", "VOC-7")], claims: [] }, state, { teamPattern: TEAM, now: later, baseline: false });
  assert.deepEqual(added.map((d) => `${d.via}:${d.aircraft}:${d.flight}`), ["stand:null:VOC-7"]);
  const claimed = diffDepartures({ sessions, workspaces: [ws("atc-c", "claude/voc-7-x", "VOC-7")], claims: [claim("h", "atc-c", "2026-09-27T12:06:00.000Z")] }, state, { teamPattern: TEAM, now: later, baseline: false });
  assert.deepEqual(claimed.map((d) => `${d.via}:${d.aircraft}:${d.t}`), ["claim:TEAM_H:2026-09-27T12:06:00.000Z"]);
});

test("착수 기록: HANDOFF는 앞 AIRCRAFT가 손을 뗐을 때만, 동시 점유 중에는 앞 AIRCRAFT를 유지한다", () => {
  const state = foldDepartures([{ t: "2026-09-27T09:00:00.000Z", flight: null, aircraft: "TEAM_J", stand: "/w/atc-a", branch: "claude/a", repo: "/r/atc", via: "claim" }]);
  const opts = { teamPattern: TEAM, now: NOW, baseline: false };
  const both = [claim("j", "atc-a", "2026-09-27T09:00:00.000Z"), claim("h", "atc-a", "2026-09-27T11:00:00.000Z")];
  assert.deepEqual(diffDepartures({ sessions, workspaces: [ws("atc-a", "claude/a")], claims: both }, state, opts), []);
  const handed = [claim("j", "atc-a", "2026-09-27T09:00:00.000Z", "handed-off"), claim("h", "atc-a", "2026-09-27T11:00:00.000Z")];
  const out = diffDepartures({ sessions, workspaces: [ws("atc-a", "claude/a")], claims: handed }, state, opts);
  assert.deepEqual(out.map((d) => `${d.via}:${d.aircraft}`), ["handoff:TEAM_H"]);
  // 재시작: 기록을 접으면 마지막 AIRCRAFT가 상태가 되어 같은 줄을 다시 쓰지 않는다
  const again = foldDepartures([{ t: "2026-09-27T09:00:00.000Z", flight: null, aircraft: "TEAM_J", stand: "/w/atc-a", branch: "claude/a", repo: "/r/atc", via: "claim" }, ...out]);
  assert.deepEqual(diffDepartures({ sessions, workspaces: [ws("atc-a", "claude/a")], claims: handed }, again, { ...opts, baseline: true }), []);
});

test("착수 기록 조회: 같은 저장소·브랜치를 먼저, 없으면 FLIGHT·STAND. 머지 뒤 기록은 보지 않는다", () => {
  const d = (t: string, over: Partial<Departure>): Departure => ({ t, flight: null, aircraft: null, stand: "/w/x", branch: null, repo: "/r/atc", via: "claim", ...over });
  const lines = [
    d("2026-09-27T08:00:00.000Z", { stand: "/w/atc-a", branch: "claude/a", via: "stand" }),
    d("2026-09-27T09:00:00.000Z", { stand: "/w/atc-a", branch: "claude/a", aircraft: "TEAM_J" }),
    d("2026-09-27T11:00:00.000Z", { stand: "/w/atc-a", branch: "claude/a", aircraft: "TEAM_H", via: "handoff" }),
    d("2026-09-27T13:00:00.000Z", { stand: "/w/atc-a", branch: "claude/a", aircraft: "TEAM_B", via: "handoff" }), // 머지 뒤
    d("2026-09-26T09:00:00.000Z", { stand: "/w/vocado-voc-7", branch: "voc-7", flight: "VOC-7", aircraft: "TEAM_E", repo: "/r/v" }),
  ];
  assert.deepEqual(matchDepartures(lines, { repo: "/r/atc", branch: "claude/a", before: "2026-09-27T12:00:00.000Z" }), {
    aircraft: "TEAM_H",
    firstAt: "2026-09-27T08:00:00.000Z",
    stands: ["/w/atc-a"],
  });
  assert.equal(matchDepartures(lines, { repo: "/r/v", branch: "other", flight: "VOC-7", before: "2026-09-27T12:00:00.000Z" }).aircraft, "TEAM_E");
  assert.equal(matchDepartures(lines, { repo: "/r/v", branch: null, flight: null, stands: ["/w/vocado-voc-7"], before: "2026-09-27T12:00:00.000Z" }).aircraft, "TEAM_E");
  assert.deepEqual(matchDepartures(lines, { repo: "/r/atc", branch: "claude/zzz", before: "2026-09-27T12:00:00.000Z" }), { aircraft: null, firstAt: null, stands: [] });
});
