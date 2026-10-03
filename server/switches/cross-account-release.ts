import { loadDispatchConfig, saveCrossAccountRelease } from "../dispatch.ts";
import { record } from "../recorder.ts";
import { defineSwitch } from "../switch-def.ts";

// ACCOUNT 불일치 카드 풀기(ATC-458): dispatch.json crossAccountRelease(기본 on). OCC와 ACCOUNT가 달라 닿지 않는 AIRCRAFT의 열린 ASSIGN 카드를 닫고 FLIGHT를 계획으로 돌린다.
// 계획 규칙(그 AIRCRAFT는 available false)은 이 스위치와 상관없다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "crossAccountRelease",
  label: "ACCOUNT RELEASE",
  group: "operations",
  block: { code: "ACCOUNT RELEASE", label: "ACCOUNT가 달라 닿지 않는 AIRCRAFT의 카드를 닫음", windowLabel: "ACCOUNT 불일치 카드 풀기(SUPERVISOR 전용)", words: "account 불일치 mismatch cross 닿지 않는 occ release 풀기 카드 supersede wrong-aircraft crossAccountRelease", searchOrder: 54 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 끄면 옛 동작(카드가 ATC-251 사유로 기다림)이라 ⚠ 목록에 넣지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: ACCOUNT가 달라 닿지 않는 AIRCRAFT의 열린 카드를 닫지 않는다. 카드가 ACCOUNT 불일치 사유로 계속 기다리고 FLIGHT는 계획으로 돌아가지 않는다(계획은 그 AIRCRAFT를 더는 고르지 않는다).",
    on: "기본: OCC와 관찰한 ACCOUNT가 달라 닿지 않는 AIRCRAFT의 열린(제안·승인, 아직 안 보낸) 카드를 AIRCRAFT 사유로 닫고 FLIGHT를 계획으로 돌린다. 닫은 수는 METRICS MISFIRE에 있다.",
  },
  row: () => ({ label: "ACCOUNT RELEASE", env: "crossAccountRelease", note: "dispatch.json · OCC가 닿지 못하는 AIRCRAFT의 열린 카드를 닫고 FLIGHT를 계획으로 돌린다 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  order: 41,
  applyOrder: 58,
  read: () => loadDispatchConfig().crossAccountRelease,
  save: (v: "off" | "on") => {
    const from = loadDispatchConfig().crossAccountRelease;
    saveCrossAccountRelease(v);
    if (from !== v) record({ t: new Date().toISOString(), kind: "policy", op: "cross-account-release-mode", by: "SUPERVISOR", from, to: v });
  },
  record: (v: "off" | "on") => `crossAccountRelease=${v}`,
});
