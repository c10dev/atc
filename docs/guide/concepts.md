# 개념과 용어

화면과 문서의 항공 용어는 영어로 쓴다. 코드 이름은 그대로 둔다.

## 무엇이 무엇인가

| 용어 | 뜻 | 예 |
|---|---|---|
| AIRPORT | 저장소 하나(대문자 4자 코드) | `VCDO` = vocado_nextjs, `ATCC` = atc |
| AIRCRAFT | 팀 세션 하나 | `TEAM_B`, 호출부호 BRAVO |
| REGISTRATION | 팀 세션 이름(바뀌지 않는 식별자) | `TEAM_B` |
| CAPTAIN | 팀 리더 세션 | TEAM_B의 리더 |
| CREW | CAPTAIN 아래 팀원(서브에이전트·팀원 세션) | backend(Opus), ui-builder, ui-qa, flash-helper |
| STAND | git 워크트리 | `vocado-voc-193-…` |
| FLIGHT | Linear 티켓 | `VOC-193`, 화면 표기 `VOC193` |
| AD HOC | 티켓 없는 작업(작은 수정) | STRIPS의 FLIGHT 칸에 `AD HOC` |
| FLEET | 팀 전체 | TEAM_A … TEAM_H |

## AIRCRAFT 상태

| 상태 | 뜻 |
|---|---|
| AIRBORNE | 세션이 일하는 중 |
| HOLDING | 대기 중인데 끝나지 않은 FLIGHT의 STAND를 쥐고 있음 |
| PARKED | 대기 중, 쥔 STAND 없음 — 새 일을 받을 수 있음 |
| NORDO | 세션이 죽었는데 점유가 남음 |
| AOG | FLEET에서 잠시 운항 중지로 둠(배정 안 함) |

## FLIGHT 단계 (Linear 상태)

| 화면 | Linear |
|---|---|
| SCHEDULED | Backlog |
| FILED | Todo |
| ENROUTE | In Progress |
| APPROACH | In Review |
| ARRIVED | Done |

CLEARED TO LAND는 Linear 상태가 아니다. GitHub PR을 보고 atc가 정한다(아래).

LOGBOOK의 ARRIVED는 Linear Done이 아니라 PR 머지로 센다. 머지된 PR 하나가 LOGBOOK 한 줄이다([팀 운영](fleet.md)).

| 용어 | 뜻 |
|---|---|
| LOGBOOK | AIRCRAFT별로 끝낸(ARRIVED) FLIGHT의 기록. TARGETS 실적을 여기서 센다 |
| block time | 팀 소요 시간: STAND를 처음 점유한 시각부터 PR을 연 시각까지 |
| 착륙 대기 | PR을 연 시각부터 머지까지(리뷰·머지 대기). 정시율에 넣지 않는다 |
| ON TIME / DELAYED | block time이 WAKE 기대치(또는 같은 종류의 중앙값) 안인지 |
| FLIGHT FOLLOWING(운항 추적) | 배정된 FLIGHT가 READBACK → DEPARTED → PR → CLEARED → ARRIVED 중 어디까지 왔는지 따라가고, WAKE 기대치의 1.5배를 넘도록 다음 단계가 없거나(지연) Linear 상태와 PR이 어긋나면(불일치) OCC가 SUPERVISOR에게 알린다 |
| REVERTED | 머지 뒤 `Revert "…"` PR로 되돌려진 FLIGHT |
| CHECKRIDE | LOGBOOK 근거로 팀의 TYPE RATING 부여·재검토를 추천하는 것. 부여·회수는 SUPERVISOR가 누른다 |
| AUTOLAND | SUPERVISOR 스위치(`off`·`update`·`merge`) 뒤에서 atc가 CLEARED인데 behind인 PR을 갱신하고, `merge`면 위임된 PR을 머지까지 하는 것(아래 LANDING SEQUENCE) |
| HOLD(착륙 스트립) | SUPERVISOR가 PR에 다는 표시. AUTOLAND가 그 PR을 머지하지 않고, 그 PR이 CLEARED여도 다음 갱신을 막지 않는다 |
| MCC | atc 저장소 자신의 PR을 맡는 관제 세션(docs/mcc.md). INSPECTION(리뷰)하고, 스위치가 켜지면 `auto`·`flagged` PR을 머지하고 7700을 새 코드로 RETURN TO SERVICE한다. 설정 창 AGENTS 탭의 MCC 줄(`shadow` 기본 · `land` · `land+rts`). 지금은 서버 쪽만 있다 |
| GROUND STOP(AUTOLAND) | main의 post-merge `Application Check`가 빨가 AUTOLAND가 멈춘 상태. SUPERVISOR가 설정 창에서 푼다 |

## LANDING SEQUENCE

LANDING은 main 머지다. LANDING SEQUENCE는 GitHub에 열린 PR 중 Draft가 아닌 것의 목록이고(atc가 90초마다 `gh`로 읽는다), PR마다 단계가 둘이다.

