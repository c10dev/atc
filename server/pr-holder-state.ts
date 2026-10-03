import type { HolderPlans } from "./pr-holder.ts";

// PR HOLDER(ATC-354)의 마지막 계산 결과. runDispatch(5분 주기)가 쓰고, SUPERVISOR QUEUE의 RELAY 카드와 DUTY brief가 읽는다.
// 아직 계산하지 않았으면 null이고, 그동안 RELAY 카드는 만들지 않는다(AIRCRAFT가 이어받을 수 있는지 모르므로).
let routes: HolderPlans["routes"] | null = null;

export const setHolderRoutes = (r: HolderPlans["routes"] | null) => {
  routes = r;
};
export const holderRoutes = () => routes;
