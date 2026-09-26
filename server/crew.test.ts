import assert from "node:assert/strict";
import { test } from "node:test";
import { canFly, classLabel, classOf, DEFAULT_FLEET } from "./crew.ts";

test("classOf: type·wake·rating 라벨과 Risk 그룹을 읽고, 없으면 BUILD · M", () => {
  assert.deepEqual(classOf([]), { type: "BUILD", wake: "M", ratings: [], explicit: { type: false, wake: false }, sources: [] });
  const c = classOf(["type:MAINT", "Wake: h", "rating:UI", "Risk:Security", "Risk: Rights", "symphony-pilot", "tail:TEAM_E"]);
  assert.equal(c.type, "MAINT");
  assert.equal(c.wake, "H");
  assert.deepEqual(c.ratings, ["SEC", "UI"]);
  assert.deepEqual(c.explicit, { type: true, wake: true });
  assert.equal(classLabel(c), "MAINT · H · SEC · UI");
  assert.equal(classOf(["type:PILOT", "wake:X"]).type, "BUILD");
});

test("canFly: BUILD·CHECK는 flash-helper 말고 그 일을 할 팀원이 필요, SURVEY·FERRY는 누구나", () => {
  const flash = [{ position: "helper", agent: "flash-helper", limits: ["no BUILD", "no CHECK verdicts", "no SEC"] }];
  const qa = [{ position: "ui-qa", agent: "ui-qa", limits: ["read-only"] }];
  assert.equal(canFly(DEFAULT_FLEET.defaults.complement, "BUILD"), true);
  assert.equal(canFly(DEFAULT_FLEET.defaults.complement, "CHECK"), true);
  assert.equal(canFly(flash, "BUILD"), false);
  assert.equal(canFly(flash, "CHECK"), false);
  assert.equal(canFly(flash, "SURVEY"), true);
  assert.equal(canFly(qa, "BUILD"), false);
  assert.equal(canFly([{ position: "backend", agent: "claude-opus-5-5", limits: ["no CHECK verdicts"] }], "CHECK"), false);
});
