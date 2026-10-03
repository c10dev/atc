import { loadDispatchConfig, saveFuelHold } from "../dispatch.ts";
import { defineSwitch } from "../switch-def.ts";

// FUEL REMAINING(ATC-55): dispatch.json fuel.hold. DISPATCH HOLD 스위치(D3, 기본 꺼짐). SUPERVISOR만
export default defineSwitch({
  key: "fuelHold",
  label: "FUEL HOLD",
  group: "operations",
  block: { code: "FUEL", label: "사용 한도 HOLD", windowLabel: "사용 한도 HOLD(SUPERVISOR 전용)", words: "dispatch hold 사용량 한도 fuel.hold", searchOrder: 40 },
  values: ["off", "on"],
  default: "off",
  risky: ["on"],
  error: "off 또는 on",
  warn: () => {
    const f = loadDispatchConfig().fuel;
    return {
      off: `off(기본): FUEL은 FLEET 줄과 TOWER·OCC INFO(${f.infoPct}%)에만 보인다. statusline hook이 있어야 값이 들어온다.`,
      on: `⚠ ACCOUNT가 한도의 ${f.holdPct}% 이상을 쓰면 reset까지 DISPATCH가 그 ACCOUNT의 AIRCRAFT를 건너뛴다. ${f.infoPct}%부터 TOWER·OCC에 INFO.`,
    };
  },
  row: () => ({ label: "DISPATCH HOLD", env: "fuel.hold", note: "dispatch.json · 이 화면에서만 바꾼다" }),
  order: 10,
  lineOrder: 40,
  applyOrder: 20,
  read: () => (loadDispatchConfig().fuel.hold ? "on" : "off"),
  save: (v: "off" | "on") => saveFuelHold(v === "on"),
  record: (v: "off" | "on") => `fuel.hold=${v}`,
});
