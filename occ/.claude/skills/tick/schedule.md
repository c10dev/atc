# OCC 절차: SCHEDULE

**한국어** · [English](schedule.en.md)

[`CLAUDE.md`](../../../CLAUDE.md)에서 옮긴 절차다. `/tick` 5·6단계에서 `schedule brief`에 후보·`waypointGaps`나 S2 발부할 것이 있을 때, 그리고 CHARTER REQUEST가 왔을 때 Read한다. 역할과 하지 않는 것은 `CLAUDE.md`가 정한다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `node ../controller/atcctl.mjs schedule draft CLASSIFY <VOC-193> [--type <TYPE>] [--wake <WAKE>] [--rating <RATING>]… -- <근거>` | 분류 라벨 초안. 빠진 축만 적어도 된다. `--rating`은 여러 번 |
| `node ../controller/atcctl.mjs schedule draft PRIORITIZE <VOC-193> --priority <1-4> -- <근거>` | 우선순위 초안. 1 Urgent · 2 High · 3 Medium · 4 Low |
| `node ../controller/atcctl.mjs schedule draft CLOSE <VOC-193> -- <근거>` | 닫기 초안. PR·머지 시각·Fixes 여부는 atc가 LOGBOOK에서 채운다. 발부하지 않는다(SUPERVISOR가 Linear에서 직접 Done) |
| `node ../controller/atcctl.mjs schedule draft NEW --title <제목> --project <프로젝트> [--milestone <마일스톤>] [--gap] [--priority <1-4>] [--type <TYPE>] [--wake <WAKE>] [--rating <RATING>]… [--tail <TEAM_X>] [--parent <FLIGHT>] [--related <FLIGHT>]… [--blocked-by <FLIGHT>]… --reason <근거> -- '<본문>'` | (CHARTER DESK) AD HOC FLIGHT 초안. 본문의 `\n`은 줄바꿈. 출력: 초안 ID와 atc가 찾은 비슷한 FLIGHT(`similar`). `--milestone`은 그 프로젝트의 마일스톤(WAYPOINT) 이름. `--gap`은 WAYPOINT gap 초안 표시로, `--milestone`이 필요하고 비슷한 FLIGHT가 있으면 atc가 받지 않는다 |
| `node ../controller/atcctl.mjs schedule slip-ack [<key>]…` | 보고한 WAYPOINT 지연 경고(`schedule brief`의 `slips`)를 적는다. key가 없으면 지금 fresh 전부. 같은 경고는 다시 fresh가 되지 않고, 풀렸다가 다시 생기면 다시 fresh다 |
| `node ../controller/atcctl.mjs schedule release <S-0001>` | (S2) 승인된 작업을 발부하고 Linear 호출을 `CALL n/m · <도구>`와 JSON 입력으로 출력. 이미 발부됐으면 같은 CALL을 다시 준다 |

## SCHEDULE 초안 (S1, 그림자 운용)

매 바퀴 `schedule brief`의 `candidates`에서 고른다. 후보에는 이미 같은 종류의 열린 초안이 있는 FLIGHT가 빠져 있다. **한 바퀴에 FLIGHT 3개까지**, 하나마다 `dispatch flight <FLIGHT>`로 본문·댓글을 읽고 초안을 쓴다. 근거는 본문·댓글에서 본 사실 한 줄이고 따옴표로 감싼다(`>`·`<`가 따옴표 밖에 있으면 guard가 막는다).

| 후보 | 초안 |
|---|---|
| `candidates.classify`: `type:`이나 `wake:` 라벨이 없음 | `CLASSIFY`. 아래 "CLASSIFY 전에"대로 `../docs/fleet.md` 4.1~4.3을 읽고 TYPE·WAKE·RATING, 근거에 절 번호. 이미 라벨이 있는 축은 비워 둔다 |
| `candidates.prioritize`: 우선순위 없음 | `PRIORITIZE`. **본문·댓글에 근거가 있을 때만**(기한, 장애·보안 노출, 다른 FLIGHT를 막음, 사람이 적어 둔 우선순위). 근거가 없으면 쓰지 않는다 |
| `candidates.close`: PR이 머지됐는데(LOGBOOK ARRIVED, 되돌림 아님) Linear가 Done·Canceled가 아님 | `CLOSE`. 아래 "CLOSE 전에"대로 확인하고, 근거에 PR 번호·머지 시각·`Fixes`인지를 적는다 |

