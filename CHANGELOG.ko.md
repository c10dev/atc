# 변경 기록

[English](CHANGELOG.md) · **한국어**

atc의 주요 변경 사항을 여기에 적는다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를, 버전은 [유의적 버전](https://semver.org/lang/ko/)을 따른다.

## [Unreleased]

### 보안
- TOWER·OCC의 Bash guard(`controller/guard.mjs`)가 큰따옴표 안의 명령 치환을 통과시켰다: `node atcctl.mjs brief -- "$(touch /tmp/x)"`와 백틱이 막히지 않았다. 쉘은 명령보다 먼저 이것을 실행하므로 관제 세션이 아무 명령이나 돌릴 수 있었다. 이제 작은따옴표 밖의 명령 치환·변수 확장(`$(…)`, 백틱, `${…}`, `$VAR`)을 모두 막는다. 작은따옴표 안과 역슬래시로 이스케이프한 글은 그대로 된다. TEAM_H가 보고했다.

### 추가
- 새 버전 알림. 배포 전에 열어 둔 탭은 옛 번들을 계속 돌려서 새 기능("CROSSCHECK에 동의" 버튼)을 못 보고 지나칠 수 있었다. 이제 서버가 `web/dist/index.html`의 진입 스크립트 경로(`/assets/index-<hash>.js`)를 빌드 정체로 삼고, 파일이 바뀌면 다시 읽는다(재시작 없이 다시 빌드해도 알아챈다). `GET /api/version`은 `{build, startedAt}`를 주고, `/api/events`는 연결할 때와 build가 바뀔 때 `event: version`을 보낸다. 화면은 자기 번들(`import.meta.url`)과 비교해 다르면 머리글 아래에 "새 버전이 배포됨 · 새로고침"을 띄운다. 새로고침과 닫기(그 빌드에 대해서는 숨김) 버튼이 있다. 입력 중인 내용(거절 사유 등)이 날아가지 않게 저절로 새로고침하지 않고, 개발 서버나 빌드가 없을 때는 뜨지 않는다. 새로고침이나 새 탭이 늘 지금 번들을 받도록 `index.html`은 `Cache-Control: no-cache`로 보낸다. `docs/guide`의 문제 해결과 화면 안내에 적었다.
- CROSSCHECK가 atc의 `docs/`를 읽을 수 있다(읽기만; SUPERVISOR 결정). CLASSIFY·NEW mark는 먼저 `docs/fleet.md` 4.1~4.3(FLIGHT TYPE, WAKE, TYPE RATING)을 읽고 인용한다. settings에 `permissions.additionalDirectories: ["../docs"]`를 더했다. 새 fail-closed hook `crosscheck/read-guard.mjs`(Read·Glob·Grep)가 `crosscheck/`, `../docs/`, 그 세션이 저장한 도구 출력만 허용하고, atc 소스·`~/.local/state/atc`·다른 저장소는 막는다(대화형 세션에서 권한 창으로 넘어가지 않는다). `crosscheck/CLAUDE.md`와 `/tick`은 기준을 인용하라고 안내한다.
- CROSSCHECK가 GitHub PR 사실을 읽기 전용 `gh pr view|checks|list`로 확인한다(SUPERVISOR 결정). MCP는 쓰지 않고 `--strict-mcp-config`는 그대로다. Bash hook은 `guard.mjs --crosscheck --gh-read`가 됐다. 두 옵션을 같이 주면 `gh pr`은 `view`·`checks`·`list`만(OCC와 달리 `diff`는 뺌), `--crosscheck`만 주면 `gh`는 계속 막힌다. settings allow에 세 명령을 넣었다. `crosscheck/CLAUDE.md`와 `/tick`은 본문·댓글·OCC 메모에 나온 PR 조건을 `gh pr view <N> --repo <owner/name> --json state,mergedAt,title`로 확인한 뒤 mark를 달라고 하고, AIRPORT별 저장소 표를 두며, 쓰는 gh 명령을 금지한다.
- CROSSCHECK 모델별 일치율. mark마다 `model`이 남는다. `atcctl`이 세션 settings `env`의 `ATC_CROSSCHECK_MODEL`에서 가져오고(세션이 스스로 적지 않음, 명령 앞 환경 변수로 바꾸는 것은 guard가 막음), 없는 mark는 `unknown`으로 읽는다. `gate.crosscheck`는 전체 `{marked, matched, rate}`를 그대로 두고 `byModel`을 더했다. DISPATCH·SCHEDULE 점검 패널에 모델마다 한 줄, 칩과 RECENT 툴팁에 모델 이름. `crosscheck/settings.test.mjs`가 settings 모델과 기록될 모델이 같은지, DeepSeek이 아닌지 확인한다.
- CROSSCHECK: SUPERVISOR가 판정하기 전에 OCC와 다른 계열의 모델이 예비 판정을 먼저 달아 둔다([docs/occ.md](docs/occ.md) "CROSSCHECK"). 게이트에는 계속 사람 판정만 세고, CROSSCHECK와 사람의 일치율은 따로 잰다.
  - 서버: `proposals.jsonl`·`schedule.jsonl`의 `crosscheck` op(`{op, id, at, by, verdict, reason}`). `note`처럼 상태를 바꾸지 않는다. HOLD가 아닌 `proposed` 제안과 `draft` 초안에만 받고, 나중 mark가 앞의 것을 대신한다. Proposal·ScheduleOp에 `crosscheck`, ScheduleOp에 `decision`(발부 뒤에도 남는 SUPERVISOR 판정)이 생겼다. `POST /api/dispatch/proposals/:id/crosscheck`, `POST /api/schedule/ops/:id/crosscheck`는 모드와 상관없이 받고, `reason`은 필수·500자 이내. 두 게이트에 `crosscheck: {marked, matched, rate}`(판정 전에 mark가 있던 사람 판정만; agree ↔ agreed·approved, disagree ↔ disagreed·rejected), 두 브리핑에 `crosscheck: {pending, examples}`.
  - `atcctl crosscheck brief`, `atcctl dispatch crosscheck D-xxxx agree|disagree -- <이유>`, `atcctl schedule crosscheck S-xxxx agree|disagree -- <이유>`.
  - 세션 폴더 `crosscheck/`(`CLAUDE.md`, `/tick`, 영어 번역). 설정은 fail-closed: `controller/guard.mjs --crosscheck`가 atcctl 읽기와 crosscheck 명령만, `occ/mcp-guard.mjs --read-only`가 읽기 MCP 도구만 통과시키고, Edit·Write·SendMessage·Agent는 막는다. 모델은 `claude-ocx-native--gpt-5.6-terra`로 고정했고 `ocx claude`로만 닿는다(정확한 실행 명령은 문서). 평범한 `claude`로 열면 Claude로 몰래 돌지 않고 오류로 멈춘다.
  - DISPATCH·SCHEDULE 탭: 열린 카드에 점선 칩 `CROSSCHECK agree · <이유>`, 같은 판정을 한 번에 내는 "CROSSCHECK에 동의" 버튼(shadow는 verdict, approval은 approve/reject; disagree에 동의하면 그 이유가 판정 사유), RECENT에 흐린 mark, 점검 패널에 참고 줄 "CROSSCHECK 일치 n/m".
- OCC S2, SCHEDULE 승인 운용. `mode` 뒤에 만들어 두었고 기본은 꺼짐([docs/occ.md](docs/occ.md) "Turning on S2"). approval 모드에서 SUPERVISOR가 SCHEDULE 탭에서 초안을 승인·거절하고, OCC는 `atcctl schedule release S-xxxx`로 정확한 Linear MCP 호출(`save_issue`, CLASSIFY·PRIORITIZE에는 근거 댓글; 계획 필드만)을 받아 그대로 부른다. `occ/mcp-guard.mjs`에 linear-guard가 들어가 approval 모드에서 발부된 호출과 도구·입력이 같은 Linear 쓰기만 통과한다. Linear에 반영이 보이면 atc가 APPLIED로 바꾼다. 새 상태 APPROVED·REJECTED·RELEASED·APPLIED, 탭의 IN PROGRESS 목록과 모드 전환, `POST /api/schedule/ops/:id/{approve,reject,release}`, `GET /api/schedule/released`, `POST /api/schedule/mode`. MCP guard는 hook 입력을 읽지 못하면 이제 막는다(전에는 통과시켰다).
- DOCS 탭(`#docs`, `#docs/<쪽>`): 문서 사이트 같은 사용 안내. 왼쪽 목차, 가운데 본문, 오른쪽 "이 쪽에서" 목차, 이전·다음 링크. 원본은 `docs/guide/`의 한국어 Markdown이고 빌드 때 묶여 `marked`로 그린다(새 의존성이라 다음 빌드 전에 `npm install`). 쪽: 소개, 빠른 시작, 개념, 일 맡기기(CHARTER DESK / AD HOC), 판정하기, FLEET, 교신 규칙, 화면, 단계, 문제 해결. 쪽 사이 링크는 탭 안에서 움직인다. 루트 `CLAUDE.md`에 사용 방법이 바뀌면 안내도 고치라고 넣었다.
- CHARTER DESK, OCC의 요청 창구: SCHEDULE `NEW` 초안(여전히 S1 그림자 운용이라 Linear에는 쓰지 않는다). SUPERVISOR가 OCC 세션에서 CHARTER REQUEST를 하면 OCC가 AD HOC FLIGHT(정기 스케줄 밖의 새 이슈) 초안을 쓰고, 승인되어 S2부터 Linear Todo가 되면 FILED다.
  - 서버: `POST /api/schedule/ops`가 `{kind: "NEW", title, body, project, reason, priority?, type?, wake?, ratings?, tail?, parent?, related?, blockedBy?}`를 받고, 작업의 `flight`는 `null`이다. 본문에는 vocado 네 칸(목표, 수정 허용 범위, 금지 사항, 완료 기준 또는 영어 이름)이 있어야 하고, `rating:SEC`는 Codex Engineering Task 칸(Allowed files, Forbidden changes, Invariants, Acceptance Criteria, Verification)도 있어야 한다. 프로젝트, tail(퇴역하지 않은 FLEET 등록번호), parent·related·blockedBy key를 검사한다. 근거에는 "중복 검색:"이 있어야 한다. atc가 제목이 비슷한 티켓을 5개까지 `similar`로 남기며, 찾는 범위는 스냅샷(최근 45일 안에 바뀐 이슈)뿐이다. `NEW` 초안은 열린 초안 5건 한도에 들고, 서로 대신하지 않으며, 초안 뒤에 같은 제목의 이슈가 Linear에 생기면 SUPERSEDED로 닫힌다.
  - `atcctl schedule draft NEW --title … --project … [--priority n] [--type X] [--wake Y] [--rating Z]… [--tail TEAM_X] [--parent K] [--related K]… [--blocked-by K]… --reason … -- <본문>`. 본문의 `\n`은 줄바꿈이고, 초안 ID, "AD HOC FLIGHT 초안", 비슷한 FLIGHT를 출력한다.
  - OCC 규정(`occ/CLAUDE.md`, `/tick`): CHARTER DESK 절 — CHARTER REQUEST가 있을 때만 쓰고, 먼저 중복을 찾고, 템플릿대로 본문을 쓰고, 팀이 분명하면 tail을 제안하고, 초안 ID를 SUPERVISOR에게 알린다.
- OCC S1, 그림자 운용의 SCHEDULE 초안([docs/occ.md](docs/occ.md) 5~7장, 영어). OCC가 분류 라벨이나 우선순위가 없는 Todo·Backlog FLIGHT에 `CLASSIFY`(`type:`, `wake:`, `rating:` 라벨, [docs/fleet.md](docs/fleet.md) 4장 기준)와 `PRIORITIZE` 초안을 쓴다. Linear에는 아무것도 쓰지 않는다.
  - 서버: 추가만 하는 기록 `~/.local/state/atc/schedule.jsonl`(`server/schedule.ts`)과 `GET /api/schedule/brief`, `GET /api/schedule/ops/:id`, `POST /api/schedule/ops`, `POST /api/schedule/ops/:id/verdict`. 열린 초안은 5건까지(넘으면 409). 같은 FLIGHT·종류로 새 초안을 쓰면 앞의 것은 SUPERSEDED. FLIGHT가 Todo·Backlog를 벗어나거나 Linear에 이미 반영되면 SUPERSEDED, 3일이 지나면 EXPIRED로 닫힌다.
  - `atcctl schedule brief`, `schedule draft CLASSIFY <FLIGHT> [--type X] [--wake Y] [--rating Z]… -- <근거>`, `schedule draft PRIORITIZE <FLIGHT> --priority 1-4 -- <근거>`. 한도에 차면 `LIMIT: …`을 출력해 세션이 초안 쓰기를 멈추게 한다.
  - OCC 규정(`occ/CLAUDE.md`, `/tick`): 한 바퀴에 후보 FLIGHT 3개까지 읽고 초안을 쓴다. PRIORITIZE는 본문·댓글에 근거가 있을 때만, `LIMIT`이 나오면 멈춘다.
  - DISPATCH 다음에 SCHEDULE 탭: S2 진입 점검(판정 20건, 합의율 80%), 열린 초안 카드(FLIGHT, 제목, 지금 분류, 바뀔 것, OCC 근거), "승인했을 것 / 거절했을 것" 버튼과 선택 거절 사유, Linear에서 손으로 붙일 라벨 안내, 후보 수, 최근 7일 표.
- 루트 `CLAUDE.md`(한국어, 세션이 읽는 원본)와 `CLAUDE.en.md`(번역): atc 코드를 고치는 세션의 작업 규칙. 운영 체크아웃이 아니라 워크트리에서 작업하고, 테스트·타입·빌드와 임시 상태 폴더의 7702 시험 서버로 확인하며(Linear 키는 복사하지 않음), 서비스 재시작·머지는 하지 않고, 커밋은 영어로 attribution 줄 없이, 항공 용어는 영어로, 문서는 영어판·한국어판을 함께 고친다. `controller/`·`occ/`의 관제 세션은 자기 폴더의 `CLAUDE.md`를 계속 따른다.
- FLEET 탭의 팀 빌딩([docs/fleet.md](docs/fleet.md) 8.1): **ENTRY INTO SERVICE**로 **CONFIGURATION** 템플릿(`general`, `security`, `ui`, `research`)을 골라 새 AIRCRAFT를 들인다(비어 있는 다음 `TEAM_X`, 기본 AIRPORT는 팀들이 있는 곳). **CREW BRIEFING**은 새 세션에 붙여 넣을 시작 지시문을 주고, **AOG**는 사유와 해제 예정일을 남기고 잠시 배정을 멈추며(planner가 건너뜀), **RETIREMENT**는 목록과 계획에서 뺀다(복귀 가능). atc는 세션을 직접 띄우지 않는다.
- planner의 FLIGHT 분류([docs/fleet.md](docs/fleet.md) 3단계): Linear 라벨 `type:`, `wake:`, `rating:`(Risk 그룹 라벨은 `SEC`). FLIGHT는 필요한 TYPE RATING을 모두 가졌고 팀원이 그 종류의 일을 할 수 있는 AIRCRAFT에만 간다. 슬롯은 WAKE로 세고(L 0.5, M 1, H 2), `wake:J`는 나누기 전까지 제외하며, 새 ROUTE 요소가 AIRCRAFT의 담당 프로젝트에 +1을 준다. 자격 있는 AIRCRAFT가 아예 없으면 사유와 함께 제외한다. Linear 라벨 그룹의 하위 라벨은 이제 `그룹:이름`(예: `Risk:Security`)으로 읽는다. DISPATCH 카드에 분류가 보인다.
- FLEET 등록부와 탭([docs/fleet.md](docs/fleet.md) 2단계): `~/.local/state/atc/fleet.json`에 팀마다 CREW COMPLEMENT, TYPE RATING(`SEC`, `UI`, `DATA`, `DOCS`), ROUTE, TARGETS를 두고, 기본값은 vocado 팀원 규칙에서 온다. 보안 작업을 맡을 팀원이 없는 구성에는 `SEC`를 줄 수 없다. FLEET 탭은 AIRCRAFT마다 상태(AIRBORNE / HOLDING / PARKED), 지금 FLIGHT, 프로필을 보여 주고 고친다(`GET /api/fleet`, `PATCH /api/fleet/:registration`). planner는 아직 쓰지 않는다.
- OCC 세션 S0(`occ/`, [docs/occ.md](docs/occ.md), 영어). DISPATCH 세션 폴더가 `dispatch/`에서 `occ/`로 옮겨졌고 하던 일(제안 검토, HOLD, FLIGHT PLAN, READBACK)은 그대로다. OCC는 운항 추적을 더한다: `guard.mjs --gh-read`로 읽기 전용 `gh pr view|checks|diff|list`를 쓴다. `occ/mcp-guard.mjs`가 읽기 MCP 도구만 통과시켜 S0에서는 Linear·GitHub에 쓸 수 없다.
- `atcctl manual check` / `manual ack`: 관제 세션(OCC, TOWER)의 `/tick`은 마지막 ack 뒤 `CLAUDE.md`나 `/tick`이 바뀌었는지부터 확인하고, 바뀌었으면 다시 읽는다.
- TAIL ASSIGNMENT, Linear 라벨 `tail:TEAM_X`(처음엔 `lane:TEAM_X`로 나왔고, 2026-10-10까지 별칭으로 읽으며 제외 사유에 바꾸라고 적는다): planner가 그 FLIGHT를 그 팀에만 제안한다. 그 팀이 못 받으면(AIRBORNE, HOLDING, 세션 없음, 다른 AIRPORT) 다른 팀에 주지 않고 사유와 함께 제외한다.
- 상위 이슈(Linear `children`이 있거나 다른 이슈가 `parent`로 지목한 것)를 작업으로 보지 않는다. ASSIGN 제안도, STAND 없이 아무리 오래 ENROUTE여도 RELEASE 제안도, NO CONTACT 경보도 만들지 않는다. 작업은 그 하위 이슈다. 보드 쿼리가 `parent` / `children`을 읽고, DISPATCH 탭의 "제외" 목록에 하위 건수와 함께 뜬다.
- `dispatch note --hold <FLIGHT>`: 본문에만 적혀 있고 `blocks` 관계로는 없는 선행 작업을 DISPATCH 세션이 지정한다. 제안은 DISPATCH 탭의 새 HELD 목록으로 가고, 제안 자신의 FLIGHT는 예약된 채로 남아 planner가 다시 올리지 않으며(AIRCRAFT는 다른 FLIGHT가 쓸 수 있게 놓아 둔다), 보낼 수는 없고, FLIGHT PLAN에 `HOLD — 선행 FLIGHT …` 줄이 들어간다. 지정한 FLIGHT가 모두 끝나면 atc가 그 제안을 SUPERSEDED로 풀어 planner가 다시 후보로 올린다. 값 없는 `--hold`는 선행 FLIGHT 없는 HOLD(사람 결정 대기, 사유는 메모)이고, HOLD 뒤에 FLIGHT가 수정되면 풀린다. HOLD에는 24시간 만료가 없다. 대신 FLIGHT 자체가 Todo가 아니게 되거나 SUPERVISOR가 "HOLD 풀기"(`POST /api/dispatch/proposals/:id/unhold`)를 누르면 닫힌다. 선행 FLIGHT는 열린 FLIGHT 목록에 있는 key여야 하고 제안 자신의 FLIGHT일 수 없다.
- 우선순위가 없는 FLIGHT는 ASSIGN 후보가 아니다. 사람이 아직 언제 할지 정하지 않은 것이라 "제외" 목록에 뜬다.
- DISPATCH 탭의 거절 사유 칩. 거절할 때 사유 목록(상위 이슈, 본문에만 있는 선행 작업, 사람 결정 대기, 이미 진행 중, 우선순위 낮음, 슬롯 없음, 다른 팀이 더 적합, 이미 완료됨) 중 하나를 고르고 메모를 선택으로 덧붙이며, `"<칩> — <메모>"` 형태로 제안의 사유에 저장된다.
- SUPERSEDED 사유가 계획의 제외 사유를 그대로 쓴다. FLIGHT가 상위 이슈·HOLD·라벨·STAND 때문에 빠진 경우 "더 나은 배정으로 바뀜" 대신 그 이유(`HOLD D-0005 — 선행 FLIGHT 대기`)가 남는다.
- DISPATCH 2b 승인 운용. `mode`(`shadow` / `approval`) 뒤에 있고 기본은 꺼짐. approval 모드에서 SUPERVISOR가 DISPATCH 탭에서 제안을 승인·거절하고, DISPATCH는 승인된 ASSIGN을 정해진 FLIGHT PLAN으로 CAPTAIN에게 보내며(`dispatch release`), `READBACK D-xxxx`나 거절을 기록한다. 그 FLIGHT의 STAND가 생기면 atc가 DEPARTED로 바꾼다. 승인·전달·수락된 제안은 AIRCRAFT와 FLIGHT를 예약한다. 탭에 IN FLIGHT 목록(NO READBACK / NO DEPARTURE 표시), 3단계(ATFM) 점검, 확인 창을 거치는 모드 전환이 생겼다.
- `dispatch/send-guard.mjs`: DISPATCH의 SendMessage는 approval 모드에서, SENT 상태인 제안을, 그 CAPTAIN에게, atc가 만든 FLIGHT PLAN 문구 그대로 보낼 때만 통과한다.
- 설정 창에 LINEAR·AGENTS 탭. 새 `GET /api/settings`로 서버 설정을 읽기 전용으로 보여 주고, 비밀 값은 돌려주지 않는다.
  - LINEAR: 연결 상태, 마지막 동기화, API 키 설정 여부, 팀 키, LANDING 상태.
  - AGENTS: 세션 수, 세션 폴더, 점유 hook 설치 여부, TTL과 HANDOFF 기준 시간.
- README에 릴리스 배지.
- 이 변경 기록.

### 변경
- CROSSCHECK mark를 세션의 실제 모델로 확인한다(SUPERVISOR 결정). Claude Desktop은 settings의 model을 따르지 않아 두 세션이 `claude-opus-5-5`로 돌았는데, mark에는 settings `env`의 Muse 이름이 남았다. 이제 `atcctl dispatch|schedule crosscheck`이면 `guard.mjs --crosscheck`가 hook 입력의 `transcript_path`에서 마지막 assistant `message.model`을 읽어 `/muse-spark|gpt-5\.6-terra/i`만 통과시킨다. Claude 모델·DeepSeek, 기록이 없거나 깨졌거나 model이 없으면 막고 "앱에서 모델을 Muse로 바꾸거나 터미널에서 ocx claude로 여세요"라고 안내한다. 통과한 명령은 PreToolUse `updatedInput`으로 앞에 `ATC_CROSSCHECK_MODEL='<실제 모델>'`을 붙여 실행해 mark에 실제 이름이 남는다(ocx는 `claude-ocx-opencode-go--muse-spark-1.3-contributor`, ClaudeRipple·Desktop은 `muse-spark-1.3-contributor`). mark 명령의 `--model`과 이어 쓴 mark 명령은 막고, settings의 `env.ATC_CROSSCHECK_MODEL`은 뺐다. 읽기 명령은 그대로다.
- LANDING SEQUENCE를 Linear 상태 `Ready to Merge`가 아니라 GitHub에 열린 PR로 만든다. vocado의 Linear에는 그 상태가 없어서 대기열이 늘 비어 있었다. GitHub remote가 있는 AIRPORT마다 열린 PR을 읽고(`server/sources/github.ts`: 90초마다 백그라운드로 `gh pr list`, 실패하면 마지막 결과 유지) PR마다 **CLEARED TO LAND**를 따진다(`server/landing.ts`): head 커밋의 체크가 모두 통과, head 커밋에 작성자도 Codex 봇도 아닌 리뷰어의 리뷰(또는 head 뒤 Codex 👍), head에 Codex 지적 없음, CHANGES_REQUESTED 없음, `mergeStateStatus`가 CLEAN·UNSTABLE·HAS_HOOKS, Draft 아님, STAND에 LOSS OF SEPARATION 없음. 아니면 막힌 조건(`draft`, `checks-pending`, `checks-failed`, `no-checks`, `no-review`, `review-stale`, `review-findings`, `changes-requested`, `behind`, `dirty`, `blocked`, `merge-unknown`, `los`)과 한국어 한 줄씩을 붙여 **APPROACH**. 결정 사항은 [docs/occ.md](docs/occ.md) 9절(영어).
  - 스냅샷: `pulls`(열린 PR 전부. FLIGHT, STAND, `landing`, `blocks`, `readyAt`, `createdAt`. CLEARED가 `readyAt` 순으로 먼저, 그다음 APPROACH가 연 순서)와 `github`(`{enabled, error, fetchedAt}`).
  - TOWER 브리핑: `landingQueue`는 Draft가 아닌 PR이고, 항목마다 `seq`(CLEARED 안의 순번), AIRPORT, PR 번호·URL·브랜치·head, STAND와 `holders`, `landing`, `blocks`, `readyAt`, `landClearance`. 브리핑에 `github`도 있다. 이벤트: `landing.requested`, `landing.cleared`(새로), `landing.blocked`(새로: CAPTAIN이 손써야 할 막힘이 생김), `landing.left`. PR(`repo`, `pull`) 단위다. LANDING 이벤트는 양쪽 스냅샷 다 PR을 읽었을 때만 비교하고, GitHub이 실패해도 다른 이벤트는 막지 않는다.
  - TOWER 규정(`controller/CLAUDE.md`, `/tick`): `LAND`는 CLEARED TO LAND PR에만, 번호는 `seq`. APPROACH PR은 `landing.requested`·`landing.blocked` 이벤트에 기다리면 풀리는 것 말고 다른 막힘이 있을 때만 그 STAND의 holders에게 `INFO`로 알리고, 같은 막힘으로 다시 보내지 않으며 서버 재시작 뒤에도 보내지 않는다.
  - Codex의 👍를 head 리뷰로 친다: Codex는 문제가 없는 PR에 리뷰 대신 `+1` 반응만 남기므로, head 커밋의 committer 시각 이후에 Codex 봇이 단 👍는 리뷰 조건을 채운다(이전 head 때부터 남아 있던 👍는 세지 않는다). 반응, head committer 시각, Codex의 PR 댓글은 head에 통과 리뷰가 없거나 Codex 지적이 있는 Draft 아닌 PR에만 읽기 전용 `gh api`로 읽는다. head 뒤 Codex의 마지막 댓글이 "usage limits" 안내면 막힘 문구가 "Codex 한도 — 사람 리뷰 필요"다.
  - Codex 리뷰는 통과로 치지 않는다: Codex는 문제를 찾았을 때만 COMMENTED 리뷰("💡 Codex Review", P1·P2 줄 댓글)를 단다. head에 그 리뷰가 있으면 그 리뷰 뒤에 Codex 👍가 달리거나 사람(Codex·작성자 아님)이 head에 APPROVED할 때까지 `review-findings`("Codex 지적 있음(head sha7) — 반영 후 재리뷰 필요", STRIPS 짧은 이름 "Codex 지적")로 막는다. 지적 전 APPROVED나 사람 COMMENTED로는 풀리지 않는다. TOWER는 다른 손쓸 막힘처럼 CAPTAIN에게 알린다. 사람 리뷰어의 head APPROVED·COMMENTED는 그대로 통과다.
  - 브랜치에 `voc-<n>`이 없는 PR은 제목 끝의 `(VOC-n)`으로 FLIGHT를 찾는다.
  - STRIPS: 맨 위 LANDING SEQUENCE(CLEARED TO LAND는 `readyAt` 순번, APPROACH는 PR마다 막는 조건과 함께 접어서, Draft는 흐리게 접어서. AIRPORT, FLIGHT, `#PR` 링크, STAND를 쥔 팀), STAND 줄 REMARKS의 PR 배지(`CLEARED TO LAND`, CLEARED PR이 둘 이상이면 `SEQ n`. 또는 `APPROACH`와 막는 조건 수, 펼치는 조건 목록), GitHub을 못 읽으면 "GitHub 조회 실패 · PR 상태가 오래됐을 수 있음".
  - 지표의 LANDING 대기는 PR 단위로 센다. 교통량 표본의 `landing`은 Draft가 아닌 PR 수다.
- `ATC_LANDING_STATE` 설정을 없앴다(LINEAR 설정 탭, `PUT /api/settings`의 `landingState`). `.env.local`에 남은 줄은 무시한다.
- CROSSCHECK 기본 모델을 Muse Spark 1.3(`claude-ocx-opencode-go--muse-spark-1.3-contributor[1m]`)으로 바꿨다(SUPERVISOR 결정). GPT-5.6 Terra는 대체 모델로 문서에 남겼다. DeepSeek은 flash-helper와 같은 모델이라 FLEET 규칙상 판정에 쓰지 않는다. Muse가 일부 도구 스키마를 받지 못해 CROSSCHECK 설정에서 `Artifact`도 막고, 세션은 `ocx claude --strict-mcp-config`(MCP 서버 없음; GitHub 읽기는 아직 미정)로 연다. [docs/occ.md](docs/occ.md) "CROSSCHECK" 참고.
- 티켓 없는 작업을 "티켓 없음"·"—" 대신 **AD HOC**으로 표시한다(FLIGHT STRIPS, planner의 HOLDING 사유, 이름 규칙). 티켓이 필요한 일은 OCC의 요청 창구 CHARTER DESK에서 AD HOC FLIGHT가 되고, 이것은 그 짝이다.
- SUPERSEDED 사유가 계획의 제외 목록에 그 FLIGHT가 없을 때도 실제 규칙을 밝힌다: 이미 STAND가 있음, 우선순위 없음, 매핑 밖 프로젝트, 다른 운항사 라벨. planner와 사유 문구가 같은 문구 모음을 써서 서로 어긋나지 않는다.
- TOWER·DISPATCH hook은 `$CLAUDE_PROJECT_DIR` 기준으로 돌고 fail-closed(`… || exit 2`)다. hook이 없거나 실패하면 이제 도구를 통과시키지 않고 막는다.
- FIDS 스플릿 플랩 모션이 실제 안내판처럼 보인다. 판(타일)이 넘어가는 중간에 비지 않는다. 새 글자는 떨어지는 판 뒤에 미리 걸려 있고, 판은 중력처럼 점점 빨라지며 기울수록 어두워진다. 판 없는 글자(TIME, REMARKS, Glass Cockpit·Night Sky 테마)는 반쪽 글자 대신 한 글자씩 떨어져 앉는다. 칸마다 최대 6판이고, 안내판이 더 빨리 멈춘다.

## [0.1.0] — 2026-09-26

첫 릴리스. ✈️ Ready for takeoff.

### 추가

#### 레이더와 화면
- RADAR: 세션 ─ 워크트리 ─ 티켓 3열을 선으로 연결한다. 주인 없는 워크트리와 워크트리 없는 진행 티켓을 강조한다.
- FLIGHT STRIPS: 세션마다 스트립 하나. 상태, 점유한 STAND, 티켓, CLEARANCE를 보여 준다.
- FIDS: DEPARTURES 안내판. 목록이나 비행 단계별 보드로 보고, 글자는 스플릿 플랩으로 넘어간다.
- AIRPORTS: 저장소 등록부. `~/projects` 아래 자동 개설, 4자 코드, 첫 커밋 해시로 식별, 개설·폐쇄·이름 변경·삭제.
- OUTSTATION: 소속 AIRPORT 밖 STAND를 점유한 세션.
- 화면 전체에 항공 용어와 음성 알파벳 콜사인(`TEAM_A` → `ALPHA`).
- 흐르는 ALERT 티커.
- 테마: Radar Console, Glass Cockpit, Night Sky.
- 설정 창: 애니메이션, 시각(UTC / 지역), 밀도(보통 / 촘촘), FIDS 보기와 범위.

#### 점유, HANDOFF, 충돌
- 점유 hook(`hooks/claim.mjs`): 세션마다 어느 linked worktree에서 일하는지 기록하는 Claude Code `PostToolUse` hook. 고친 파일과 명령 위치의 `cd`·`git -C`만 센다. echo 문자열, heredoc, 읽기만 하는 명령은 세지 않는다.
- ESTIMATED TRACK: hook 기록이 없을 때 대화 기록의 도구 호출로 추정한 점유.
- Codex 세션. cwd로 점유를 잡는다.
- 점유 구간으로 판정: HANDOFF, LOSS OF SEPARATION, 잠깐 들름.
- 경보: LOSS OF SEPARATION, NORDO STAND, UNIDENTIFIED, NO CONTACT.

#### 1단계 — CONTROLLER (TOWER)
- `controller/`에서 여는 권한 제한 Claude 세션. 교통 브리핑을 읽고 팀 세션에 CLEARANCE(TRAFFIC, HOLD, CONTINUE, LAND, REPORT, INFO)를 보낸다.
- FLIGHT STRIPS에서 READBACK 추적.
- `atcctl` CLI와 Bash 제한 guard.

#### 1.5단계 — FLIGHT RECORDER와 METRICS
- 이벤트와 5분 교통량 표본을 날짜별로 추가만 하는 기록. 30일 보관.
- METRICS 탭: 충돌, CLEARANCE READBACK 비율과 시간, 머지 대기, 2단계 진입 점검.

#### 2a단계 — DISPATCH (그림자 운용)
- 배정 제안: 어떤 FLIGHT(티켓)를 어떤 AIRCRAFT(팀 세션)에 보낼지. 요소별 점수와 슬롯을 함께 보인다.
- 방치된 작업에 대한 RELEASE 제안.
- `dispatch/`에서 여는 권한 제한 DISPATCH 세션. 제안을 검토하고 메모와 CAUTION을 단다.
- SUPERVISOR가 동의·비동의를 표시하는 DISPATCH 탭. 아직 아무에게도 보내지 않는다.

#### 운용과 문서
- systemd 사용자 서비스(`deploy/atc.service`).
- 루트 README와 모든 폴더의 영어·한국어 문서.
- MIT 라이선스.

[Unreleased]: https://github.com/chaehy5665/atc/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/chaehy5665/atc/releases/tag/v0.1.0
