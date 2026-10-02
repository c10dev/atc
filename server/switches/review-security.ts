import { EXTERNAL_REVIEW_SECURITY, type ExternalReviewSecurity, loadDispatchConfig, saveExternalReviewSecurity } from "../dispatch.ts";
import { defineSwitch } from "../switch-def.ts";

// 외부 착륙 리뷰(ATC-30): 보안 규칙에만 걸린 PR을 REVIEW 세션(Claude Sonnet)에 보낼까. dispatch.json externalReview.security
export default defineSwitch({
  key: "reviewSecurity",
  label: "REVIEW",
  group: "landing",
  block: { code: "REVIEW", label: "Codex 한도 때 착륙 리뷰", words: "보안 pr sonnet deepseek exclude externalReview.security", searchOrder: 30 },
  values: EXTERNAL_REVIEW_SECURITY,
  default: "exclude",
  risky: ["deepseek"], // 보안 PR도 REVIEW 세션에 보낸다
  error: "exclude 또는 deepseek",
  display: { deepseek: "sonnet (deepseek)" }, // 저장 값 deepseek은 옛 이름이다
  warn: {
    exclude: "기본: 보안 규칙(라벨·경로·키워드)에 걸린 PR은 REVIEW 세션에 보내지 않고 SUPERVISOR 리뷰로.",
    deepseek: "⚠ 보안 PR도 REVIEW 세션(Claude Sonnet)이 리뷰한다. .env·비밀·키 경로와 FLIGHT 없는 PR은 계속 보내지 않는다. 저장 값 이름 deepseek은 옛 이름이다.",
  },
  row: () => ({ label: "보안 PR", env: "externalReview.security", note: "dispatch.json · 저장 값은 exclude 또는 deepseek(옛 이름)이고, 화면에는 sonnet (deepseek)으로 보인다" }),
  order: 40,
  lineOrder: 50,
  applyOrder: 10,
  read: () => loadDispatchConfig().externalReview.security,
  save: (v: ExternalReviewSecurity) => saveExternalReviewSecurity(v),
  record: (v: ExternalReviewSecurity) => `externalReview.security=${v}`,
});
