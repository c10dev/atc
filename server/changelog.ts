// CHANGELOG 조각(ATC-64): PR은 CHANGELOG를 고치지 않고 changelog.d/<이름>.md·<이름>.ko.md에 [Unreleased] 항목을 둔다.
// 접기(server/changelog-fold.ts)가 조각을 두 CHANGELOG의 [Unreleased]에 넣고 지운다. 순수 함수만 둔다(DOCS 변경 기록 쪽과 함께 씀).

export type Lang = "en" | "ko";

// 절 이름. 순서는 Keep a Changelog 순서이고, 없는 절을 새로 만들 때만 쓴다. 한국어판은 "바뀜"도 "변경"으로 읽는다.
const SECTIONS = [
  { key: "added", en: ["Added"], ko: ["추가"] },
  { key: "changed", en: ["Changed"], ko: ["변경", "바뀜"] },
  { key: "deprecated", en: ["Deprecated"], ko: ["폐기 예정"] },
  { key: "removed", en: ["Removed"], ko: ["제거"] },
  { key: "fixed", en: ["Fixed"], ko: ["수정"] },
  { key: "security", en: ["Security"], ko: ["보안"] },
  { key: "docs", en: ["Docs"], ko: ["문서"] },
] as const;
export const SECTION_NAMES = SECTIONS.map((s) => ({ en: s.en[0], ko: s.ko[0] }));

const rankOf = (heading: string) => SECTIONS.findIndex((s) => ([...s.en, ...s.ko] as string[]).includes(heading.trim()));

export interface FragmentFile {
  file: string; // changelog.d 안 파일 이름(ATC-64.md, ATC-64.ko.md)
  text: string;
}
export interface Fragment {
  name: string; // 확장자 뺀 이름(ATC-64)
  text: string;
}
export interface FragmentPair {
  name: string;
  en: string;
  ko: string;
}

// changelog.d 파일을 언어 짝으로 묶는다. README는 조각이 아니다. 짝이 없거나 .md가 아닌 파일은 unpaired.
export function pairFragments(files: FragmentFile[]): { pairs: FragmentPair[]; unpaired: string[] } {
  const by = new Map<string, Partial<Record<Lang, string>>>();
  const unpaired: string[] = [];
  for (const f of files) {
    const m = /^(.+?)(\.ko)?\.md$/.exec(f.file);
    if (!m) {
      unpaired.push(f.file);
      continue;
    }
    if (m[1] === "README") continue;
    const e = by.get(m[1]) ?? {};
    e[m[2] ? "ko" : "en"] = f.text;
    by.set(m[1], e);
  }
  const pairs: FragmentPair[] = [];
  for (const [name, e] of by) {
    if (e.en != null && e.ko != null) pairs.push({ name, en: e.en, ko: e.ko });
    else unpaired.push(e.en != null ? `${name}.md (${name}.ko.md 없음)` : `${name}.ko.md (${name}.md 없음)`);
  }
  pairs.sort((a, b) => byName(a.name, b.name));
  return { pairs, unpaired: unpaired.sort() };
}

// 이름 순서(ATC-9 < ATC-10). 접기는 이 순서로 절 맨 위에 넣으므로 뒤 이름이 위로 온다
const byName = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

export interface ParsedFragment {
  sections: { rank: number; lines: string[] }[];
  errors: string[];
}