| 축 | 값 (`../docs/fleet.md` 4장) |
|---|---|
| TYPE | `BUILD` 구현하고 PR · `MAINT` 동작이 안 바뀌는 정비·인프라·CI·테스트 · `TEST` 버릴 수도 있는 시험 · `SURVEY` 조사·문서, 코드 없음 · `CHECK` 리뷰·검증, 결과가 판정 · `FERRY` 설계 결정 없는 기계적 이동, 5줄 이하 문서 수정 |
| WAKE | `L` 파일 하나·몇 줄, 1시간 미만 · `M` 기능·수정 하나와 테스트, PR 하나 · `H` 여러 모듈, 마이그레이션·보안 면, 리뷰 여러 번 · `J` 팀·AIRPORT를 넘고 설계가 먼저, 나눠야 함 |
| RATING | `SEC` DB·마이그레이션·RLS·인증·권한·보안·권리·배포·결제 · `UI` 화면·컴포넌트·접근성 · `DATA` 언어 데이터·파이프라인·콘텐츠·분석 · `DOCS` 문서·규칙 파일. 여럿일 수 있다 |


### CLOSE 전에

1. **PR을 확인한다.** `schedule brief`의 `close.<FLIGHT>`에 PR(`pr.url`)·머지 시각(`mergedAt`)·본문 관계(`link`)가 있다. 읽기 전용 `gh pr view <번호> --repo <owner/name> --json state,mergedAt,body`로 머지됐는지와 본문을 한 번 본다.
2. **`Fixes`만 끝낸다.** vocado 규칙상 PR 본문의 `Fixes VOC-n`만 이슈를 끝낸다. `Part of VOC-n`인 PR은 후보에 없다. 본문에 둘 다 없으면(`link: none`) `dispatch flight <FLIGHT>`로 완료 기준을 읽고, 남은 칸이 있어 보이면 쓰지 않는다.
3. **근거 한 줄**: `"PR vocado_nextjs#400 09-26 13:41 머지 · Fixes VOC-193 · 완료 기준 네 칸 모두 PR 범위"`. 되돌림(Revert PR)이 있거나 후속 FLIGHT가 남았다고 적혀 있으면 쓰지 않는다.
4. **상태는 바꾸지 않는다.** CLOSE는 S2에서도 발부되지 않는다(`schedule release`가 거절한다). 승인되면 SUPERVISOR가 Linear에서 직접 Done으로 바꾸고, atc가 다음 읽기에서 초안을 닫는다.

### CLASSIFY 전에

1. **기준을 읽는다.** 그 바퀴에 CLASSIFY를 쓰기 전에 `../docs/fleet.md`를 Read로 열어 4.1 FLIGHT TYPE, 4.2 WAKE CATEGORY, 4.3 TYPE RATING을 읽는다. 위 표는 요약일 뿐이다.
2. **예시를 본다.** `schedule brief`의 `examples`는 SUPERVISOR의 최근 판정이다(`proposed`는 OCC가 냈던 분류, `draft`는 그때 근거, `reason`은 거절 사유). **거절 사유와 같은 실수를 되풀이하지 않는다.** 예: "FLIGHT TYPE은 MAINT — 수정 허용 범위가 tests·CI 게이트뿐, 제품 동작 변경 없음(4.1)", "WAKE는 L — 파일 하나·두 규칙, 새 테스트 없음(4.2)".
3. **FLIGHT TYPE은 이 순서로 정한다**(4.1). 앞에서 맞으면 거기서 멈춘다.

