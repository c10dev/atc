// 벤치마크 이슈 추첨 CLI(ATC-463). 오프라인이다: 후보 JSON 파일만 읽고, 쓰는 곳은 --out 파일 하나뿐이다. Linear·GitHub는 부르지 않는다.
//   node server/benchmark-draw-run.ts --candidates <후보.json> --out <결과.json> [--seed n] [--count 10..12] [--pairs 2..3]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { draw, formatDraw, parseCandidates } from "./benchmark-draw.ts";

function parseArgs(argv: string[]) {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) throw new Error(`인자 오류: ${argv[i]}`);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}

try {
  const o = parseArgs(process.argv.slice(2));
  if (!o.candidates || !o.out) throw new Error("사용: --candidates <파일> --out <파일> [--seed n] [--count n] [--pairs n]");
  const seed = o.seed !== undefined ? Number(o.seed) : Math.floor(Math.random() * 2 ** 32);
  if (!Number.isInteger(seed)) throw new Error("--seed는 정수");
  const result = draw(parseCandidates(JSON.parse(readFileSync(o.candidates, "utf8"))), {
    seed,
    count: o.count !== undefined ? Number(o.count) : undefined,
    pairs: o.pairs !== undefined ? Number(o.pairs) : undefined,
  });
  const out = resolve(o.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(formatDraw(result));
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