| 단계 | 뜻 |
|---|---|
| APPROACH | PR이 열렸지만 아래 조건 중 막힌 것이 있다. 막힌 조건이 한국어 한 줄씩 붙는다 |
| CLEARED TO LAND | 조건을 모두 채웠다. 준비된 순서대로 줄을 서고, TOWER가 이 PR에만 `LAND`로 순번을 준다 |

CLEARED TO LAND 조건 — 모두 PR의 **최신 커밋(head)** 기준이다.

| 조건 | 막히면 |
|---|---|
| Draft가 아님 | `draft` |
| CI 체크가 모두 통과(NEUTRAL·SKIPPED도 통과) | `checks-pending`(진행 중), `checks-failed`(실패), `no-checks`(체크 없음) |
| head 커밋에 PR 작성자도 Codex도 아닌 리뷰어의 리뷰, 또는 head 커밋 뒤에 달린 Codex 👍. head에 Codex 지적이 있으면 그 뒤 Codex 👍나 사람 APPROVED가 있어야 함 | `no-review`(리뷰 없음), `review-stale`(이전 커밋에만 리뷰), `review-findings`(head에 Codex 지적) |
| 변경 요청(CHANGES_REQUESTED)이 남아 있지 않음 | `changes-requested` |
| main에서 벗어나지 않음 | `behind`(rebase 필요), `dirty`(충돌), `blocked`(보호 규칙), `merge-unknown`(GitHub이 계산 중) |
| 그 STAND에 LOSS OF SEPARATION이 없음 | `los` |

- 새로 push하면 head가 바뀌어 CI와 리뷰를 다시 본다. 예전 커밋에서 받은 초록불과 리뷰는 세지 않는다.
- Codex는 큰 문제가 없으면 리뷰 대신 PR에 👍만 남긴다. 이 👍가 head 커밋 시각 뒤에 달렸으면 head 리뷰로 친다. 새 push 전부터 남아 있던 👍는 세지 않는다.
- Codex가 문제를 찾으면 COMMENTED 리뷰("💡 Codex Review", P1·P2 줄 댓글)를 단다. 이것은 통과가 아니라 지적이다. head에 이 리뷰가 있으면 `review-findings`로 막히고, 그 리뷰 뒤에 Codex 👍가 달리거나, 사람(Codex·작성자 아닌 리뷰어)이 지적을 보고 head에 APPROVED해야 풀린다. 지적 전 APPROVED나 사람 COMMENTED로는 풀리지 않는다.
- main을 병합하기만 한 새 head는 이전 커밋의 리뷰를 이어받는다(ATC-31): 그 사이 커밋이 main 병합뿐이고 PR이 바꾼 파일과 내용(blob)이 그대로면, 새 리뷰 없이 CI만 통과하면 CLEARED가 된다. 스트립에 "REVIEW: … (carried from 18700c1, main merge only)"로 보인다. 사람이 쓴 커밋을 더했거나, 병합하며 PR 파일의 충돌을 풀었으면 새 리뷰가 필요하다.
- base가 main이 아닌 PR(쌓인 PR)은 CLEARED가 되지 않고 STACKED로 보인다(ATC-29). 아래 PR부터 main에 들어간 뒤 base를 main으로 바꿔야 착륙할 수 있다. FLIGHT의 PR이 main이 아닌 브랜치에 머지돼 main에 닿지 않으면 STRANDED 경보가 선다.
- 지적에는 P0~P3 배지가 붙는다(표시가 없으면 P2로 본다). head의 지적이 **모두 P3**이고 스레드마다 resolve했거나 답글을 달았으면 막지 않는다(ATC-28). 스트립에 "Codex P3 2건(해결됨) — 착륙 막지 않음"이 뜨고, LAND 글에 남은 P3가 적힌다. P0~P2가 하나라도 있으면 전처럼 막는다.
- 사람(Codex·작성자 아닌 리뷰어)의 COMMENTED 리뷰는 APPROVED처럼 통과로 친다.
- Codex가 한도에 걸리면 "usage limits" 댓글을 단다. 이렇게 head 뒤에 한도 댓글이 있거나 6시간 넘게 Codex가 말이 없으면 CODEX UNAVAILABLE이다. 그때는 착륙 리뷰 세션(REVIEW, DeepSeek V4.1 Flash, tmux `atc-review`)이 diff를 리뷰하고, 현재 head에 P0·P1 없는 pass를 남기면 그것이 리뷰가 된다. 스트립에 "REVIEW: DEEPSEEK (Codex 한도)"로 보인다. 기다리는 동안은 "Codex 한도 · 착륙 리뷰 대기"다. 새 push는 새 리뷰가 필요하고, Codex가 돌아와 리뷰하면 Codex가 이긴다.
- 설정 창 AGENTS 탭의 REVIEW 줄을 deepseek으로 바꾸면(기본 exclude) 아래 보안 규칙에만 걸린 PR도 DeepSeek 리뷰어에게 가고, pass면 착륙한다("REVIEW: DEEPSEEK (보안, Codex 한도)"). `.env`·비밀 경로와 FLIGHT 없는 PR은 어느 경우에도 가지 않는다(ATC-30).
- 외부 모델에 보내지 않는 PR: FLIGHT가 없는 PR, FLIGHT의 `rating:SEC`·Risk: Security·Rights·Contract 라벨, 그리고 라벨이 없어도 보안 diff(`supabase/migrations`·`functions`, `*.sql`, auth·session·admission, RLS·policy, middleware, `.env`·비밀 경로)나 제목·본문의 보안 키워드(security, privilege, RLS, grant, revoke, EXECUTE, definer, admission, auth, ACL, "use server", exposure). 스트립에 "외부 리뷰 제외 — migrations"처럼 뜨고, Codex나 SUPERVISOR 리뷰를 기다린다. 외부 리뷰의 pass가 이미 있어도 착륙 근거가 되지 않는다.
- PR 브랜치에 `voc-<번호>`가 없으면 PR 제목 끝의 `(VOC-번호)`로 FLIGHT를 찾는다.
- **AUTOLAND**(ATC-34, 기본 꺼짐): SUPERVISOR가 설정 창에서 켜면 atc가 착륙의 기계 일을 한다. `update`는 `behind`만 남은 CLEARED PR을 GitHub Update branch로 갱신한다(LANDING SEQUENCE 순서로 AIRPORT마다 하나씩, CI가 통과하면 ATC-31 덕에 다시 CLEARED). HOLD하지 않은 CLEARED PR이 있으면 그것이 머지될 때까지 다음 갱신을 기다린다. 갱신한 head에 리뷰가 이어지지 않으면(main에서 PR 파일이 바뀜) atc가 그 head에 `@codex review`를 한 번 달고, Codex가 한도이거나 30분 동안 답이 없으면 곧바로 REVIEW(DeepSeek)에 넘긴다(외부 리뷰 제외 PR은 SUPERVISOR 리뷰, ATC-38). `merge`는 위임된 PR(HOLD, FLIGHT 없음, `rating:SEC`·Risk 라벨, 보안 경로·키워드, Human Preview 미통과가 아닌 PR)을 정확한 head로 머지까지 한다. main의 post-merge `Application Check`가 빨가면 GROUND STOP으로 두 모드가 멈추고, SUPERVISOR가 풀어야 다시 돈다.
- 판정 이유는 저장소의 `docs/occ.ko.md` 9.1절.

