import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupervisorAlert } from "./supervisor-alerts.ts";
import { NOTICE_MAX, noticesOf, type NoticesInput } from "./notices.ts";

const failed = [{ code: "checks-failed" as const, text: "", en: "" }];
const pull = (n: number, over: Partial<NoticesInput["pulls"][number]> = {}): NoticesInput["pulls"][number] => ({ number: n, title: `PR title ${n}`, url: `https://github.com/x/y/pull/${n}`, draft: false, blocks: [], createdAt: "2026-10-03T00:00:00Z", head: `h${n}`, ...over });
const alert = (key: string, over: Partial<SupervisorAlert> = {}): SupervisorAlert => ({ key, group: "alert", level: null, cue: null, aircraft: null, flight: null, text: key, next: "", link: "#home", since: null, dest: "queue" as never, ...over });
const base = (over: Partial<NoticesInput> = {}): NoticesInput => ({ now: Date.parse("2026-10-03T12:00:00Z"), ready: [], tickets: [], pulls: [], queue: [], alerts: [], ...over });

test("empty input gives three empty groups", () => {
  const n = noticesOf(base());
  assert.deepEqual([n.linear.total, n.github.total, n.atc.total], [0, 0, 0]);
  assert.equal(n.at, "2026-10-03T12:00:00.000Z");
});

test("linear: READY issues by priority (0 last), linked to Linear when the url is known", () => {
  const n = noticesOf(base({ ready: [{ key: "ATC-9", title: "nine", priority: 0 }, { key: "ATC-10", title: "ten", priority: 2 }, { key: "ATC-2", title: "two", priority: 2 }], tickets: [{ key: "ATC-2", url: "https://linear.app/x/ATC-2" }] }));
  assert.deepEqual(n.linear.items.map((x) => x.key), ["linear|ready|ATC-2", "linear|ready|ATC-10", "linear|ready|ATC-9"]);
  assert.equal(n.linear.items[0]!.link, "https://linear.app/x/ATC-2");
  assert.equal(n.linear.items[1]!.link, "#release");
});

test("github: SUPERVISOR merges first, then failed checks; a PR is listed once; drafts are skipped", () => {
  const n = noticesOf(
    base({
      pulls: [pull(1), pull(2, { blocks: failed }), pull(3, { blocks: failed }), pull(4, { draft: true, blocks: failed })],
      queue: [
        { kind: "LANDING", key: "atc#1@h1", since: null, title: "PR #1", hash: "#flights" },
        { kind: "LANDING", key: "atc#3@h3", since: null, title: "PR #3", hash: "#flights" },
        { kind: "UPDATE", key: "u", since: null, title: "u", hash: "#home" },
      ],
    }),
  );
  assert.deepEqual(n.github.items.map((x) => x.source), ["GitHub · waits for you to merge", "GitHub · waits for you to merge", "GitHub · checks failed"]);
  assert.deepEqual(n.github.items.map((x) => x.text.split(" ")[1]), ["#1", "#3", "#2"]);
  assert.equal(n.github.items[0]!.link, "https://github.com/x/y/pull/1");
});

test("atc: every alert, with action only for WARNING, CAUTION and call", () => {
  const n = noticesOf(base({ alerts: [alert("a", { level: "warning" }), alert("b", { level: "advisory" }), alert("c", { cue: "call", flight: "ATC-1", aircraft: "TEAM_F" }), alert("d", { level: "caution" })] }));
  assert.deepEqual(n.atc.items.map((x) => x.action), [true, false, true, true]);
  assert.equal(n.atc.items[2]!.source, "atc · CALL · TEAM_F · ATC-1");
});

test("groups are cut at NOTICE_MAX but total keeps the real count", () => {
  const n = noticesOf(base({ ready: Array.from({ length: NOTICE_MAX + 5 }, (_, i) => ({ key: `ATC-${i}`, title: "t", priority: 3 })) }));
  assert.equal(n.linear.items.length, NOTICE_MAX);
  assert.equal(n.linear.total, NOTICE_MAX + 5);
});
