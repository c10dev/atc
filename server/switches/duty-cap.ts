import { DUTY_CAP_RANGE, dutyCapValid } from "../duty-cap.ts";
import { loadDutyConfig } from "../duty-config.ts";
import { duty, setDutyCap } from "../duty-run.ts";
import { defineSwitch } from "../switch-def.ts";

// DUTY 컨텍스트 CAP(ATC-496, docs/duty.md): duty.json의 cap(토큰). null이면 cap을 지워 모델로 정한다([1m]이면 100만, 아니면 25만). SUPERVISOR만.
// 줄은 화면의 DutyCapRow가 따로 그린다. 바꾸면 FLIGHT RECORDER에 한 줄(duty-cap, from → to)
export default defineSwitch({
  key: "dutyCap",
  label: "DUTY CAP",
  group: "operations",
  block: { code: "DUTY", label: "DUTY 채팅(atc 안의 대화 상대)", windowLabel: "DUTY 채팅(SUPERVISOR 전용)", words: "", searchOrder: 90 },
  default: "",
  risky: [],
  line: false,
  validate: (raw) =>
    raw === null || dutyCapValid(raw) ? { ok: true, value: raw } : { ok: false, error: `${DUTY_CAP_RANGE[0]}–${DUTY_CAP_RANGE[1]} 사이의 정수 토큰 또는 null(모델로 정함)` },
  order: 63,
  applyOrder: 181,
  read: () => String(dutyCapValid(loadDutyConfig().cap) ? loadDutyConfig().cap : ""),
  data: () => {
    const s = duty().status();
    return { cap: s.cap, source: s.capSource, note: s.capNote, model: s.model, configured: dutyCapValid(loadDutyConfig().cap) ? loadDutyConfig().cap : null };
  },
  save: async (v: number | null) => {
    await setDutyCap(v);
  },
  record: (v: number | null) => `duty.cap=${v ?? "auto"}`,
});
