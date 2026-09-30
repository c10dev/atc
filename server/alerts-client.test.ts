import assert from "node:assert/strict";
import { test } from "node:test";
import { FREQ_MAX, FREQ_MIN, RAMP_S, specOf, specEnd } from "../web/src/sound.ts";
import {
  type AlertPrefs,
  applyAlertEvent,
  DEFAULT_PREFS,
  EMPTY_SEEN,
  FLAP_MS,
  inQuiet,
  kindFilter,
  needsAction,
  parsePrefs,
  parseSeen,
  type SoundName,
  soundFor,
  soundOfAlert,
  type SupervisorAlert,
} from "../web/src/supervisor-alerts.ts";

const NOW = Date.parse("2026-09-29T12:00:00");
const al = (key: string, over: Partial<SupervisorAlert> = {}): SupervisorAlert => ({ key, group: "health", level: "caution", cue: null, aircraft: "TEAM_A", flight: "ATC-1", text: key, next: "n", link: "#strips", since: null, dest: "alerts", ...over });
const ev = (raised: SupervisorAlert[], cleared: string[] = [], items: SupervisorAlert[] = raised, initial = false) => ({ raised, cleared, items, initial });
const on: AlertPrefs = { ...DEFAULT_PREFS, sound: true, sounds: { warning: true, caution: true, call: true, done: true } };
const ctx = (over: Partial<{ lastSounded: Record<string, number>; playing: SoundName | null }> = {}) => ({ lastSounded: {}, playing: null, ...over });

// ── 한 번만 알리기 ──
test("처음 연결(initial)은 기준선: 알리지 않고, 이후 새 key만 알린다", () => {
  const a = al("a");
  const first = applyAlertEvent(EMPTY_SEEN, ev([a], [], [a], true), NOW);
  assert.deepEqual(first.fresh, []);
  assert.equal(first.state.seeded, true);
  const b = al("b");
  const next = applyAlertEvent(first.state, ev([b], [], [a, b]), NOW + 1000);
  assert.deepEqual(next.fresh.map((x) => x.key), ["b"]);
  // 같은 이벤트를 다시 받아도(다른 탭이 이미 처리) 다시 알리지 않는다
  assert.deepEqual(applyAlertEvent(next.state, ev([b], [], [a, b]), NOW + 2000).fresh, []);
});

test("다시 접속(initial)하면 그동안 생긴 key는 알리고, 이미 알린 key는 알리지 않는다", () => {
  const a = al("a");
  const seeded = applyAlertEvent(EMPTY_SEEN, ev([a], [], [a], true), NOW).state;
  const b = al("b");
  const re = applyAlertEvent(seeded, ev([a, b], [], [a, b], true), NOW + 60_000);
  assert.deepEqual(re.fresh.map((x) => x.key), ["b"]);
  // 재접속 사이에 사라진 key는 사라진 것으로 적는다
  const gone = applyAlertEvent(re.state, ev([b], [], [b], true), NOW + 120_000);
  assert.equal(gone.state.keys.a.clearedAt, NOW + 120_000);
});

test("사라졌다 10분 안에 돌아온 key는 다시 알리지 않고, 10분 뒤에는 알린다", () => {
  const a = al("a");
  const s0 = applyAlertEvent(EMPTY_SEEN, ev([a], [], [a], true), NOW).state;
  const s1 = applyAlertEvent(s0, ev([], ["a"], []), NOW + 1000).state;
  const quick = applyAlertEvent(s1, ev([a]), NOW + 1000 + FLAP_MS - 1);
  assert.deepEqual(quick.fresh, []);
  // 위에서 돌아왔다고 적혔으니 다시 사라졌다 오는 경우로 확인한다
  const s2 = applyAlertEvent(s1, ev([], ["a"], []), NOW + 5000).state; // 이미 사라진 key는 그대로
  const later = applyAlertEvent(s2, ev([a]), NOW + 1000 + FLAP_MS + 1);
  assert.deepEqual(later.fresh.map((x) => x.key), ["a"]);
});

