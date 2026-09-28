import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLEET } from "./crew.ts";
import { observeCrew, parseMeta, positionOf } from "./crew-observed.ts";

const D = DEFAULT_FLEET.defaults.complement;
const NOW = Date.parse("2026-09-27T12:00:00Z");
const ago = (h: number) => NOW - h * 3_600_000;

test("parseMeta: agentType·model만 꺼내고 description 같은 나머지는 버린다", () => {
  const m = parseMeta(JSON.stringify({ agentType: "ui-qa", description: "비밀 지시", name: "ui-qa-vr", model: "opus", spawnDepth: 1 }));
  assert.deepEqual(m, { agentType: "ui-qa", model: "opus" });
  assert.deepEqual(parseMeta(JSON.stringify({ agentType: "Explore" })), { agentType: "Explore", model: null });
  assert.equal(parseMeta("{"), null);
  assert.equal(parseMeta(JSON.stringify({ description: "x" })), null);
});

test("positionOf: 같은 이름은 그대로, 범용 타입은 모델 계열로, 내장 타입은 null", () => {
  assert.equal(positionOf("ui-builder", null, D), "ui-builder");
  assert.equal(positionOf("ui-qa", null, D), "ui-qa");
  assert.equal(positionOf("flash-helper", null, D), "flash-helper");
  assert.equal(positionOf("general-purpose", "opus", D), "backend");
  assert.equal(positionOf("claude", "claude-opus-5-5", D), "backend");
  // 모델 없이 부르면 CAPTAIN(Opus) 모델을 물려받는 것으로 본다
  assert.equal(positionOf("general-purpose", null, D), "backend");
  assert.equal(positionOf("general-purpose", "sonnet", D), null);
  assert.equal(positionOf("Explore", null, D), null);
  assert.equal(positionOf("Plan", "opus", D), null);
  assert.equal(positionOf("claude-code-guide", null, D), null);
  // 선언에 agent로 적은 타입도 맞춘다
  assert.equal(positionOf("Explore", null, [{ position: "scout", agent: "Explore" }]), "scout");
  assert.equal(positionOf("general-purpose", "opus", [{ position: "ui-qa", agent: "ui-qa" }]), null);
});

test("observeCrew: 14일 안의 호출을 묶고, 선언에 없음·안 쓰임을 낸다", () => {
  const { observedCrew, crewDrift } = observeCrew(
    [
      { agentType: "ui-builder", model: null, at: ago(2) },
      { agentType: "ui-builder", model: null, at: ago(30) },
      { agentType: "ui-qa", model: null, at: ago(5) },
      { agentType: "general-purpose", model: "opus", at: ago(1) },
      { agentType: "Explore", model: null, at: ago(3) },
      { agentType: "general-purpose", model: "sonnet", at: ago(4) },
      { agentType: "flash-helper", model: null, at: ago(24 * 15) }, // 기간 밖
    ],
    D,
    NOW,
  );
  assert.deepEqual(observedCrew[0], { agentType: "general-purpose", position: "backend", model: "opus", count: 1, lastAt: new Date(ago(1)).toISOString() });
  assert.deepEqual(
    observedCrew.map((o) => [o.agentType, o.position, o.count]),
    [
      ["general-purpose", "backend", 1],
      ["ui-builder", "ui-builder", 2],
      ["Explore", null, 1],
      ["general-purpose", null, 1],
      ["ui-qa", "ui-qa", 1],
    ],
  );
  assert.deepEqual(crewDrift, { undeclared: ["Explore", "general-purpose (sonnet)"], unused: ["flash-helper"] });
});

test("observeCrew: 호출이 없으면 빈 목록이고 선언 전부가 안 쓰임", () => {
  assert.deepEqual(observeCrew([], D, NOW), { observedCrew: [], crewDrift: { undeclared: [], unused: ["backend", "ui-builder", "ui-qa", "flash-helper"] } });
});

test("observeCrew(ATC-57): FUEL이 본 실제 모델을 쓰고, 선언과 어긋나면(COMPLEMENT DRIFT) 선언에 없음으로 올린다", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const complement = DEFAULT_FLEET.defaults.complement;
  const spawns = [
    { agentType: "general-purpose", model: null, at: now - 60_000, agent: "g1" }, // 실제 Sonnet
    { agentType: "general-purpose", model: null, at: now - 50_000, agent: "g2" }, // 실제 Opus
    { agentType: "ui-builder", model: null, at: now - 40_000, agent: "u1" },
  ];
  const actual = new Map([
    ["g1", "claude-sonnet-5"],
    ["g2", "claude-opus-5-5"],
    ["u1", "claude-sonnet-5"],
  ]);
  const { observedCrew, crewDrift } = observeCrew(spawns, complement, now, 14, (a) => actual.get(a) ?? null);
  assert.deepEqual(
    observedCrew.map((o) => [o.agentType, o.model, o.position]),
    [
      ["ui-builder", "claude-sonnet-5", "ui-builder"], // agent 타입 선언은 모델을 말하지 않는다
      ["general-purpose", "claude-opus-5-5", "backend"],
      ["general-purpose", "claude-sonnet-5", null],
    ],
  );
  assert.deepEqual(crewDrift.undeclared, ["general-purpose (claude-sonnet-5)"]);
  // 실제 모델을 모르면 예전처럼 부를 때 준 model(없으면 CAPTAIN 모델 Opus로 본다)
  assert.deepEqual(observeCrew(spawns, complement, now).crewDrift.undeclared, []);
});
