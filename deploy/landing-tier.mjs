#!/usr/bin/env node
// atc PR의 LANDING CLEARANCE 등급. 바뀐 파일 경로로만 정한다(CLAUDE.md "git과 PR").
//   auto    — CI와 MCC INSPECTION pass 뒤 MCC가 착륙(land 모드). 배포는 UPDATE 바 또는 land+rts의 MCC(docs/mcc.md 5.1, 6)
//   flagged — auto와 같지만 보고에 바뀐 관제 규칙과 외부 부작용 파일을 따로 적는다
//   user    — 사용자가 머지
// 사용: gh pr diff <N> --name-only | node deploy/landing-tier.mjs   (또는 경로를 인자로)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 사용자 등급: 안전장치, 권한, 에이전트 지침, CI, 의존성, 다른 세션에서 도는 hook, 배포와 이 규칙 자체
const USER = [
  [/(^|\/)[^/]*guard[^/]*\.mjs$/, "guard"],
  [/(^|\/)\.claude\/(?!skills\/)/, ".claude/ 설정"], // skills/는 매뉴얼이라 아래 flagged
  [/^\.claude\//, "루트 .claude/(팀 세션 skill·설정)"], // 루트 skill은 팀 세션 지침이라 CLAUDE.md와 같다
  [/^CLAUDE(\.en)?\.md$/, "루트 CLAUDE.md"],
  [/^\.github\//, "CI"],
  [/^rulebook\//, "규정집(에이전트 절차, plugin)"], // 모든 AIRCRAFT·관제 세션이 따르는 글이라 루트 .claude/ skill과 같다(ATC-286). 폴더 이름만 든 경로(docs/rulebook.md)는 해당 없음
  [/^package(-lock)?\.json$/, "의존성"],
  [/^hooks\//, "팀 세션 hook"],
  [/^deploy\/(?!README)/, "배포·등급 규칙"],
  [/^duty\/settings\.json$/, "DUTY 설정"], // duty/*guard*.mjs는 위의 guard 규칙이 잡는다
];
// 강조 등급: 관제 세션의 매뉴얼과 CLI(guard 제외)
const FLAGGED = [
  [/^(controller|occ|crosscheck|review|mcc|dispatch|duty)\//, "관제 세션"],
  // 주기로 도는 서버 일(ATC-393): 자동 RTS·자동 승인·LAUNCH·재시작 타이머가 파일 하나로 더해지거나 바뀐다. 서비스 이름(provideService)으로 부르는 부작용은 import 스캔이 못 보므로 폴더째 강조한다
  [/^server\/jobs\//, "주기 서버 일(배포·LAUNCH·머지 타이머)"],
  // SUPERVISOR 스위치 선언(ATC-393): 값·기본값·저장 방식·⚠ 모드가 파일 하나에 있다. 쓰는 길(fromThisApp)은 settings.ts에 그대로
  [/^server\/switches\//, "SUPERVISOR 스위치 선언"],
];

// 외부 부작용이 있는 서버 코드(SHOW): 머지, PR 코멘트·본문, 세션·유닛 시작·정지처럼 밖에 흔적을 남긴다.
// 명령을 돌리거나 GET 아닌 fetch를 하는 server 파일은 여기나 READ_ONLY에 반드시 올라야 한다(landing-tier.test.mjs).
export const SIDE_EFFECT = [
  ["server/autoland-run.ts", "PR 머지·브랜치 갱신·코멘트(gh api)"],
  ["server/mcc-run.ts", "PR 머지·INSPECTION 코멘트·atc-rts 유닛 시작"],
  ["server/human-check-run.ts", "PR 본문 수정·코멘트(gh api)"],
  ["server/sources/linear-write.ts", "Linear GraphQL mutation: 이슈 상태 옮기기(DUTY G3), 이슈 만들기·고치기·댓글(DUTY D7a). 서버가 Linear에 쓰는 유일한 파일"],
  ["server/duty-l1-run.ts", "DUTY L1 쓰기 길(D7a): git worktree add·remove·fetch와 node_modules 하드링크(STAND), Linear 쓰기 요청(duty.json l1이 켜졌을 때만, Origin 있는 요청 거절)"],
  ["server/session-control.ts", "claude --bg 세션 시작·정지, tmux pane 닫기"],
  ["server/tts.ts", "외부 TTS 명령(piper·espeak-ng·Kokoro 래퍼) 실행: 문구를 WAV로 렌더링(ATC-140, ATC-143)"],
  ["server/duty-run.ts", "DUTY `claude -p` 프로세스 띄우기(D2). D1에서는 비어 있고, D2가 이 파일을 등급 파일 수정 없이 flagged로 들이려고 미리 올려 둠"],
  ["server/pr-merge-run.ts", "PR 머지(gh api PUT, sha 고정, auto-merge 없음): PR 서랍 MERGE 버튼 — SUPERVISOR 클릭만, user 등급 CLEARED PR만(DUTY G2)"],
  ["server/account-add.ts", "Claude Code 설정 폴더 만들기와 그 settings.json 쓰기(ADD ACCOUNT, ATC-186). 로그인 정보는 열지 않음"],
  ["tts/kokoro-say.py", "server/tts.ts가 부르는 Kokoro 래퍼: 모델을 돌려 WAV를 파일로 씀(네트워크 없음, ATC-143)"],
  // 위 파일의 부작용 helper를 불러 시점을 정하는 파일(SIDE_EFFECT_HELPERS를 import). 자기는 명령을 돌리지 않는다
  ["server/update-run.ts", "RTS 유닛 시작 시점(UPDATE 바)"],
  ["server/voice-run.ts", "TTS 렌더링 시점(GET /api/voice/*)과 상태 폴더 voice-cache/ 쓰기"],
  ["server/fleet-plan-run.ts", "FLEET PLAN 실행: AIRCRAFT 세션 시작·정지 시점"],
  ["server/fresh-start-run.ts", "FRESH START(ATC-73): 승인된 ASSIGN을 받을 AIRCRAFT의 백그라운드 세션 STOP과 새 세션 LAUNCH 시점 — SUPERVISOR 클릭만"],
  ["server/control-recycle-run.ts", "CONTROL RECYCLE 실행: 관제 세션 정지·시작 시점(ATC-166, 스위치 off 기본)"],
  ["server/account-usage-run.ts", "REFRESH(ATC-348): ACCOUNT 폴더에서 `claude -p \"/usage\"` 실행(모델 호출 없음, 한도 %만 읽음, MCP·hook 끔) — SUPERVISOR 클릭만"],
  ["server/account-login.ts", "claude auth login 실행(코드를 stdin으로), 로그인 뒤 .claude.json 온보딩 칸 셋 쓰기(ATC-187). .credentials.json은 열지 않음"],
  ["server/flight-state-run.ts", "FLIGHT 상태 버튼(POST /api/flight/:key/state): SUPERVISOR 클릭만 Linear 상태를 옮김(DUTY G3)"],
  ["server/accounts-run.ts", "ADD ACCOUNT·LOGIN·REFRESH 시점(POST /api/accounts/add, /api/accounts/:label/login, /api/accounts/:label/usage, SUPERVISOR만)"],
  ["server/jobs/autoland.ts", "AUTOLAND 한 주기 실행 배선(머지·브랜치 갱신 시점, ATC-393에서 index.ts에서 옮김)"],
  ["server/jobs/auto-approve.ts", "launch 카드 자동 승인과 세션 LAUNCH 시점(launchForCard, ATC-393에서 index.ts에서 옮김)"],
  ["server/index.ts", "서버 진입: 라우트와 주기 일 실행기(jobs/)를 연결하고 서비스 시작 커밋을 읽는다. 일 하나하나의 부작용은 jobs/의 파일마다(AUTOLAND는 위)"],
];
// 부작용을 일으키는 export(이름, 정의한 파일, 하는 일). 이것을 import하는 server 파일은 SIDE_EFFECT나 READ_ONLY에 올라야 한다(landing-tier.test.mjs)
export const SIDE_EFFECT_HELPERS = [
  ["startRtsUnit", "server/mcc-run.ts", "atc-rts 유닛 시작(운영 7700 배포)"],
  ["runAutoland", "server/autoland-run.ts", "AUTOLAND 한 주기: PR 머지·브랜치 갱신·코멘트"],
  ["recordHumanCheck", "server/human-check-run.ts", "PR 본문 수정·코멘트"],
  ["renderPhrase", "server/tts.ts", "외부 TTS 명령(piper·espeak-ng·Kokoro) 실행"],
  ["launchAircraft", "server/session-control.ts", "AIRCRAFT 세션 시작"],
  ["launchForCard", "server/session-control.ts", "launch 카드의 AIRCRAFT 세션 시작(launchAircraft를 부른다)"],
  ["stopAircraft", "server/session-control.ts", "AIRCRAFT 세션 정지"],
  ["launchControl", "server/session-control.ts", "관제 세션 시작"],
  ["stopControl", "server/session-control.ts", "관제 세션 정지·pane 닫기"],
  ["addAccount", "server/account-add.ts", "ACCOUNT 폴더 만들기·settings.json 쓰기"],
  ["startLogin", "server/account-login.ts", "claude auth login 프로세스 시작"],
  ["submitCode", "server/account-login.ts", "로그인 코드 전달과 온보딩 칸 쓰기"],
  ["refreshUsage", "server/account-usage-run.ts", "claude -p /usage 프로세스 실행(한도 읽기)"],
];
// 명령·외부 API를 쓰지만 읽기만 하는 서버 코드(SHIP)
export const READ_ONLY = [
  ["server/airports.ts", "rev-list·rev-parse만 읽음"],
  ["server/account-health.ts", "claude auth status --json만 부름(loggedIn·authMethod·요금제만 남김, ATC-348), settings.json 읽기(ATC-146)"],
  ["server/rules-state.ts", "log만 읽음"],
  ["server/overlap-run.ts", "git merge-base·diff·status·rev-parse만 읽음(파일 겹침, ATC-71)"],
  ["server/sources/git.ts", "worktree list·status·log·for-each-ref만 읽음"],
  ["server/sources/github.ts", "gh pr list·view·diff, gh issue list·view와 GET api만 읽음"],
  ["server/standfree-run.ts", "gh api GET(리뷰·코멘트·파일)만 읽음"],
  ["server/sources/linear.ts", "Linear GraphQL query만(mutation 없음)"],
  ["server/sources/supabase-migrations.ts", "Supabase Management API GET 하나: 호스티드 DB가 적용한 마이그레이션 버전만 읽음(SQL·적용·쓰기 없음, ATC-329)"],
  ["server/sources/linear-labels.ts", "Linear GraphQL query만(mutation 없음)"],
  ["server/sources/linear-projects.ts", "Linear GraphQL query만(mutation 없음)"],
  ["server/judges/engines.ts", "판정 엔진에 묻기만 함(POST지만 상태를 바꾸지 않음)"],
];

const RANK = { auto: 0, flagged: 1, user: 2 };

export function tierOf(files) {
  let tier = "auto";
  const reasons = [];
  for (const f of files.map((s) => s.trim()).filter(Boolean)) {
    // guard 테스트는 guard를 바꾸지 않으므로 강조만
    const user = !/\.test\.mjs$/.test(f) || !/guard/.test(f) ? USER.find(([re]) => re.test(f)) : null;
    const flagged = FLAGGED.find(([re]) => re.test(f));
    const hit = user ? ["user", user[1]] : SIDE_EFFECT.some(([path]) => path === f) ? ["flagged", "외부 부작용"] : flagged ? ["flagged", flagged[1]] : null;
    if (!hit) continue;
    reasons.push({ file: f, tier: hit[0], why: hit[1] });
    if (RANK[hit[0]] > RANK[tier]) tier = hit[0];
  }
  return { tier, reasons };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const files = args.length ? args : readFileSync(0, "utf8").split("\n");
  const { tier, reasons } = tierOf(files);
  console.log(tier);
  for (const r of reasons) console.log(`  ${r.tier.padEnd(7)} ${r.file} (${r.why})`);
}
