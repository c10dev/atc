import { unescapeMarkdown } from "./k3-allow.ts";

// 작업 지시서 `## Release` 절의 `Sequence:` 줄(ATC-456): 발권 순서의 선호. 막지 않는다(진짜 선행조건은 blockedBy).
//   Sequence: after ATC-n — <이유>
// 서버는 Linear가 저장한 그대로 읽는다(K 줄과 같다, ATC-399): 쓴 `ATC-n`은 이슈 멘션 `<issue id="…" href="…">ATC-n</issue>`으로 바뀌고 기호 앞에 역슬래시가 붙을 수 있다.
// 순수 함수. 읽는 것은 본문뿐이다. 이슈가 있는지는 화면이 쓰는 쪽(release-tree.ts)이 안다.
export interface SequenceLine {
  after: string | null; // 읽힌 이슈 key
  reason: string | null;
  problem: string | null; // 모양이 틀렸거나 줄이 둘 이상이면 이유(그러면 순서에 쓰지 않는다)
}

export const SEQUENCE_FORM = "`Sequence: after ATC-n — <이유>`";
const MENTION = /<issue\b[^>]*>([^<]*)<\/issue>/gi;
const LINE = /^\s*(?:[-*+]\s+)?Sequence\s*:\s*(.*?)\s*$/i;
const BODY = /^after\s+([A-Z][A-Z0-9]*-\d+)\b\s*(?:[—–]|--|-)\s*(\S.*)$/i;

// `## Release` 절의 줄들(멘션은 key로, 이스케이프는 되돌린다). 절 이름은 release 하나
function releaseSection(description: string | null | undefined): string[] {
  let cur = false;
  const out: string[] = [];
  for (const raw of (description ?? "").split("\n")) {
    const line = unescapeMarkdown(raw.replace(MENTION, "$1"));
    const h = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (h) {
      cur = /^release$/i.test(h[1]!.replace(/[:：]$/, ""));
      continue;
    }
    if (cur) out.push(line);
  }
  return out;
}

// 줄이 없으면 null. 둘 이상이면 첫 줄의 값은 버리고 problem만 둔다(어느 쪽을 믿을지 모르니 순서에 쓰지 않는다)
export function sequenceOf(description: string | null | undefined): SequenceLine | null {
  const lines = releaseSection(description).filter((l) => LINE.test(l));
  if (lines.length === 0) return null;
  if (lines.length > 1) return { after: null, reason: null, problem: `Sequence 줄이 ${lines.length}개 — 한 줄만 씁니다` };
  const m = BODY.exec(LINE.exec(lines[0]!)![1]!);
  if (!m) return { after: null, reason: null, problem: `Sequence 줄이 ${SEQUENCE_FORM} 꼴이 아님` };
  return { after: m[1]!.toUpperCase(), reason: m[2]!.replace(/\s+/g, " ").trim().slice(0, 300), problem: null };
}
