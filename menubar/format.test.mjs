import assert from "node:assert/strict";
import { test } from "node:test";
import { esc, fuelOf, menuLines, newAlerts, nextSeen, notifyUrl, rtsLine, SEEN_TTL_MS, unreachableLines, workingOf } from "./format.mjs";

const item = (key, level, over = {}) => ({ key, group: "alert", level, cue: null, aircraft: null, flight: null, text: `${key} 문구`, next: "", link: "#strips", since: null, ...over });
const fleet = {
  fuelAccounts: [
    { account: "a", windows: [{ name: "five_hour", pct: 10 }, { name: "seven_day", pct: 20 }] },
    { account: "b", windows: [{ name: "five_hour", pct: 33.4 }, { name: "seven_day", pct: 53 }] },
  ],
  aircraft: [{ registration: "TEAM_A", status: "busy" }, { registration: "TEAM_B", status: "idle" }, { registration: "TEAM_C", status: "busy" }],
};
const control = { sessions: [{ name: "TOWER", live: [{ status: "idle", job: { state: "working" } }] }, { name: "OCC", live: [{ status: "idle", job: null }] }, { name: "MCC", live: [] }] };
const update = { last: { at: "2026-09-29T15:21:11.692Z", result: "ok", detail: "4초 · 세션 9개 그대로" } };
const opts = { fleet, update, control, tz: "UTC" };
const menu = (items) => menuLines({ alerts: { items }, ...opts });
const BASE = "http://localhost:7700";

test("빈 알림: 제목 ✈ 0과 FUEL, 색 없음, 항목 자리에 안내", () => {
  const m = menu([]);
  assert.equal(m[0], "✈ 0 5h 33% · 7d 53%");
  assert.equal(m[1], "---");
  assert.equal(m[2], "지금 알릴 것 없음");
  assert.ok(m.includes(`DISPATCH 승인 대기 0 | href=${BASE}/#dispatch`));
  assert.ok(m.includes(`RTS ok 15:21 · 4초 · 세션 9개 그대로 | href=${BASE}/#radar`));
  assert.ok(m.includes(`일하는 중: AIRCRAFT 2 · 관제 세션 1 | href=${BASE}/#fleet`));
  assert.deepEqual(m.slice(-2), [`Open atc | href=${BASE}/`, "Refresh | refresh=true"]);
});

test("advisory만: 숫자는 0, +n으로 따로, 색 없음", () => {
  const m = menu([item("a|1", "advisory"), item("a|2", "advisory")]);
  assert.equal(m[0], "✈ 0 +2 5h 33% · 7d 53%");
  assert.ok(m.includes("ADVISORY 2"));
  assert.ok(!m.some((l) => l.startsWith("WARNING") || l.startsWith("CAUTION")));
});

test("warning: 빨강 제목, 등급 순(높은 것 먼저), 항목은 text — next, 누르면 탭 주소", () => {
  const m = menu([item("c1", "caution", { text: "주인 없는 변경", next: "정리한다" }), item("w1", "warning", { text: "충돌", link: "#airports" }), item("v1", "advisory")]);
  assert.equal(m[0], "✈ 2 +1 5h 33% · 7d 53% | color=#FF3B30");
  const at = (s) => m.findIndex((l) => l.startsWith(s));
  assert.ok(at("WARNING 1") < at("CAUTION 1") && at("CAUTION 1") < at("ADVISORY 1"));
  assert.ok(m.includes(`충돌 | href=${BASE}/#airports`));
  assert.ok(m.includes(`주인 없는 변경 — 정리한다 | href=${BASE}/#strips`));
});

