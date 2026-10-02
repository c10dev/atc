// 점의 모양(kit/chips.css .dot[data-shape])을 세션 상태에서 고른다. 색만으로 구별하지 않는다(ATC-412): busy는 찬 원, idle은 막대, dead는 빈 원
export const dotShapeOf = (status: string): "ring" | "dash" | undefined => (status === "dead" ? "ring" : status === "idle" ? "dash" : undefined);

// ACTIVITY 단계의 점 모양: tool은 찬 원, model은 빈 원, idle은 막대
export const PHASE_SHAPE = { tool: undefined, model: "ring", idle: "dash" } as const;
