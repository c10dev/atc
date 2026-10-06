# ALERTING: SUPERVISOR의 주의를 끄는 것과 그것이 가는 곳

[English](alerting.md) · **한국어**

Status (2026-10-03): [layout.md](layout.md)로 **대체됨(superseded)**. 만든 것은 A1([ATC-197](https://linear.app/vocado/issue/ATC-197))뿐이다. 상위 [ATC-195](https://linear.app/vocado/issue/ATC-195/alerting-split-bell-into-master-attention-alerts-conditions-queue)는 2026-10-03에 닫았다. 나머지 계획은 취소하거나 대체했다. 본문(영어판)은 설계 기록과 A1이 서버에 남긴 것의 기록으로 남겨 둔다. SUPERVISOR의 결정은 영어판 7절에 있다. 이 한국어판은 상태만 옮겼고, 본문은 영어판을 본다.

- **만든 것:**
  - **A1**(ATC-197): `supervisorAlertsOf`의 모든 항목에 `destOf`와 `dest`, 그리고 조건 항목 셋 `rts|halted`, `control|down|<session>`, `reposition|stuck|<aircraft>`(영어판 "A1 as built"). 서버는 `dest`를 그대로 두고 HOME이 읽는다.
  - **ATC-327**(오래 가는 PENDING 승인)은 이 계획의 일이 아니고 만든 그대로 둔다.
- **살려 둔 것:** **A1b**([ATC-203](https://linear.app/vocado/issue/ATC-203))는 `control|down`을 어떤 원인이든 잡도록 넓히고 `host|memory`를 더한다. ATC-195 아래에서 만들지 않았다. 독립 FLIGHT이고 2026-10-03에 발권했다. "as built" 기록은 이 문서가 아니라 그 PR에 남긴다.
- **취소한 것:** **A3–A7**(ATC-198·199·200·201·202): MASTER 등, 헤더의 QUEUE·LOG 표시, 목적지별 알림, summary v2, atc-app 변경.
- **A2와 A8:** 이슈로 만든 적 없고(ATC-195 하위는 197~203뿐), 계획하지 않는다.
  - **A2**(Q1과 A1이 원천 공유): Q1([ATC-194](https://linear.app/vocado/issue/ATC-194))이 2026-09-30에 따로 끝났고 HOME이 그것을 읽는다.
  - **A8**(가이드 재작성): 레이아웃 개편 PR들이 화면마다 가이드를 함께 고친다.
- **layout.md로 대체한 것:**
  - **QUEUE와 ALERTS**는 HOME(`#home`)의 구역이다. 거기의 ALERTS는 `dest`가 `alerts`인 WARNING·CAUTION 항목이다.
  - **헤더 벨**은 사이드바 헤더의 알림 아이콘으로 옮겼다([ATC-447](https://linear.app/vocado/issue/ATC-447)). 출처(Linear, GitHub, atc)별로 묶는다.
  - **MASTER, LOG 팝오버, 숫자 둘의 탭 제목, summary v2**는 계획하지 않는다. summary는 `counts`와 `pending`을 그대로 둔다.
- **여전히 맞는 것:** 2절의 원칙 1–6과 8([design-language.md](design-language.md)에 모았다), 3.1의 목적지 표, 7절의 결정.

### 닫힌 FLIGHT와 남은 STAND, 만든 것(ATC-543)

- **닫힌 FLIGHT는 조용하다.** Linear 상태가 Done·Canceled·Duplicate인 FLIGHT는 `no-pr`·`no-arrival`·`no-departure`·`review-no-pr`·`stranded` 줄도, ORPHAN FLIGHT도 내지 않는다(`server/following.ts`의 닫힌 FLIGHT 거름이 이제 `stranded`도 뺀다. 나머지는 ATC-385가 이미 뺐다). `done-not-merged`와 `merged-not-done`은 제 뜻 그대로다.
- **정리 줄 하나.** `alert|cleanup`이 닫힌 FLIGHT의 남은 STAND(살아 있는 세션이 쥐지 않고 본 체크아웃이 아닌 것)를 오래 주인 없는 변경·종료된 세션의 점유와 함께 싣는다. STAND마다 경로, 변경 수, 미푸시 커밋 수(`git rev-list --count HEAD --not --remotes`)를 보인다. `git -C <체크아웃> worktree remove <경로>` 명령은 둘 다 0일 때만 보이고, 아니면 지우면 잃는 것을 적는다. atc는 이 명령을 실행하지 않는다. 순수 부분은 `server/cleanup-stands.ts`다.
- **쓸모없어진 DECISION 카드.** FLIGHT가 닫혔거나 PR이 머지·닫힌(GitHub를 읽었을 때) DECISION은 SUPERVISOR QUEUE에서 빠진다. 규칙은 ATC-540의 `isMoot`다. 카드를 답하거나 거두지 않는다: 기록은 그대로이고 role은 여전히 거둘 수 있다. DECISION 카드에는 원래 알림 줄이 없어서 알림 목록에서 뺄 것은 없다.


### 관제 세션은 턴을 끝낸다, CLEARANCE MOOT (ATC-515)

- **WARNING은 SUPERVISOR가 할 일이 있다는 뜻이다.** TOWER·MCC 매뉴얼에 이제 팀의 READBACK·UNABLE·STANDBY를 기다리는 것도, SUPERVISOR가 `user` 등급이나 ESCALATE한 PR을 머지하기를 기다리는 것도 멈출 이유가 아니라고 적혀 있다: ATC LOG·MCC LOG 한 줄을 쓰고 job을 `working`/`idle`로 둔 채 턴을 끝낸다. 매뉴얼의 모든 "SUPERVISOR에게 보고"는 LOG 보고다. K1–K3 결정만 묻는다(TOWER·OCC는 DECISION 카드, MCC는 `mcc escalate`). `CONTROL_BLOCKED_NEXT`와 `blockedAlerts`는 그대로다: `blocked`인 관제 job은 MCC도 여전히 규칙 위반을 낸다.
- **CLEARANCE MOOT.** `server/clearance-moot.ts`(순수)가 열려 있고(READBACK·ROGER·UNABLE·취소 없음) FLIGHT의 PR이 하나 이상이며 모두 머지됐거나 닫힌 CLEARANCE를 고른다. CLEARANCE에는 PR 번호가 없어 FLIGHT가 고리다. FLIGHT가 없거나 PR이 아직 없는 것, 가장 늦은 머지 뒤에 나간 것(후속 일일 수 있다), 머지 시각을 모르는 FLIGHT의 것은 고르지 않는다. tick 브리핑이 `clearances.moot`로 싣고 TOWER가 `atcctl cancel`을 직접 낸다(서버는 취소하지 않는다). 열린·머지된 PR은 스냅샷·LOGBOOK·stranded 머지에서 읽는다. 머지 없이 닫힌 PR은 atc가 기록하지 않아 그런 FLIGHT는 고르지 않는다.
- **스위치.** SUPERVISOR 전용 `CLEARANCE MOOT`(설정 창, `clearance-moot.json`, 기본 on). off면 브리핑에 아무것도 없고 셈도 움직이지 않는다. 매뉴얼 문구는 스위치와 상관없다.
- **MISFIRE.** 1분 일 `clearance-moot`이 올린 CLEARANCE를 id로 기록한다(`clearance-moot-events.jsonl`, 브리핑 경로는 읽기만 한다). 취소된 것은 같은 FLIGHT에 취소 뒤 24시간 안에 새 CLEARANCE가 나가거나, 올릴 때 그 FLIGHT에 있던 PR이 다시 열리면 MISFIRE 하나로 센다. `GET /api/clearance-moot`이 스위치와 수(올림·취소·MISFIRE)를 보여 준다.

### 닫혔거나 밀린 부름에 온 답은 거절한다 (ATC-554)

- **검사가 있는 곳.** 서버, 팀의 답을 기록하는 길이다. 답이 "답한 것"으로 세어지는 곳이 거기라서다. 답하는 쪽에는 검사가 없다: 팀 CAPTAIN은 `SendMessage`로 답하고 TOWER·OCC가 `atcctl`(`readback`·`unable`·`standby`·`dispatch …`·`crew-change …`)로 기록한다. guard 파일과 hook은 건드리지 않아 guard의 fail-closed는 그대로다. 파일: `server/stale-reply.ts`(순수 규칙), `server/stale-reply-run.ts`(스위치·기록·`GET /api/stale-reply`), `server/switches/stale-reply.ts`(선언), 그리고 `POST /api/clearances/:id/{readback,roger,unable,standby}`(`server/controller.ts`), `POST /api/dispatch/proposals/:id/{accept,decline,standby,await-supervisor}`(`server/proposals.ts`), `POST /api/fleet/crew-changes/:id/{readback,unable,standby}`(`server/crew-change.ts`) 맨 앞의 호출 한 줄.
- **규칙.** 같은 주제로 뒤에 나간 부름이 있으면 그 부름은 밀린 것이다: CLEARANCE는 따르라는 것(W/U: INFO·TRAFFIC·REPORT가 아니고 FLIGHT가 있다)만, 같은 세션·같은 종류·같은 FLIGHT·같은 STAND·글에 든 PR 번호가 같을 때(같은 FLIGHT의 다른 PR에 나간 FIX는 다른 주제다. 알림과 FLIGHT 없는 CLEARANCE는 거절하지 않는다), FLIGHT PLAN은(보낸 것만) 같은 FLIGHT·같은 종류, CREW CHANGE는(보낸 것만) 같은 REGISTRATION. 밀린 id에 온 답은 409 `C-0001 is closed or superseded by a later call for the same subject — answer the latest call C-0002`. 최신 id에 온 답은 전처럼 받는다(닫힌 최신 부름에 다시 온 READBACK 포함). 없는 id는 그대로 404. RECALL의 답(`recalled`)과 TOWER의 `cancel`·`undeliverable`은 검사하지 않는다.
- **스위치.** SUPERVISOR 전용 `STALE REPLY`(설정 창, `stale-reply.json`, 기본 on, `atcctl` 명령 없음). off면 모든 답을 전처럼 받고 셈도 하지 않는다.
- **셈.** 거절마다 `stale-reply-events.jsonl`에 한 줄(종류·id·동작·최신 id)을 더한다. 설정 창 블록이 최근 7일의 거절 수를 종류별로 보여 주어 틀린 거절이 보인다. 기록을 못 써도 답은 통과시키지 않는다. 못 쓴 줄은 메모리에 남아 다음 거절 때 다시 쓰고 그 사이에도 센다. 실패는 error로 남는다. 409가 오면 어떻게 하는지는 TOWER·OCC 매뉴얼에 있다.

### QUEUE 계약(ATC-546)

SUPERVISOR QUEUE의 모든 종류와 HOME에 닿는 모든 알림은 한 표(`server/queue-contract.ts`)에 두 가지를 선언한다. **`ends`**: 스스로 사라지는 조건(말로, 구현한 함수 포함). **`action`**: SUPERVISOR가 HOME에서 누르는 것(`approve`, `brake`, `hand`, `answer`, `open`, `done`)과, 그 동작이 HOME 화면에서만 되는지(`screenOnly`). `QUEUE_CONTRACT`는 `QUEUE_KINDS` 값마다 한 줄, `ALERT_CONTRACT`는 HOME에 닿는 알림 key 종류마다 한 줄(`alert|…`, `following|…`, `control|…`, `rts|halted` …)이고, 닿지 않는 key 앞마디는 `ALERT_NOT_ON_HOME`이 이유를 적는다.

**QUEUE 종류나 HOME 알림을 더하면 줄을 더한다.** `server/queue-contract.test.ts`가 줄 없는 종류, `supervisorQueueOf`가 만든 시험 줄이 선언한 동작을 그리지 않는 것(`homeControlOf`, `web/src/home-rows.ts`: HOME의 열린 줄이 쓰는 같은 함수), `open` 단추가 `#home` 자신을 가리키는 것(ATC-541의 고리)을 실패로 막는다. 줄의 `gap` 칸은 알려진 어긋남(선언한 동작이 아직 HOME에 그려지지 않음)이고, 시험이 그 어긋남이 아직 사실인지 확인하므로 고치면 칸을 지운다.
