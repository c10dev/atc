// 벤치마크 B4(ATC-465)의 CLI. 읽기만 한다: --state 폴더는 읽기 전용(쓰지 않는다), GitHub는 건드리지 않고(PR 자료는 `gh`로 미리 받아 둔 <ATC-n>.json을 읽는다), 출력은 표준출력뿐이다.
//   node server/arm-metrics-run.ts --spec <spec.json> [--state <state dir>] [--gh-dir <dir with <ATC-n>.json: gh pr view --json … + check-runs>] [--json]
// spec: { arm: "solo"|"atc", window: {start,end}, issues: [{ key, start?, transcript?, reviewPassedAt?, mergeReadyAt? }], control?: [{ role, file }] }
//   solo: transcript = 내보낸 대화 기록 파일, PR 자료는 --gh-dir. atc: --state와 control 대화 기록(OCC·MCC)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AtcState, atcRecord, formatRecords, type GhPr, soloRecord } from "./arm-metrics.ts";
import { foldLogbook, type LogLine } from "./logbook.ts";

const args = process.argv.slice(2);
const get = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const readText = (p: string) => readFileSync(p, "utf8");
const jsonl = (p: string): any[] => {
  let text = "";
  try {
    text = readText(p);
  } catch {
    return [];
  }
  const out: any[] = [];
  for (const l of text.split("\n")) {
    if (!l) continue;
    try {
      out.push(JSON.parse(l));
    } catch {}
  }
  return out;
};

const ghFixture = (dir: string, key: string): GhPr | null => {
  try {
    return JSON.parse(readText(join(dir, `${key}.json`)));
  } catch {
    return null;
  }
};

try {
  const specPath = get("spec");
  if (!specPath) throw new Error("--spec is required");
  const spec = JSON.parse(readText(specPath));
  if (spec.arm !== "solo" && spec.arm !== "atc") throw new Error("spec.arm must be solo or atc");
  const issues: any[] = spec.issues ?? [];
  const out = [];
  if (spec.arm === "solo") {
    const ghDir = get("gh-dir");
    for (const it of issues) {
      const pr = ghDir ? ghFixture(ghDir, it.key) : null;
      out.push(soloRecord({ issue: it.key, start: it.start ?? spec.window.start, transcript: it.transcript ? readText(it.transcript) : null, pr, reviewPassedAt: it.reviewPassedAt ?? null }));
    }
  } else {
    const dir = get("state");
    if (!dir) throw new Error("--state is required for the atc arm");
    const state: AtcState = {
      logbook: foldLogbook(jsonl(join(dir, "logbook.jsonl")) as LogLine[]),
      leaks: jsonl(join(dir, "leaks.jsonl")),
      relays: jsonl(join(dir, "relays.jsonl")),
      proposals: jsonl(join(dir, "proposals.jsonl")),
      clearances: jsonl(join(dir, "clearances.jsonl")),
    };
    const control = (spec.control ?? []).map((c: any) => ({ role: c.role, text: readText(c.file) }));
    for (const it of issues) out.push(atcRecord({ issue: it.key, start: it.start ?? spec.window.start, window: spec.window, batchIssues: issues.length, state, control, mergeReadyAt: it.mergeReadyAt ?? null }));
  }
  process.stdout.write(args.includes("--json") ? JSON.stringify(out, null, 2) + "\n" : formatRecords(out));
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
