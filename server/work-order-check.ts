import { measureOf } from "./effect-check.ts";
import { K3_LABELS, k3DeclarationsOf } from "./k3-allow.ts";
import { sectionsOf } from "./release.ts";

// 작업 지시서 본문 모양 점검(ATC-469). DUTY가 Linear에 만들거나(create) 본문을 고칠(update) 때, 발권 때 읽는 절이 읽히는지 먼저 본다.
// 거절: Goal·Done when·K effects 절이 없거나 비었음, `## K effects`의 K3 줄이 선언으로 읽히지 않음(`K3: none` 포함). 경고만: Measure 절이 없거나 읽히지 않음.
// 절 이름은 발권 해시가 읽는 규칙(release.ts sectionsOf)과 같다. 순수 함수 — 입출력은 duty-l1-run.ts
export const K3_SHAPE = "K3[<label>]: <control> | files: <paths>";

export interface WorkOrderCheck {
  errors: string[]; // 하나라도 있으면 400, Linear에 아무것도 쓰지 않는다
  warnings: string[]; // 만들어지고 답에 warning으로 실린다
}

export function workOrderCheck(body: string): WorkOrderCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const s = sectionsOf(body);
  if (!s.goal) errors.push("`## Goal`(또는 `## 목표`) 절이 없거나 비었음");
  if (!s.doneWhen) errors.push("`## Done when`(또는 `## Exit criteria`·`## 완료 기준`) 절이 없거나 비었음");
  if (!s.k) errors.push("`## K effects`(또는 `## K 효과`) 절이 없거나 비었음 — 효과가 없으면 `None`처럼 K3로 시작하지 않는 글을 적는다");
  const k3 = k3DeclarationsOf(body);
  if (k3.unparsed > 0) {
    errors.push(`\`## K effects\`의 K3 줄 ${k3.unparsed}개가 선언으로 읽히지 않음${k3.none > 0 ? "(`K3: none`은 금지: 효과가 없으면 K3로 시작하는 줄을 쓰지 않는다)" : ""}. 줄 모양은 \`${K3_SHAPE}\`, 라벨은 ${K3_LABELS.join(" · ")}`);
  }
  const m = measureOf(body);
  if (m.kind === "missing") warnings.push("`## Measure` 절이 없음 — 잴 것이 없으면 `None`이라고 적는다");
  else if (m.kind === "invalid") warnings.push(`\`## Measure\`를 읽지 못함: ${m.reason} — 잴 것이 없으면 \`None\`이라고 적는다`);
  return { errors, warnings };
}

export const workOrderRejection = (errors: readonly string[]): string => `작업 지시서 본문 모양이 맞지 않아 Linear에 쓰지 않음: ${errors.join("; ")}`;
