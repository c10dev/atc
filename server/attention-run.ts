// 주의 분 CLI(ATC-464). 로컬 파일만 읽고 아무것도 올리지 않는다. 원본 내보내기는 이 호스트(Mac)에 둔다.
//   node server/attention-run.ts --export <aw.json> --windows <windows.json> [--config docs/research/attention-windows.json] [--host <name>] [--json]
import { readFileSync } from "node:fs";
import { analyze, formatReport, parseConfig } from "./attention.ts";

const args = process.argv.slice(2);
const get = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
try {
  const need = (k: string) => {
    const v = get(k);
    if (!v) throw new Error(`--${k}가 필요하다`);
    return v;
  };
  const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  const config = parseConfig(read(get("config") ?? new URL("../docs/research/attention-windows.json", import.meta.url).pathname));
  const w = read(need("windows"));
  const rep = analyze(read(need("export")), Array.isArray(w) ? w : w.windows, config, get("host"));
  process.stdout.write(args.includes("--json") ? JSON.stringify(rep, null, 2) + "\n" : formatReport(rep));
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
