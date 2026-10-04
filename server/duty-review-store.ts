import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import type { ReviewLine } from "./duty-review.ts";

// duty-reviews.jsonl(추가만)의 읽기와 쓰기. 따로 둔 까닭(ATC-401): SUPERVISOR QUEUE와 RELEASE 화면이 제안 출처를 읽는데,
// 런타임(duty-review-run.ts)은 leaks-run → 큐를 읽어서 그쪽에서 가져오면 import 순환이 생긴다(release-store.ts와 같은 꼴).
export const REVIEWS_FILE = () => join(config.stateDir, "duty-reviews.jsonl");

export function readReviewLines(file = REVIEWS_FILE()): ReviewLine[] {
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return raw.split("\n").flatMap((l) => {
    try {
      const j = JSON.parse(l) as ReviewLine;
      return j && (j.ev === "review" || j.ev === "proposal" || j.ev === "outcome") ? [j] : [];
    } catch {
      return [];
    }
  });
}
export function appendReviewLine(line: ReviewLine, file = REVIEWS_FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(line)}\n`);
}
