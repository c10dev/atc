import { record } from "../recorder.ts";
import { defineSwitch } from "../switch-def.ts";
import { loadRemoteMode, setRemoteMode } from "../verify-gate-run.ts";

// VERIFY GATE 원격 실행(ATC-518): ~/.local/state/atc-gate/config.json의 remote(기본 on). 문으로 부른 고정된 검증 명령(npm test, tsc, vite build)을 LAN 데스크톱에서 돌리고,
// 데스크톱이 안 닿거나 명령이 목록에 없으면 로컬 문으로 돈다. 끄면 전부 로컬 문. 주소는 문 폴더의 remote.json(저장소에 없다). SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "verifyRemote",
  label: "VERIFY REMOTE",
  group: "operations",
  block: { code: "VERIFY GATE", label: "무거운 검증 명령의 동시 실행 상한", windowLabel: "무거운 검증 명령 줄 세우기(SUPERVISOR 전용)", words: "verify remote desktop 데스크톱 원격 LAN ssh verifyRemote", searchOrder: 58 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 끄면 로컬 문(옛 동작)이라 ⚠ 목록에 넣지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 검증 명령이 모두 이 호스트의 문에서 돈다(데스크톱을 쓰지 않는다).",
    on: "기본: npm test·tsc·vite build는 닿는 LAN 데스크톱에서 돈다(소스만 보낸다: .env·~/.claude*·운영 상태는 보내지 않는다). 안 닿거나 전송이 시작 전에 실패하면 로컬 문으로 돈다. 시작한 뒤 연결을 잃으면 종료 코드 76으로 알리고 다시 돌리지 않는다.",
  },
  row: () => ({ label: "VERIFY REMOTE", env: "verifyRemote", note: "atc-gate/config.json · 주소·사용자는 같은 폴더의 remote.json(저장소에 없음) · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  order: 46,
  applyOrder: 63,
  read: () => loadRemoteMode(),
  save: (v: "off" | "on") => {
    const from = loadRemoteMode();
    setRemoteMode(v);
    if (from !== v) record({ t: new Date().toISOString(), kind: "policy", op: "verify-remote-mode", by: "SUPERVISOR", from, to: v });
  },
  record: (v: "off" | "on") => `verifyRemote=${v}`,
});
