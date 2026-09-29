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
  [/^package(-lock)?\.json$/, "의존성"],
  [/^hooks\//, "팀 세션 hook"],
  [/^deploy\/(?!README)/, "배포·등급 규칙"],
];
// 강조 등급: 관제 세션의 매뉴얼과 CLI(guard 제외)
const FLAGGED = [[/^(controller|occ|crosscheck|review|mcc|dispatch)\//, "관제 세션"]];

// 외부 부작용이 있는 서버 코드(SHOW): 머지, PR 코멘트·본문, 세션·유닛 시작·정지처럼 밖에 흔적을 남긴다.
// 명령을 돌리거나 GET 아닌 fetch를 하는 server 파일은 여기나 READ_ONLY에 반드시 올라야 한다(landing-tier.test.mjs).
export const SIDE_EFFECT = [
  ["server/autoland-run.ts", "PR 머지·브랜치 갱신·코멘트(gh api)"],
  ["server/mcc-run.ts", "PR 머지·INSPECTION 코멘트·atc-rts 유닛 시작"],
  ["server/human-check-run.ts", "PR 본문 수정·코멘트(gh api)"],
  ["server/session-control.ts", "claude --bg 세션 시작·정지, tmux pane 닫기"],
];
// 명령·외부 API를 쓰지만 읽기만 하는 서버 코드(SHIP)
export const READ_ONLY = [
  ["server/index.ts", "rev-parse HEAD만 읽음"],
  ["server/airports.ts", "rev-list·rev-parse만 읽음"],
  ["server/rules-state.ts", "log만 읽음"],
  ["server/sources/git.ts", "worktree list·status·log·for-each-ref만 읽음"],
  ["server/sources/github.ts", "gh pr list·view·diff와 GET api만 읽음"],
  ["server/standfree-run.ts", "gh api GET(리뷰·코멘트·파일)만 읽음"],
  ["server/sources/linear.ts", "Linear GraphQL query만(mutation 없음)"],
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
    const hit = user
      ? ["user", user[1]]
      : FLAGGED.find(([re]) => re.test(f))
        ? ["flagged", "관제 세션"]
        : SIDE_EFFECT.some(([path]) => path === f)
          ? ["flagged", "외부 부작용"]
          : null;
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
