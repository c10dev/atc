// REGISTRATION 하나로 읽기(ATC-67). 세션 이름은 `Team G`, `TEAM-G`, `team_g`, `TEAMG`처럼 달라도 DISPATCH의 teamPattern에 맞으면
// 같은 AIRCRAFT다. 등록부(fleet.json) 키, `tail:` 라벨, ACCOUNT 구성원, 새 기록은 모두 정식 표기(`TEAM_G`, 대문자·`_`)로 맞춘다. 순수 함수.

// DISPATCH 설정 teamPattern의 기본값(dispatch.json에서 바꿀 수 있다)
// 글자는 하나(TEAM_A … TEAM_Z) 또는 둘(TEAM_AA … TEAM_ZZ, ATC-181). 팀 이름 규칙은 여기 하나뿐이고, 콜사인·화면·정렬이 모두 이것을 거친다
export const REG_LETTERS = "[A-Z]{1,2}";
export const DEFAULT_TEAM_PATTERN = `^TEAM[\\s_-]?${REG_LETTERS}$`;

const SEP = /[\s_-]+/g;

// teamPattern에 맞는 이름 → 정식 REGISTRATION. 맞지 않으면 null.
// 대문자로 올리고 구분자(공백·_·-)를 `_` 하나로 바꾼다. 구분자가 없으면(`TEAMG`) `_`를 넣어 teamPattern에 맞는 첫 자리를 쓴다.
export function registrationOf(name: string | null | undefined, teamPattern = DEFAULT_TEAM_PATTERN): string | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  let re: RegExp;
  try {
    re = new RegExp(teamPattern, "i");
  } catch {
    return null;
  }
  if (!re.test(raw)) return null;
  const base = raw.toUpperCase().replace(SEP, "_");
  if (base.includes("_") || !re.test(base)) return base;
  for (let i = 1; i < base.length; i++) {
    const split = `${base.slice(0, i)}_${base.slice(i)}`;
    if (re.test(split)) return split;
  }
  return base; // `_`를 받지 않는 teamPattern이면 대문자 그대로
}

// REGISTRATION 정렬(ATC-181): 글자 수가 먼저라 TEAM_Z가 TEAM_AA보다 앞. TEAM_X 꼴이 아닌 이름은 이름순으로 그 뒤
export const TEAM_REGISTRATION = /^TEAM_[A-Z]{1,2}$/;
export function compareRegistration(a: string, b: string): number {
  const ta = TEAM_REGISTRATION.test(a);
  const tb = TEAM_REGISTRATION.test(b);
  if (ta && tb) return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  if (ta !== tb) return ta ? -1 : 1;
  return a.localeCompare(b);
}

// 이름을 서로 비교할 때 쓰는 키: TEAM이면 정식 REGISTRATION, 아니면(관제 세션, 옛 기록의 다른 이름) 대문자
export const regKey = (name: string | null | undefined, teamPattern = DEFAULT_TEAM_PATTERN): string =>
  registrationOf(name, teamPattern) ?? (name ?? "").trim().toUpperCase();

export const sameReg = (a: string | null | undefined, b: string | null | undefined, teamPattern = DEFAULT_TEAM_PATTERN): boolean =>
  regKey(a, teamPattern) === regKey(b, teamPattern);

// 등록부(fleet.json aircraft)에서 이 REGISTRATION의 키. 옛 키가 `Team_G`처럼 적혀 있어도 찾는다. 없으면 null
export function fleetKeyOf(keys: Iterable<string>, name: string, teamPattern = DEFAULT_TEAM_PATTERN): string | null {
  const want = regKey(name, teamPattern);
  for (const k of keys) if (regKey(k, teamPattern) === want) return k;
  return null;
}

// 살아 있는 세션 이름 중 정식 표기가 아닌 것(FLEET 힌트)과, 같은 REGISTRATION으로 읽히는 세션이 둘 이상인 것(충돌)
export interface RegistrationNames {
  registration: string;
  names: string[]; // 그 REGISTRATION으로 읽힌 살아 있는 세션 이름(세션마다 하나, 같은 이름도 따로)
  rename: string | null; // 정식 표기가 아닌 첫 이름
  conflict: boolean; // 세션 둘 이상
}
export function registrationNamesOf(names: string[], teamPattern = DEFAULT_TEAM_PATTERN): Map<string, RegistrationNames> {
  const out = new Map<string, RegistrationNames>();
  for (const n of names) {
    const reg = registrationOf(n, teamPattern);
    if (!reg) continue;
    const e = out.get(reg) ?? { registration: reg, names: [], rename: null, conflict: false };
    e.names.push(n);
    if (n !== reg && e.rename === null) e.rename = n;
    e.conflict = e.names.length > 1;
    out.set(reg, e);
  }
  return out;
}

// FLEET에 보일 한 줄(ATC-67, 화면과 함께 씀). 이름 바꾸기 힌트는 세션을 그대로 잇는다 — 바꾸라는 권유일 뿐이다
export const renameHintOf = (sessionName: string, registration: string) => `세션 이름 ${sessionName} → ${registration}로 바꾸면 좋다`;
export const IDEA_SUPERSEDED = "https://github.com/chaehy5665/atc/issues/96";
export const conflictHintOf = (names: string[], registration: string) =>
  `세션 ${names.length}개가 ${registration}로 읽힘: ${names.join(", ")} — 합치지 않는다. 하나만 남기거나 이름을 바꾼다(idea #96 SUPERSEDED)`;
