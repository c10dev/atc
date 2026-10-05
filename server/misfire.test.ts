import assert from "node:assert/strict";
import { test } from "node:test";
import { isAutoApproved, isLaunchStopped, misfireOf, misfireView } from "./misfire.ts";
import { AIRCRAFT_WHY, STOPPED_WHY } from "./proposals.ts";

const NOW = Date.parse("2026-10-02T12:00:00Z");
type C = Parameters<typeof misfireView>[0][number];
const card = (id: string, o: Partial<C> & { approved?: string; sent?: boolean; recalled?: boolean; declined?: boolean } = {}): C => {
  const { approved, sent, recalled, declined, ...rest } = o;
  const timeline: C["timeline"] = { approved: approved ?? "2026-10-02T08:00:00Z" };
  if (sent) timeline.sent = "2026-10-02T08:05:00Z";
  if (recalled) timeline.recalling = "2026-10-02T09:00:00Z";
  if (declined) timeline.declined = "2026-10-02T09:00:00Z";
  return { id, kind: "ASSIGN", status: "approved", via: "auto", reason: null, ...rest, timeline } as C;
};

test("only server-approved ASSIGN cards count; a person's approval does not", () => {
  assert.equal(isAutoApproved(card("D-1")), true);
  assert.equal(isAutoApproved(card("D-2", { via: "crosscheck" as never })), false);
  assert.equal(isAutoApproved(card("D-3", { kind: "RELEASE" })), false);
});

test("misfire kinds: declined, recalled, superseded after sent, wrong AIRCRAFT; healthy and pre-send supersede do not count", () => {
  assert.equal(misfireOf(card("D-1")), null);
  assert.equal(misfireOf(card("D-2", { status: "declined", declined: true, sent: true })), "declined");
  assert.equal(misfireOf(card("D-3", { status: "recalled", recalled: true, sent: true })), "recalled");
  assert.equal(misfireOf(card("D-4", { status: "superseded", sent: true, reason: "FLIGHT 상태가 바뀜" })), "superseded-after-sent");
  assert.equal(misfireOf(card("D-5", { status: "superseded", reason: "FLIGHT 상태가 바뀜" })), null); // 보내기 전 SUPERSEDED는 틀린 승인이 아니다
  assert.equal(misfireOf(card("D-6", { status: "superseded", reason: `${AIRCRAFT_WHY}: 세션이 없음` })), "wrong-aircraft");
  assert.equal(misfireOf(card("D-7", { via: "crosscheck" as never, status: "declined", declined: true })), null);
});

test("misfireView: per approval day, share of approvals, window and empty days", () => {
  const v = misfireView(
    [
      card("D-1"),
      card("D-2", { status: "declined", declined: true, sent: true }),
      card("D-3", { approved: "2026-10-01T10:00:00Z" }),
      card("D-4", { approved: "2026-09-20T10:00:00Z", status: "declined", declined: true }), // 창 밖
    ],
    NOW,
    3,
  );
  assert.deepEqual(v.daily.map((d) => d.day), ["2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.deepEqual(v.daily.map((d) => [d.approvals, d.misfires, d.share]), [[0, 0, null], [1, 0, 0], [2, 1, 0.5]]);
  assert.equal(v.today.by.declined, 1);
  assert.deepEqual(v.total, { approvals: 3, misfires: 1, share: 1 / 3, crossAccount: 0, displaced: 0, displacedMisfires: 0, launchStopped: 0 });
});

test("launch-then-stopped (ATC-548): a LAUNCH card superseded as AIRCRAFT 멈춤 within one settle of its LAUNCH, counted on the day it was withdrawn", () => {
  const stopped = (id: string, o: Partial<C> = {}) => card(id, { launch: true, via: "oneshot" as never, status: "superseded", reason: `${STOPPED_WHY} — TEAM_O — VOC-317 ORPHAN FLIGHT`, statusAt: "2026-10-02T08:09:00Z", ...o });
  assert.equal(isLaunchStopped(stopped("D-1")), true); // 09분 뒤: 한 settle(10분) 안
  assert.equal(isLaunchStopped(stopped("D-2", { statusAt: "2026-10-02T08:40:00Z" })), false); // 한참 뒤: 뜬 세션이 한동안 일했다
  assert.equal(isLaunchStopped(stopped("D-3", { launch: undefined })), false); // 일반 ASSIGN 카드
  assert.equal(isLaunchStopped(stopped("D-4", { reason: `${AIRCRAFT_WHY}: 세션 없음` })), false);
  assert.equal(isLaunchStopped(stopped("D-5", { status: "approved" })), false);
  const v = misfireView([stopped("D-1"), stopped("D-2", { statusAt: "2026-10-02T08:40:00Z" })], NOW, 2);
  assert.equal(v.today.launchStopped, 1);
  assert.equal(v.total.launchStopped, 1);
});
