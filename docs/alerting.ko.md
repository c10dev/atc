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

### QUEUE 계약(ATC-546)

SUPERVISOR QUEUE의 모든 종류와 HOME에 닿는 모든 알림은 한 표(`server/queue-contract.ts`)에 두 가지를 선언한다. **`ends`**: 스스로 사라지는 조건(말로, 구현한 함수 포함). **`action`**: SUPERVISOR가 HOME에서 누르는 것(`approve`, `brake`, `hand`, `answer`, `open`, `done`)과, 그 동작이 HOME 화면에서만 되는지(`screenOnly`). `QUEUE_CONTRACT`는 `QUEUE_KINDS` 값마다 한 줄, `ALERT_CONTRACT`는 HOME에 닿는 알림 key 종류마다 한 줄(`alert|…`, `following|…`, `control|…`, `rts|halted` …)이고, 닿지 않는 key 앞마디는 `ALERT_NOT_ON_HOME`이 이유를 적는다.

**QUEUE 종류나 HOME 알림을 더하면 줄을 더한다.** `server/queue-contract.test.ts`가 줄 없는 종류, `supervisorQueueOf`가 만든 시험 줄이 선언한 동작을 그리지 않는 것(`homeControlOf`, `web/src/home-rows.ts`: HOME의 열린 줄이 쓰는 같은 함수), `open` 단추가 `#home` 자신을 가리키는 것(ATC-541의 고리)을 실패로 막는다. 줄의 `gap` 칸은 알려진 어긋남(선언한 동작이 아직 HOME에 그려지지 않음)이고, 시험이 그 어긋남이 아직 사실인지 확인하므로 고치면 칸을 지운다.