test("사라진 지 오래된 key 기록은 지운다. 저장값이 깨져 있으면 빈 상태", () => {
  const a = al("a");
  const s0 = { seeded: true, keys: { old: { clearedAt: NOW - 2 * 3_600_000 } } };
  assert.deepEqual(applyAlertEvent(s0, ev([a]), NOW).state.keys, { a: { clearedAt: null } });
  assert.deepEqual(parseSeen("nope"), EMPTY_SEEN);
  assert.deepEqual(parseSeen({ seeded: true, keys: { x: { clearedAt: null }, y: 3, z: { clearedAt: "no" } } }), { seeded: true, keys: { x: { clearedAt: null } } });
});

// ── 종류 필터 ──
test("종류 필터: 꺼 둔 종류는 거른다", () => {
  const items = [al("h", { group: "health" }), al("p", { group: "pending" }), al("r", { group: "rts" })];
  const p = { groups: { ...DEFAULT_PREFS.groups, pending: false } };
  assert.deepEqual(kindFilter(items, p).map((x) => x.key), ["h", "r"]);
  assert.deepEqual(kindFilter(items, DEFAULT_PREFS).length, 3);
});

test("조치가 필요한 것: WARNING·CAUTION·CALL", () => {
  assert.equal(needsAction({ level: "warning", cue: null }), true);
  assert.equal(needsAction({ level: "advisory", cue: "call" }), true);
  assert.equal(needsAction({ level: "advisory", cue: null }), false);
  assert.equal(needsAction({ level: null, cue: "done" }), false);
});

test("설정: 모르는 값·깨진 값은 기본값, 기본은 알림과 소리 모두 꺼짐", () => {
  assert.equal(DEFAULT_PREFS.notify, false);
  assert.equal(DEFAULT_PREFS.sound, false);
  assert.equal(DEFAULT_PREFS.sounds.done, false);
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("x"), DEFAULT_PREFS);
  const p = parsePrefs({ notify: true, volume: 7, groups: { rts: false, bogus: false }, sounds: { warning: "no" }, quiet: { on: true, from: "25:00", to: "07:30" } });
  assert.equal(p.notify, true);
  assert.equal(p.volume, 1);
  assert.equal(p.groups.rts, false);
  assert.equal("bogus" in p.groups, false);
  assert.equal(p.sounds.warning, true);
  assert.deepEqual(p.quiet, { on: true, from: "22:00", to: "07:30" });
});

// ── 조용한 시간 ──
test("조용한 시간: 자정을 넘는 구간과 꺼짐", () => {
  const q = { on: true, from: "22:00", to: "08:00" };
  const at = (h: number, m = 0) => new Date(2026, 8, 29, h, m);
  assert.equal(inQuiet(q, at(23)), true);
  assert.equal(inQuiet(q, at(7, 59)), true);
  assert.equal(inQuiet(q, at(8)), false);
  assert.equal(inQuiet(q, at(21, 59)), false);
  assert.equal(inQuiet({ on: true, from: "01:00", to: "05:00" }, at(3)), true);
  assert.equal(inQuiet({ on: true, from: "01:00", to: "05:00" }, at(6)), false);
  assert.equal(inQuiet({ ...q, on: false }, at(23)), false);
  assert.equal(inQuiet({ on: true, from: "09:00", to: "09:00" }, at(9)), false);
});

// ── 소리 ──
test("소리: 등급과 cue에서 WARNING·CAUTION·CALL·DONE, ADVISORY와 등급 없음은 조용", () => {
  assert.equal(soundOfAlert({ level: "warning", cue: null }), "warning");
  assert.equal(soundOfAlert({ level: "caution", cue: null }), "caution");
  assert.equal(soundOfAlert({ level: "advisory", cue: "call" }), "call");
  assert.equal(soundOfAlert({ level: null, cue: "done" }), "done");
  assert.equal(soundOfAlert({ level: "advisory", cue: null }), null);
  assert.equal(soundOfAlert({ level: null, cue: null }), null); // 옛 서버: 짐작하지 않는다
});

