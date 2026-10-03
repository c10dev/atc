import { record } from "../recorder.ts";
import { defineSwitch } from "../switch-def.ts";
import { loadGateMode, setGateMode, verifyGateData } from "../verify-gate-run.ts";

// VERIFY GATE(ATC-517): ~/.local/state/atc-gate/config.json의 mode(기본 on). `node server/verify-gate-cli.ts <명령>`으로 부른 무거운 검증 명령(npm test, tsc, vite build)이
// 호스트 전체에서 동시에 N건만 돌고 나머지는 줄을 선다. 끄면 그 명령은 줄 없이 바로 실행된다. 문이 못 돌면 늘 바로 실행한다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "verifyGate",
  label: "VERIFY GATE",
  group: "operations",
  block: { code: "VERIFY GATE", label: "무거운 검증 명령의 동시 실행 상한", windowLabel: "무거운 검증 명령 줄 세우기(SUPERVISOR 전용)", words: "verify gate 검증 동시 실행 줄 npm test tsc vite build 슬롯 OOM verifyGate", searchOrder: 58 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 끄면 옛 동작(명령이 곧바로 돈다)이라 ⚠ 목록에 넣지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 문으로 부른 검증 명령도 줄 없이 바로 돈다. 여러 STAND가 동시에 npm test·tsc·vite build를 돌리면 호스트가 다시 포화될 수 있다.",
    on: "기본: 문으로 부른 검증 명령은 호스트 전체에서 동시에 N건(기본 2)만 돈다. 자리가 없으면 줄을 서고(stderr에 순번·기다린 시간), 한도(기본 30분)를 넘기면 종료 코드 75로 끝난다. 문이 못 돌면 바로 실행하고 세어 둔다.",
  },
  row: () => ({ label: "VERIFY GATE", env: "verifyGate", note: "atc-gate/config.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 줄 선 수·가장 긴 기다림·한도 실패·바로 실행한 수는 이 블록" }),
  data: () => verifyGateData(),
  order: 45,
  applyOrder: 62,
  read: () => loadGateMode(),
  save: (v: "off" | "on") => {
    const from = loadGateMode();
    setGateMode(v);
    if (from !== v) record({ t: new Date().toISOString(), kind: "policy", op: "verify-gate-mode", by: "SUPERVISOR", from, to: v });
  },
  record: (v: "off" | "on") => `verifyGate=${v}`,
});
