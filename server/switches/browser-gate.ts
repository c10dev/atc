import { record } from "../recorder.ts";
import { defineSwitch } from "../switch-def.ts";
import { browserGateData, loadBrowserMode, setBrowserMode } from "../browser-gate-run.ts";

// BROWSER GATE(ATC-520): ~/.local/state/atc-gate/browser/config.json의 mode(기본 on). Playwright MCP 설정의 executablePath가 deploy/browser-gate/chromium-gated를 가리키면,
// 모든 세션이 띄우는 headless Chrome이 호스트 전체에서 동시에 N개(기본 3)만 돈다. 끄면 Chrome이 줄 없이 바로 뜬다. 문이 못 돌면 늘 바로 띄운다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "browserGate",
  label: "BROWSER GATE",
  group: "operations",
  block: { code: "BROWSER GATE", label: "브라우저(Playwright) 동시 실행 상한", windowLabel: "여러 세션의 headless Chrome 줄 세우기(SUPERVISOR 전용)", words: "browser gate 브라우저 playwright chrome headless 동시 실행 줄 슬롯 CPU browserGate", searchOrder: 59 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 끄면 옛 동작(Chrome이 곧바로 뜬다)이라 ⚠ 목록에 넣지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 문을 거치는 Playwright Chrome도 줄 없이 바로 뜬다. 여러 세션이 동시에 브라우저를 띄우면 호스트 CPU가 다시 포화될 수 있다.",
    on: "기본: 문을 거치는 Playwright Chrome은 호스트 전체에서 동시에 N개(기본 3)만 돈다. 자리가 없으면 줄을 서고(stderr에 순번), 한도(기본 90초)를 넘기면 BUSY 메시지와 종료 코드 75로 끝난다. 문이 못 돌면 바로 띄우고 세어 둔다. 세션이 끝난 Chrome은 슬롯을 놓는다.",
  },
  row: () => ({ label: "BROWSER GATE", env: "browserGate", note: "atc-gate/browser/config.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 기다린 요청·가장 긴 기다림·busy 답·세션 뒤 놓은 슬롯은 이 블록" }),
  data: () => browserGateData(),
  order: 46,
  applyOrder: 63,
  read: () => loadBrowserMode(),
  save: (v: "off" | "on") => {
    const from = loadBrowserMode();
    setBrowserMode(v);
    if (from !== v) record({ t: new Date().toISOString(), kind: "policy", op: "browser-gate-mode", by: "SUPERVISOR", from, to: v });
  },
  record: (v: "off" | "on") => `browserGate=${v}`,
});
