#!/usr/bin/env node
// CHANGELOG 접기(ATC-64): changelog.d/의 조각을 CHANGELOG.md·CHANGELOG.ko.md의 [Unreleased]에 넣고 조각을 지운다.
// 사용: node server/changelog-fold.ts [--check] [저장소 폴더]
//   --check  바꾸지 않고 짝과 형식만 본다
// 짝이 없거나 형식이 틀린 조각이 하나라도 있으면 아무것도 바꾸지 않고 1로 끝난다.
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { foldChangelog, type FoldResult, type Lang, pairFragments } from "./changelog.ts";

const FILES: Record<Lang, string> = { en: "CHANGELOG.md", ko: "CHANGELOG.ko.md" };

export function runFold(root: string, check: boolean): { code: number; out: string[] } {
  const dir = join(root, "changelog.d");
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => !f.startsWith("."))
        .map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") }))
    : [];
  const { pairs, unpaired } = pairFragments(files);
  const out = unpaired.map((u) => `짝 없음: changelog.d/${u}`);

  const results = {} as Record<Lang, FoldResult>;
  for (const lang of ["en", "ko"] as const) {
    const r = foldChangelog(readFileSync(join(root, FILES[lang]), "utf8"), lang, pairs.map((p) => ({ name: p.name, text: p[lang] })));
    for (const e of r.errors) out.push(...e.errors.map((m) => `형식: changelog.d/${e.name}${lang === "ko" ? ".ko" : ""}.md ${m}`));
    results[lang] = r;
  }
  if (out.length) return { code: 1, out: [...out, "아무것도 바꾸지 않았다."] };
  if (!pairs.length) return { code: 0, out: ["접을 조각 없음."] };
  if (check) return { code: 0, out: [`조각 ${pairs.length}쌍 확인: ${pairs.map((p) => p.name).join(", ")}`] };

  for (const lang of ["en", "ko"] as const) {
    const file = join(root, FILES[lang]);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, results[lang].text);
    renameSync(tmp, file);
  }
  for (const p of pairs) for (const f of [`${p.name}.md`, `${p.name}.ko.md`]) unlinkSync(join(dir, f));
  return { code: 0, out: [`조각 ${pairs.length}쌍을 [Unreleased]에 넣고 지웠다: ${pairs.map((p) => p.name).join(", ")}`] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith("--")) ?? fileURLToPath(new URL("..", import.meta.url));
  const { code, out } = runFold(root, args.includes("--check"));
  for (const l of out) (code ? console.error : console.log)(l);
  process.exitCode = code;
}