test("soundFor: 소리가 꺼져 있거나 종류를 끄면 조용하고, WARNING만 되풀이한다", () => {
  const w = al("w", { level: "warning" });
  assert.equal(soundFor([w], DEFAULT_PREFS, NOW, ctx()).sound, null);
  const d = soundFor([w], on, NOW, ctx());
  assert.deepEqual([d.sound, d.repeat, d.interrupt, d.keys], ["warning", true, false, ["w"]]);
  assert.deepEqual([soundFor([al("c")], on, NOW, ctx()).sound, soundFor([al("c")], on, NOW, ctx()).repeat], ["caution", false]);
  assert.equal(soundFor([al("p", { level: "advisory", cue: "call", group: "pending" })], on, NOW, ctx()).sound, "call");
  assert.equal(soundFor([al("r", { level: null, cue: "done", group: "rts" })], on, NOW, ctx()).sound, "done");
  const noDone = { ...on, sounds: { ...on.sounds, done: false } };
  assert.equal(soundFor([al("r", { level: null, cue: "done" })], noDone, NOW, ctx()).sound, null);
  assert.equal(soundFor([al("a", { level: "advisory" })], on, NOW, ctx()).sound, null);
  assert.equal(soundFor([al("x", { level: null })], on, NOW, ctx()).sound, null);
});

test("soundFor: 함께 온 key는 가장 높은 등급 소리 하나(WARNING > CAUTION > CALL > DONE)", () => {
  const batch = [al("c"), al("p", { level: "advisory", cue: "call" }), al("w", { level: "warning" }), al("d", { level: null, cue: "done" })];
  const d = soundFor(batch, on, NOW, ctx());
  assert.equal(d.sound, "warning");
  assert.deepEqual(d.keys.sort(), ["c", "d", "p", "w"]);
  assert.equal(soundFor(batch.filter((x) => x.key !== "w"), on, NOW, ctx()).sound, "caution");
});

test("soundFor: 한 번에 하나 — 울리는 소리와 같거나 낮으면 내지 않고, 높으면 끊는다", () => {
  assert.equal(soundFor([al("c")], on, NOW, ctx({ playing: "caution" })).sound, null);
  assert.equal(soundFor([al("c")], on, NOW, ctx({ playing: "warning" })).sound, null);
  assert.equal(soundFor([al("w", { level: "warning" })], on, NOW, ctx({ playing: "warning" })).sound, null);
  const up = soundFor([al("w", { level: "warning" })], on, NOW, ctx({ playing: "caution" }));
  assert.deepEqual([up.sound, up.interrupt], ["warning", true]);
});

test("soundFor: 같은 key는 10분 안에 다시 울리지 않는다", () => {
  const c = al("c");
  assert.equal(soundFor([c], on, NOW, ctx({ lastSounded: { c: NOW - FLAP_MS + 1 } })).sound, null);
  assert.equal(soundFor([c], on, NOW, ctx({ lastSounded: { c: NOW - FLAP_MS } })).sound, "caution");
});

test("soundFor: 조용한 시간에는 울리지 않는다", () => {
  const quiet = { ...on, quiet: { on: true, from: "11:00", to: "13:00" } };
  assert.equal(soundFor([al("w", { level: "warning" })], quiet, NOW, ctx()).sound, null);
  assert.equal(soundFor([al("w", { level: "warning" })], { ...quiet, quiet: { ...quiet.quiet, from: "13:00", to: "14:00" } }, NOW, ctx()).sound, "warning");
});

// ── 소리 명세: 넷뿐, 서로 다른 높이·리듬, 200–1500 Hz, 램프 ──
test("소리 명세: 주파수 범위, 램프 길이, 서로 다른 높이와 리듬", () => {
  const names: SoundName[] = ["warning", "caution", "call", "done"];
  const specs = Object.fromEntries(names.map((n) => [n, specOf(n)]));
  for (const n of names) {
    for (const t of specs[n].tones) {
      assert.ok(t.freqs.every((f) => f >= FREQ_MIN && f <= FREQ_MAX), `${n} 주파수`);
      assert.ok(t.dur >= 2 * RAMP_S, `${n} 램프가 들어갈 길이`);
      assert.ok(t.gain > 0 && t.gain <= 1);
    }
    assert.ok(specEnd(specs[n]) <= specs[n].period + 1e-9, `${n} 한 번이 주기 안`);
  }
  assert.ok(RAMP_S >= 0.02 && RAMP_S <= 0.03);
  const sig = (n: SoundName) => JSON.stringify([specs[n].tones.map((t) => t.freqs), specs[n].tones.map((t) => [t.at, t.dur])]);
  assert.equal(new Set(names.map(sig)).size, 4);
  const pitches = names.map((n) => JSON.stringify(specs[n].tones.map((t) => t.freqs)));
  const rhythms = names.map((n) => JSON.stringify(specs[n].tones.map((t) => [t.at, t.dur])));
  assert.equal(new Set(pitches).size, 4, "높이가 모두 다르다");
  assert.equal(new Set(rhythms).size, 4, "리듬이 모두 다르다");
  // CALL: 음쌍 둘, 각 0.3초, 사이 0.1초
  const call = specs.call.tones;
  assert.deepEqual([call.length, call[0].dur, +(call[1].at - (call[0].at + call[0].dur)).toFixed(2), call[0].freqs.length], [2, 0.3, 0.1, 2]);
  // WARNING은 빠른 펄스 여러 개, CAUTION은 하나의 두 음
  assert.ok(specs.warning.tones.length >= 4 && specs.warning.tones.every((t) => t.dur <= 0.1));
  assert.equal(specs.caution.tones.length, 2);
});

