import { loadAutoland, REVIEWED_SECURITY, type ReviewedSecurity } from "../autoland.ts";
import { setReviewedSecurity } from "../autoland-run.ts";
import { defineSwitch } from "../switch-def.ts";

// AUTOLAND 머지 리뷰의 보안 위임(ATC-328): autoland.json의 reviewedSecurity. SUPERVISOR만
export default defineSwitch({
  key: "autolandReviewedSecurity",
  label: "AUTOLAND REVIEW",
  group: "landing",
  block: { code: "AUTOLAND", label: "착륙 자동화", windowLabel: "착륙 자동화(SUPERVISOR 전용)", words: "", searchOrder: 10 },
  values: REVIEWED_SECURITY,
  default: "off",
  risky: ["delegate"], // 머지 리뷰 pass가 rating:SEC·보안 게이트 PR의 AUTOLAND 머지 근거가 된다(ATC-328)
  error: "off 또는 delegate",
  warn: {
    off: "꺼짐(기본): 머지 리뷰 pass는 리뷰 조건만 채운다. rating:SEC·보안 게이트 PR은 SUPERVISOR가 머지한다.",
    delegate: "⚠ 이 head에 머지 리뷰 pass가 있는 rating:SEC·보안 게이트 PR을 AUTOLAND merge가 머지한다. 비밀·키·마이그레이션·SQL 경로, Risk 라벨, FLIGHT 없음은 그대로 SUPERVISOR.",
  },
  row: () => ({
    label: "머지 리뷰 위임",
    env: "autoland.reviewedSecurity",
    note: "autoland.json · 맡은 AIRPORT에서 REVIEW 세션이 atc에 남긴 이 head의 머지 리뷰 pass가 착륙 리뷰다. 이 스위치는 보안 게이트 PR까지 위임할지 정한다 — 이 화면에서만 바꾼다, 관제 세션은 못 바꿈",
  }),
  order: 20,
  lineOrder: 11,
  applyOrder: 90,
  read: () => loadAutoland().reviewedSecurity,
  save: (v: ReviewedSecurity) => setReviewedSecurity(v),
  record: (v: ReviewedSecurity) => `autoland.reviewedSecurity=${v}`,
});
