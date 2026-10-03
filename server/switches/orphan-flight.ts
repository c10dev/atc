import { ORPHAN_SWITCHES, type OrphanSwitch } from "../orphan-flight.ts";
import { loadOrphanSwitch, saveOrphanSwitch } from "../orphan-flight-run.ts";
import { defineSwitch } from "../switch-def.ts";

// ORPHAN FLIGHT(ATC-516, docs/fleet.md): orphan-flight.json의 스위치(기본 on). 끄면 감지·ALERT·HOME 줄·DISPATCH 셈이 함께 꺼지고 지금과 같다. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다(K3)
export default defineSwitch({
  key: "orphanFlight",
  label: "ORPHAN FLIGHT",
  group: "operations",
  block: { code: "ORPHAN FLIGHT", label: "주인 잃은 FLIGHT 감지", windowLabel: "주인 잃은 FLIGHT 감지(SUPERVISOR 전용)", words: "orphan flight 주인 잃은 세션 끊김 한도 limit resume 새 세션 orphanFlight", searchOrder: 102 },
  values: ORPHAN_SWITCHES,
  default: "on",
  risky: [], // 읽기와 DISPATCH 셈만 바꾼다. 어느 세션에도 보내지 않는다(RESUME 글은 RELAY 초안, SUPERVISOR가 보낸다)
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: ORPHAN FLIGHT 감지·ALERT·HOME 줄·DISPATCH 셈이 모두 꺼진다(지금과 같다). 세션이 죽어 주인이 없어진 FLIGHT가 슬롯을 쓰지 않는다.",
    on: "기본: 출발한 FLIGHT의 세션이 멈췄는데 같은 REGISTRATION의 새 세션이 쥐지 않으면 ALERT와 HOME 줄을 내고(유예 뒤), DISPATCH는 그 REGISTRATION의 슬롯을 쓴 것으로 센다. 어느 세션에도 자동으로 보내지 않는다.",
  },
  row: () => ({ label: "ORPHAN FLIGHT", env: "orphanFlight", note: "orphan-flight.json · 세션이 멈춘 뒤 아무도 쥐지 않은 FLIGHT의 감지·ALERT·HOME 줄·DISPATCH 셈 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  order: 72,
  applyOrder: 57,
  read: () => loadOrphanSwitch(),
  save: (v: OrphanSwitch) => saveOrphanSwitch(v),
  record: (v: OrphanSwitch) => `orphanFlight=${v}`,
});
