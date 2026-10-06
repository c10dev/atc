import { callsData } from "../linear-call-run.ts";
import { loadRetries, saveRetries } from "../linear-call.ts";
import { RETRY_VALUES } from "../net-retry.ts";
import { defineSwitch } from "../switch-def.ts";

// LINEAR RETRY(ATC-561, docs/linear-retry.md): linear-retry.json의 다시 시도 횟수(0~3, 기본 2). Linear 호출(atc 서버 → Linear)과 atcctl → atc 서버 호출이 네트워크 수준 실패와 HTTP 429·502·503·504에서 이만큼 다시 시도한다.
// 0은 다시 시도하지 않는다(지금까지와 같다). SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다. 이 선언이 server/switches/에 있어 deploy/landing-tier.mjs가 `user` 등급으로 본다
export default defineSwitch({
  key: "linearRetries",
  label: "LINEAR RETRY",
  group: "operations",
  block: { code: "LINEAR RETRY", label: "Linear 호출 다시 시도 횟수", windowLabel: "Linear 호출 다시 시도 횟수(SUPERVISOR 전용)", words: "linear retry 다시 시도 재시도 fetch failed 네트워크 실패 백오프 atcctl linearRetries", searchOrder: 104 },
  values: RETRY_VALUES,
  default: "2",
  risky: [], // 쓰기는 다시 보내기 전에 이미 적용됐는지 확인하므로 중복이 없다
  line: false,
  error: "0, 1, 2, 3 가운데 하나",
  warn: {
    "0": "0: 다시 시도하지 않는다(지금까지와 같다). `fetch failed` 한 번이 그대로 실패로 보인다.",
    "1": "1: 네트워크 실패에서 한 번 다시 시도한다(약 0.25초 뒤).",
    "2": "기본: 네트워크 실패(DNS·연결·시간 초과)와 HTTP 429·502·503·504에서 두 번까지 다시 시도한다(약 0.25초, 약 1초 뒤). 쓰기는 다시 보내기 전에 이미 적용됐는지 찾아 이슈·댓글이 두 번 생기지 않는다.",
    "3": "3: 세 번까지 다시 시도한다(약 0.25초, 1초, 4초 뒤).",
  },
  row: () => ({ label: "LINEAR RETRY", env: "linearRetries", note: "linear-retry.json · 네트워크 실패 뒤 다시 시도하는 횟수 · 0은 다시 시도 없음 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  data: () => callsData(7),
  order: 74,
  applyOrder: 59,
  read: () => String(loadRetries()),
  save: (v: string) => saveRetries(Number(v)),
  record: (v: string) => `linearRetries=${v}`,
});
