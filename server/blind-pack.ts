// 벤치마크 블라인드 리뷰 묶음(docs/research/atc-vs-solo.md 5절, ATC-466): 두 팔의 diff에서 문체 단서를 지우고
// 무작위 라벨(X/Y)로 묶는다. 라벨→팔 대응은 묶음 밖(로컬 mapping 파일)에만 둔다. 전부 순수 함수이고 입출력은 blind-pack-run.ts가 한다.

export type Arm = "atc" | "solo";
export type Label = "X" | "Y";
export type Mapping = Record<Label, Arm>;
export type Sev = "P0" | "P1" | "P2";
export type Reviewer = "claude" | "codex";

// 팔을 가리는 파일: 프로토콜이 말한 changelog.d/ 조각. 더 있으면 호출자가 extra로 넘긴다
export const DEFAULT_STRIP = ["changelog.d/"];

// 시드로 고정되는 작은 난수(mulberry32). 같은 시드는 늘 같은 라벨
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 어느 팔이 X가 될지 무작위(시드가 같으면 같다)
export function assignLabels(seed: number): Mapping {
  return seededRandom(seed)() < 0.5 ? { X: "atc", Y: "solo" } : { X: "solo", Y: "atc" };
}

export type Stripped = { path: string; reason: string };

// `diff --git a/p b/p` 덩어리 단위로 나눠 규칙에 걸린 파일을 뺀다. 경로 접두사(끝이 /) 또는 정확한 경로
export function stripDiff(diff: string, extra: string[] = []): { diff: string; stripped: Stripped[] } {
  const rules = [...DEFAULT_STRIP, ...extra];
  const parts = diff.split(/^(?=diff --git )/m);
  const kept: string[] = [];
  const stripped: Stripped[] = [];
  for (const part of parts) {
    const m = /^diff --git a\/(\S+) b\/(\S+)/.exec(part);
    if (!m) {
      kept.push(part); // 머리 앞 조각(보통 빈 문자열)
      continue;
    }
    const paths = [m[1], m[2]];
    const rule = rules.find((r) => paths.some((p) => (r.endsWith("/") ? p.startsWith(r) : p === r)));
    if (rule) stripped.push({ path: m[2], reason: rule });
    else kept.push(part);
  }
  return { diff: kept.join(""), stripped };
}

// 남은 diff 본문에 팔을 드러내는 낱말(브랜치 이름, PR 번호 같은 것)이 있으면 그 낱말을 돌려준다
export function leaksIn(text: string, needles: string[]): string[] {
  return needles.filter((n) => n.length > 0 && text.includes(n));
}

export type Pack = {
  files: Record<string, string>; // 묶음 안의 파일: X.diff, Y.diff, PROMPT.md, FINDINGS-TEMPLATE.md
  mapping: { labels: Mapping; seed: number; base: string; stripped: Record<Label, Stripped[]> }; // 묶음 밖에만 쓴다
};

export type PackInput = {
  seed: number;
  base: string;
  diffs: Record<Arm, string>;
  extraStrip?: string[];
  leakNeedles?: string[]; // 팔마다 다른 브랜치 이름·PR 번호 따위. diff에 있으면 던진다
};

export function buildPack(input: PackInput): Pack {
  const labels = assignLabels(input.seed);
  const out = {} as Record<Label, string>;
  const stripped = {} as Record<Label, Stripped[]>;
  for (const l of ["X", "Y"] as Label[]) {
    const r = stripDiff(input.diffs[labels[l]], input.extraStrip);
    const hit = leaksIn(r.diff, input.leakNeedles ?? []);
    if (hit.length) throw new Error(`${l}.diff에 팔을 드러내는 낱말이 남았다: ${hit.join(", ")}`);
    out[l] = r.diff;
    stripped[l] = r.stripped;
  }
  const files = { "X.diff": out.X, "Y.diff": out.Y, "PROMPT.md": reviewerPrompt(), "FINDINGS-TEMPLATE.md": findingsTemplate() };
  return { files, mapping: { labels, seed: input.seed, base: input.base, stripped } };
}

export function reviewerPrompt(): string {
  return `# Blind code review

Two independent implementations of the same change are in X.diff and Y.diff (same base commit). You do not know who wrote which. Review each diff on its own for correctness bugs and regressions. Do not guess the author and do not compare style.

Report only findings you can point to in the diff, with these severities:
- P0: breaks the build or tests, data loss, security hole, crash on the normal path
- P1: wrong behavior in a realistic case, missing handling the change clearly needs
- P2: minor defect or risk worth fixing, no nudge for pure style

Output exactly one line per finding, nothing else per finding, in this format:

FINDING <X|Y> <P0|P1|P2> <file>:<line> — <one-sentence defect and when it fails>

If a diff has no findings, write: NONE <X|Y>
`;
}

export function findingsTemplate(): string {
  return `# Findings (one file per reviewer: claude.txt, codex.txt)

FINDING X P1 path/to/file.ts:12 — example of the format
NONE Y
`;
}

export type Finding = { label: Label; sev: Sev; where: string; text: string };

const LINE = /^\s*FINDING\s+([XY])\s+(P[012])\s+(\S+)\s+[—-]+\s*(.*)$/;

// 정해진 형식의 줄만 센다. NONE 줄과 그 밖의 글은 무시
export function parseFindings(text: string): Finding[] {
  const out: Finding[] = [];
  for (const line of text.split("\n")) {
    const m = LINE.exec(line);
    if (m) out.push({ label: m[1] as Label, sev: m[2] as Sev, where: m[3], text: m[4].trim() });
  }
  return out;
}

export type Counts = Record<Sev, number> & { p1plus: number };
export type Merged = Record<Reviewer, Record<Arm, Counts>> & { total: Record<Arm, Counts> };

const zero = (): Counts => ({ P0: 0, P1: 0, P2: 0, p1plus: 0 });

// 두 리뷰어의 지적과 대응을 읽어 팔별·리뷰어별 P0~P2 수를 낸다. total은 두 리뷰어의 합(프로토콜 5절의 판정 값)
export function mergeFindings(mapping: Mapping, reviews: Record<Reviewer, string>): Merged {
  const res: Merged = {
    claude: { atc: zero(), solo: zero() },
    codex: { atc: zero(), solo: zero() },
    total: { atc: zero(), solo: zero() },
  };
  for (const rv of ["claude", "codex"] as Reviewer[]) {
    for (const f of parseFindings(reviews[rv])) {
      const arm = mapping[f.label];
      for (const c of [res[rv][arm], res.total[arm]]) {
        c[f.sev]++;
        if (f.sev !== "P2") c.p1plus++;
      }
    }
  }
  return res;
}

export function formatMerged(m: Merged): string {
  const row = (name: string, c: Record<Arm, Counts>) =>
    `| ${name} | ${c.atc.P0} / ${c.atc.P1} / ${c.atc.P2} (P1+ ${c.atc.p1plus}) | ${c.solo.P0} / ${c.solo.P1} / ${c.solo.P2} (P1+ ${c.solo.p1plus}) |`;
  return [
    "| Reviewer | atc P0 / P1 / P2 | solo P0 / P1 / P2 |",
    "|---|---|---|",
    row("Claude", m.claude),
    row("Codex", m.codex),
    row("Sum", m.total),
    "",
  ].join("\n");
}
