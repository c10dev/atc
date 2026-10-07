// FRESH START가 도는 중인 카드(ATC-560). STOP과 LAUNCH 사이에는 그 AIRCRAFT의 세션이 없어 보이므로,
// 승인된 카드의 다른 길(OCC release, 세션 없는 카드의 자동 LAUNCH ATC-388, SUPERVISOR의 FRESH START 버튼)이 끼어들지 않게 한다.
// 서버 메모리뿐이다: 서버가 멈추면 사라지고, 그때 멈춘 세션의 카드는 ATC-388 길이 이어받는다
const busy = new Map<string, string>(); // 제안 id → REGISTRATION

export const freshStartBusy = (id: string) => busy.has(id);
export const freshStartBusyAircraft = (reg: string) => [...busy.values()].includes(reg);
export const markFreshStartBusy = (id: string, reg: string) => void busy.set(id, reg);
export const clearFreshStartBusy = (id: string) => void busy.delete(id);
