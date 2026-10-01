// ACCOUNT 사이 전달(ATC-251, docs/accounts.md 7절): SendMessage는 보내는 세션과 같은 config 폴더(ACCOUNT)의 세션만 찾는다.
// OCC가 다른 ACCOUNT의 AIRCRAFT에 FLIGHT PLAN을 보내면 닿지 않으므로, 보내기 전에 예측하고 이유를 말한다. 순수 함수만 둔다.

export const REACH_RULE = "SendMessage는 같은 ACCOUNT의 세션에만 닿는다(docs/accounts.md 5.6)";

// 보낼 쪽(from)과 받을 쪽(to)의 ACCOUNT가 둘 다 알려져 있고 다르면 사유, 아니면 null(모르면 막지 않는다)
export function unreachableWhy(input: { fromName: string; from: string | null | undefined; toName: string; to: string | null | undefined }): string | null {
  const { fromName, from, toName, to } = input;
  if (!from || !to || from === to) return null;
  return `${toName}는 ACCOUNT ${to}에 있고 ${fromName}는 ${from}에 있어 FLIGHT PLAN이 닿지 않는다 — ${REACH_RULE}. ${toName}를 ${from}로 옮기거나(ACCOUNT CHANGE·APPLY NOW) ${fromName}를 ${to}로 옮긴 뒤 보낸다`;
}

// LAUNCH ACCOUNT 설정 경고: AIRCRAFT용과 관제 세션용이 다르면 다음 LAUNCH·APPLY NOW 뒤 OCC가 AIRCRAFT에 닿지 못한다. 한쪽이 "각 home"(null)이면 알 수 없어 경고하지 않는다
export function launchSplitWarning(setting: { aircraft?: string | null; control?: string | null }): string | null {
  const a = setting.aircraft;
  const c = setting.control;
  if (!a || !c || a === c) return null;
  return `LAUNCH ACCOUNT가 갈라졌다(AIRCRAFT ${a}, 관제 세션 ${c}): OCC가 ${a}의 AIRCRAFT에 FLIGHT PLAN을 보내지 못한다 — ${REACH_RULE}. 둘을 같은 ACCOUNT로 맞춘다`;
}

// 지금 돌고 있는 AIRCRAFT 가운데 OCC와 ACCOUNT가 다른 것(REGISTRATION 순). 둘 다 관찰·설정된 라벨일 때만 센다
export function unreachableAircraft(occ: string | null | undefined, aircraft: readonly { name: string; account: string | null | undefined }[]): { name: string; account: string }[] {
  if (!occ) return [];
  return aircraft.filter((a): a is { name: string; account: string } => !!a.account && a.account !== occ).sort((x, y) => x.name.localeCompare(y.name));
}

export function unreachableAircraftWarning(occ: string | null | undefined, rows: readonly { name: string; account: string }[]): string | null {
  if (!occ || !rows.length) return null;
  return `OCC(ACCOUNT ${occ})가 닿지 못하는 AIRCRAFT: ${rows.map((r) => `${r.name}(${r.account})`).join(", ")} — ${REACH_RULE}`;
}
