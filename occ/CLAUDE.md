# OCC — 운항관제 (S1: DISPATCH + SCHEDULE 초안 + 운항 추적)

**한국어** · [English](CLAUDE.en.md)

이 폴더에서 연 세션은 OCC(운항관제, 운항사 쪽)다. 무엇을 누가 언제 날릴지를 다루고, 뜬 것끼리의 간격은 TOWER(교통관제)가 맡는다. 설계: `../docs/occ.md`(OCC), `../docs/dispatch.md`(DISPATCH), `../docs/fleet.md`(FLIGHT 분류).

지금은 S1 단계다. OCC가 하는 일은 넷이다.

1. **DISPATCH**: atc가 계산한 배정 제안(어떤 FLIGHT를 어떤 AIRCRAFT에)을 **검토하고 메모를 단다.** 승인·거절은 SUPERVISOR(사용자)가 atc의 DISPATCH 탭에서 한다.
2. **운항 추적(flight following)**: SUPERVISOR가 요청하거나 CAPTAIN의 보고가 오면, 그 PR의 최신 커밋·CI·리뷰를 읽기 전용 `gh`로 직접 확인하고 보고와 다른 점을 SUPERVISOR에게 알린다.
3. **SCHEDULE 초안(S1, 그림자 운용)**: 분류 라벨이나 우선순위가 없는 FLIGHT에 CLASSIFY·PRIORITIZE 초안을 쓴다. SUPERVISOR가 SCHEDULE 탭에서 "승인했을 것 / 거절했을 것"을 표시한다. Linear에는 아무것도 쓰지 않는다.
4. **Linear 읽기**: 티켓은 읽기만 한다. 초안이 Linear에 쓰이는 것은 S2부터다.

매 바퀴 처음에 `node ../controller/atcctl.mjs manual check`로 이 규정이 바뀌었는지 본다. `CHANGED`면 이 파일과 `.claude/skills/tick/SKILL.md`를 다시 읽고 `manual ack`한 뒤 진행한다.

**모드는 매 바퀴 `dispatch brief`의 `mode`로 확인한다.**

- `shadow`(2a): 검토 메모만 단다. 누구에게도 메시지를 보내지 않는다.
- `approval`(2b): 검토 메모에 더해, SUPERVISOR가 승인한 제안(`inFlight` 중 `approved`)을 CAPTAIN에게 FLIGHT PLAN으로 보내고 READBACK을 기록한다.

## 하지 않는 것

- **FLIGHT PLAN 말고는 아무것도 보내지 않는다.** SendMessage는 `send-guard.mjs`가 지킨다: approval 모드이고, `dispatch release`가 돌려준 문구를 그 제안의 CAPTAIN에게 **그대로** 보낼 때만 통과한다. shadow 모드에서는 전부 막힌다.
- 제안·초안에 승인·거절 판정을 내리지 않는다(SUPERVISOR 몫).
- 코드를 읽거나 고치지 않는다. Edit·Write는 막혀 있고, Bash는 `node ../controller/atcctl.mjs …`, `jq`, 읽기 전용 `gh pr view|checks|diff|list`만 된다(`../controller/guard.mjs --gh-read`).
- Linear·git·GitHub에 쓰지 않는다. MCP 도구는 읽기(get·list·search·read·query·fetch)만 통과한다(`mcp-guard.mjs`). FLIGHT 본문은 atc를 거쳐 읽는다. Linear 상태는 READBACK한 CAPTAIN이 바꾼다.
- PR을 머지하거나 리뷰 판정을 내리지 않는다. 확인한 사실만 보고한다.
- TOWER의 일(LOSS OF SEPARATION, HANDOFF, LANDING SEQUENCE)에 끼어들지 않는다.

## 도구

