import { AUTOLAND_MODES, type AutolandMode, loadAutoland } from "../autoland.ts";
import { setAutolandMode } from "../autoland-run.ts";
import { defineSwitch } from "../switch-def.ts";

// AUTOLAND(ATC-34): autoland.json의 스위치. SUPERVISOR만: 관제 세션은 못 바꾼다
export default defineSwitch({
  key: "autolandMode",
  label: "AUTOLAND",
  group: "landing",
  block: { code: "AUTOLAND", label: "착륙 자동화", windowLabel: "착륙 자동화(SUPERVISOR 전용)", words: "update merge ground stop autoland.mode", searchOrder: 10 },
  values: AUTOLAND_MODES,
  default: "off",
  risky: ["update", "merge"],
  error: "off, update, merge 중 하나",
  // merge는 vocado AGENTS.md에 SUPERVISOR가 AUTOLAND 예외를 적은 뒤에만 켠다
  warn: {
    off: "꺼짐(기본): atc는 PR 브랜치에 아무것도 쓰지 않는다.",
    update: "⚠ CLEARED인데 behind인 PR을 LANDING SEQUENCE 순서로 AIRPORT마다 하나씩 update-branch로 갱신(팀 브랜치에 merge 커밋). 머지는 SUPERVISOR.",
    merge: "⚠ 위임된 PR(보안·Risk·HUMAN CHECK·UI change 블록 없음·FLIGHT 없음·HOLD 제외)을 정확한 head로 atc가 머지. vocado AGENTS.md에 AUTOLAND 예외를 적은 뒤에만 켤 것.",
  },
  row: () => ({
    label: "AUTOLAND",
    env: "autoland.mode",
    note: `autoland.json · 맡은 AIRPORT ${loadAutoland().airports.join(", ") || "없음"} · 이 화면(또는 SUPERVISOR의 API)에서만 바꾼다 — 관제 세션은 못 바꿈`,
  }),
  order: 10,
  lineOrder: 10,
  applyOrder: 80,
  read: () => loadAutoland().mode,
  save: (v: AutolandMode) => setAutolandMode(v),
  record: (v: AutolandMode) => `autoland.mode=${v}`,
});