test("caution만: 호박색 제목", () => {
  assert.match(menu([item("c1", "caution")])[0], /\| color=#FF9500$/);
});

test("call: DISPATCH 승인 대기는 pending|proposal 항목 수, 제목 색은 advisory라 없음", () => {
  const m = menu([
    item("pending|proposal|P-1", "advisory", { group: "pending", cue: "call", link: "#dispatch", text: "제안 P-1 판정 대기" }),
    item("pending|proposal|P-2", "advisory", { group: "pending", cue: "call", link: "#dispatch" }),
    item("pending|tool|s1|t", "advisory", { group: "pending", cue: "call" }),
  ]);
  assert.ok(m.includes(`DISPATCH 승인 대기 2 | href=${BASE}/#dispatch`));
  assert.ok(!/color=/.test(m[0]));
});

test("atc 연결 안 됨: ✈ —와 한 줄 안내(오류 덩어리 없음)", () => {
  const m = unreachableLines();
  assert.equal(m[0], "✈ —");
  assert.ok(m.includes("atc 연결 안 됨: SSH 포워딩 확인"));
  assert.ok(m.includes("Refresh | refresh=true"));
  assert.equal(m.filter((l) => l.includes("Error") || l.includes("ECONN")).length, 0);
});

test("한글 문구 속 |는 SwiftBar 구분자라 막는다: 제목 줄에 ` | `는 매개변수 앞에 하나뿐", () => {
  const m = menu([item("k", "caution", { text: "MCC 대기 | merge PR #228 — 답하거나 | 붙는다", next: "a|b\nc", link: "#strips" })]);
  const l = m.find((x) => x.includes("MCC 대기"));
  assert.equal(l, `MCC 대기 ¦ merge PR #228 — 답하거나 ¦ 붙는다 — a¦b c | href=${BASE}/#strips`);
  assert.equal(l.split(" | ").length, 2);
  assert.equal(esc("- 맨 앞 하이픈"), "– 맨 앞 하이픈");
  assert.equal(esc("가".repeat(300)).length, 110);
});

test("한 등급이 15개를 넘으면 15개만 펼치고 나머지는 한 줄로", () => {
  const m = menu(Array.from({ length: 20 }, (_, n) => item(`c${n}`, "caution", { text: `항목 ${n}` })));
  assert.equal(m.filter((l) => l.startsWith("항목 ")).length, 15);
  assert.ok(m.includes(`외 5개 — atc에서 보기 | href=${BASE}/#radar`));
  assert.ok(m.includes("CAUTION 20 | color=#FF9500"));
});

test("FUEL은 가장 많이 쓴 ACCOUNT, 모르면 빠진다", () => {
  assert.equal(fuelOf(fleet), "5h 33% · 7d 53%");
  assert.equal(fuelOf({ fuelAccounts: [{ windows: [{ name: "seven_day", pct: 7 }] }] }), "7d 7%");
  assert.equal(fuelOf({}), null);
  assert.equal(menuLines({ alerts: { items: [] }, fleet: null, update: null, control: null })[0], "✈ 0");
});

test("일하는 수·RTS는 자료가 없으면 줄이 빠진다", () => {
  assert.deepEqual(workingOf(fleet, control), { aircraft: 2, control: 1 });
  assert.deepEqual(workingOf(null, null), { aircraft: null, control: null });
  assert.equal(rtsLine({ last: null }, "UTC"), null);
  const m = menuLines({ alerts: { items: [] }, fleet: null, update: null, control: null });
  assert.ok(m.every((l) => !l.startsWith("RTS") && !l.startsWith("일하는")));
});

test("새 key 알림: warning이거나 call인 처음 본 key만, 처음 실행이면 모두 본 것으로", () => {
  const items = [item("w", "warning"), item("c", "advisory", { cue: "call" }), item("x", "caution"), item("old", "warning")];
  assert.deepEqual(newAlerts(items, { old: 1 }).map((i) => i.key), ["w", "c"]);
  assert.deepEqual(newAlerts(items, null), []);
  assert.deepEqual(newAlerts(items, { w: 1, c: 1, x: 1, old: 1 }), []);
});

test("본 key 목록: 지금 있는 key를 더하고, 7일 지난 것은 지운다. 같은 key는 시각을 바꾸지 않는다", () => {
  const now = 10 * SEEN_TTL_MS;
  const seen = nextSeen([item("a", "warning"), item("b", "caution")], { a: now - 5, gone: now - SEEN_TTL_MS - 1, kept: now - 1000 }, now);
  assert.deepEqual(seen, { a: now - 5, kept: now - 1000, b: now });
  assert.deepEqual(nextSeen([], null, now), {});
});

test("swiftbar://notify 주소: 플러그인·제목·본문·href, 한글과 |가 안전하게 인코딩", () => {
  const url = notifyUrl({ plugin: "atc", item: item("k", "warning", { text: "충돌 | 확인", link: "#airports" }) });
  const u = new URL(url);
  assert.equal(u.protocol, "swiftbar:");
  assert.equal(u.host, "notify");
  assert.equal(u.searchParams.get("plugin"), "atc");
  assert.equal(u.searchParams.get("title"), "atc WARNING");
  assert.equal(u.searchParams.get("body"), "충돌 ¦ 확인");
  assert.equal(u.searchParams.get("href"), `${BASE}/#airports`);
  assert.equal(new URL(notifyUrl({ plugin: "atc", item: item("k", "advisory", { cue: "call" }) })).searchParams.get("title"), "atc ADVISORY CALL");
  assert.ok(!url.includes("+"));
});
