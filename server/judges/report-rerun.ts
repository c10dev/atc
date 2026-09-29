// REPORT 판정 다시 돌리기(ATC-141): 지난 REPORT 판정 가운데 SUPERVISOR가 표시한 것을 새 입력·기준으로 그림자 재판정하고 일치율의 전후를 낸다.
// 기록(judges.jsonl)은 읽기만 하고 아무것도 쓰지 않는다. 메시지는 ATCC AIRCRAFT의 대화 기록에서 판정 시각까지만 읽어 마스킹해 보낸다(저장 없음).
// 쓰는 법: node server/judges/report-rerun.ts [--file judges.jsonl] [--all] [--rule-only] [--only R-…]
//   --all: 표시가 없는 판정도 다시 돌려 분류가 바뀐 것을 보인다. --rule-only: Jev를 부르지 않고 규칙 판정만.
import { globSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { jevEngine } from "./engines.ts";
import { lastMessageOf, maskText, reportJudgmentOf, reportQuestions, ruleJudgmentOf, type ReportClass } from "./report.ts";
import type { ReportJudgeLine } from "./store.ts";

// 판정 시각(turnAt)까지의 줄만 남겨 그 시점의 마지막 메시지를 읽는다
export function messageAt(transcript: string, turnAtMs: number) {
  const kept = transcript.split("\n").filter((l) => {
    const m = /"timestamp":"([^"]+)"/.exec(l);
    return !m || Date.parse(m[1]!) <= turnAtMs;
  });
  return lastMessageOf(kept.join("\n"));
}

// 표시와 분류로 본 맞음: 맞다고 표시한 분류를 되풀이하거나, 틀리다고 표시한 분류에서 벗어나면 맞다
export const stillRight = (mark: "right" | "wrong", before: ReportClass, after: ReportClass) => (mark === "right" ? after === before : after !== before);

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const file = arg("--file") ?? join(homedir(), ".local/state/atc/judges.jsonl");
  const all = argv.includes("--all");
  const ruleOnly = argv.includes("--rule-only");
  const only = arg("--only");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const marks = new Map<string, "right" | "wrong">();
  for (const l of lines) if (l.op === "mark" && l.target === "report") marks.set(l.id, l.verdict);
  const judged = lines.filter((l): l is ReportJudgeLine => l.op === "judge" && l.target === "report" && (only ? l.id === only : all || marks.has(l.id)));
  const key = process.env.TYPESAFE_API_KEY ?? "";
  if (!ruleOnly && !key) throw new Error("TYPESAFE_API_KEY가 없다 — --rule-only로 규칙 판정만 보거나 키를 넣는다");
  const engine = ruleOnly ? null : jevEngine(key);
  const base = join(homedir(), ".claude/projects");
  let n = 0;
  let marked = 0;
  let beforeRight = 0;
  let afterRight = 0;
  for (const j of judged) {
    const [path] = globSync(join(base, "*", `${j.session}.jsonl`));
    const msg = path ? messageAt(readFileSync(path, "utf8"), Date.parse(j.turnAt)) : null;
    if (!msg) {
      console.log(`${j.id}\tskip\t대화 기록이나 메시지를 찾지 못함`);
      continue;
    }
    const rule = ruleJudgmentOf(msg.cut);
    let after: ReportClass | null = rule ? rule.judgment.class : null;
    const how = rule ? "rule" : "jev";
    if (!after && engine) {
      const r = await engine.ask({ target: "report", title: j.aircraft, state: { message: maskText(msg.text) }, questions: reportQuestions() });
      after = reportJudgmentOf(r.answers).class;
    }
    n++;
    const mark = marks.get(j.id) ?? null;
    let verdict = "";
    if (mark) {
      marked++;
      const was = mark === "right";
      const is = after === null ? was : stillRight(mark, j.judgment.class, after);
      if (was) beforeRight++;
      if (is) afterRight++;
      verdict = `\tmark=${mark}\t${was ? "right" : "wrong"} → ${is ? "right" : "wrong"}`;
    }
    console.log(`${j.id}\t${j.judgment.class} → ${after ?? "(not rerun)"}\t${how}${verdict}`);
  }
  console.log(`rerun ${n}, marked ${marked}: before ${beforeRight}/${marked}, after ${afterRight}/${marked}`);
}

if (import.meta.main) await main();