| 순서 | 물음 | 맞으면 |
|---|---|---|
| 1 | 결과가 리뷰·감사의 판정인가 | `CHECK` |
| 2 | 코드 없이 조사·감사·목록·계획 문서만 내는가(구현은 나중이라고 적혀 있음) | `SURVEY` |
| 3 | 버려도 되는 스파이크·시제품인가 | `TEST` |
| 4 | 설계 판단 없는 기계적 이동인가(의존성 올리기, 이름 바꾸기, 5줄 이하 문서 수정) | `FERRY` |
| 5 | **제품 동작이 바뀌지 않는가** — 리팩터, 정리, 인프라, CI·정적 게이트, 테스트, 사용자에게 보이지 않는 경쟁 조건·락 수정(4.1의 예: VOC-195 lock race fix) | `MAINT` |
| 6 | 사용자가 보거나 겪는 기능·동작·화면이 새로 생기거나 바뀌는가 | `BUILD` |

   `BUILD`는 6에서만 붙인다. 보안 면(SEC)이나 테스트가 있다는 것만으로 BUILD가 아니다 — 그건 RATING·WAKE의 일이다.
4. **WAKE는 실제 바뀔 크기로**(4.2): 파일 하나·몇 줄이고 새 테스트가 필요 없으면 `L`, 기능·수정 하나와 테스트·PR 하나면 `M`, 여러 모듈·서비스나 마이그레이션·보안 면·리뷰 여러 번이면 `H`, 팀·AIRPORT를 넘고 설계가 먼저면 `J`. 허용 범위에 테스트 파일이 적혀 있다고 새 테스트가 있는 것은 아니다.
5. **근거에 절 번호를 인용한다.** 근거 한 줄에 판단한 축마다 적용한 절을 적는다: `"4.1 MAINT: 허용 범위가 tests 정적 규칙뿐, 제품 동작 변경 없음 · 4.2 M: 규칙 하나와 테스트 · 4.3 SEC: GRANT EXECUTE 게이트"`.

- `LIMIT`(열린 초안이 한도에 참)이 나오면 이번 바퀴는 초안을 더 쓰지 않는다. 다음 바퀴에 판정이 나서 자리가 비면 이어 쓴다. 열린 `NEW`(CHARTER DESK) 초안도 한도 5건에 든다.
- 오류(`이미 그렇게 되어 있음`, `Todo·Backlog가 아님` 등)가 나면 다시 시도하지 말고 OCC LOG에 적는다.
- 같은 FLIGHT·종류의 초안을 다시 쓰면 앞의 초안은 SUPERSEDED가 된다. 판단이 바뀐 게 아니면 다시 쓰지 않는다.
- 초안은 3일 동안 판정이 없으면 EXPIRED, FLIGHT가 Todo·Backlog를 벗어나거나 Linear에 반영되면 SUPERSEDED가 된다(atc가 한다). CLOSE는 Linear가 Done·Canceled가 되거나 PR이 되돌려지면 SUPERSEDED다.

## SCHEDULE 발부 (S2, `schedule brief`의 `mode`가 approval일 때만)

S2에서는 SUPERVISOR가 SCHEDULE 탭에서 승인한 작업을 OCC가 Linear에 쓴다. 쓰는 내용은 atc가 만들고, OCC는 그대로 옮기기만 한다.

| 상황 (`schedule brief` 위치) | 할 일 |
|---|---|
| `inProgress` 중 `approved` | `node ../controller/atcctl.mjs schedule release <S-xxxx>` → 출력의 `CALL n/m · <도구>` 아래 JSON을 **한 글자도 바꾸지 않고** 그 Linear MCP 도구(`save_issue`, `save_comment`)의 입력으로 넣는다. CALL을 순서대로 모두 |
| `inProgress` 중 `released`(다음 바퀴에도 남음) | Linear에 반영됐는지 atc가 다음 읽기에서 본다. 한 번 더 `schedule release`로 같은 CALL을 받아 빠진 호출만 다시 한다. 이미 통과한 호출은 linear-guard가 `이미 한 번 통과함`으로 막는다(되풀이해도 두 번 쓰지 않게) — 다시 하지 않는다. 그래도 남으면 SUPERVISOR 보고 |
| linear-guard가 막음(`OCC MCP 차단`) | 입력을 고쳐 다시 시도하지 말고 SUPERVISOR 보고 |
| Linear 도구가 오류(라벨 없음 등) | 다시 시도하지 말고 오류 그대로 SUPERVISOR 보고 |

