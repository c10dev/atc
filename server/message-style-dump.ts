import { writeFileSync } from "node:fs";
import { messageCases } from "./message-style-cases.ts";

// 한 번 쓰는 도구: `node server/message-style-dump.ts <out.json>`. 문구를 고치기 전에 fixtures/message-before.json을 만드는 데 썼다
const out = process.argv[2];
if (!out) throw new Error("usage: node server/message-style-dump.ts <out.json>");
writeFileSync(out, JSON.stringify(messageCases(), null, 2) + "\n");
