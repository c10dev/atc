import { loadDispatchConfig, saveReleaseParked } from "../dispatch.ts";
import { record } from "../recorder.ts";
import { defineSwitch } from "../switch-def.ts";

// PARKED(ATC-487): dispatch.json releaseParked(기본 on). RELEASE 화면의 접힌 PARKED 절(막는 이슈 없이 손으로 올린 Backlog 이슈)과 그 줄의 발권을 켠다.
// 끄면 절이 없고 /api/releases/fire가 PARKED 이슈를 다시 거절한다(옛 동작). SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "releaseParked",
  label: "PARKED",
  group: "operations",
  block: { code: "PARKED", label: "RELEASE 화면의 PARKED 절과 그 발권", windowLabel: "손으로 올린 Backlog 이슈를 RELEASE 화면에서 발권(SUPERVISOR 전용)", words: "parked backlog 손으로 올린 hand-filed release 발권 접힌 releaseParked", searchOrder: 55 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 끄면 옛 동작(그 이슈는 어느 화면에도 없음)이라 ⚠ 목록에 넣지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: PARKED 절이 사라지고 /api/releases/fire가 막는 이슈 없이 손으로 올린 Backlog 이슈를 거절한다. 그런 이슈는 Linear에서 직접 Todo로 옮겨야 한다.",
    on: "기본: 막는 이슈 없이 손으로 올린 Backlog 이슈(상위 이슈 제외)가 RELEASE 화면의 접힌 PARKED 절에 보이고 발권 단추로 Todo로 옮기며 발권한다. 24시간 안에 Canceled·Duplicate가 된 수는 RELEASE 화면에 있다.",
  },
  row: () => ({ label: "PARKED", env: "releaseParked", note: "dispatch.json · RELEASE 화면의 PARKED 절 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 오작동 수는 RELEASE 화면" }),
  order: 42,
  applyOrder: 59,
  read: () => loadDispatchConfig().releaseParked,
  save: (v: "off" | "on") => {
    const from = loadDispatchConfig().releaseParked;
    saveReleaseParked(v);
    if (from !== v) record({ t: new Date().toISOString(), kind: "policy", op: "release-parked-mode", by: "SUPERVISOR", from, to: v });
  },
  record: (v: "off" | "on") => `releaseParked=${v}`,
});
