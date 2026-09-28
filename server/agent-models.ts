// 서브에이전트 agent id → 실제로 답한 message.model(ATC-57 COMPLEMENT DRIFT). FUEL 읽기(fuel-run.ts)가 훑을 때마다 채우고,
// OBSERVED CREW(crew-observed.ts)가 읽는다. 대화 기록을 따로 읽지 않으려고 둔 작은 저장소(아직 훑지 않았으면 비어 있다)
const models = new Map<string, string>();

export function rememberAgentModels(m: Map<string, string>) {
  for (const [a, model] of m) models.set(a, model);
}

export const agentModelOf = (agent: string): string | null => models.get(agent) ?? null;
