// 벤치마크 solo 팔의 CLAUDE.md(docs/research/atc-vs-solo.md, ATC-462): 루트 CLAUDE.md에서 교신 규칙만 뺀 글.
// 코드·검증·문서·git 규칙은 그대로 둬서, 규칙의 효과와 오케스트레이션의 효과를 가른다. 순수 함수라 같은 입력은 늘 같은 출력이다.
// 사용: node server/solo-claude-md.ts CLAUDE.md > <solo STAND>/CLAUDE.md  (루트 파일은 고치지 않는다)

export const NEUTRALIZED_HEADER =
  "<!-- solo 팔용 CLAUDE.md: server/solo-claude-md.ts가 루트 CLAUDE.md에서 만들었다(교신 절과 그 참조만 뺐다). 손으로 고치지 않는다 -->\n";

// 빼는 것: (1) `## 교신` 절 전체(DISPATCH·CLEARANCE·CREW 답신 규칙, 최종 보고 머리 포함), (2) 용어 절의 그 절을 가리키는 문장
const SECTION = "교신";
const DANGLING = ' 세션끼리 주고받는 글은 영어다(아래 "교신").';

// 빠진 뒤에도 남으면 안 되는 교신 표지. 하나라도 있으면 던진다(규칙이 다른 곳으로 새는 것을 막는다)
const LEFTOVER = [/\[DISPATCH D-/, /\[ATC C-/, /\[OCC CC-/, /ARRIVED ATC-/, /READBACK [DCA]/, /UNABLE [DC]/, /STANDBY D-/, /ROGER C-/];

export function neutralize(md: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l === `## ${SECTION}`);
  if (start < 0) throw new Error(`"## ${SECTION}" 절이 없다: 루트 CLAUDE.md의 구조가 바뀌었다`);
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  // 앞 절과 사이의 빈 줄은 절과 함께 뺀다
  let from = start;
  while (from > 0 && lines[from - 1] === "") from--;
  const kept = [...lines.slice(0, from), ...lines.slice(end)];
  let out = kept.join("\n");
  if (!out.includes(DANGLING)) throw new Error('용어 절의 "아래 교신" 문장이 없다: 루트 CLAUDE.md의 문장이 바뀌었다');
  out = out.replace(DANGLING, "");
  for (const re of LEFTOVER) if (re.test(out)) throw new Error(`교신 표지가 남았다(${re}): 뺄 문장을 늘려야 한다`);
  if (!out.endsWith("\n")) out += "\n";
  return NEUTRALIZED_HEADER + out;
}

if (import.meta.main) {
  const { readFileSync } = await import("node:fs");
  const file = process.argv[2];
  if (!file) {
    console.error("사용: node server/solo-claude-md.ts CLAUDE.md > <STAND>/CLAUDE.md");
    process.exit(2);
  }
  process.stdout.write(neutralize(readFileSync(file, "utf8")));
}
