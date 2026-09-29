#!/usr/bin/env node
// INSPECTION 자료(packet)의 크기를 토큰으로 잰다(ATC-135 0단계). 읽기만: GET /api/mcc(기록)과 GET /api/mcc/packet/<PR>.
// 사용: node mcc/packet-size.mjs [--last 20] [--base http://localhost:7700]
// 토큰은 글자 수 / 4 어림이다(JSON 그대로 세션에 들어오는 크기).
import { pathToFileURL } from "node:url";

// 순수: INSPECTION 기록에서 PR별 마지막 것을 골라 최근 n건의 PR 번호(오래된 순)
export function lastInspected(records, n) {
  const seen = new Map();
  for (const r of records) if (r.op === "inspect") seen.set(r.pr, r.at);
  return [...seen.entries()].sort((a, b) => (a[1] < b[1] ? -1 : 1)).slice(-n).map(([pr]) => pr);
}

export const tokensOf = (text) => Math.round(text.length / 4);

// 순수: [{pr, tokens, cut}] → 요약
export function summarize(rows) {
  const t = rows.map((r) => r.tokens).sort((a, b) => a - b);
  const sum = t.reduce((a, b) => a + b, 0);
  const at = (q) => t[Math.min(t.length - 1, Math.floor(q * t.length))] ?? 0;
  return { n: t.length, mean: t.length ? Math.round(sum / t.length) : 0, median: at(0.5), p90: at(0.9), max: t.at(-1) ?? 0, cut: rows.filter((r) => r.cut).length };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const base = opt("--base", "http://localhost:7700");
  const last = Number(opt("--last", "20"));
  const records = (await (await fetch(`${base}/api/mcc`)).json()).records;
  const rows = [];
  for (const pr of lastInspected(records, last)) {
    const res = await fetch(`${base}/api/mcc/packet/${pr}`);
    const text = await res.text();
    let cut = false;
    try {
      cut = JSON.parse(text).diffTruncated === true;
    } catch {}
    rows.push({ pr, tokens: tokensOf(text), cut, ok: res.ok });
    console.log(`#${pr}\t${tokensOf(text)} tokens${cut ? "\tdiffTruncated" : ""}${res.ok ? "" : "\tHTTP " + res.status}`);
  }
  console.log(JSON.stringify(summarize(rows.filter((r) => r.ok))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