- 발부된 CALL 말고는 Linear에 아무것도 쓰지 않는다. 상태(In Progress 등)·담당은 CAPTAIN 몫이라 CALL에도 없다.
- 승인된 `CLOSE`는 발부하지 않는다. `schedule release`가 `CLOSE는 SUPERVISOR가 Linear에서 직접`으로 거절한다. 다시 시도하지 않는다 — SCHEDULE 탭의 "LINEAR에서 직접 DONE" 목록에 떠 있다.
- `shadow`(S1)면 이 절을 건너뛴다. 승인·거절은 OCC가 하지 않는다.

## WAYPOINT gap (완료 기준에서 NEW 초안, S1 그림자 운용)

배정할 FLIGHT가 모자라면 게이트가 쌓이지 않는다. ROUTE MAP은 WAYPOINT(Linear 마일스톤)마다 완료 기준을 알고 있으니, 덮는 이슈가 없는 기준을 NEW 초안으로 올린다. 매 바퀴 SCHEDULE 초안 뒤에 한다.

1. `schedule brief`의 `waypointGaps`를 읽는다. ROUTE마다 지금 구간 WAYPOINT와 그다음 WAYPOINT가 있고, 각각 완료 기준(`criteria`, 번호 목록이 없으면 `description`)과 그 마일스톤의 이슈(`issues`: key·제목·상태)가 붙어 있다. `null`이면 atc가 마일스톤을 못 읽은 것이니 건너뛴다.
2. 기준마다 덮는 이슈가 있는지 **직접 판단한다**(서버는 짝짓지 않는다). 열린 이슈든 끝난 이슈든 그 기준을 다루면 덮은 것이다. 애매하면 `dispatch flight <FLIGHT>`로 읽는다. `truncated: true`면 빠진 이슈가 있을 수 있으니 그 WAYPOINT는 건너뛴다.
3. 다음 기준은 올리지 않는다.
   - 사람이 정해야 하는 것: "SUPERVISOR decides", "사용자가 정한다", 정책 결정, 사용자 모집·인터뷰처럼 사람 손이 필요한 것.
   - 번호 목록 없이 설명만 있고 확인할 수 있는 결과가 분명하지 않은 것. 설명에 "Exit when …"처럼 구체적인 끝 조건이 있으면 그 문장을 기준으로 삼아도 된다.
4. 덮는 이슈가 없는 기준마다 CHARTER DESK와 같은 방법으로 쓰되, 다음을 지킨다.
   - `--project`에 그 ROUTE, `--milestone`에 그 WAYPOINT 이름, `--gap`을 붙인다.
   - 본문은 네 칸(SEC면 Codex 템플릿)이고, `## 목표`에 그 기준을 `> ` 인용으로 그대로 옮긴다.
   - 근거는 `--reason "WAYPOINT gap: <WAYPOINT> 기준 <번호>. 중복 검색: <waypointGaps 이슈와 보드에서 찾아본 결과>"`.
5. **한 바퀴에 2건까지.** 지금 구간 WAYPOINT의 기준부터 올린다.
6. atc가 `비슷한 FLIGHT가 있어 … 쓰지 않음`으로 거절하면 다시 쓰지 않고 OCC LOG에 그 FLIGHT를 적는다. `LIMIT`이면 이번 바퀴는 멈춘다.

CROSSCHECK는 다른 SCHEDULE 초안처럼 이 초안에도 mark를 단다. S2에서 승인되면 발부 호출에 마일스톤 id가 들어가, 새 이슈가 그 WAYPOINT에 바로 붙는다.

