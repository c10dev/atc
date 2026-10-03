// 블라인드 리뷰 묶음 CLI(ATC-466). 오프라인이다: 호출자가 만든 diff 파일만 읽고 명령도 GitHub 쓰기도 없다.
//   pack:  node server/blind-pack-run.ts pack --base <sha> --atc-diff <file> --solo-diff <file> --out <묶음 폴더> --mapping <대응 파일> [--seed n] [--strip path]… [--leak word]…
//   merge: node server/blind-pack-run.ts merge --mapping <대응 파일> --claude <claude.txt> --codex <codex.txt>
// 대응 파일은 묶음 폴더 밖에 둔다(안이면 거부한다). 리뷰어 실행은 손으로 한다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { buildPack, formatMerged, mergeFindings } from "./blind-pack.ts";

function parseArgs(argv: string[]) {
  const opts: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k.startsWith("--") || argv[i + 1] === undefined) throw new Error(`인자 오류: ${k}`);
    (opts[k.slice(2)] ??= []).push(argv[i + 1]);
  }
  return opts;
}
const one = (o: Record<string, string[]>, k: string) => {
  const v = o[k]?.[0];
  if (!v) throw new Error(`--${k}가 필요하다`);
  return v;
};

const [cmd, ...rest] = process.argv.slice(2);
try {
  const o = parseArgs(rest);
  if (cmd === "pack") {
    const out = resolve(one(o, "out"));
    const mappingPath = resolve(one(o, "mapping"));
    if (!relative(out, mappingPath).startsWith("..")) throw new Error("대응 파일은 묶음 폴더 밖에 둬야 한다");
    const seed = o.seed ? Number(o.seed[0]) : Math.floor(Math.random() * 2 ** 32);
    const pack = buildPack({
      seed,
      base: one(o, "base"),
      diffs: { atc: readFileSync(one(o, "atc-diff"), "utf8"), solo: readFileSync(one(o, "solo-diff"), "utf8") },
      extraStrip: o.strip,
      leakNeedles: o.leak,
    });
    mkdirSync(out, { recursive: true });
    for (const [name, text] of Object.entries(pack.files)) writeFileSync(join(out, name), text);
    mkdirSync(dirname(mappingPath), { recursive: true });
    writeFileSync(mappingPath, JSON.stringify(pack.mapping, null, 2) + "\n", { mode: 0o600 });
    for (const l of ["X", "Y"] as const) {
      const s = pack.mapping.stripped[l];
      console.log(`${l}.diff: stripped ${s.length} file(s)${s.map((x) => `\n  - ${x.path} (${x.reason})`).join("")}`);
    }
    console.log(`package: ${out}\nmapping (do not open before all reviews are in): ${mappingPath}`);
  } else if (cmd === "merge") {
    const mapping = JSON.parse(readFileSync(one(o, "mapping"), "utf8")).labels;
    process.stdout.write(formatMerged(mergeFindings(mapping, { claude: readFileSync(one(o, "claude"), "utf8"), codex: readFileSync(one(o, "codex"), "utf8") })));
  } else {
    throw new Error("사용: pack | merge");
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
