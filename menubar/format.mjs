// macOS 메뉴 막대(SwiftBar) 표시 줄을 만드는 순수 함수(ATC-149). 읽기만 하고 입출력은 atc.15s.mjs가 한다.
// 입력: GET /api/supervisor-alerts(alerts), /api/fleet(fleet), /api/update(update), /api/control/sessions(control).
// 어느 하나가 없어도(null) 그 줄만 빠진다. 서버는 바꾸지 않는다: 새 엔드포인트·토큰·CORS 없음.

const LEVEL_ORDER = ["warning", "caution", "advisory"];
const LEVEL_LABEL = { warning: "WARNING", caution: "CAUTION", advisory: "ADVISORY" };
// 제목 색: warning 빨강, caution 호박. advisory만 있으면 기본색(색 지정 없음)
const LEVEL_COLOR = { warning: "#FF3B30", caution: "#FF9500" };
const MAX_TEXT = 110;
const MAX_PER_LEVEL = 15; // 등급마다 이만큼만 펼친다(메뉴가 화면을 넘지 않게). 나머지는 atc에서

export const DEFAULT_BASE = "http://localhost:7700";

// SwiftBar 한 줄: `제목 | 이름=값 …`. 제목의 `|`는 매개변수 구분자라서 닮은 글자(¦)로 바꾸고, 줄바꿈은 공백으로,
// 맨 앞 `-`는 하위 메뉴 표시라서 en dash로 바꾼다. 너무 길면 자른다.
export function esc(text) {
  let t = String(text ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "¦");
  if (t.length > MAX_TEXT) t = `${t.slice(0, MAX_TEXT - 1)}…`;
  return t.replace(/^-/, "–");
}

// 매개변수 값에도 `|`나 공백이 있으면 안 된다(주소는 그대로 쓰되 공백·`|`만 막는다)
const hrefOf = (base, link) => `${base.replace(/\/+$/, "")}/${String(link ?? "").replace(/^\/+/, "")}`.replace(/\s/g, "%20").replace(/\|/g, "%7C");
const line = (text, params = {}) => {
  const p = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(" ");
  return p ? `${esc(text)} | ${p}` : esc(text);
};

const rank = (level) => (LEVEL_ORDER.includes(level) ? LEVEL_ORDER.indexOf(level) : LEVEL_ORDER.length);
export const itemsOf = (alerts) => (Array.isArray(alerts?.items) ? alerts.items.filter((i) => i && typeof i.key === "string") : []);

// 가장 많이 쓴 ACCOUNT의 5시간·7일 사용률: `5h 33% · 7d 53%`. 없으면 null
export function fuelOf(fleet) {
  const accts = Array.isArray(fleet?.fuelAccounts) ? fleet.fuelAccounts : [];
  const used = (a) => Math.max(0, ...((a.windows ?? []).map((w) => w.pct ?? 0)));
  const top = [...accts].sort((a, b) => used(b) - used(a))[0];
  if (!top) return null;
  const win = (name) => (top.windows ?? []).find((w) => w.name === name)?.pct;
  const parts = [["5h", win("five_hour")], ["7d", win("seven_day")]].filter(([, pct]) => typeof pct === "number").map(([k, pct]) => `${k} ${Math.round(pct)}%`);
  return parts.length ? parts.join(" · ") : null;
}

// 지금 일하는 AIRCRAFT 수와 관제 세션 수. AIRCRAFT는 status "busy", 관제 세션은 살아 있는 세션이 busy거나 job이 working
export function workingOf(fleet, control) {
  const aircraft = Array.isArray(fleet?.aircraft) ? fleet.aircraft.filter((a) => a.status === "busy").length : null;
  const sessions = Array.isArray(control?.sessions) ? control.sessions : null;
  const ctl = sessions ? sessions.filter((s) => (s.live ?? []).some((l) => l.status === "busy" || l.job?.state === "working")).length : null;
  return { aircraft, control: ctl };
}

// 마지막 RTS: `RTS ok 15:21 · 4초 · 세션 9개 그대로`. tz는 시험용(기본은 Mac의 시간대)
export function rtsLine(update, tz) {
  const last = update?.last;
  if (!last?.at) return null;
  const time = new Date(last.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, ...(tz ? { timeZone: tz } : {}) });
  return `RTS ${last.result ?? "?"} ${time}${last.detail ? ` · ${last.detail}` : ""}`;
}