## CHARTER DESK (AD HOC FLIGHT 초안, S1 그림자 운용)

CHARTER DESK는 OCC 안의 요청 창구다. SUPERVISOR가 이 세션에서 직접 한 요청(CHARTER REQUEST)만 받는다. 매 바퀴 할 일이 아니고, 요청이 왔을 때만 한다.

- 요청이 티켓 없이 팀에 바로 줄 만큼 작으면(5줄 이하 수정, 문서 메모 등) AD HOC이 맞다고 SUPERVISOR에게 말한다. OCC는 팀에 보내지 않는다.
- 티켓이 필요한 일이면 AD HOC FLIGHT(새 이슈) 초안을 쓴다. 승인되면 S2부터 Linear Todo(FILED)가 되고, 그 뒤는 여느 FLIGHT처럼 DISPATCH가 배정한다.

| 순서 | 할 일 |
|---|---|
| 1. 중복 검색 | `schedule brief`(열린 초안의 `payload.title`, `flights`)와 `dispatch brief`의 FLIGHT에서 비슷한 것을 찾고, 비슷해 보이면 `dispatch flight <FLIGHT>`로 읽는다. 같은 일이 이미 있으면 초안을 쓰지 않고 그 FLIGHT를 알린다. atc의 FLIGHT 목록은 **최근 45일 안에 바뀐 이슈**(와 그와 이어진 이슈)뿐이라, 그보다 오래 손대지 않은 열린 이슈는 여기서 찾을 수 없다 |
| 2. 본문 | vocado 네 칸: `## 목표`, `## 수정 허용 범위`, `## 금지 사항`, `## 완료 기준`. SEC 작업(DB·마이그레이션·RLS·인증·권한·보안·권리·배포·결제)은 Codex Engineering Task 제목 그대로: `## Outcome`, `## Context`, `## Scope`(`### In scope`, `### Allowed files / surfaces`, `### Out of scope`), `## Forbidden changes`, `## Invariants`, `## Acceptance Criteria`, `## Verification`, `## Risks / Rollback`, `## Review Readiness`. 요청에 없는 범위는 지어내지 않고 "SUPERVISOR 확인 필요"라고 적는다 |
| 3. 분류 | `--type`·`--wake`·`--rating`은 위 분류 기준대로. `--priority`는 요청에 근거가 있을 때만. 맞는 팀이 분명하면(범위가 그 팀의 ROUTE·과거 FLIGHT와 이어지고, SEC면 SEC 자격이 있음) `--tail TEAM_X`를 제안한다. 분명하지 않으면 비운다 |
| 4. 관계 | 선행 작업은 `--blocked-by`, 상위 이슈는 `--parent`, 이어진 일은 `--related`. 모두 FLIGHT 목록에 있는 key |
| 5. 근거 | `--reason "<요청 한 줄 요약>. 중복 검색: <찾아본 것과 결과>"`. "중복 검색:"이 없으면 atc가 받지 않는다 |
| 6. 알림 | 출력의 초안 ID(`S-xxxx`)를 SUPERVISOR에게 알리고 SCHEDULE 탭에서 판정해 달라고 한다. `비슷한 FLIGHT`가 나오면 함께 알린다. `LIMIT`이면 초안을 쓰지 못했다고 알린다(열린 초안 판정이 먼저) |

명령 모양: 여러 단어 값은 큰따옴표, 본문은 작은따옴표 한 덩어리 `-- '## 목표\n…\n## 완료 기준\n…'`. 줄바꿈은 `\n`으로 쓴다(heredoc·리다이렉션은 guard가 막는다). 작은따옴표 안에는 `'`를 쓰지 않고, 큰따옴표 안에는 백틱이나 `$`를 넣지 않는다(셸이 실행한다).

그림자 운용이라 Linear에는 아무것도 쓰지 않는다. 초안 뒤에 같은 제목의 이슈가 Linear에 생기면 atc가 SUPERSEDED로, 3일 동안 판정이 없으면 EXPIRED로 닫는다.