// ── 음성 콜아웃(ATC-140) ──
const voiceOn: AlertPrefs = { ...on, voice: { on: true, radio: 0.7 } };

test("음성 설정: 기본은 꺼짐(톤과 따로), 모르는 값은 기본으로, radio는 0..1로 자른다", () => {
  assert.deepEqual(DEFAULT_PREFS.voice, { on: false, radio: 0.7 });
  assert.deepEqual(parsePrefs({ voice: { on: true, radio: 5 } }).voice, { on: true, radio: 1 });
  assert.deepEqual(parsePrefs({ voice: { on: "yes", radio: "x" } }).voice, { on: false, radio: 0.7 });
  assert.deepEqual(parsePrefs({ voice: null }).voice, DEFAULT_PREFS.voice);
  assert.deepEqual(parsePrefs({ sound: true }).voice, DEFAULT_PREFS.voice); // 옛 저장값
});

test("음성은 WARNING·CALL에만: 톤 뒤에 그 알림 하나(voiceKey)", () => {
  const warning = al("w", { level: "warning" });
  const call = al("c", { level: "advisory", cue: "call" });
  assert.equal(soundFor([warning], voiceOn, NOW, ctx()).voiceKey, "w");
  assert.equal(soundFor([call], voiceOn, NOW, ctx()).voiceKey, "c");
  // CAUTION·DONE에는 음성이 없다
  assert.equal(soundFor([al("k", { level: "caution" })], voiceOn, NOW, ctx()).voiceKey, null);
  assert.equal(soundFor([al("d", { level: null, cue: "done" })], voiceOn, NOW, ctx()).voiceKey, null);
  // 음성이 꺼져 있으면 톤만
  const off = soundFor([warning], on, NOW, ctx());
  assert.equal(off.sound, "warning");
  assert.equal(off.voiceKey, null);
});

test("묶인 알림은 가장 높은 것 하나만 읽고, 이미 더 높은 소리가 울리는 중이면 소리도 음성도 없다", () => {
  const w = al("w", { level: "warning" });
  const c = al("c", { level: "advisory", cue: "call" });
  const k = al("k", { level: "caution" });
  const d = soundFor([k, c, w], voiceOn, NOW, ctx());
  assert.deepEqual([d.sound, d.voiceKey, d.keys.sort()], ["warning", "w", ["c", "k", "w"]]);
  // 가장 높은 것이 CAUTION이면 톤만 난다(음성이 없는 것이 더 높으면 낮은 CALL을 대신 읽지 않는다)
  const lowCall = soundFor([k, c], voiceOn, NOW, ctx());
  assert.deepEqual([lowCall.sound, lowCall.voiceKey], ["caution", null]);
  const blocked = soundFor([c], voiceOn, NOW, ctx({ playing: "warning" }));
  assert.deepEqual([blocked.sound, blocked.voiceKey], [null, null]);
  // 음성이 있어도 조용한 시간, 소리 꺼짐, 10분 재울림 방지는 그대로
  assert.equal(soundFor([w], { ...voiceOn, sound: false }, NOW, ctx()).voiceKey, null);
  assert.equal(soundFor([w], voiceOn, NOW, ctx({ lastSounded: { w: NOW - 60_000 } })).voiceKey, null);
  assert.equal(soundFor([w], { ...voiceOn, quiet: { on: true, from: "11:00", to: "13:00" } }, NOW, ctx()).voiceKey, null);
});