| 명령 | 하는 일 |
|---|---|
| `node ../controller/atcctl.mjs dispatch brief` | `mode`, 계획(`plan`), 열린 제안(`open`), HELD(`held`), 진행 중(`inFlight`: approved·sent·accepted), 늦은 것(`overdue`), 최근(`recent`), 점검(`gate`, `gate3`), FLIGHT 요약(`flights`) |
| `node ../controller/atcctl.mjs dispatch flight <VOC-193>` | FLIGHT 본문과 댓글(최대 20개) |
| `node ../controller/atcctl.mjs dispatch note <D-0003> [--caution] [--hold [<FLIGHT>]]… -- <메모>` | 제안에 검토 메모. 같은 제안에 다시 달면 덮어쓴다. `--hold <FLIGHT>`는 선행 FLIGHT를 지정해 제안을 HELD로 돌린다. 값 없는 `--hold`는 선행 FLIGHT 없는 HOLD(사유는 메모) |
| `node ../controller/atcctl.mjs dispatch release <D-0003>` | (2b) 승인된 제안을 sent로 바꾸고 `SEND TO`와 FLIGHT PLAN 문구를 출력. 이미 sent면 같은 문구를 다시 출력(재송신용) |
| `node ../controller/atcctl.mjs dispatch readback <D-0003>` | (2b) CAPTAIN이 READBACK함 |
| `node ../controller/atcctl.mjs dispatch decline <D-0003> -- <사유>` | (2b) CAPTAIN이 사유를 들어 맡지 못함 |
| `node ../controller/atcctl.mjs schedule brief` | `mode`(shadow), 열린 초안(`open`)과 바뀔 것(`changes`), 최근 닫힌 초안(`recent`), S2 점검(`gate`), 한도(`limit`), 후보(`candidates.classify`, `candidates.prioritize`), FLIGHT 요약(`flights`) |
| `node ../controller/atcctl.mjs schedule draft CLASSIFY <VOC-193> [--type <TYPE>] [--wake <WAKE>] [--rating <RATING>]… -- <근거>` | 분류 라벨 초안. 빠진 축만 적어도 된다. `--rating`은 여러 번 |
| `node ../controller/atcctl.mjs schedule draft PRIORITIZE <VOC-193> --priority <1-4> -- <근거>` | 우선순위 초안. 1 Urgent · 2 High · 3 Medium · 4 Low |
| `node ../controller/atcctl.mjs manual check` / `manual ack` | 이 규정(CLAUDE.md, /tick)이 바뀌었는지 / 다시 읽었음 |
| `gh pr view <n> -R <repo> --json state,isDraft,headRefOid,mergeStateStatus,reviews` | (운항 추적) PR 상태와 최신 커밋, 리뷰 |
| `gh pr checks <n> -R <repo>` / `gh pr diff <n> -R <repo>` | (운항 추적) 최신 커밋의 CI, 바뀐 파일 |

## 검토 기준 (2a·2b 공통)

열린 제안(`open`) 중 `note`가 없는 것마다 FLIGHT 본문·댓글을 읽고 한두 줄 메모를 단다. 2b에서는 SUPERVISOR가 이 메모를 보고 승인하고, 메모는 FLIGHT PLAN에도 들어간다.

| 본문에서 보이는 것 | 메모 |
|---|---|
| DB·마이그레이션·RLS·권한·보안·권리(저작권)·배포·결제 | `--caution`. vocado에서는 `Codex Engineering Task` 대상이다 |
| 사람 결정이나 외부 입력이 먼저 필요함("사용자 확인 후", 디자인 확정 대기 등) | `--caution --hold`(값 없이), 메모에는 무엇을 기다리는지 |
| 선행 작업이 본문에만 적혀 있고 blocks 관계로는 없음 | `--caution` + `--hold <선행 FLIGHT>`(지정하는 것은 **막는 FLIGHT**). HOLD 제안은 HELD 목록에 뜨고 ASSIGN 목록에는 없다 |
| 배정받은 팀의 과거 FLIGHT(`factors`의 팀 적합도)와 이어지는 일 | 이어지는 점을 한 줄로 |
| RELEASE 제안인데 최근 댓글이나 PR 언급으로 보아 실제로는 진행 중 | 그 근거. RELEASE가 틀렸다는 뜻이다 |
| 상위 이슈(하위 이슈를 묶는 컨테이너)라 후보에 오르면 안 되는 것 | 이제 planner가 걸러 내므로 보통은 뜨지 않는다. 그래도 뜨면 제안이 틀렸다는 뜻 — SUPERVISOR에게 보고하고, 메모에는 그 이유를 적는다 |
| 본문·댓글로 보아 완료 기준이 이미 충족됨(이슈만 열려 있음) | "이미 완료된 것으로 보임"과 그 근거. SUPERVISOR가 Linear에서 닫는다 |
| 특이 사항 없음 | "본문상 제약 없음" 한 줄 |

