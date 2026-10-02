// 이전 주소 북마크도 열린다. FOLLOW·STRIPS·FIDS·RADAR·RADIO는 FLIGHTS의 보기가 됐다(ATC-379): #follow·#strips는 목록, #board는 보드, #radar는 레이더, #radio는 RADIO 기록.
// #dispatch는 HOME이 이어받았다(ATC-377), #schedule도 그렇다(ATC-378): 큐와 메뉴 막대의 옛 링크도 HOME을 연다
const LEGACY_HASH: Record<string, string> = {
  map: "flights/radar",
  teams: "flights",
  tickets: "flights/board",
  dispatch: "home",
  schedule: "home", // SCHEDULE은 HOME이 이어받았다(ATC-378)
  follow: "flights",
  strips: "flights",
  board: "flights/board",
  radar: "flights/radar",
  radio: "flights/radio",
};

// 옛 주소를 지금 주소로. 보기가 정해진 옛 주소(#board 등)는 그 보기로, 아니면 뒤의 하위 경로를 이어 붙인다. 바꿀 것이 없으면 null
export function canonicalHash(hash: string): string | null {
  const [head, ...rest] = hash.replace(/^#/, "").split("/");
  const to = LEGACY_HASH[head];
  if (!to) return null;
  return `#${to}${to.includes("/") || !rest.length ? "" : `/${rest.join("/")}`}`;
}

// FLIGHTS(ATC-379)의 보기. 주소 #flights/<보기>가 정한다
export const VIEWS = [
  { id: "list", label: "LIST", hash: "flights" },
  { id: "board", label: "BOARD", hash: "flights/board" },
  { id: "radar", label: "RADAR", hash: "flights/radar" },
  { id: "radio", label: "RADIO", hash: "flights/radio" },
] as const;
export type FlightsView = (typeof VIEWS)[number]["id"];

// #flights → 목록, #flights/board·radar·radio → 그 보기. 모르는 하위 경로는 목록
export function viewOfHash(hash: string): FlightsView {
  const sub = hash.replace(/^#/, "").split("/")[1];
  return VIEWS.find((v) => v.id === sub)?.id ?? "list";
}
