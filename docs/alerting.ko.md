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
