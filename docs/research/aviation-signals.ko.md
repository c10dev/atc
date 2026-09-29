# 조사: 항공이 호출·확인·완료를 신호하는 방법

[English](aviation-signals.md) · **한국어**

> 상태: [ATC-118](https://linear.app/vocado/issue/ATC-118) 조사, 2026-09-29. 읽기만 했다. 메시지 형식, guard, 매뉴얼, 세션은 바꾸지 않는다. 끝의 권고는 ENGINEERING이 정할 작업 지시서 초안이다. SUPERVISOR가 요청한 두 가지는 9절과 10절에 있다: 경보음이 실제로 어떤 소리인지, 녹음된 음성 데이터를 쓸 수 있는지.

## 질문

atc는 항공 용어를 빌려 쓴다: CLEARANCE, READBACK, FLIGHT PLAN, HANDOFF. 항공은 실제로 어떻게 하는가:

- 한 상대를 부르고;
- 메시지를 확인하고;
- 진행을 보고하고;
- 끝났다고 알리는가?

atc는 거기서 무엇을 가져와야 하는가?

## 방법

- **1차 출처**는 공개된 것을 쓴다:
  - ICAO Doc 10037(GOLD, CPDLC);
  - FAA AC 25.1322-1(조종실 경보);
  - FAA Pilot/Controller Glossary와 AIM;
  - ICAO Doc 4444(readback 항목, 공개 사본으로 인용);
  - EASA Part-145.A.50(release to service).
- **규격이 유료이거나 공개되지 않은 것은 요약을 썼다:**
  - ARINC 714(SELCAL)와 ARINC ACARS 규격;
  - IEC 60601-1-8(의료 경보);
  - IATA 지연 코드.

  아래에 따로 표시했다.
- **atc 사실**은 `origin/main` 코드와 2026-09-29의 운영 기록에서 읽었다. 건수만, 메시지 본문은 읽지 않았다:
  - `clearances.jsonl`, 2026-09-26 17:01Z부터 09-29 03:46Z;
  - `proposals.jsonl`;
  - 09-28/29의 FLIGHT RECORDER.
- **한계:** ICAO Doc 4444와 Doc 9432는 ICAO가 무료로 공개하지 않는다. 문구는 공개 사본과 요약에서 인용했고, 단어의 뜻은 FAA 용어집을 썼다.

## 요약

| # | 항공 관행 | 지금 atc | 권고 | 효과 | 작업량, 등급 |
|---|---|---|---|---|---|
| 1 | 음성: 안전 항목은 readback. WILCO / ROGER / UNABLE / STAND BY는 뜻이 다 다름 | 모든 메시지에 한 단어 `READBACK <id>`. 못 하면 READBACK 대신 이유. FLIGHT PLAN에는 `decline` op가 있고, CLEARANCE에는 없음 | **바꿔서.** atc 메시지는 글이라 음성보다 데이터링크 모델이 맞음(2행) | — | — |
| 2 | CPDLC: 메시지마다 응답 속성(W/U, A/N, R, Y, N). closure 응답이 닫음. STANDBY는 열어 두고 타이머를 다시 시작. 시한이 지나면 음성으로 전환 | 모든 CLEARANCE가 READBACK을 요구(INFO 포함, 110건 중 81건). 10분 overdue가 있고, TOWER가 한 번 재송신한 뒤 SUPERVISOR에게 보고. STANDBY가 없고, CLEARANCE에는 UNABLE도 없음 | **가져온다.** 머리에 응답 속성을 넣고, `UNABLE <id> — 사유`와 `STANDBY <id>`를 더하고, INFO는 ROGER만 받거나 응답을 받지 않음 | 침묵과 "못 함"이 구분되고, 담긴 것 없는 READBACK이 줄어듦 | M, `user`(루트와 애플리케이션 `CLAUDE.md`의 READBACK 규칙) + `flagged`(매뉴얼) |
| 3 | ACARS OOOI: Out, Off, On, In을 문·브레이크·기어 센서가 자동으로 보냄 | DEPARTED(점유나 READBACK)와 ARRIVED(머지)는 자동. PR 열림은 알 수 있음. "운영 반영"(배포)은 FLIGHT별로 기록하지 않음 | **가져온다.** FLIGHT마다 고정 마일스톤 넷: OUT, OFF, ON, IN | ETA와 FOLLOWING에 실제 시각. FLIGHT별 "배포됨" 신호 | M, `auto` |
| 4 | SELCAL: 시끄러운 주파수는 줄여 두고, 두 음의 호출이 한 항공기만 깨움 | SQUELCH(빈 tick 버리기)는 만드는 중. SUPERVISOR에게는 호출 신호가 없고 [ATC-87](https://linear.app/vocado/issue/ATC-87)이 더함 | ATC-87에 **발상을 가져온다**: SUPERVISOR를 기다리는 항목에 "당신을 부른다"는 별도 소리 | SUPERVISOR가 화면을 지켜보지 않아도 됨 | S, ATC-87 안에서 |
| 5 | 경보: 고유 음은 10개 미만. master warning 음 하나, master caution 음 하나. advisory는 소리 없음. 확인하면 끔. 헛경보는 신뢰를 무너뜨림 | ALERT 등급은 [ATC-110](https://linear.app/vocado/issue/ATC-110), 소리는 ATC-87 | **점검으로 가져온다.** ATC-87은 이미 이를 따름. AC 25.1322-1의 음 개수 제한과 ramp를 더함(9절) | 사람이 계속 켜 두는 소리 | S, ATC-87 안에서 |
| 6 | 이관: CONTACT는 새 기관을 부르라는 뜻, MONITOR는 듣기만 하라는 뜻. 새 주파수에서 check-in | HANDOFF는 알리지 않고 감지함. CREW CHANGE는 READBACK을 요구 | **지금은 보류.** `/clear`나 다시 띄운 뒤의 check-in이 RESTARTING 틈(ATC-91)을 메울 수 있지만 이득이 작음 | — | — |
| 7 | A-CDM: 모든 공항 파트너가 함께 보는, 목표·실제 시각이 붙은 마일스톤 16개 | LANDING SEQUENCE, RTS, ARRIVED가 따로 보임 | 3행으로 **바꿔서**: 마일스톤 넷이 atc의 공유 마일스톤 | FLIGHT마다 타임라인 하나 | 3행과 함께 |
| 8 | 책임이 따르는 완료: 권한 있는 사람이 작업을 확인한 뒤 서명하는 Certificate of Release to Service. 예외는 따로 적음 | MCC INSPECTION `pass`가 head SHA에 묶이고, RTS에 건강 확인과 ROLLBACK이 있음 | **유지.** 이미 같은 구조. 선택으로 도착 보고에 "달리 명시한 것"(PILOT'S DISCRETION)을 적음 | — | — |
| 9 | 소리: master warning은 반복 차임, master caution은 한 번 차임. SELCAL은 고정 음표 | atc에는 소리가 전혀 없음 | **가져온다:** 브라우저에서 작은 소리 묶음을 합성(9절). 녹음은 절대 싣지 않음 | — | ATC-87 안에서 |
| 10 | 음성 데이터: ATC 음성 코퍼스와 실시간 중계 | 쓰지 않음 | **보류.** MIT 저장소에 재배포를 허락하는 코퍼스가 없고, atc에는 음성이 필요 없음 | — | — |

## 1. 음성 확인 응답

**readback은 모든 것이 아니라 안전 항목을 위한 것이다.** ICAO Doc 4444(4.5.7.5.1)가 늘 readback할 것을 정한다:

- 항로 허가;
- 활주로 진입, 착륙, 이륙, 대기, 횡단, 역주행;
- 사용 활주로, 고도계 설정, SSR 코드;
- 고도·방향·속도 지시;
- 전이 고도.

나머지는 확인만 한다. HOLD, HOLD POSITION, HOLD SHORT에는 ROGER나 WILCO로 부족하고, HOLDING이나 HOLDING SHORT로 답한다(Doc 4444, SKYbrary와 공개 사본으로 인용).

**단어마다 뜻이 다르다**(FAA Pilot/Controller Glossary):

| 단어 | 뜻 |
|---|---|
| ROGER | "I have received all of your last transmission." 예·아니오 질문의 답으로 쓰지 않는다 |
| WILCO | "I have received your message, understand it, and will comply with it." |
| UNABLE | "Indicates inability to comply with a specific instruction, request, or clearance." |
| STAND BY | 잠시 멈추거나 기다리라는 뜻. "The caller should reestablish contact if a delay is lengthy." "is not an approval or denial." |
| READ BACK | "Repeat my message back to me." |

**음성이 내용을 되읽는 까닭:** 음성은 잘못 들을 수 있다. 관제사가 readback을 듣고(hearback) 틀린 숫자를 잡는다.

atc는 글을 보낸다. CAPTAIN은 서버가 만든 문구를 그대로 받으므로, 되풀이해도 더해지는 것이 없다. atc의 `READBACK <id>`는 음성 readback이 아니라 데이터링크의 WILCO처럼 동작한다.

잃고 있는 것은 다른 답들 사이의 구분이다:

- "못 함"은 지금 자유 문장의 이유다;
- "나중에"는 없다;
- "알았음"(INFO에 대한 ROGER)이 "하겠음"과 같은 단어다.

## 2. CPDLC: 응답 속성, 닫힘, 타이머

ICAO Doc 10037(GOLD, 2016 초판, 편집 전 사전판)에서:

- **열림과 닫힘.** 열린 메시지는 "contains at least one message element that requires a response"이고 "remains open until the required response is received". 닫힌 메시지는 응답이 필요한 요소가 없거나 "has received a closure response"인 것이다.
- **응답 속성**(우선순위 W/U, A/N, R, Y, N):
  - W/U: WILCO나 UNABLE이 닫음;
  - A/N: AFFIRM이나 NEGATIVE가 닫음;
  - R: ROGER가 닫음;
  - Y: 어떤 응답이든;
  - N: 응답 없음.
- **STANDBY는 닫지 않는다.** "A RSPD-3 STANDBY response to an open CPDLC uplink message does not operationally close the dialogue."
- **타이머.**
  - 운영 응답이 필요한 메시지를 보내면 지상 타이머 `tts`가 120초로 시작한다. 만료되면 "the controller is notified and reverts to voice".
  - 항공기 타이머 `ttr`는 100초다. ATN B1 항공기에서는 메시지가 시간 초과되고 "the flight crew should contact ATC by voice".
  - "If the flight crew responds to a clearance with a STANDBY, the aircraft and ground timers are re-started."
  - LACK 타이머는 40초다.
- **제때 닫히지 않으면**(3.3.1.2): 관제사는 남은 허가의 공역을 계속 보호하고 음성으로 확인한다.

**지금 atc(2026-09-26 → 09-29):**

- **CLEARANCE:**
  - 110건: INFO 81건, LAND 29건. INFO는 79건, LAND는 25건이 READBACK됐다.
  - 발부 뒤 READBACK까지 중앙값 0.3분, p90 0.9분.
  - op는 `issue`, `readback`, `cancel`뿐이다.
- **FLIGHT PLAN:**
  - 17건 중 16건이 보낸 뒤 중앙값 0.5분 만에 accept됐다.
  - `decline`은 있지만 한 번도 쓰이지 않았다.
- **타이머:**
  - FLIGHT PLAN, CLEARANCE, CREW CHANGE의 READBACK은 10분 뒤 overdue다(`READBACK_OVERDUE_MS`, `OVERDUE_MS`, `CREW_CHANGE_READBACK_OVERDUE_MS`).
  - DEPARTED는 READBACK 뒤 30분에 overdue다.
  - STAND 없는 FLIGHT의 ARRIVED는 24시간 뒤 overdue다.
- **대체 경로:** NO READBACK이면 TOWER가 한 번 재송신하고, 그래도 없으면 SUPERVISOR에게 보고한다(`controller/CLAUDE.md`). 이미 "시간 초과 → 음성으로 전환"과 같은 구조다. SUPERVISOR가 atc의 음성 채널이다.
- **기록:** READBACK은 관제 세션이 답장을 읽고 `atcctl … readback`으로 기록한다. 자동으로 파싱하는 것은 없다.

**atc에 맞는 것:**

- **메시지 종류마다 응답 속성:**
  - LAND, HOLD, FLIGHT PLAN, RECALL, CREW CHANGE는 `W/U`;
  - INFO와 TRAFFIC은 `R`.
  - 끝줄이 어떤 답을 기다리는지 말한다.
- **명시적인 `UNABLE <id> — <사유>`:**
  - 메시지를 닫는다;
  - D-는 `decline`으로, C-는 새 `unable`로 이어진다.
- **`STANDBY <id>`:** 메시지를 열어 두고 10분 overdue를 한 번 다시 시작한다.
- **대체 경로는 그대로:** 한 번 재송신하고, 그다음 SUPERVISOR.

## 3. ACARS OOOI와 자동 보고

OOOI는 비행의 고정 마일스톤 넷이다: "out of the gate, off the ground, on the ground, and into the gate". "aircraft sensors mounted on doors, parking brakes, and struts"가 감지하고, 승무원 조작 없이 보낸다(Wikipedia "ACARS"):

| 마일스톤 | 트리거 |
|---|---|
| **Out** | 주차 브레이크 풀림, 문 닫힘 |
| **Off** | 바퀴에 무게가 빠짐 |
| **On** | 바퀴에 무게가 실림 |
| **In** | 주차 브레이크 걸림, 문 열림 |

보고마다 시각과 탑재 연료 같은 자료가 붙는다. 항공사는 이것으로 블록 시간, 지연, 승무원 급여를 계산한다. 정확한 메시지는 ARINC 618/620/633에 있고 유료다. 여기 내용은 공개 요약(airlabs.co, Wikipedia "ACARS")에서 왔다.

IATA 표준 지연 코드는 늦은 마일스톤에 사유를 붙인다(AHM 730/731, 유료, 여기서는 확인하지 않음).

**atc에는 이미 대응하는 것이 있지만 한 묶음이 아니다:**

| OOOI | atc 신호 | 지금 기록 |
|---|---|---|
| OUT | DEPARTED: READBACK 뒤 STAND 점유, STAND 없는 FLIGHT는 READBACK | 있음(`departures.jsonl`, 제안의 `depart`) |
| OFF | PR 열림, 또는 첫 push | GitHub로 알 수 있음. FLIGHT 마일스톤으로는 기록하지 않음 |
| ON | PR 머지 → ARRIVED | 있음(LOGBOOK) |
| IN | RTS 뒤 머지 커밋이 운영에 반영됨 | **없음.** `rts.jsonl`에 커밋은 있지만 FLIGHT별이 아님 |

넷을 FLIGHT마다 실제 시각과 함께 기록하면, FOLLOWING과 ETA에 고정 타임라인이 생긴다. "배포됨"에도 신호가 생긴다. 지금은 머지 순간에 ARRIVED로 치지만, MCC가 `land+rts`라 운영 반영은 몇 분 뒤 RTS로 일어난다.

## 4. 주의 끌기: SELCAL

HF 무선은 시끄러워서 승무원은 소리를 줄여 둔다. SELCAL은 지상국이 한 항공기만 부르게 한다(Wikipedia "SELCAL", code7700.com):

- **코드:** 항공기마다 네 글자 코드가 있다.
- **호출:** 지상국이 동시에 울리는 두 음을 두 쌍 보낸다. 한 쌍은 약 1.0 ± 0.25초이고, 사이는 약 0.2 ± 0.1초다.
- **조종실에서:** 차임과 불빛이 켜지므로 "crewmembers need not devote their attention to continuous radio listening".
- **음표:** 16음, A = 312.6 Hz부터 S = 1479.1 Hz까지(ARINC 714, 공개된 표에서).

이것이 SUPERVISOR의 처지다. 지금 승인 중앙값이 3.9분인 것은 누군가 화면을 지켜보기 때문이다. SQUELCH는 관제 세션에 같은 일을 한다: SIGNAL이 올 때까지 잡음을 버린다. SUPERVISOR에게는 나머지 반쪽, 자기를 기다리는 것이 생겼을 때의 별도 호출이 필요하다. ATC-87은 이미 PENDING 차임을 계획하고 있고, 이 조사는 그 소리를 SELCAL식 두 음 패턴으로 하기를 권한다(9절).

## 5. 경보 철학

FAA AC 25.1322-1(2010)에서:

- **소리 개수.** "The number of unique tones should be less than 10."
  - "Provide one unique tone for master warning alerts and one unique tone for master caution alerts."
  - advisory에는 master aural alert를 두지 않는다. "because immediate flightcrew attention is not needed".
- **구분.** "Each sound should differ from other sounds in more than one dimension (frequency, modulation, sequence, intensity)."
- **한 번에 하나.** 경보음은 한 번에 하나만 울리고, 더 급한 것이 덜 급한 것을 끊는다.
- **확인.** 시스템은 "permit each occurrence of attention-getting cues for warning and caution alerts to be acknowledged and then suppressed, unless the alert is required to be continuous"해야 한다. "a positive acknowledgement of the alert condition is required"이면 반복하고 끌 수 있게 한다. 계속 알 필요가 없으면 반복하지 않는다.
- **헛경보.** 잦은 헛경보는 "the flightcrew's confidence in the alerting system"을 떨어뜨리고, 승무원은 "may ignore a real alert".
- **없앰.** 조건이 사라지면 경보를 없앤다.

**atc에 비춰 보면:**

- ATC-110(등급, ADVISORY는 조용히)과 ATC-87(WARNING은 ACK까지 반복, CAUTION은 한 번, ADVISORY는 무음, 몰린 경보 합치기)은 이와 맞는다.
- FLIGHT RECORDER에는 24.7시간에 `alert.raised` 46건이 있었다:
  - 시간당 최대 9건이고, 11건은 직전 경보와 1분 안에 이어졌다;
  - no-workspace 16, health 14, orphan 12, stranded 2, unattended 2, conflict 0.
- 그래서 모든 경보에 소리를 붙이면 AC가 경고하는 헛경보가 된다.

## 6. 이관과 check-in

주파수를 바꿀 때 관제사는 CONTACT나 MONITOR를 말한다(FAA AIM 4-2, GOLD):

- CONTACT(기관, 주파수)는 새 기관을 부르라는 뜻이다;
- MONITOR는 듣기만 하라는 뜻이다. 새 기관이 먼저 부른다.

atc는 HANDOFF를 STAND 활동(한 세션이 손을 떼고 다른 세션이 이어받음)으로 감지하고, 경보로 치지 않는다. CREW CHANGE는 READBACK을 쓴다.

AIRCRAFT가 `/clear`나 다시 띄운 뒤 돌아왔을 때 "check-in"을 하면 RESTARTING 유예(ATC-91)의 일부를 대신할 수 있다. 이득이 작아서 이 조사는 지금은 권하지 않는다.

## 7. 공유 마일스톤: A-CDM

공항 협업 의사결정(A-CDM)은 비행마다 목표·실제 시각이 붙은 마일스톤 16개를 정한다. 예를 들면:

- TOBT(목표 출발 준비 시각: 항공기 준비, 문 닫힘);
- TSAT(목표 시동 허가 시각, ATC가 줌);
- AOBT(실제 출발 시각).

항공사, 조업사, 공항, ATC가 같은 마일스톤을 본다. 그래서 "awareness of all airport partners"가 좋아지고, 뒤따르는 갱신이 일어나고, 지연을 일찍 잡는다(EUROCONTROL A-CDM 규격, ICAO APAC 발표 자료).

atc의 당사자들(OCC, TOWER, MCC, CAPTAIN, SUPERVISOR)은 FLIGHT를 저마다 다른 화면으로 본다. 3절의 마일스톤 넷이 가장 작은 공통 묶음이다. 목표 시각은 나중에 TRIP FUEL과 NETWORK의 ETA 논리로 붙일 수 있다.

## 8. 책임이 따르는 완료

EASA Part-145.A.50:

- 사용 가능 확인서(CRS)는 지시된 정비가 모두 "has been properly carried out"임을 확인한 권한 있는 확인 요원이 발행한다.
- "before flight at the completion of any maintenance" 발행한다.
- 문구는 작업을 "except as otherwise specified" 했다고 말한다.

믿음은 세 가지에서 온다: 권한 있는 서명자, 지시와 대조한 확인, 명시된 예외.

atc는 이미 같은 모양이다:

- **MCC INSPECTION**은 head SHA에 묶이고, 변경을 ATC 이슈의 완료 기준과 대조한다. `pass`만 착륙한다.
- **RTS**는 버전·세션·데몬 확인을 거쳐야 운영이 건강하다고 하고, 아니면 ROLLBACK한다.
- **명시된 예외**도 있다: PILOT'S DISCRETION으로 고른 것을 PR 본문에 적는다. CAPTAIN의 최종 보고에 고정된 "달리 명시한 것" 칸이 있으면 도움이 된다(권고 3).

## 9. 소리가 실제로 어떤지

**여객기(공개 요약, 제작사 매뉴얼이 아님):**

| 기종 | 경보 | 소리 | 출처 |
|---|---|---|---|
| Airbus | Level 3, 빨간 warning | "continuous repetitive chime or a specific sound or a synthetic voice" | Wikipedia "ECAM" |
| Airbus | Level 2, 주황 caution | "a single chime" | Wikipedia "ECAM" |
| Airbus | Level 1 | 소리 없음 | Wikipedia "ECAM" |
| Airbus | 자동조종 해제 / 실속 | "cavalry charge" / "cricket" | 미확인(비행 시뮬레이션 동호회 설명) |
| Boeing | 화재 / 객실 고도·형상·과속 / 자동조종 해제 | 벨 / 사이렌 / wailer | 미확인(교육 사이트 설명) |

**어떤 경보음에나 해당하는 설계 규칙:**

- **FAA AC 25.1322-1 부록 2:**
  - 200–4500 Hz 사이의 주파수;
  - 두 주파수 이상, 또는 한 주파수에 뚜렷한 간격;
  - 시작과 끝에 20–30 ms ramp. "to avoid startling";
  - 고유 음 10개 미만;
  - master warning과 master caution에 음 하나씩, advisory에는 없음.
- **IEC 60601-1-8, 의료 경보(유료, 제조사 응용 문서에서):**
  - 기본 주파수 150–1000 Hz에 배음;
  - 높음은 빠른 펄스 10개 묶음, 중간은 3개, 낮음은 1–2개.

  우선순위를 펄스 수로 나타내서 싼 스피커에서도 살아남으므로, 두 번째 모델로 쓸 만하다.
- **SELCAL 음표:** 312.6–1479.1 Hz의 16음을 약 1초씩 두 쌍으로 울린다.

**ATC-87에 뜻하는 것:**

- 소리는 넷까지, 모두 Web Audio로 합성한다:

  | 소리 | 패턴 |
  |---|---|
  | **WARNING** | 빠른 펄스 여러 개로 된 두 음 묶음, ACK까지 반복 |
  | **CAUTION** | 부드러운 두 음 차임 한 번, 반복 없음 |
  | **CALL**(SUPERVISOR를 기다리는 것) | 짧은 SELCAL식 패턴: 두 음 쌍 둘, 한 쌍을 약 0.3초로 줄임 |
  | *(선택, 기본 꺼짐)* **DONE** | RTS 결과에 낮은 음 하나 |

- 완료는 advisory라 기본은 소리가 없다.
- 소리마다 음높이와 **리듬이 함께** 다르다.
- 작은 스피커를 위해 200–1500 Hz 안에 두고, 모든 시작과 끝을 20–30 ms로 ramp한다.
- 항공기 제작사의 소리를 베끼지 않는다. 샘플 사이트의 녹음은 출처가 분명하지 않고, 알아볼 수 있는 제작사 소리는 상표 문제를 부를 수 있다. 공개된 표의 음 주파수는 저작권 대상이 아니라 써도 된다.

## 10. 음성 데이터(녹음과 코퍼스)

| 출처 | 무엇 | 조건(공개된 대로, 2026-09-29 확인) | atc에서 쓸 수 있나 |
|---|---|---|---|
| LiveATC.net | 실시간·보관 ATC 중계 | "personal non-commercial purposes only". 허락 없이 재배포·복제·제3자 제품 사용 금지 | 아니요 |
| ATCOSIM(EUROCONTROL, TU Graz) | 모의 관제 음성 10시간, 영어, 비원어민 화자 | 무료지만 제3자에게 재배포 금지 | 저장소에는 아니요. 로컬 조사만 |
| ATCO2(Idiap 등) | 1시간 시험 세트는 "for research purposes"로 무료. 4시간 시험 세트와 5,281시간 학습 세트는 ELRA 경유 | 유료 세트는 ELRA에서 판다. 공개 요약 하나는 CC BY-NC-ND 4.0이라 하고, 프로젝트 쪽은 "commercial and non-commercial use"라 한다. **미확인**: ELRA 카탈로그 쪽이 열리지 않았다 | 아니요 |
| UWB-ATCC(서보헤미아 대학) | 체코 ATC 약 20시간, 영어 | CC BY-NC-SA 4.0 | 아니요(비영리·동일조건이 MIT 저장소와 맞지 않음) |
| LDC Air Traffic Control Complete(LDC94S14A) | DFW, BOS, DCA 약 70시간(1994) | LDC 사용자 계약, 비회원은 유료 | 아니요 |

**결론:**

- atc에는 녹음된 음성이 필요 없다. 메시지는 글이고, 소리는 합성할 수 있다.
- 이 출처들 중 어느 것도 공개 MIT 저장소에 넣을 수 없다.
- 나중에 음성 안내("TEAM_G STALLED")를 원하면, 브라우저의 `speechSynthesis`가 데이터 없이 글에서 로컬로 만든다. ATC-87은 지금은 범위 밖으로 둔다.

## 권고(ENGINEERING을 위한 작업 지시서 초안)

### EO 1. 응답 속성, UNABLE, STANDBY

- **목표:** 모든 atc 메시지가 어떤 답이 자기를 닫는지 말하고, CAPTAIN이 "못 함"과 "나중에"를 고정된 형식으로 말할 수 있다.
- **완료 기준:**
  - **머리:** CLEARANCE, FLIGHT PLAN, RECALL, CREW CHANGE의 머리에 기대하는 답을 넣는다. LAND, HOLD, FLIGHT PLAN, RECALL, CREW CHANGE는 `W/U`, INFO와 TRAFFIC은 `R`.
  - **`UNABLE <id> — <사유>`:**
    - 메시지를 닫는다. D-는 `decline`으로, C-와 CC-는 새 `unable` op로;
    - STRIPS와 DISPATCH에 보인다;
    - ATC-87의 CAUTION key를 올린다.
  - **`STANDBY <id>`:** 10분 overdue를 한 번 다시 시작하고 `standby`를 기록한다. 두 번째 STANDBY는 기록하되 타이머를 다시 시작하지 않는다.
  - **`ROGER <id>`가 `R` 메시지를 닫는다.** READBACK도 계속 받으므로 옛 습관이 깨지지 않는다.
  - **테스트:** op마다 순수 fold 테스트.
  - **규칙:** 매뉴얼(TOWER, OCC)과 루트·애플리케이션 `CLAUDE.md`의 READBACK 규칙을 고친다.
- **제약:**
  - guard를 느슨하게 하지 않는다. `send-guard`는 지금처럼 문구를 비교한다.
  - `READBACK`은 어디서나 계속 유효하다.
- **등급:** `user`(루트 `CLAUDE.md`), 매뉴얼은 `flagged`.

### EO 1 as built (ATC-122)

- `server/response.ts`(순수):
  - `responseOf`는 LAND·HOLD·CONTINUE·FLIGHT PLAN·RECALL·CREW CHANGE에 W/U, INFO·TRAFFIC·REPORT에 R을 준다.
  - `answerError`는 READBACK은 늘, ROGER는 R에만, STANDBY는 W/U에만 받고, RECALL에는 READBACK만 받는다.
  - `closingLine`이 끝줄을 쓰고, `overdueBase`가 overdue 시작을 첫 STANDBY로 옮긴다.
- **기록:**
  - CLEARANCE에 `roger`·`unable {reason}`·`standby` op가 생겼다. 먼저 온 닫는 답이 남고, 취소는 READBACK 뒤에도 된다.
  - FLIGHT PLAN에는 `standby` op가 생겼고, UNABLE은 있던 `decline`이다.
  - CREW CHANGE에는 `unable` 상태와 `standby` op가 생겼다.
  - 옛 서버는 새 op를 건너뛴다.
- **보이는 곳:**
  - STRIPS 도장에 ROGER·STANDBY·UNABLE(사유)이 보인다.
  - DISPATCH IN FLIGHT 줄에 STANDBY가 보인다.
  - FLIGHT가 있는 UNABLE은 FLIGHT FOLLOWING에 `unable` 문제로 하루 뜬다.
  - `crew-change brief`에 `unable`이 있다.
- **기록 방법:** atcctl이 답을 기록한다: `roger`, `unable -- <사유>`, `standby`와 그 `dispatch`·`crew-change` 형태. 답장은 여전히 관제 세션이 읽고 기록하고, 팀 메시지를 파싱하는 것은 없다.
- **규칙:** 루트 `CLAUDE.md`(두 언어), `atc-task` skill, TOWER·OCC 매뉴얼이 답을 적는다. `VOCADO_READBACK_SUGGESTION`은 루트 `CLAUDE.md`와 같은 문장이고, 이제 테스트가 이를 확인한다.
- **하지 않은 것:** 애플리케이션 저장소 자체의 규칙 줄은 SUPERVISOR가 바꾼다. 그때까지 그쪽 CAPTAIN도 끝줄에서 답을 본다.

### EO 2. FLIGHT별 OOOI 마일스톤

- **목표:** FLIGHT마다 고정 타임라인 하나: OUT(DEPARTED), OFF(PR 열림), ON(머지, ARRIVED), IN(RTS 뒤 운영 반영).
- **완료 기준:**
  - 순수 함수가 `departures.jsonl`, GitHub PR 자료, LOGBOOK, `rts.jsonl`에서 네 시각을 뽑는다. IN은 머지 커밋을 포함한 첫 성공 RTS다.
  - 시각이 FOLLOWING과 FLIGHT 줄에 보이고, 각 마일스톤이 처음 생길 때 FLIGHT RECORDER에 이벤트를 쓴다.
  - 없는 마일스톤은 비워 두고, 추측하지 않는다.
- **제약:**
  - 팀 작업을 새로 감지하지 않는다.
  - ARRIVED의 뜻은 바꾸지 않는다. IN을 그 옆에 더한다.
- **등급:** `auto`.

### EO 3. 고정 칸의 도착 보고

- **목표:** CAPTAIN의 최종 보고에 atc가 확인할 수 있는 고정 칸이 있다. 자료가 붙은 "In" 보고다.
- **완료 기준:**
  - **형식:** `[TEAM_X → OCC|ENGINEERING] ARRIVED ATC-n · PR #n`에 `tier`, `tests`, `discretion`(수, 그다음 목록), `blocked`(없음, 또는 목록)를 한 줄씩.
  - **확인:** PR이 머지됐는데 도착 보고가 없는 FLIGHT를 FOLLOWING이 표시한다.
  - **skill:** `atc-task` skill 8절이 이 형식을 쓴다.
- **제약:** [ATC-18](https://linear.app/vocado/issue/ATC-18)(모든 보고를 다룸)을 보완한다. 자유 문장 요약을 대신하지 않는다.
- **등급:** `user`(`.claude/`), 이를 읽는 관제 매뉴얼은 `flagged`.

### EO 4. ATC-87의 소리 묶음(ATC-87을 고침, 새 이슈 없음)

- **목표:** ATC-87의 소리가 9절을 따른다.
- **내용:**
  - 소리는 넷까지: WARNING, CAUTION, CALL, 선택으로 DONE;
  - 음높이와 리듬이 다르다;
  - 200–1500 Hz, 20–30 ms ramp, 합성, 녹음 없음;
  - CALL은 SELCAL식이다;
  - 완료는 기본으로 무음이다.

### EO 5(낮음). 재시작 뒤 check-in

- **목표:** AIRCRAFT가 `/clear`나 다시 띄운 뒤 돌아오면 `CHECK IN TEAM_X`를 보내고, 유예(ATC-91)를 기다리지 않고 바로 RESTARTING을 끝낸다.
- **권고:** 같은 파서를 쓰므로 EO 1 뒤에 정한다.

## 확인하지 못한 것

- **ARINC 618/620/633과 714:** 원문이 유료다. OOOI 트리거와 SELCAL 음표는 공개 요약에서 왔다.
- **IATA AHM 730/731 지연 코드:** 읽지 않았다.
- **IEC 60601-1-8:** 읽지 않았다. 펄스 수와 주파수 한계는 제조사 응용 문서에서 왔다.
- **Airbus와 Boeing 소리:** 제작사 매뉴얼이 아니라 공개 설명에서 왔다. Airbus warning·caution 차임만 문서(Wikipedia "ECAM")와 대조했고, 나머지는 표에 미확인으로 적었다.
- **ATCO2 라이선스:** ELRA 카탈로그(ELRA-S0484)가 열리지 않았다. 공개 설명 둘이 서로 다르다.
- **LiveATC 약관:** 브라우저 확인 뒤에 있다. 약관은 https://www.liveatc.net/legal/ 의 검색 색인 문구에서 인용했다.
- **ICAO Doc 4444와 Doc 9432:** ICAO 판매처가 아니라 공개 사본과 요약으로 인용했다.

## 출처(2026-09-29 조회)

출처 목록은 영어판([aviation-signals.md](aviation-signals.md#sources-accessed-2026-09-29))과 같다.
