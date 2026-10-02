import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { callsign } from "./callsign.ts";
import { nextRegistration, REGISTRATION_SEQUENCE } from "./fleet.ts";
import { hashOf, radioPhraseOf, voiceOf } from "./radio-phrase.ts";
import { compareRegistration, DEFAULT_TEAM_PATTERN, registrationOf, regKey } from "./registration.ts";
import { optionsOf, linksOf } from "../web/src/radio-log.ts";
import { sortRows, type FuelRow } from "../web/src/fuel-overview.ts";
import type { Transmission } from "./radio.ts";

// 두 글자 REGISTRATION(ATC-181): TEAM_AA … TEAM_ZZ

test("registrationOf: 한 글자와 두 글자 모두, 어떤 표기든 TEAM_XX로", () => {
  for (const [raw, want] of [
    ["Team G", "TEAM_G"], ["team-g", "TEAM_G"], ["TEAMG", "TEAM_G"], ["TEAM_Z", "TEAM_Z"],
    ["Team AB", "TEAM_AB"], ["team-ab", "TEAM_AB"], ["TEAMAB", "TEAM_AB"], ["team_ab", "TEAM_AB"], ["TEAM_ZZ", "TEAM_ZZ"], ["  team aa ", "TEAM_AA"],
  ] as const) assert.equal(registrationOf(raw), want, raw);
});

test("팀 이름이 아닌 것: 세 글자, 숫자, 다른 접두어", () => {
  for (const raw of ["TEAM_ABC", "TEAMABC", "TEAM_1", "TEAM_A1", "TEAM_", "TEAM", "OCC", "TOWER", "TEAMS_A", "XTEAM_A", ""]) assert.equal(registrationOf(raw), null, raw);
  assert.equal(regKey("TEAM_ABC"), "TEAM_ABC"); // 팀이 아니면 대문자 그대로
  assert.ok(new RegExp(DEFAULT_TEAM_PATTERN, "i").test("Team_qz"));
});

test("nextRegistration: A…Z 다음 AA, AB … ZZ 다음 null. 퇴역·기존 번호는 계속 쓴 것", () => {
  assert.equal(nextRegistration([]), "TEAM_A");
  assert.equal(nextRegistration(["TEAM_A", "Team B"]), "TEAM_C");
  const letters = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
  const upToY = letters.slice(0, 24).map((c) => `TEAM_${c}`);
  assert.equal(nextRegistration(upToY), "TEAM_Y");
  assert.equal(nextRegistration([...upToY, "TEAM_Y"]), "TEAM_Z");
  const all1 = letters.map((c) => `TEAM_${c}`);
  assert.equal(nextRegistration(all1), "TEAM_AA"); // Z → AA 경계
  assert.equal(nextRegistration([...all1, "TEAM_AA"]), "TEAM_AB");
  assert.equal(nextRegistration([...all1, "team ab"]), "TEAM_AA"); // 빈 AA가 먼저
  assert.equal(nextRegistration(all1.slice(1)), "TEAM_A");
  assert.equal(nextRegistration(REGISTRATION_SEQUENCE.slice(0, -1)), "TEAM_ZZ");
  assert.equal(nextRegistration(REGISTRATION_SEQUENCE), null);
  assert.equal(REGISTRATION_SEQUENCE.length, 26 + 26 * 26);
  assert.equal(new Set(REGISTRATION_SEQUENCE).size, REGISTRATION_SEQUENCE.length);
});

test("callsign: 글자마다 한 단어", () => {
  assert.equal(callsign({ name: "TEAM_G" }), "GOLF");
  assert.equal(callsign({ name: "Team RA" }), "ROMEO ALPHA");
  assert.equal(callsign({ name: "team-zz" }), "ZULU ZULU");
  assert.equal(callsign({ name: "TEAMAB" }), "ALPHA BRAVO");
  assert.equal(callsign({ name: "TEAM_ABC" }), "TEAM_ABC");
  assert.equal(callsign({ name: "OCC" }), "OCC");
});

test("compareRegistration: 글자 수가 먼저(TEAM_Z가 TEAM_AA보다 앞), 팀 이름이 아닌 것은 뒤", () => {
  const list = ["TEAM_AB", "TEAM_B", "OCC", "TEAM_AA", "TEAM_Z", "TEAM_A", "TOWER"];
  assert.deepEqual([...list].sort(compareRegistration), ["TEAM_A", "TEAM_B", "TEAM_Z", "TEAM_AA", "TEAM_AB", "OCC", "TOWER"]);
  assert.ok(compareRegistration("TEAM_Z", "TEAM_AA") < 0);
  assert.equal(compareRegistration("TEAM_G", "TEAM_G"), 0);
});