// 조각 하나: `### 절` 제목 아래 항목 줄. 제목 앞에는 빈 줄만, 절 이름은 SECTIONS 중 하나(어느 언어든)
export function parseFragment(text: string): ParsedFragment {
  const sections: ParsedFragment["sections"] = [];
  const errors: string[] = [];
  let cur: { rank: number; lines: string[] } | null = null;
  const rows = text.replace(/\r\n/g, "\n").split("\n");
  for (const [i, line] of rows.entries()) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line); // ####부터는 항목 안 제목이라 그대로 둔다
    if (h) {
      const rank = rankOf(h[2]);
      if (h[1] !== "###" || rank < 0) {
        errors.push(`${i + 1}줄: 절 제목은 ### ${SECTION_NAMES.map((s) => s.en).join("/")} 중 하나`);
        cur = null;
        continue;
      }
      cur = sections.find((s) => s.rank === rank) ?? null;
      if (!cur) sections.push((cur = { rank, lines: [] }));
      continue;
    }
    if (cur) cur.lines.push(line);
    else if (line.trim()) errors.push(`${i + 1}줄: 첫 절 제목(###) 앞에 글이 있음`);
  }
  for (const s of sections) {
    while (s.lines.length && !s.lines[0].trim()) s.lines.shift();
    while (s.lines.length && !s.lines.at(-1)!.trim()) s.lines.pop();
    if (!s.lines.length) errors.push(`### ${SECTIONS[s.rank].en[0]}: 항목이 없음`);
  }
  if (!sections.length && !errors.length) errors.push("절이 없음");
  return { sections: sections.filter((s) => s.lines.length), errors };
}

export interface FoldResult {
  text: string;
  folded: string[]; // 넣었거나 이미 들어 있던 조각
  errors: { name: string; errors: string[] }[]; // 넣지 않은 조각
}

// 조각을 [Unreleased]에 넣는다. 같은 절이 있으면 (여러 개면 첫 절) 그 맨 위에, 없으면 Keep a Changelog 순서로 앞 절 뒤에 새 절을 만든다.
// 이미 같은 글이 [Unreleased]에 있으면 넣지 않는다(다시 돌려도 같다). 기존 줄과 [Unreleased] 밖은 바꾸지 않는다.
export function foldChangelog(changelog: string, lang: Lang, fragments: Fragment[]): FoldResult {
  const lines = changelog.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^## \[Unreleased\]/.test(l));
  if (start < 0) throw new Error("CHANGELOG에 ## [Unreleased]가 없음");
  const folded: string[] = [];
  const errors: FoldResult["errors"] = [];

  for (const f of [...fragments].sort((a, b) => byName(a.name, b.name))) {
    const parsed = parseFragment(f.text);
    if (parsed.errors.length) {
      errors.push({ name: f.name, errors: parsed.errors });
      continue;
    }
    for (const sec of parsed.sections) {
      const end = regionEnd(lines, start);
      if (hasLines(lines.slice(start, end), sec.lines)) continue;
      const heads = subsections(lines, start, end);
      const same = heads.find((h) => h.rank === sec.rank);
      if (same) {
        lines.splice(same.at + 1, 0, ...sec.lines);
        continue;
      }
      const title = `### ${SECTIONS[sec.rank][lang][0]}`;
      const before = heads.filter((h) => h.rank >= 0 && h.rank < sec.rank).at(-1);
      if (!before && heads.length) {
        lines.splice(heads[0].at, 0, title, ...sec.lines, "");
        continue;
      }
      // 앞 절(없으면 [Unreleased]) 끝, 끝의 빈 줄 앞에 넣는다
      let at = before ? (heads.find((h) => h.at > before.at)?.at ?? end) : end;
      while (at > start + 1 && !lines[at - 1].trim()) at--;
      lines.splice(at, 0, "", title, ...sec.lines);
      if (at + sec.lines.length + 2 < lines.length && lines[at + sec.lines.length + 2].trim()) lines.splice(at + sec.lines.length + 2, 0, "");
    }
    folded.push(f.name);
  }
  return { text: lines.join("\n"), folded, errors };
}

// 줄 묶음이 줄 단위로 그대로 들어 있는가(한 줄의 일부만 같으면 아니다)
const hasLines = (hay: string[], block: string[]) => hay.some((_, i) => block.every((l, j) => hay[i + j] === l));

const regionEnd = (lines: string[], start: number) => {
  const i = lines.findIndex((l, j) => j > start && /^## /.test(l));
  return i < 0 ? lines.length : i;
};

const subsections = (lines: string[], start: number, end: number) =>
  lines.flatMap((l, at) => (at > start && at < end && /^### /.test(l) ? [{ at, rank: rankOf(l.slice(4)) }] : []));
