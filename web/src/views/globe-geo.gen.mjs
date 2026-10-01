// globe-geo.ts 생성기(ATC-291). 다시 만들려면:
//   curl -sL -o /tmp/airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
//   node web/src/views/globe-geo.gen.mjs /usr/share/zoneinfo /tmp/airports.csv > web/src/views/globe-geo.ts
// 입력: IANA tz 데이터베이스의 zone1970.tab·tzdata.zi(공개 도메인)와 OurAirports airports.csv(공개 도메인).
import { readFileSync } from "node:fs";

const [zoneDir, csvPath] = process.argv.slice(2);
if (!zoneDir || !csvPath) {
  console.error("usage: node globe-geo.gen.mjs <zoneinfo dir> <airports.csv>");
  process.exit(1);
}

// ±DDMM[SS]±DDDMM[SS] → 도, 0.1°로 반올림해 10배 정수
function parseIso6709(s) {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/.exec(s);
  if (!m) throw new Error(`bad coordinate ${s}`);
  const lat = (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60 + Number(m[4] ?? 0) / 3600);
  const lon = (m[5] === "-" ? -1 : 1) * (Number(m[6]) + Number(m[7]) / 60 + Number(m[8] ?? 0) / 3600);
  return [Math.round(lat * 10), Math.round(lon * 10)];
}

const zones = {};
for (const line of readFileSync(`${zoneDir}/zone1970.tab`, "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const [, coord, name] = line.split("\t");
  zones[name] = parseIso6709(coord);
}
// 링크(별칭)는 가리키는 zone의 도시를 따른다. 체인(링크의 링크)은 풀어 쓴다.
const links = {};
for (const line of readFileSync(`${zoneDir}/tzdata.zi`, "utf8").split("\n")) {
  const m = /^L (\S+) (\S+)$/.exec(line);
  if (m) links[m[2]] = m[1];
}
for (const [alias, target0] of Object.entries(links)) {
  let target = target0;
  for (let i = 0; i < 4 && !zones[target] && links[target]; i++) target = links[target];
  if (zones[target] && !zones[alias] && !alias.startsWith("Etc/")) zones[alias] = zones[target];
}

// CSV(따옴표 필드)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (f += '"'), i++;
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") (row.push(f), (f = ""));
    else if (c === "\n") (row.push(f), rows.push(row), (row = []), (f = ""));
    else if (c !== "\r") f += c;
  }
  return rows;
}
const [head, ...rows] = parseCsv(readFileSync(csvPath, "utf8"));
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const airports = [];
for (const r of rows) {
  if (r[col.type] !== "large_airport" || !/^[A-Z]{3}$/.test(r[col.iata_code])) continue;
  airports.push([r[col.iata_code], Math.round(Number(r[col.latitude_deg]) * 10), Math.round(Number(r[col.longitude_deg]) * 10)]);
}
airports.sort((a, b) => (a[0] < b[0] ? -1 : 1));

const tzBody = Object.keys(zones)
  .sort()
  .map((k) => `  ${JSON.stringify(k)}: [${zones[k][0]}, ${zones[k][1]}],`)
  .join("\n");
const apBody = airports.map((a) => `  [${JSON.stringify(a[0])}, ${a[1]}, ${a[2]}],`).join("\n");

process.stdout.write(`// GLOBE 위치 표(ATC-291). web/src/views/globe-geo.gen.mjs가 만든다. 직접 고치지 않는다.
// TZ_CITY: IANA tz 데이터베이스(zone1970.tab의 대표 도시 좌표와 tzdata.zi의 링크). 공개 도메인, https://www.iana.org/time-zones
// AIRPORTS: OurAirports의 large_airport 가운데 IATA 코드가 있는 것. 공개 도메인, https://ourairports.com/data/
// 좌표는 0.1°로 반올림해 10배 정수로 적었다. GLOBE 청크 안에서만 쓴다(외부 요청 없음).
// 다시 만들려면 generator 머리의 명령을 쓴다.
export const TZ_CITY: Readonly<Record<string, readonly [lat10: number, lon10: number]>> = {
${tzBody}
};

export const AIRPORTS: readonly (readonly [iata: string, lat10: number, lon10: number])[] = [
${apBody}
];
`);
