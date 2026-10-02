import assert from "node:assert/strict";
import { test } from "node:test";
import { k3DeclarationsOf, k3LaunchOf, settingsOf } from "./k3-allow.ts";
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
