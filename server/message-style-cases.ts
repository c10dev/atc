import { DIRECT_LINE, DISCRETION_LINE, FINISH_LINE, formatAssignment } from "./briefs.ts";
import { landTextOf } from "./controller.ts";
import { crewChangeMessage, crewChangeText } from "./crew-change.ts";
import { DEFAULT_FLEET } from "./crew.ts";
import { goAroundTextOf } from "./go-around.ts";
import { blockedEn, carriedFindingsEn, changesRequestedEn, checksFailedEn, codexFindingsEn, codexP3OpenEn, draftEn, infoTextOf, mccFindingsEn, noChecksEn, noteMccEn, noteReviewEn, stackedEn } from "./landing-en.ts";
import { formatFlightPlan, formatRecall } from "./proposals.ts";
import { closingLine } from "./response.ts";

// ATC-359: 서버가 세션에 보내는 영어 문구를 고정 입력으로 만든다. 문구 스타일을 고쳐도 머리·id·화법 낱말이 그대로인지
// message-style.test.ts가 server/fixtures/message-before.json(고치기 전 출력)과 견준다.
const P = { id: "D-0007", flight: "VOC-193", airport: "VCDO", status: "sent", departedVia: null, hold: ["VOC-190"], note: "DB work", caution: true, resume: null } as never;
const CREW_AFTER = { complement: DEFAULT_FLEET.defaults.complement, ratings: ["UI", "DATA", "DOCS"] };

export function messageCases(): Record<string, string> {
  const body = ["## Goal", "Tidy the play button", "## Done when", "- tests pass"].join("\n");
  return {
    flightPlan: formatFlightPlan(P, { title: "Fix perms", url: "https://linear.app/x/VOC-193", priority: 2 }, "TEAM_B", body, Date.parse("2026-10-02T00:00:00Z"), ["Note line."]),
    recall: formatRecall(P, { title: "Fix perms" }, "TEAM_B", "priority changed"),
    assignment: formatAssignment({ key: "ATC-9", title: "Fix", url: "https://x/ATC-9" }, body, "TEAM_B"),
    closingClearanceWU: closingLine("clearance", "W/U", "C-0007"),
    closingClearanceR: closingLine("clearance", "R", "C-0008"),
    closingRecall: closingLine("recall", "W/U", "D-0003"),
    closingCrew: closingLine("crew-change", "W/U", "CC-0003"),
    lines: [DIRECT_LINE, FINISH_LINE, DISCRETION_LINE].join("\n"),
    landFirst: landTextOf(1, "ATCC", 411, "ATC353", null, 0),
    landNext: landTextOf(2, "ATCC", 412, "ATC354", 411, 2),
    goDirty: goAroundTextOf({ reason: "dirty", pr: 412, head: "abcdef1234567", flight: "ATC354", merged: [411], shared: ["server/a.ts", "server/b.ts"] }),
    goBehind: goAroundTextOf({ reason: "behind", pr: 412, head: "abcdef1234567", flight: null, merged: [], shared: [] }),
    goPrev: goAroundTextOf({ reason: "prevMerged", pr: 412, head: "abcdef1234567", flight: "ATC354", merged: [411], shared: [] }),
    crewText: crewChangeText({
      id: "CC-0003",
      registration: "TEAM_H",
      after: CREW_AFTER,
      added: ["backend: claude-opus-5-5"],
      removed: ["flash-helper: flash-helper (no BUILD, no CHECK verdicts, no SEC)"],
      ratingImpact: ["Loses SEC: Use the Codex template."],
    } as never),
    crewMessage: crewChangeMessage({ id: "CC-0003", registration: "TEAM_H", text: "[ATC FLEET] CREW CHANGE · X\n\nBody line." }),
    landingInfo: infoTextOf(411, [noChecksEn(), checksFailedEn(["a", "b"]), draftEn(), changesRequestedEn(["kim"]), blockedEn(2)]) ?? "",
    landingNotes: [
      codexFindingsEn("abc1234", "P0 1 · P2 2"),
      codexP3OpenEn("abc1234", 3, 1),
      carriedFindingsEn("Codex", "def5678"),
      mccFindingsEn("abc1234", [0, 1, 2], "x"),
      noteMccEn("abc1234"),
      noteReviewEn("abc1234", true),
      stackedEn({ number: 412, baseRefName: "feat" }, { base: 411, chain: [411, 412] }, "main"),
      stackedEn({ number: 412, baseRefName: "feat" }, null, "main"),
    ].join("\n"),
  };
}
