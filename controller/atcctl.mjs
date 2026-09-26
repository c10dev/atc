#!/usr/bin/env node
// TOWER·DISPATCH 세션이 쓰는 atc CLI. atc 서버(기본 http://127.0.0.1:7700)에만 말한다. 의존성 없음.
const BASE = process.env.ATC_URL || "http://127.0.0.1:7700";

const USAGE = `사용법:
  node atcctl.mjs brief                     지난 확인 이후 변화 + 현재 상태 (JSON)
  node atcctl.mjs ack <cursor>              브리핑을 처리했다고 표시 (다음 brief는 이후 변화만)
  node atcctl.mjs issue <세션> <TYPE> [--stand <STAND>] [--flight <FLIGHT>] -- <CLEARANCE 내용>
                                            TYPE: TRAFFIC HOLD CONTINUE LAND REPORT INFO
                                            보낼 대상(SEND TO)과 보낼 문구를 출력한다
  node atcctl.mjs readback <C-0007>         팀이 READBACK함
  node atcctl.mjs cancel <C-0007>           CLEARANCE 취소

DISPATCH (2a 그림자 운용: 제안 검토만, 판정은 SUPERVISOR)
  node atcctl.mjs dispatch brief            계획·열린 제안·2b 점검 (JSON)
  node atcctl.mjs dispatch flight <VOC-193> FLIGHT 본문·댓글 (Linear 읽기 전용)
  node atcctl.mjs dispatch note <D-0003> [--caution] -- <메모>
                                            제안에 검토 메모를 단다(CAUTION 표시 선택)
  node atcctl.mjs dispatch release <D-0003> (2b) 승인된 제안을 sent로 바꾸고 SEND TO와 FLIGHT PLAN 출력
  node atcctl.mjs dispatch readback <D-0003>
                                            (2b) CAPTAIN이 READBACK함
  node atcctl.mjs dispatch decline <D-0003> -- <사유>
                                            (2b) CAPTAIN이 맡지 못함`;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) {
    console.error(`오류: ${data.error ?? res.status}`);
    process.exit(1);
  }
  return data;
}

function parseIssue(args) {
  const sep = args.indexOf("--");
  const head = sep < 0 ? args : args.slice(0, sep);
  const text = sep < 0 ? "" : args.slice(sep + 1).join(" ");
  const [to, type, ...rest] = head;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i] === "--stand") opts.stand = rest[i + 1];
    else if (rest[i] === "--flight") opts.flight = rest[i + 1];
    else throw new Error(`알 수 없는 옵션 ${rest[i]}`);
  }
  if (!to || !type || !text) throw new Error("세션, TYPE, -- 뒤 CLEARANCE 내용이 모두 필요함");
  return { to, type: type.toUpperCase(), text, ...opts };
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === "brief") {
    console.log(JSON.stringify(await call("GET", "/api/controller/brief?consumer=controller"), null, 1));
  } else if (cmd === "ack" && args[0]) {
    await call("POST", "/api/controller/ack", { consumer: "controller", cursor: args[0] });
    console.log(`ack ${args[0]}`);
  } else if (cmd === "issue") {
    const r = await call("POST", "/api/clearances", parseIssue(args));
    console.log(`SEND TO: ${r.sendTo}\n---\n${r.message}`);
  } else if (cmd === "dispatch" && args[0] === "brief") {
    console.log(JSON.stringify(await call("GET", "/api/dispatch/brief"), null, 1));
  } else if (cmd === "dispatch" && args[0] === "flight" && args[1]) {
    console.log(JSON.stringify(await call("GET", `/api/dispatch/flight/${encodeURIComponent(args[1])}`), null, 1));
  } else if (cmd === "dispatch" && args[0] === "note" && args[1]) {
    const sep = args.indexOf("--");
    const text = sep < 0 ? "" : args.slice(sep + 1).join(" ");
    if (!text) throw new Error("-- 뒤에 메모가 필요함");
    const caution = args.slice(2, sep < 0 ? undefined : sep).includes("--caution");
    const r = await call("POST", `/api/dispatch/proposals/${encodeURIComponent(args[1])}/note`, { text, caution });
    console.log(`${r.proposal.id} 메모${r.proposal.caution ? " · CAUTION" : ""}`);
  } else if (cmd === "dispatch" && args[0] === "release" && args[1]) {
    const r = await call("POST", `/api/dispatch/proposals/${encodeURIComponent(args[1])}/release`);
    console.log(`SEND TO: ${r.sendTo}\n---\n${r.message}`);
  } else if (cmd === "dispatch" && args[0] === "readback" && args[1]) {
    const r = await call("POST", `/api/dispatch/proposals/${encodeURIComponent(args[1])}/accept`);
    console.log(`${r.proposal.id} READBACK 확인`);
  } else if (cmd === "dispatch" && args[0] === "decline" && args[1]) {
    const sep = args.indexOf("--");
    const reason = sep < 0 ? "" : args.slice(sep + 1).join(" ");
    if (!reason) throw new Error("-- 뒤에 CAPTAIN의 사유가 필요함");
    const r = await call("POST", `/api/dispatch/proposals/${encodeURIComponent(args[1])}/decline`, { reason });
    console.log(`${r.proposal.id} DECLINED`);
  } else if ((cmd === "readback" || cmd === "cancel") && args[0]) {
    const r = await call("POST", `/api/clearances/${encodeURIComponent(args[0])}/${cmd}`);
    console.log(`${r.clearance.id} ${cmd === "readback" ? "READBACK 확인" : "취소"}`);
  } else {
    console.log(USAGE);
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(`오류: ${e.message}`);
  process.exit(1);
}
