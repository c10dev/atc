import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDraft, payloadText } from "./atcctl.mjs";

const argv = (s) => s.split(" ");

test("CLASSIFY: --rating은 여러 번, 근거는 -- 뒤 전부", () => {
  assert.deepEqual(parseDraft(argv("classify VOC-195 --type MAINT --wake M --rating SEC --rating DATA -- 잠금 경쟁 -- 수정")), {
    kind: "CLASSIFY",
    flight: "VOC-195",
    type: "MAINT",
    wake: "M",
    ratings: ["SEC", "DATA"],
    reason: "잠금 경쟁 -- 수정",
  });
});

test("CLASSIFY: 옵션 하나만", () => {
  assert.deepEqual(parseDraft(argv("CLASSIFY VOC-1 --wake L -- 한 줄")), { kind: "CLASSIFY", flight: "VOC-1", wake: "L", reason: "한 줄" });
});

test("PRIORITIZE: --priority", () => {
  assert.deepEqual(parseDraft(argv("PRIORITIZE VOC-177 --priority 2 -- 본문에 기한")), { kind: "PRIORITIZE", flight: "VOC-177", priority: "2", reason: "본문에 기한" });
});

const bad = [
  ["모르는 작업", "TAIL VOC-1 -- x", /모르는 SCHEDULE 작업/],
  ["작업 없음", "", /모르는 SCHEDULE 작업/],
  ["FLIGHT 없음", "CLASSIFY -- x", /FLIGHT key/],
  ["FLIGHT 자리에 옵션", "CLASSIFY --type BUILD -- x", /FLIGHT key/],
  ["근거 없음", "CLASSIFY VOC-1 --type BUILD", /근거/],
  ["빈 근거", "CLASSIFY VOC-1 --type BUILD --", /근거/],
  ["CLASSIFY에 --priority", "CLASSIFY VOC-1 --priority 1 -- x", /쓸 수 없는 옵션 --priority/],
  ["PRIORITIZE에 --type", "PRIORITIZE VOC-1 --type BUILD --priority 1 -- x", /쓸 수 없는 옵션 --type/],
  ["PRIORITIZE에 --priority 없음", "PRIORITIZE VOC-1 -- x", /--priority <1-4>가 필요/],
  ["값 없는 옵션", "CLASSIFY VOC-1 --wake -- x", /--wake 뒤에 값/],
  ["값 자리에 옵션", "CLASSIFY VOC-1 --type --wake M -- x", /--type 뒤에 값/],
];
for (const [name, s, re] of bad) test(`거부: ${name}`, () => assert.throws(() => parseDraft(s ? argv(s) : []), re));

test("payloadText", () => {
  assert.equal(payloadText({ kind: "CLASSIFY", payload: { type: "MAINT", wake: "M", ratings: ["SEC"] } }), "type:MAINT wake:M rating:SEC");
  assert.equal(payloadText({ kind: "CLASSIFY", payload: { ratings: ["UI"] } }), "rating:UI");
  assert.equal(payloadText({ kind: "PRIORITIZE", payload: { priority: 3 } }), "priority 3(Medium)");
});