const tx = (extra: Partial<Transmission>): Transmission => ({ id: "C-1", at: "2026-09-30T10:00:00.000Z", freq: "TOWER", from: "TOWER", to: "ROMEO ALPHA (TEAM_RA)", aircraft: "TEAM_RA", kind: "GO AROUND", head: "h", flight: "ATC-147", ...extra });

test("RADIO: 두 글자 콜사인의 문구와 목소리, FLEET 링크, AIRCRAFT 정렬", () => {
  assert.equal(radioPhraseOf(tx({})), "ROMEO ALPHA, Tower, go around, ATC one four seven.");
  assert.equal(radioPhraseOf(tx({ replyTo: "C-1", kind: "READBACK", from: "ROMEO ALPHA (TEAM_RA)", to: "TOWER", re: "GO AROUND" })), "Tower, ROMEO ALPHA, readback, go around, ATC one four seven.");
  const voices = ["a", "b", "c"];
  const v = voiceOf(tx({}), voices);
  assert.ok(v && voices.includes(v));
  assert.equal(voiceOf(tx({ freq: "DELIVERY" }), [...voices].reverse()), v); // 안정적
  assert.equal(hashOf("ROMEO ALPHA"), hashOf("ROMEO ALPHA"));
  assert.notEqual(hashOf("ROMEO ALPHA"), hashOf("ROMEO"));
  assert.deepEqual(linksOf(tx({ id: "C-9" })).map((l) => l.href), ["#flights", "#fleet/TEAM_RA"]);
  assert.deepEqual(optionsOf([tx({ aircraft: "TEAM_AA" }), tx({ aircraft: "TEAM_Z" }), tx({ aircraft: "TEAM_B" })], "aircraft"), ["TEAM_B", "TEAM_Z", "TEAM_AA"]);
});

test("METRICS FUEL 표: 이름순 정렬이 TEAM_Z를 TEAM_AA 앞에", () => {
  const row = (label: string) => ({ label, cost: null }) as unknown as FuelRow;
  assert.deepEqual(sortRows([row("TEAM_AA"), row("TEAM_Z"), row("TEAM_B")], "label", "asc").map((r) => r.label), ["TEAM_B", "TEAM_Z", "TEAM_AA"]);
  assert.deepEqual(sortRows([row("TEAM_AA"), row("TEAM_Z"), row("TEAM_B")], "cost", "desc").map((r) => r.label), ["TEAM_B", "TEAM_Z", "TEAM_AA"]);
});

// 새로 하드코딩한 한 글자 팀 정규식이 생기면 실패한다(landing-tier 분류 테스트처럼 소스를 훑는다).
// 팀 이름 규칙은 server/registration.ts의 DEFAULT_TEAM_PATTERN 하나다.
test("소스에 한 글자짜리 팀 정규식이 없다(TEAM…[A-Z]$)", () => {
  const roots = ["server", "web/src", "hooks", "controller", "occ", "crosscheck", "mcc", "deploy", "tts"];
  const ext = /\.(ts|tsx|mjs|js|py)$/;
  const skip = /(^|\/)(node_modules|dist)(\/|$)|\.test\.[a-z]+$/;
  const root = join(import.meta.dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      if (skip.test(relative(root, p))) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (ext.test(n)) files.push(p);
    }
  };
  for (const r of roots) walk(join(root, r));
  assert.ok(files.length > 100, "소스를 찾아야 한다");
  const single = /TEAM[^\n"'`]{0,12}\(?\[A-Z\]\)?\$/;
  const hits = files.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .map((l, i) => ({ f: relative(root, f), n: i + 1, l }))
      .filter(({ l }) => !/^\s*(\/\/|\*|#)/.test(l) && single.test(l)),
  );
  assert.deepEqual(hits.map((h) => `${h.f}:${h.n} ${h.l.trim()}`), [], "한 글자 팀 정규식은 registration.ts의 DEFAULT_TEAM_PATTERN을 쓴다");
});

// REGISTRATION으로 정렬하는 곳은 compareRegistration(글자 수 먼저)을 쓴다. registration.localeCompare는 TEAM_AA를 TEAM_B 앞에 둔다
test("소스에서 REGISTRATION을 localeCompare로 정렬하지 않는다", () => {
  const root = join(import.meta.dirname, "..");
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (/node_modules|dist/.test(p)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) && n !== "registration.ts") {
        readFileSync(p, "utf8")
          .split("\n")
          .forEach((l, i) => {
            if (/\b(registration|aircraft)\.localeCompare\(/.test(l)) hits.push(`${relative(root, p)}:${i + 1} ${l.trim()}`);
          });
      }
    }
  };
  for (const r of ["server", "web/src"]) walk(join(root, r));
  assert.deepEqual(hits, []);
});
