import assert from "node:assert/strict";
import { test } from "node:test";
import { conflictHintOf, DEFAULT_TEAM_PATTERN, fleetKeyOf, registrationNamesOf, registrationOf, regKey, renameHintOf, sameReg } from "./registration.ts";

test("registrationOf: teamPattern에 맞는 표기는 모두 정식 TEAM_X로", () => {
  for (const n of ["Team G", "TEAM-G", "team_g", "TEAM_G", "TEAMG", "teamg", " Team G ", "Team-g"]) assert.equal(registrationOf(n), "TEAM_G", n);
});

test("registrationOf: 팀 세션이 아닌 이름은 null", () => {
  for (const n of ["TOWER", "OCC", "ENGINEERING", "President", "TEAM", "TEAM_GH", "TEAM_1", "MY TEAM G", "Team  G", "", null, undefined]) assert.equal(registrationOf(n), null, String(n));
});

test("registrationOf: teamPattern을 바꾸면 거기서 정한다(하드코딩 없음)", () => {
  const crew = "^CREW[\\s_-]?\\d{1,2}$";
  assert.equal(registrationOf("crew 7", crew), "CREW_7");
  assert.equal(registrationOf("CREW12", crew), "CREW_12");
  assert.equal(registrationOf("Team G", crew), null);
  // `_`를 받지 않는 규칙이면 대문자 그대로
  assert.equal(registrationOf("squad7", "^SQUAD\\d$"), "SQUAD7");
  // 깨진 규칙은 아무것도 맞지 않는다
  assert.equal(registrationOf("TEAM_G", "^TEAM["), null);
  assert.equal(DEFAULT_TEAM_PATTERN, "^TEAM[\\s_-]?[A-Z]$");
});

test("regKey·sameReg·fleetKeyOf: 비교는 REGISTRATION으로, 팀이 아닌 이름은 대문자로", () => {
  assert.equal(regKey("Team G"), "TEAM_G");
  assert.equal(regKey("tower"), "TOWER");
  assert.equal(regKey(null), "");
  assert.ok(sameReg("team-g", "TEAM_G"));
  assert.ok(!sameReg("TEAM_G", "TEAM_H"));
  // 등록부의 옛 키 표기도 찾고, 그 키를 그대로 돌려준다(바꿔 쓰지 않는다)
  assert.equal(fleetKeyOf(["TEAM_A", "Team_G"], "TEAM-G"), "Team_G");
  assert.equal(fleetKeyOf(["TEAM_A"], "Team G"), null);
});

test("registrationNamesOf: 정식이 아닌 이름은 힌트, 같은 REGISTRATION의 세션 둘 이상은 충돌", () => {
  const m = registrationNamesOf(["Team G", "TEAM_H", "team_h", "TOWER", "TEAM_K", "TEAM_K"]);
  assert.deepEqual(m.get("TEAM_G"), { registration: "TEAM_G", names: ["Team G"], rename: "Team G", conflict: false });
  assert.deepEqual(m.get("TEAM_H"), { registration: "TEAM_H", names: ["TEAM_H", "team_h"], rename: "team_h", conflict: true });
  // 같은 이름을 두 번 띄운 것도 충돌이다(idea #96)
  assert.deepEqual(m.get("TEAM_K"), { registration: "TEAM_K", names: ["TEAM_K", "TEAM_K"], rename: null, conflict: true });
  assert.equal(m.has("TOWER"), false);
  assert.equal(renameHintOf("Team G", "TEAM_G"), "세션 이름 Team G → TEAM_G로 바꾸면 좋다");
  assert.match(conflictHintOf(["TEAM_H", "team_h"], "TEAM_H"), /^세션 2개가 TEAM_H로 읽힘: TEAM_H, team_h — 합치지 않는다/);
});
