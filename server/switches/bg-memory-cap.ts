import { loadDispatchConfig, saveBgMemoryCap } from "../dispatch.ts";
import { record } from "../recorder.ts";
import { defineSwitch } from "../switch-def.ts";

// SCOPE MEMORY CAP(ATC-505): dispatch.json bgMemoryCap(기본 on). LAUNCH의 임시 scope에 MemoryHigh·MemoryMax(기본 20G·24G, dispatch.json bgMemoryHigh·bgMemoryMax)를 건다.
// 끄면 OOMPolicy=continue만(옛 동작). 새로 LAUNCH하는 scope부터 적용한다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "bgMemoryCap",
  label: "SCOPE MEMORY CAP",
  group: "operations",
  block: { code: "SCOPE MEMORY", label: "백그라운드 세션 scope의 메모리 상한(OOM이 scope 안에서 끝나게)", windowLabel: "LAUNCH scope의 MemoryHigh·MemoryMax(SUPERVISOR 전용)", words: "scope memory 메모리 oom kill cgroup memoryhigh memorymax launch bgMemoryCap", searchOrder: 56 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 끄면 옛 동작이라 ⚠ 목록에 넣지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 새로 LAUNCH하는 scope에 메모리 상한을 걸지 않는다(OOMPolicy=continue만). 세션이 메모리를 너무 쓰면 커널이 scope 밖의 프로세스(데스크톱, 운영 서비스, DB)를 죽일 수 있다. 이미 떠 있는 scope는 그대로다.",
    on: "기본: 새로 LAUNCH하는 scope에 MemoryHigh 20G·MemoryMax 24G(dispatch.json에서 바꿈)를 건다. 이미 떠 있는 scope는 다음 새 LAUNCH부터 상한이 생긴다. scope 안의 OOM kill 수는 CONTROL 블록에 있다.",
  },
  row: () => ({ label: "SCOPE MEMORY CAP", env: "bgMemoryCap", note: "dispatch.json · 새 LAUNCH의 scope부터 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · OOM kill 수는 CONTROL 블록" }),
  order: 43,
  applyOrder: 60,
  read: () => loadDispatchConfig().bgMemoryCap,
  save: (v: "off" | "on") => {
    const from = loadDispatchConfig().bgMemoryCap;
    saveBgMemoryCap(v);
    if (from !== v) record({ t: new Date().toISOString(), kind: "policy", op: "bg-memory-cap-mode", by: "SUPERVISOR", from, to: v });
  },
  record: (v: "off" | "on") => `bgMemoryCap=${v}`,
});