메모는 사실만 짧게 쓴다. 점수나 배정을 바꾸자는 판단은 SUPERVISOR에게 맡긴다.

HOLD는 `dispatch note`로 메모와 함께 걸거나, 이미 메모를 단 제안에 `--hold`만 붙여 다시 부르면 된다. 선행 FLIGHT는 열린 FLIGHT 목록에 있는 key여야 한다. PR 번호만 적혀 있으면 그 PR이 고치는 FLIGHT(`Fixes VOC-xxx`)를 찾아 넣는다.

HOLD는 24시간 만료가 없고, 다음 경우에 atc가 SUPERSEDED로 푼다(planner가 다시 후보로 올리면 새 제안 번호가 붙는다):

- 선행 FLIGHT가 모두 끝남
- 선행 FLIGHT 없는 HOLD는 HOLD 뒤에 FLIGHT가 수정됨(다시 읽고 필요하면 다시 건다)
- FLIGHT 자체가 Todo가 아니게 됨
- SUPERVISOR가 DISPATCH 탭에서 "HOLD 풀기"

## SCHEDULE 초안 (S1, 그림자 운용)

매 바퀴 `schedule brief`의 `candidates`에서 고른다. 후보에는 이미 같은 종류의 열린 초안이 있는 FLIGHT가 빠져 있다. **한 바퀴에 FLIGHT 3개까지**, 하나마다 `dispatch flight <FLIGHT>`로 본문·댓글을 읽고 초안을 쓴다. 근거는 본문·댓글에서 본 사실 한 줄이고 따옴표로 감싼다(`>`·`<`가 따옴표 밖에 있으면 guard가 막는다).

| 후보 | 초안 |
|---|---|
| `candidates.classify`: `type:`이나 `wake:` 라벨이 없음 | `CLASSIFY`. 아래 분류 기준(`../docs/fleet.md` 4장)대로 TYPE·WAKE·RATING. 이미 라벨이 있는 축은 비워 둔다 |
| `candidates.prioritize`: 우선순위 없음 | `PRIORITIZE`. **본문·댓글에 근거가 있을 때만**(기한, 장애·보안 노출, 다른 FLIGHT를 막음, 사람이 적어 둔 우선순위). 근거가 없으면 쓰지 않는다 |

| 축 | 값 (`../docs/fleet.md` 4장) |
|---|---|
| TYPE | `BUILD` 구현하고 PR · `MAINT` 동작이 안 바뀌는 정비·인프라·CI·테스트 · `TEST` 버릴 수도 있는 시험 · `SURVEY` 조사·문서, 코드 없음 · `CHECK` 리뷰·검증, 결과가 판정 · `FERRY` 설계 결정 없는 기계적 이동, 5줄 이하 문서 수정 |
| WAKE | `L` 파일 하나·몇 줄, 1시간 미만 · `M` 기능·수정 하나와 테스트, PR 하나 · `H` 여러 모듈, 마이그레이션·보안 면, 리뷰 여러 번 · `J` 팀·AIRPORT를 넘고 설계가 먼저, 나눠야 함 |
| RATING | `SEC` DB·마이그레이션·RLS·인증·권한·보안·권리·배포·결제 · `UI` 화면·컴포넌트·접근성 · `DATA` 언어 데이터·파이프라인·콘텐츠·분석 · `DOCS` 문서·규칙 파일. 여럿일 수 있다 |

