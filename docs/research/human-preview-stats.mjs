#!/usr/bin/env node
// ATC-39 리서치: vocado PR의 Human Preview 비용을 GitHub에서 읽기만 해서 센다(gh api graphql, 쓰기 없음).
// 사용: node docs/research/human-preview-stats.mjs [since=2026-08-29] > out.json
// PR마다 본문 편집 이력(userContentEdits)으로 applicability가 required가 된 시각, disposition이 바뀐 시각을 찾는다.
// 사용자 데이터나 자격 증명은 읽지 않는다. 본문에서 Human Preview 칸의 값과 PR 메타데이터만 뽑는다.
import { execFileSync } from "node:child_process";

const REPO = ["chaehy5665", "vocado_nextjs"];
const since = process.argv[2] ?? "2026-08-29";

const gql = (query, vars = {}) => {
  const args = ["api", "graphql", "-f", `query=${query}`];
  // 문자열은 -f, 수·null은 -F(GraphQL Int·null로 넘어간다)
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === "string" ? "-f" : "-F", `${k}=${v ?? "null"}`);
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 << 20 })).data;
};

const LIST = `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 50, after: $after) {
  pageInfo { hasNextPage endCursor }
  nodes { ... on PullRequest { number } } } }`;
const DETAIL = `query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $n) {
  number title createdAt mergedAt closedAt state isDraft headRefName body
  commits(last: 100) { nodes { commit { oid authoredDate messageHeadline } } }
  timelineItems(first: 50, itemTypes: [READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT]) { nodes { __typename ... on ReadyForReviewEvent { createdAt } ... on ConvertToDraftEvent { createdAt } } }
  userContentEdits(first: 100) { nodes { editedAt diff } }
  comments(first: 100) { nodes { createdAt body } }
} } }`;

// 본문 한 칸의 값(첫 줄). "- Human Preview applicability: `required` …" → "required …"
const field = (body, name) => {
  const m = new RegExp(`^[-*]\\s*${name}[^:\\n]*:\\s*(.*)$`, "im").exec(body ?? "");
  return m ? m[1].replace(/`/g, "").trim() : null;
};
const applicabilityOf = (body) => {
  const v = field(body, "Human Preview applicability");
  if (v === null) return "missing";
  if (/^not required/i.test(v)) return "not required";
  if (/^required/i.test(v)) return "required";
  return "other";
};
const dispositionOf = (body) => {
  const v = field(body, "Human Visual Review disposition(?: when required)?") ?? "";
  const m = /^(approved|changes requested|waived|pending|passed|failed|N\/A)/i.exec(v);
  return m ? m[1].toLowerCase() : v ? "other" : null;
};

const numbers = [];
let after = null;
do {
  const d = gql(LIST, { q: `repo:${REPO.join("/")} is:pr created:>=${since}`, after });
  numbers.push(...d.search.nodes.map((x) => x.number));
  after = d.search.pageInfo.hasNextPage ? d.search.pageInfo.endCursor : null;
} while (after);

const out = [];
for (const n of numbers.sort((a, b) => a - b)) {
  const p = gql(DETAIL, { owner: REPO[0], name: REPO[1], n }).repository.pullRequest;
  // 편집 이력은 최신순. 옛날 순으로 돌리고 처음 본문(createdAt)도 넣는다
  const edits = p.userContentEdits.nodes.filter((e) => e.diff).map((e) => ({ at: e.editedAt, body: e.diff })).sort((a, b) => a.at.localeCompare(b.at));
  const history = edits.length ? edits : [{ at: p.createdAt, body: p.body }];
  const requiredAt = history.find((h) => applicabilityOf(h.body) === "required")?.at ?? null;
  const dispositions = [];
  for (const h of history) {
    const d = dispositionOf(h.body);
    if (d && d !== dispositions.at(-1)?.value) dispositions.push({ at: h.at, value: d });
  }
  const readyEvents = p.timelineItems.nodes.filter((x) => x.__typename === "ReadyForReviewEvent").map((x) => x.createdAt);
  out.push({
    number: p.number,
    title: p.title,
    state: p.state,
    isDraft: p.isDraft,
    createdAt: p.createdAt,
    readyAt: readyEvents[0] ?? (p.isDraft ? null : p.createdAt),
    mergedAt: p.mergedAt,
    closedAt: p.closedAt,
    applicability: applicabilityOf(p.body),
    everRequired: requiredAt !== null,
    requiredAt,
    disposition: dispositionOf(p.body),
    dispositions,
    reviewer: field(p.body, "Human reviewer"),
    findings: field(p.body, "Findings or requested corrections"),
    rePreview: field(p.body, "Re-preview / re-review history"),
    waiver: field(p.body, "Waiver, only when disposition is `?waived`?"),
    commitsAfterReady: p.commits.nodes.filter((c) => readyEvents[0] && c.commit.authoredDate > readyEvents[0] && !/^Merge\b/.test(c.commit.messageHeadline)).length,
    previewComments: p.comments.nodes.filter((c) => /human preview|human visual|preview/i.test(c.body)).map((c) => ({ at: c.createdAt, excerpt: c.body.replace(/\s+/g, " ").slice(0, 300) })),
  });
  process.stderr.write(`#${n} `);
}
process.stdout.write(JSON.stringify({ since, fetchedAt: new Date().toISOString(), prs: out }, null, 1));