// 제목 줄. 조치가 필요한 WARNING·CAUTION 수(화면 상단 숫자와 같다), advisory가 있으면 `+n`, 그리고 FUEL
export function titleOf({ items, fleet }) {
  const by = (l) => items.filter((i) => i.level === l).length;
  const act = by("warning") + by("caution");
  const adv = items.length - act;
  const top = LEVEL_ORDER.find((l) => by(l) > 0);
  const fuel = fuelOf(fleet);
  const text = `✈ ${act}${adv ? ` +${adv}` : ""}${fuel ? ` ${fuel}` : ""}`;
  return line(text, LEVEL_COLOR[top] ? { color: LEVEL_COLOR[top] } : {});
}

// 메뉴 전체(SwiftBar 출력 줄). now는 시험용
export function menuLines({ alerts, fleet, update, control, base = DEFAULT_BASE, tz }) {
  const items = itemsOf(alerts);
  const out = [titleOf({ items, fleet }), "---"];
  if (!items.length) out.push(line("지금 알릴 것 없음"));
  for (const level of LEVEL_ORDER) {
    const group = items.filter((i) => i.level === level);
    if (!group.length) continue;
    out.push(line(`${LEVEL_LABEL[level]} ${group.length}`, LEVEL_COLOR[level] ? { color: LEVEL_COLOR[level] } : {}));
    for (const i of group.slice(0, MAX_PER_LEVEL)) {
      out.push(line(`${i.text}${i.next ? ` — ${i.next}` : ""}`, { href: hrefOf(base, i.link) }));
    }
    if (group.length > MAX_PER_LEVEL) out.push(line(`외 ${group.length - MAX_PER_LEVEL}개 — atc에서 보기`, { href: hrefOf(base, "#radar") }));
  }
  // 등급이 없는 옛 항목은 맨 끝에
  const rest = items.filter((i) => !LEVEL_ORDER.includes(i.level));
  if (rest.length) {
    out.push(line(`기타 ${rest.length}`));
    for (const i of rest) out.push(line(`${i.text}${i.next ? ` — ${i.next}` : ""}`, { href: hrefOf(base, i.link) }));
  }
  out.push("---");
  const approvals = items.filter((i) => i.key.startsWith("pending|proposal|")).length;
  out.push(line(`DISPATCH 승인 대기 ${approvals}`, { href: hrefOf(base, "#dispatch") }));
  const rts = rtsLine(update, tz);
  if (rts) out.push(line(rts, { href: hrefOf(base, "#radar") })); // UPDATE 바가 있는 탭(RTS 알림 항목의 link와 같다)
  const w = workingOf(fleet, control);
  const parts = [w.aircraft != null && `AIRCRAFT ${w.aircraft}`, w.control != null && `관제 세션 ${w.control}`].filter(Boolean);
  if (parts.length) out.push(line(`일하는 중: ${parts.join(" · ")}`, { href: hrefOf(base, "#fleet") }));
  out.push("---", line("Open atc", { href: hrefOf(base, "") }), line("Refresh", { refresh: "true" }));
  return out;
}

// atc에 닿지 않을 때: 오류 덩어리 대신 한 줄
export function unreachableLines({ base = DEFAULT_BASE } = {}) {
  return ["✈ —", "---", line("atc 연결 안 됨: SSH 포워딩 확인"), "---", line("Open atc", { href: hrefOf(base, "") }), line("Refresh", { refresh: "true" })];
}

// 알림: 이번에 처음 본 key 가운데 level이 warning이거나 cue가 call인 것. seen은 { key: 본 시각(ms) }
// 처음 실행(seen이 null)이면 지금 있는 것을 모두 본 것으로 치고 알리지 않는다(켜자마자 수십 개가 쏟아지지 않게)
export function newAlerts(items, seen) {
  if (!seen) return [];
  return items.filter((i) => !(i.key in seen) && (i.level === "warning" || i.cue === "call"));
}

// 본 key를 갱신한다: 지금 있는 key를 모두 넣고, 7일 지난 것은 지운다
export const SEEN_TTL_MS = 7 * 24 * 60 * 60_000;
export function nextSeen(items, seen, now) {
  const out = {};
  for (const [k, at] of Object.entries(seen ?? {})) if (now - at < SEEN_TTL_MS) out[k] = at;
  for (const i of items) out[i.key] ??= now;
  return out;
}

// SwiftBar 알림 주소(swiftbar://notify). 눌러서 열 곳은 그 항목의 탭
export function notifyUrl({ plugin, item, base = DEFAULT_BASE }) {
  const q = new URLSearchParams({
    plugin,
    title: `atc ${item.level ? LEVEL_LABEL[item.level] ?? "" : ""}${item.cue === "call" ? " CALL" : ""}`.replace(/\s+/g, " ").trim(),
    body: esc(item.text),
    href: hrefOf(base, item.link),
  });
  return `swiftbar://notify?${q.toString().replace(/\+/g, "%20")}`;
}