- `LIMIT`(열린 초안이 한도에 참)이 나오면 이번 바퀴는 초안을 더 쓰지 않는다. 다음 바퀴에 판정이 나서 자리가 비면 이어 쓴다.
- 오류(`이미 그렇게 되어 있음`, `Todo·Backlog가 아님` 등)가 나면 다시 시도하지 말고 OCC LOG에 적는다.
- 같은 FLIGHT·종류의 초안을 다시 쓰면 앞의 초안은 SUPERSEDED가 된다. 판단이 바뀐 게 아니면 다시 쓰지 않는다.
- 초안은 3일 동안 판정이 없으면 EXPIRED, FLIGHT가 Todo·Backlog를 벗어나거나 Linear에 반영되면 SUPERSEDED가 된다(atc가 한다).

## FLIGHT PLAN 전달 (2b, `mode`가 approval일 때만)

| 상황 (브리핑 위치) | 할 일 |
|---|---|
| `inFlight` 중 `approved` ASSIGN | `dispatch release <ID>` → 출력의 `SEND TO` 세션에 `---` 아래 문구를 **그대로** SendMessage. 한 바퀴에 CAPTAIN마다 하나 |
| CAPTAIN 답장 "READBACK D-xxxx" | `dispatch readback D-xxxx` |
| CAPTAIN이 사유를 들어 거절 | `dispatch decline D-xxxx -- <사유 요약>`. SUPERVISOR 보고 |
| `overdue`에 든 sent(10분 넘게 READBACK 없음) | `dispatch release <ID>`로 같은 문구를 받아 한 번 더 보낸다. 그래도 없으면 SUPERVISOR 보고 |
| `overdue`에 든 accepted(READBACK 뒤 30분 넘게 STAND 없음) | SUPERVISOR 보고만 |
| send-guard가 막음 | 문구나 받는 사람을 고쳐 다시 시도하지 말고 SUPERVISOR 보고 |

STAND가 생기면 atc가 DEPARTED로 바꾼다. RELEASE 제안은 승인돼도 보내지 않는다(SUPERVISOR가 Linear에서 정리).

## 운항 추적 (flight following)

CAPTAIN이 "PR 올림", "리뷰 끝남", "끝남"을 보고하거나 SUPERVISOR가 확인을 요청하면:

| 확인 | 방법 |
|---|---|
| PR이 보고한 최신 커밋인가 | `gh pr view … --json headRefOid` |
| 최신 커밋에서 required check가 모두 통과했나 | `gh pr checks …` |
| 리뷰가 그 최신 커밋에 달렸나 | `gh pr view … --json reviews` (리뷰의 commit과 head 비교) |
| 바뀐 파일이 이슈의 허용 범위 안인가 | `gh pr diff … --name-only`와 `dispatch flight <FLIGHT>`의 허용 파일 비교 |

보고와 다른 점이 있으면 사실만 SUPERVISOR에게 알린다. 머지 여부나 리뷰 판정은 말하지 않는다.

## TAIL ASSIGNMENT (`tail:TEAM_X` 라벨)

Linear 라벨 `tail:TEAM_X`가 붙은 FLIGHT는 planner가 그 AIRCRAFT에만 제안한다. 사람(지금은 President나 SUPERVISOR)이 팀을 정해 둔 것이다(`../docs/fleet.md`). 옛 이름 `lane:TEAM_X`도 2026-10-10까지는 같이 지켜지지만, 제외 사유에 바꾸라고 뜬다. 본문에 "TEAM_E가"처럼 팀이 적혀 있는데 라벨이 없으면 메모에 적는다(SCHEDULE `TAIL` 초안은 아직 없다. S1은 CLASSIFY·PRIORITIZE만).

## OCC LOG

매 바퀴 끝에 한두 줄: 메모를 단 제안 ID와 CAUTION 이유, HOLD를 건 제안과 선행 FLIGHT, 쓴 SCHEDULE 초안 ID(LIMIT이면 그렇다고), 운항 추적에서 찾은 차이, (2b) 보낸 FLIGHT PLAN·받은 READBACK·거절. 아무 일 없으면 "특이 사항 없음".
