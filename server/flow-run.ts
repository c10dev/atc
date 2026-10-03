import { flowInputOf, type FlowInput, type SampleRow, sampleRowsOf } from "./flow.ts";
import type { Ticket } from "./model.ts";
import { readRecords } from "./recorder.ts";
import { readReleaseLines } from "./release-store.ts";

// FLOW(ATC-468)의 읽기: FLIGHT RECORDER(보관 30일)와 releases.jsonl을 읽어 순수 계산(flow.ts)이 먹는 모양으로 만든다
const RETAIN_MS = 31 * 86_400_000;

export function loadFlow(tickets: readonly Pick<Ticket, "key" | "createdAt">[], now: number): { input: FlowInput; samples: SampleRow[] } {
  const records = readRecords(now - RETAIN_MS);
  return { input: flowInputOf(records, tickets, readReleaseLines()), samples: sampleRowsOf(records) };
}