## 충돌과 인계

- **LOSS OF SEPARATION**: 살아 있는 두 세션이 같은 STAND를 5분 넘게 겹쳐 건드림 — 경보.
- **HANDOFF**: 앞 세션이 손을 떼고 뒤 세션이 이어받음 — 경보 아님.
- **OUTSTATION**: 자기 AIRPORT가 아닌 저장소의 STAND에서 일하는 중.

## FLIGHT 분류

티켓의 Linear 라벨로 분류하고, DISPATCH planner가 쓴다.

| 축 | 라벨 | 값 |
|---|---|---|
| FLIGHT TYPE | `type` 그룹 | BUILD(구현) · MAINT(정비) · TEST(시험) · SURVEY(리서치) · CHECK(리뷰) · FERRY(기계적 수정) |
| WAKE CATEGORY | `wake` 그룹 | L(1시간 이내) · M(몇 시간) · H(1~2일) · J(여러 날, 나눠야 함) |
| TYPE RATING | `rating:` 또는 Risk 그룹 | SEC(보안·DB·권리) · UI · DATA · DOCS |
| TAIL ASSIGNMENT | `tail:TEAM_X` | 이 팀에만 제안 |

라벨이 없으면 BUILD · M로 본다. 자세한 규칙은 저장소의 `docs/fleet.ko.md`.

## 교신

| 용어 | 뜻 |
|---|---|
| CLEARANCE | TOWER가 팀에 보내는 지시(`[ATC C-0007]`) |
| FLIGHT PLAN | OCC가 승인된 배정을 CAPTAIN에게 보내는 문구(`[DISPATCH D-0003]`, 2b부터). DIRECT 지시서다 |
| DIRECT | 목표, 완료 기준, 이 작업만의 제약, "끝까지 한 번에"만 담은 지시서. `BRIEF: DIRECT` 줄이 있다 |
| VECTORS | 지금까지의 지시서: 번호 붙은 구현 단계, 전체 템플릿, 방향마다 묻기. `BRIEF: DIRECT`가 없으면 VECTORS로 센다 |
| SOLO | CAPTAIN이 직접 구현한 FLIGHT. 서브에이전트는 조사·리뷰·문서만 도왔다 |
| CREW | 구현을 팀원에게 나눈 FLIGHT. 서브에이전트가 STAND에 코드를 썼다 |
| PILOT'S DISCRETION | DIRECT FLIGHT 안에서 흔한 애매함은 팀이 기본값을 골라 PR에 적고 계속 간다. SUPERVISOR 결정(guard, 기록 형식, 승인 게이트)만 묻는다 |
| READBACK | 받았다는 확인(`READBACK C-0007`) |
| HOLD | 선행 작업이나 사람 결정을 기다리게 잡아 둔 제안 |
| CROSSCHECK | 사용자가 판정하기 전에 OCC와 다른 계열 모델이 달아 두는 예비 판정(agree/disagree + 이유). 참고 표시라 상태를 바꾸지 않는다 |
