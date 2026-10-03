import { accountFolders, observedLabelsOn } from "../accounts.ts";
import { loadDutyConfig } from "../duty-config.ts";
import { dutyAccountPatchOf } from "../duty-account.ts";
import { setDutyConfig } from "../duty-run.ts";
import { defineSwitch } from "../switch-def.ts";

// DUTY ACCOUNT(ATC-242): duty.json의 account. 등록부의 라벨만. 바뀌면 다음 글부터 새 대화. SUPERVISOR만. 줄은 화면의 DutyAccountRow가 따로 그린다
export default defineSwitch({
  key: "dutyAccount",
  label: "DUTY ACCOUNT",
  group: "operations",
  block: { code: "DUTY", label: "DUTY 채팅(atc 안의 대화 상대)", windowLabel: "DUTY 채팅(SUPERVISOR 전용)", words: "", searchOrder: 90 },
  default: "",
  risky: [],
  line: false,
  validate: (raw) => {
    const r = dutyAccountPatchOf(raw, observedLabelsOn(accountFolders()) ? accountFolders().map((f) => f.label) : []);
    return r.ok ? { ok: true, value: r.label } : { ok: false, error: r.error };
  },
  order: 62,
  applyOrder: 180,
  read: () => loadDutyConfig().account,
  save: async (v: string) => {
    await setDutyConfig({ account: v });
  },
  record: (v: string) => `duty.account=${v}`,
});
