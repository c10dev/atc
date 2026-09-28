#!/usr/bin/env node
// atc PR의 LANDING CLEARANCE 등급. 바뀐 파일 경로로만 정한다(CLAUDE.md "git과 PR").
//   auto    — structure(MCC가 land 모드가 되면 MCC, docs/mcc.md)가 CI·검토 뒤 머지하고 배포, 사용자에게는 나중에 보고
//   flagged — auto와 같지만 보고에 바뀐 관제 규칙을 따로 적는다
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

const RANK = { auto: 0, flagged: 1, user: 2 };

export function tierOf(files) {
  let tier = "auto";
  const reasons = [];
  for (const f of files.map((s) => s.trim()).filter(Boolean)) {
    // guard 테스트는 guard를 바꾸지 않으므로 강조만
    const user = !/\.test\.mjs$/.test(f) || !/guard/.test(f) ? USER.find(([re]) => re.test(f)) : null;
    const hit = user ? ["user", user[1]] : FLAGGED.find(([re]) => re.test(f)) ? ["flagged", "관제 세션"] : null;
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
