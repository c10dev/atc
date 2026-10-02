import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type AutolandRecord, RECORD_FILE } from "./autoland.ts";

// AUTOLAND 기록(autoland.jsonl)에 한 줄 더한다. autoland-run.ts에서 옮겼다(ATC-338): landing-review.ts도 쓰는데 autoland-run.ts가 landing-review.ts를 가져와 순환이었다.
export function appendRecord(r: Omit<AutolandRecord, "at"> & { at?: string }) {
  const line: AutolandRecord = { at: r.at ?? new Date().toISOString(), ...r } as AutolandRecord;
  const file = RECORD_FILE();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(line) + "\n");
  if (["update", "merge", "groundstop", "groundstop-clear", "mode", "review-request"].includes(line.op)) console.log(`[atc] autoland ${line.op}${line.number ? ` #${line.number}` : ""}${line.result ? ` ${line.result}` : ""}${line.detail ? ` — ${line.detail}` : ""}`);
}
