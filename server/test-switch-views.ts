import "./test-hermetic.ts";
import type { SwitchView } from "./switch-def.ts";
import { switchRegistry } from "./switch-registry.ts";

// 시험 전용(ATC-393): 내장 스위치 선언에서 SwitchView 목록을 만든다. values로 지금 값을 바꿔 정책 한 줄 같은 계산을 시험한다. 운영 코드는 가져오지 않는다.
export const switchViews = (values: Record<string, string> = {}): SwitchView[] => switchRegistry.views().map((v) => (v.key in values ? { ...v, value: values[v.key]! } : v));
export const swOf = (key: string): SwitchView => {
  const v = switchViews().find((x) => x.key === key);
  if (!v) throw new Error(`선언된 스위치가 아님: ${key}`);
  return v;
};
