// Linear 팀 key와 이슈 key(`VOC-123`, `ATC-12`) 규칙. atc는 팀을 여럿 읽는다(LINEAR_TEAM_KEYS).
// 첫 팀(LINEAR_TEAM_KEY)이 주 팀이다: S2의 새 이슈, 프로젝트 목표를 거기서 쓰고 읽는다.

export const TEAM_KEY = /^[A-Z][A-Z0-9]{1,9}$/;

// 주 팀 + 목록(쉼표·공백 구분). 형식이 틀린 key는 버리고, 중복은 한 번만. 주 팀이 틀리면 VOC.
export function parseTeamKeys(primary: string | undefined, list: string | undefined): string[] {
  const norm = (s: string) => s.trim().toUpperCase();
  const first = primary && TEAM_KEY.test(norm(primary)) ? norm(primary) : null;
  const rest = (list ?? "").split(/[\s,]+/).map(norm).filter((k) => TEAM_KEY.test(k));
  const keys = [...new Set([...(first ? [first] : []), ...rest])];
  return keys.length ? keys : ["VOC"];
}

// 이슈 key의 팀: "ATC-12" → "ATC"
export const teamOfKey = (key: string) => key.split("-")[0].toUpperCase();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 브랜치·워크트리 이름 속의 key(`claude/voc-123-x`, `atc-12`, `VOC123`). 앞뒤는 경계(/, _, -, 끝)여야 한다.
export function keyPatternOf(keys: string[]): RegExp {
  return new RegExp(`(?:^|[/_-])(${keys.map((k) => escape(k.toLowerCase())).join("|")})-?(\\d+)(?:$|[/_-])`, "i");
}

export function keyInName(name: string | null | undefined, keys: string[], pattern = keyPatternOf(keys)): string | null {
  const m = name?.match(pattern);
  return m ? `${m[1].toUpperCase()}-${Number(m[2])}` : null;
}

// PR 제목 끝의 "(VOC-170)". 읽는 팀의 key만.
export function keyInTitle(title: string | null | undefined, keys: string[]): string | null {
  const m = title?.match(/\(([A-Za-z][A-Za-z0-9]*)-(\d+)\)\s*$/);
  return m && keys.includes(m[1].toUpperCase()) ? `${m[1].toUpperCase()}-${Number(m[2])}` : null;
}
