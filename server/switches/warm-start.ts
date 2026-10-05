import { loadWarmStartConfig, saveWarmStartSwitch, WARM_START_SWITCHES, type WarmStartSwitch } from "../warm-start-run.ts";
import { defineSwitch } from "../switch-def.ts";

// WARM START(ATC-539): warm-start.json의 스위치(기본 on). 켜면 서버가 따뜻한 스냅샷을 1분에 한 번 warm-snapshot.json에 저장하고, 재시작 직후 그것(최대 나이 안)을 화면에 "복원본"으로 보인다.
// 표시만 한다: DISPATCH·AUTOLAND·MCC·알림·FLIGHT RECORDER는 복원본을 읽지 않는다. 그래서 오발 카운터는 없다. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다
export default defineSwitch({
  key: "warmStart",
  label: "WARM START",
  group: "operations",
  block: { code: "WARM START", label: "재시작 직후 마지막 스냅샷 보이기", windowLabel: "재시작 직후 마지막 스냅샷(SUPERVISOR 전용)", words: "warm start 웜 스타트 재시작 스냅샷 복원 restored warm-snapshot warmStart", searchOrder: 105 },
  values: WARM_START_SWITCHES,
  default: "on",
  risky: [], // 보이기만 한다. 어떤 자동 동작도 복원본을 읽지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 재시작 직후에는 첫 따뜻한 스냅샷이 나올 때까지(약 90초) PR이 비어 보인다. 캐시 파일은 쓰지도 읽지도 않는다.",
    on: "기본: 따뜻한 스냅샷을 1분에 한 번 warm-snapshot.json에 저장하고, 재시작 직후 최대 나이 안의 것을 \"복원본\"이라는 한 줄과 함께 보인다. 첫 살아 있는 따뜻한 스냅샷이 오면 바뀐다. 표시만 한다.",
  },
  row: () => ({ label: "WARM START", env: "warmStart", note: `warm-start.json · 복원본 최대 ${loadWarmStartConfig().maxAgeMin}분(maxAgeMin) · 캐시 파일 warm-snapshot.json은 지워도 안전 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈` }),
  order: 74,
  applyOrder: 59,
  read: () => loadWarmStartConfig().mode,
  save: (v: WarmStartSwitch) => saveWarmStartSwitch(v),
  record: (v: WarmStartSwitch) => `warmStart=${v}`,
});
