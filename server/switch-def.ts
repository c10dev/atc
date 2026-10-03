// SWITCH REGISTRY(ATC-393): SUPERVISOR 스위치 하나는 server/switches/ 폴더의 파일 하나로 선언한다. 다른 파일의 줄을 고치지 않는다.
// 이 파일은 순수 타입과 선언을 화면에 보낼 모양(SwitchView)으로 바꾸는 함수만 둔다(화면 번들도 가져온다: Node 모듈을 가져오지 않는다).
// 선언을 읽는 곳: 설정 PUT(검사·저장·기록 줄), GET /api/settings의 switches, 정책 한 줄·⚠ 목록·설정 찾기(settings-policy.ts), 설정 창(web/src/SettingsAutomation.tsx).

export type SwitchGroup = "landing" | "operations"; // 설정 창의 분류(AUTOMATION 묶음)

// 설정 창의 블록(h3) 하나. 같은 code를 쓰는 스위치는 한 블록에 모인다
export interface SwitchBlock {
  code: string; // 블록 제목 코드(data-code, 설정 찾기의 코드)
  label: string; // 블록 한국어 이름(설정 찾기에 보이는 이름)
  windowLabel?: string; // 설정 창의 블록 제목에 보이는 이름(없으면 label)
  words: string; // 설정 찾기에서 찾을 말(줄 이름·환경 변수·저장 값). 같은 블록의 스위치끼리 이어 붙인다
  searchOrder?: number; // 찾기 결과의 색인 순서(없으면 order)
}

// 설정 창에서 이 스위치 줄이 어떻게 보이나(서버가 지금 값으로 만든다)
export interface SwitchRow {
  label: string;
  env: string; // 줄 옆 작은 이름(예: autoland.mode)
  note: string;
}

export interface SwitchDecl {
  key: string; // PUT /api/settings 본문의 이름이자 정책 키
  label: string; // 정책 한 줄의 이름(AUTOLAND, MCC …)
  group: SwitchGroup;
  block: SwitchBlock;
  values?: readonly string[]; // 고를 수 있는 값(enum). 구조가 있는 스위치는 validate를 쓴다
  default: string; // 아무것도 쓰지 않았을 때의 값(시험이 읽는 값과 맞는지 본다)
  risky: readonly string[]; // ⚠ 모드(올리면 atc가 더 많이 쓰거나 밖으로 내보낸다)
  error?: string; // 모르는 값일 때 400 문구(enum)
  display?: Record<string, string>; // 저장 값 → 보이는 이름(REVIEW의 deepseek)
  warn?: Record<string, string> | (() => Record<string, string>); // 값마다 한 줄 경고(설정 창)
  row?: () => SwitchRow | null; // 설정 창의 줄. null이면 줄이 없다(구조가 있는 스위치는 따로 그린다)
  line?: boolean; // 정책 한 줄에 보이나(기본 true)
  order: number; // 설정 창의 순서
  lineOrder?: number; // 정책 한 줄의 순서(기본 order)
  applyOrder?: number; // 검사·저장의 순서(기본 order)
  data?: () => unknown; // 설정 창의 블록이 그릴 덧붙은 자료(JSON으로 가는 것만). settings.ts에 칸을 더하지 않고 스위치 파일이 준다
  read(): string; // 지금 값
  validate?: (raw: unknown) => { ok: true; value: unknown } | { ok: false; error: string }; // enum이 아닐 때
  save(value: never): void | Promise<void>; // 저장 값을 파일에 쓰고 실행 중인 서버에 반영
  record?: (value: never) => string | null; // `[atc] settings updated:` 줄에 넣을 조각(없으면 안 넣는다)
}

export const defineSwitch = (d: SwitchDecl): SwitchDecl => d;

// 화면으로 가는 모양. 함수는 서버가 지금 값으로 이미 풀었다
export interface SwitchView {
  key: string;
  label: string;
  group: SwitchGroup;
  block: SwitchBlock & { searchOrder: number };
  values: readonly string[];
  value: string;
  display: Record<string, string>;
  risky: readonly string[];
  warn: Record<string, string>;
  row: SwitchRow | null;
  data?: unknown;
  line: boolean;
  order: number;
  lineOrder: number;
}

export const lineOrderOf = (d: Pick<SwitchDecl, "order" | "lineOrder">) => d.lineOrder ?? d.order;
export const applyOrderOf = (d: Pick<SwitchDecl, "order" | "applyOrder">) => d.applyOrder ?? d.order;
const byName = <T extends { key: string }>(a: T, b: T) => a.key.localeCompare(b.key);

export function viewOf(d: SwitchDecl): SwitchView {
  return {
    key: d.key,
    label: d.label,
    group: d.group,
    block: { ...d.block, searchOrder: d.block.searchOrder ?? d.order },
    values: d.values ?? [],
    value: d.read(),
    display: d.display ?? {},
    risky: d.risky,
    warn: typeof d.warn === "function" ? d.warn() : (d.warn ?? {}),
    row: d.row ? d.row() : null,
    ...(d.data ? { data: d.data() } : {}),
    line: d.line !== false,
    order: d.order,
    lineOrder: lineOrderOf(d),
  };
}

export const viewsOf = (decls: readonly SwitchDecl[]): SwitchView[] => decls.map(viewOf).sort((a, b) => a.order - b.order || byName(a, b));

// PUT 본문의 값을 검사한다. 모르는 값이면 문구
export function checkValue(d: SwitchDecl, raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (d.validate) return d.validate(raw);
  if (d.values && (d.values as readonly unknown[]).includes(raw)) return { ok: true, value: raw };
  return { ok: false, error: d.error ?? `${(d.values ?? []).join(", ")} 중 하나` };
}
