# 조사: 항공은 통신 두절과 비정상 상황을 어떻게 다루는가

[English](lost-comms-and-contingency.md) · **한국어**

> 상태: [ATC-258](https://linear.app/vocado/issue/ATC-258) 조사, 2026-10-01. 읽기만 했다. 메시지 형식, guard, 매뉴얼, 타이머, 세션은 바꾸지 않는다. 10절의 제안은 DUTY·ENGINEERING과 SUPERVISOR가 고를 초안이고, 정해진 것은 없다.

## 질문

2026-10-01 하루 아침에 atc는 여섯 가지 방식으로 연락이나 상태를 잃었다(1절). 매번 atc가 아니라 SUPERVISOR가 "왜 느리지?" 하고 물어서 찾았다. atc는 항공의 말(NORDO, HOLD, GO AROUND, READBACK, ALERTS, SAFETY REPORT)을 빌려 쓰지만 그 뒤의 절차는 빌리지 않았다. 항공은 어떻게 하고, atc는 무엇을 가져와야 하는가?

## 방법과 한계

- **출처.** 공개된 것을 문서와 장으로 인용한다:
  - ICAO Annex 2(항공 규칙), Annex 10 vol II(음성), Annex 11(ATS, 2장·5장), Annex 12(SAR), Annex 15(NOTAM), Annex 19(안전관리). PANS-ATM Doc 4444(15장, readback 항목), Doc 9426(ATS 계획 매뉴얼), GOLD(Doc 10037, CPDLC).
  - FAA: 14 CFR 91.185·91.213, AIM 4장·6장, JO 7110.65 10장, JO 7210.3, JO 1900.47(contingency), AC 00-46(ASRS).
  - EASA·Eurocontrol: Reg (EU) 2017/373, Reg (EU) 376/2014, SKYbrary 글.
- **한계.** TEAM_G의 CAPTAIN이 이 문서들에 대해 아는 것으로 썼다. 이 세션에서 웹 페이지를 가져오지 않았고 ICAO 원문은 무료로 공개되지 않는다. 그래서 문단 번호는 잘 알려진 것만 적고 나머지는 장만 적었다. **설계나 매뉴얼에 인용하기 전에 현재 판의 문단 번호를 확인한다.** 이 보고서가 기대는 것은 각 절차의 모양(누가 무엇을 하고 어떤 타이머가 도는가)이다.
- **atc 사실**은 2026-10-01의 `origin/main`에서 읽었다(표마다 문서와 코드를 적었다). 건수와 사고 내용은 ATC-258 이슈에 쓰인 수준까지만 적는다. `~/.local/state/atc/`는 읽지도 쓰지도 않았다.

## 1. 여섯 사고, 한 줄씩

| # | 일어난 일 | 종류 |
|---|---|---|
| I1 | OCC가 다른 ACCOUNT의 AIRCRAFT에 닿지 못했다. FLIGHT PLAN 넷과 RECALL이 나가지 못했고 한 팀은 RECALL을 33분 기다렸다([ATC-251](https://linear.app/vocado/issue/ATC-251)) | 통신 두절(한 번도 안 된 길을 몇 시간 동안 몰랐다) |
| I2 | APPLY NOW는 전송을 기다리고 전송은 OCC가 움직이기를 기다렸다: 교착(ATC-251 댓글) | Contingency: 순환 의존 |
| I3 | 백그라운드 AIRCRAFT 넷이 답할 사람 없이 권한 질문에서 멈췄다. TOWER는 "awaiting supervisor approval"이라고 요약했다([ATC-252](https://linear.app/vocado/issue/ATC-252)) | 조용한 대기. 타이머도 escalation도 없다 |
| I4 | `ARRIVED` 보고가 OCC에 닿았지만 OCC가 기록하기 전에 끝났고 CAPTAIN은 다시 보내지 않았다 | 보고 분실. 확인 응답이 없다 |
| I5 | 호스트 재부팅으로 모든 세션이 끝났다. 첫 부팅은 "Cannot fork"로 실패했고 관제 세션은 쓰이지 않은 순서로 하나씩 돌아왔다([ATC-255](https://linear.app/vocado/issue/ATC-255)) | "ATC zero"와 복구 |
| I6 | TOWER가 RECALL 뒤에도 TEAM_I 막힘을 보고했다. Urgent 이슈가 수정이 들어간 뒤에 dispatch됐다([ATC-243](https://linear.app/vocado/issue/ATC-243), [ATC-245](https://linear.app/vocado/issue/ATC-245)). TOWER는 아직 launch하지 않은 STAND에 "NORDO 10"을 보였다 | 낡은 정보. 엉뚱한 상태에 쓴 말 |

## 2. 통신 두절, 조종사 쪽

**항공이 하는 일.** 규칙의 목적은 *말을 걸지 않고도 모두가 항공기를 예측하게* 하는 것이다.

- **Squawk 7600**(Annex 10 vol IV, PANS-ATM 15장, AIM 6-4-1). 코드 하나가 모든 관제사에게 말 없이 "radio failure"를 알린다.
- **모두가 아는 계획을 난다.** Annex 2 §3.6.5.2와 14 CFR 91.185는 세부가 다르지만 생각은 하나다:
  - 시계 비행 조건이면 시계를 유지하고 가장 가까운 적합한 공항에 내려 도착을 보고한다.
  - 아니면 **경로** = 마지막 배정, 없으면 vector받은 fix, 없으면 expected(앞서 들은 "expect further clearance"), 없으면 filed. **고도** = 배정, 최저 안전, expected 중 가장 높은 것. **시간** = expected-further-clearance 시각에 holding fix를 떠난다. FAA는 "들은 대로 기대하라"는 규칙을 더해 조종사가 추측하지 않게 한다.
- **Transmit blind.** 응답이 들리지 않아도 운용 주파수와 **guard 121.5**로 위치와 의도를 말한다(Annex 10 vol II, AIM 6-4-1). 양쪽을 들을 수 있는 다른 항공기에 중계를 부탁한다.
- **대역 밖 신호.** ATC light-gun 신호(steady green, flashing red …, AIM 4-3-13, Annex 2 부록 1)는 무선 없이 통한다. 고장 난 통로와 일부러 다른 통로다.
- **나중에 알린다.** 착륙한 뒤 고장을 보고하고, 다시 떠나도 되는지는 관제사가 정한다.

**atc가 배울 것.** NORDO 항공기는 **멈춘 것도 자유로운 것도 아니다.** 모든 항공기에 같고 미리 쓰인 규칙을 따르므로 관제사는 그 경로를 계속 보호할 수 있다.

## 3. 통신 두절, 관제사 쪽

**항공이 하는 일**(PANS-ATM 15장 "communication failure", JO 7110.65 10장 "radio communications failure"):

1. **고장이 내 쪽인지 상대 쪽인지 가린다.** 다른 주파수를 시도하고(엉뚱한 주파수에 있을 수 있다), 앞뒤 섹터에 묻고, 다른 항공기에 중계를 부탁하고, 다른 수단으로 답하게 한다: "들리면 squawk ident / 코드 변경".
2. **지시를 blind로 송신한다.** 항공기 주파수와 guard로, 수신기는 되고 송신기가 안 되는 경우를 위해서다.
3. **항공기가 lost-comms 규칙을 따른다고 가정**하고 다른 항공기를 그 예측 경로에서 분리한다. 항공기의 응답에 기대는 clearance는 주지 않는다.
4. **시간으로 escalate한다**(4절 alerting 단계). "Radar contact lost"와 "X 안에 position report 없음"도 같은 사다리를 시작한다.
5. **알린다.** 다음 섹터, 운항사, 사다리가 시작되면 구조조정센터.

**atc가 배울 것.** 관제사는 응답을 기다린 뒤에 가정으로 움직이지 않는다. *같은 길을 다시* 시도하지 않고 *다른 길*을 시도한다. 그리고 시도한 *뒤에야* 상태(NORDO)를 선언한다.

## 4. Alerting service와 단계

**항공이 하는 일**(Annex 11 5장, Doc 4444 15장, Annex 12, 지연 항공기는 FAA JO 7110.65 10장 3절). 세 단계가 있고, 각각 시간으로 정해진 trigger가 있으며, 단계가 오를수록 더 많은 사람을 부른다:

| 단계 | Trigger(Annex 11 5.2.2, 요약) | 행동 |
|---|---|---|
| **INCERFA**(불확실) | 통신이 오기로 한 시각 뒤 30분 안에 없다, **또는** 마지막 도착 예정 시각 뒤 30분 안에 항공기가 보이지 않는다 | 곧바로 문의: 다른 기관, 운항사, 공항 |
| **ALERFA**(경보) | INCERFA 문의에 소식이 없다, **또는** 착륙 허가를 받고 예정 시각 5분 안에 착륙하지 않았고 교신이 없다, **또는** 운용 능력이 떨어졌지만 불시착 가능성은 낮다 | 구조센터에 경보, 문의를 넓힌다 |
| **DETRESFA**(조난) | ALERFA가 성과 없이 끝났다, **또는** 연료가 바닥났다, **또는** 불시착이 임박했거나 일어났다 | 전면 수색구조 |

atc에 중요한 세 가지:

- **타이머는 사람 머리가 아니라 기관의 절차에 있다.** 관제사가 한 시간이 지났다고 "느끼지" 않는다. strip이 보여 준다.
- **단계마다 다음 행동과 그것을 하는 사람이 있다.** INCERFA는 *묻는다*, ALERFA는 *도움을 부른다*, DETRESFA는 *행동한다*.
- **trigger는 나쁜 사건이 아니라 없는 사건이다.** 무언가 잘못되는 것이 아니라 제때 와야 할 것이 오지 않는다. atc가 가장 못 다루는 경우다(I1, I3, I4).

## 5. 메시지 확인

**항공이 하는 일.**

- **Readback과 hearback**(Doc 4444 12장·4장, JO 7110.65 4-2-3). 조종사는 clearance와 안전에 중요한 항목(고도, 방향, 활주로, 고도계, 주파수)을 읽어 돌려주고, 관제사는 **readback을 듣고**(hearback) 바로잡는다. 루프를 닫는 쪽은 *보낸 쪽*이다. 받은 쪽은 모르는 채 틀릴 수 있기 때문이다.
- **"Say again."** 불분명한 메시지는 다시 요청하고 짐작하지 않는다.
- **CPDLC**(GOLD, Doc 10037): 모든 uplink는 조종사의 **운용 응답**(WILCO / UNABLE / STANDBY)과 따로 **논리 확인**(항공기 장비에 도착해 이해됨)을 받는다. 지상 시스템에 **타이머**가 있어 응답이 제때 오지 않으면 관제사에게 알리고 음성으로 바꾼다. 확인이 없는 메시지는 *전달되지 않은 것*으로 보고 화면이 그렇게 말한다.
- **AFTN/AMHS**(Annex 10 vol II, Doc 9880): 메시지에 **채널 순번**이 있어(빠지면 보인다) AMHS가 **delivery report**와 **non-delivery report**를 준다. non-delivery report는 *발신자*에게 돌아가고 발신자가 처리한다. 서비스 메시지로 재전송을 요청한다.
- **Position report**는 확인 응답을 받는다("radar contact", "position received"). 대양 구간에서는 예정 시각 뒤에도 보고가 없으면 곧바로 lost-comms 수색이 시작된다(주기적 ADS-C 보고가 같은 역할을 한다).

**atc가 배울 것.** 메시지 *종류*마다 자기 응답이 있어야 한다: "도착했다"(delivery), "이해했다"(READBACK), "하는 중"(departed), "끝"(ARRIVED). 타이머는 *보낸 쪽*이 가진다. 응답이 없는 것은 이름과 다음 단계가 있는 상태이고 침묵이 아니다.

## 6. ATS contingency와 연속성

**항공이 하는 일**(Annex 11 §2.30 contingency arrangements, Doc 9426, Reg (EU) 2017/373, FAA JO 1900.47·JO 7210.3 "ATC zero"·시설 대피).

- **모든 기관에 서면 contingency 계획이 있다.** 서비스가 줄거나 없어질 때를 위한 것이다: 주파수, 레이더, 센터를 잃는 경우. 인접 기관과 운항사와 *사건 전에* 합의한다.
- **"ATC zero"**는 시설이 어떤 서비스도 줄 수 없다는 뜻이다. 계획은 이렇게 말한다: 교통을 멈추거나 돌린다(ground stop과 flow 제한), 이웃이 교통을 받거나 거절한다, NOTAM이 서비스가 없다고 알린다, 조종사는 자기 lost-comms와 see-and-avoid 규칙을 따른다.
- **Fallback**은 *다른* 기관이나 줄인 섹터 배치(bandboxing, 백업 센터)로 가고, 고장 난 것을 필요로 하는 길로 가지 않는다.
- **복귀**는 계획된 순서다: 감독이 먼저 장비와 인원을 확인하고, 기관은 교통을 *조금씩* 받으며(flow 제한을 단계로 푼다), **이웃에게는 정해진 순서로** 어느 position이 열렸는지 알린다. 주파수의 첫 관제사는 clearance가 아니라 "contact" 확인을 한다.
- **연습.** Contingency 절차는 시험하고 기록하며, 실제로 쓴 뒤 계획을 검토한다.

**atc가 배울 것.** 고장 *전에* 쓴 계획이고, 그 단계가 고장 난 것에 기대지 않으며(I2), 돌아오는 순서가 있다(I5).

## 7. Position handover

**항공이 하는 일**(Annex 11, JO 7110.65 2-1 position responsibility, JO 7210.3과 시설의 **position relief briefing** 점검표, Eurocontrol/SKYbrary "position handover").

- **Relief briefing**에는 점검표가 있다: 교통과 그 계획, 진행 중인 조정, **확인되지 않은 메시지**, 열린 clearance와 제한, 장비 상태, 기상, 특이 조건. 나가는 관제사는 들어오는 관제사가 **"I have the position"**이라고 말할 때까지 남는다. 책임은 이름 붙은 순간에 넘어간다.
- 점검표가 있는 이유는 **교체될 때 잃는 것이 진행 중인 항목**이기 때문이다: 주었지만 아직 readback되지 않은 clearance, 콜백을 기다리는 호출. 운용 오류 연구는 handover를 되풀이되는 실패 지점으로 짚고, 그래서 많은 기관에서 점검표가 의무다.
- **어떤 position은 비워 두지 않는다.** 새 관제사가 교신하기 전에는 옛 관제사를 보내지 않는다.

**atc가 배울 것.** briefing은 *떠나는* position이 기록에서, 아직 돌아가는 동안(STOP 전에) 쓴다. 새 position이 재구성하지 않는다.

## 8. 비정상·비상 대응

**항공이 하는 일.**

- **Distress와 urgency**: MAYDAY(중대하고 임박한 위험)와 PAN-PAN(긴급, 임박한 위험은 아님), squawk **7700**, 정해진 내용: 누구, 무엇, 의도, endurance. ATC는 우선권을 주고 필요 없는 것은 묻지 않는다.
- **Aviate – Navigate – Communicate.** 먼저 항공기를 날리고, 다음에 위치를 알고, 그다음에 말한다. 압박 속에서 승무원은 보고에 힘을 쓰기 전에 *항공기를 안전하게* 둔다.
- **점검표**(QRH, ECAM/EICAS 조치): 미리 쓰이고, 해를 멈추는 첫 행동 순으로 놓이며, 기다릴 수 없는 몇 개는 "memory item"이다. 승무원은 고장 한가운데서 절차를 지어내지 않는다.
- **알려진 결함으로 dispatch**: **MEL**(14 CFR 91.213, Annex 6)은 무엇이 작동하지 않아도 되는지, 어떤 조건에서, 얼마 동안인지(수리 기한) 적는다. 항공기는 결함을 *알고* 출발한다.
- **NOTAM**(Annex 15)은 알려진 중단을 *유효 기간*과 발행 시각과 함께 모두에게 알린다.
- **정보에는 나이가 있다.** ATIS에는 문자와 시각이 있고 METAR에는 관측 시각이 있다. "information Delta"를 가진 조종사는 그렇게 말하고 관제사는 언제 낡았는지 안다. 시각 없는 자료는 최신으로 받아들이지 않는다.

**atc가 배울 것.** 막힌 AIRCRAFT는 정해진 순서로 움직이고, 미뤄 둔 결함은 *알려지고 날짜가 있어야 하며*(다시 발견하지 않는다), 상태에 대한 모든 진술(TOWER, OCC)은 그것이 참이었던 시각을 달고 있어야 한다.

## 9. 학습 루프

**항공이 하는 일**(Annex 19 5장과 부록 2, Reg (EU) 376/2014, NASA ASRS, AC 00-46).

- **의무 사건 보고**: 정해진 사건(airprox, lost-comms 사건, 비상)은 운항사나 기관이 기한 안에 보고해야 한다.
- **자발 보고**(ASRS와 같은 제도): 비밀이고 처벌하지 않는다. ASRS 보고는 식별 정보를 지우고, 10일 안에 내면 집행 처분에서 보호받는다. 안전 정보는 **책임 추궁에 쓰이지 않게 보호**해서 사람들이 보고하게 한다.
- **루프를 닫는다**: 보고를 모아 분석하고, 추세가 안전 공지와 규칙 변경을 이끌며, 보고자나 기관은 무엇이 바뀌었는지 본다.

**atc가 배울 것.** 정해진 trigger가 울리면 사건이 스스로 접수되어야 하고(의무 보고처럼), 자발 SAFETY REPORT는 계속 싸게 유지해야 한다. 보고가 눈에 보이는 변화로 이어질 때만 루프가 닫힌다.

## 10. 지도: 관행 → 지금 atc → 틈 → 제안

atc 사실은 `origin/main`의 `docs/`와 코드에서 인용했다.

| 관행 | 지금 atc | 틈 | 제안 |
|---|---|---|---|
| **조종사 NORDO 규칙**(예측 가능한 행동) | CREW BRIEFING과 CLEARANCE·FLIGHT PLAN 답장 줄이 session 이름으로 답하라고 한다(`addressLine`, `server/response.ts`, [control-recycle.md](../control-recycle.md) 4절). OCC나 TOWER에 닿지 못할 때 AIRCRAFT가 할 일을 정한 규칙은 없다 | 답을 못 받은 팀은 기다리거나(I1: 33분) 짐작한다 | **F4** CREW BRIEFING의 lost-comms 규칙 |
| **Transmit blind / guard** | CAPTAIN은 한 세션에 답한다 | 두 번째 길이 없다 | **F4**, **F3** |
| **Light-gun(대역 밖) 신호** | 유일한 통로는 세션 사이의 `SendMessage` | 통로가 고장 나면 막다른 길 | **F3** 다른 길(CAPTAIN이 읽는 파일이나 Linear 댓글) |
| **관제사: 다른 길, 중계** | [dispatch.md](../dispatch.md) "Undelivered FLIGHT PLANs as built (ATC-183)": `dispatch undelivered`, CAUTION, AIRCRAFT가 돌아오면 재전송. 교차 ACCOUNT 원인은 ATC-251이 추적한다 | 기록하고 알리지만 다른 경로나 중계를 시도하지 않는다. 두 번째 실패를 재는 타이머도 없다 | **F3**, **F2** |
| **Lost-comms 경로를 가정** | 전달되지 않은 RECALL은 팀에 효과가 없다. RECALL `overdue`가 한 번 다시 보낸다([dispatch.md](../dispatch.md)) | OCC가 팀에 "X로 가정하라"를 말할 수 없다 | **F3**(다른 길로 RECALL), **F4**(팀이 할 일) |
| **Alerting 단계와 타이머** | [occ.md](../occ.md): `no-departure`(WAKE의 1.5배). NO READBACK(10분, OCC가 한 번 재전송 뒤 보고, [dispatch.md](../dispatch.md)). `no-report`와 `arrivalMissing`(30분, `no-report`는 ADVISORY info뿐). [alerting.md](../alerting.md) 수준 WARNING·CAUTION·ADVISORY. [fleet.md](../fleet.md) NEEDS YOU | 규칙이 따로따로다. 공통 사다리, 이름 붙은 단계, "다음에 누구를 부르는가"가 없다. NEEDS YOU 정지는 시계도 escalation도 없다(I3) | **F2** 단계 사다리 하나 |
| **지연 도착** | FLIGHT FOLLOWING `no-report`(OCC가 기록하고 한 번 보고) | escalate하지 않는다. I4는 사람이 기록할 때까지 "accepted"로 남았다 | **F1**, **F2** |
| **Readback / hearback / 확인** | FLIGHT PLAN과 CLEARANCE에는 READBACK·UNABLE·STANDBY·ROGER가 필수이고 guard가 읽는다 | `ARRIVED`는 **돌아오는 확인이 없다**: 보낸 쪽은 기록됐는지 모른다(I4) | **F1** OCC가 ARRIVED를 확인 |
| **논리 확인 vs 운용 응답** | READBACK 한 단어가 "받았다"와 "하겠다"를 모두 뜻한다 | 도착했지만 읽히지 않은 메시지와 전달되지 않은 메시지를 구별할 수 없다 | **F1**(확인 종류), 작다 |
| **전달 실패를 발신자에게 되돌림** | `dispatch undelivered`(ATC-183). `success:false`는 OCC가 기록한다. CREW CHANGE에는 `undelivered` op이 없다(알려진 틈으로 적혀 있다) | CREW CHANGE의 틈. 순번 검사 없음 | **F3**(CREW CHANGE 포함) |
| **ATS contingency 계획** | CONTROL RECYCLE([control-recycle.md](../control-recycle.md)), GROUND STOP과 ATFM([atfm.md](../atfm.md)), MCC 모드([mcc.md](../mcc.md)) | "관제 세션 하나가 없다", "전부 없다"에 대한 서면 계획이 없다. ATC-251 교착(I2)은 고장 난 것에 기대는 단계를 보여 준다 | **F9**, **F11** |
| **ATC zero와 복구 순서** | 관제 세션은 하나씩 LAUNCH한다(SUPERVISOR 버튼). 순서는 쓰여 있지 않다(I5). ATC-255가 일괄 동작을 제안한다 | 순서가 없다. 복구되는 동안 DISPATCH와 MCC를 붙잡는 것이 없다. 호스트 preflight가 없다 | **F9**, **F10** |
| **Position relief briefing** | OCC: `restartSafetyOf`(네 조건), 도착 즉시 기록, `schedule wip`([control-recycle.md](../control-recycle.md) 4절). TOWER: "이미 보고함" key가 세션 쪽에 있다(2.3의 3번, 미완) | 떠나는 세션이 쓰는 briefing이 아니다. MCC, CROSSCHECK, TOWER, ACCOUNT 이동에는 같은 것이 없다 | **F8** |
| **MAYDAY/PAN-PAN, 7700** | WARNING·CAUTION 수준, BELL cue, 소리([alerting.md](../alerting.md)) | 중요한 틈이 아니다. 수준이 있다 | 없음 |
| **A-N-C 순서, 점검표** | CREW BRIEFING, `atc-task` skill, 역할별 매뉴얼 | 막힌 AIRCRAFT에게 정해진 순서(일을 안전하게 두기, WIP 커밋, 그다음 보고)가 없다 | **F4** |
| **MEL / 알려진 결함** | AIRCRAFT용 `until`이 있는 AOG와 RETURN([fleet.md](../fleet.md) 8.6). Linear와 PR 사이 FOLLOWING `mismatch` | *dispatch*가 이슈가 아직 열려 있고 이미 고쳐지지 않았는지 다시 확인하지 않는다(I6b) | **F7** |
| **알려진 중단의 NOTAM** | ALERTS, BELL, TOWER LOG | 모든 세션이 읽는, 날짜 붙은 짧은 "알려진 중단" 줄이 없다(예: "교차 ACCOUNT 전달 중단") | **F6**(나이 표시)과 **F3** |
| **정보에는 나이가 있다** | [squelch.md](../squelch.md) fingerprint, `arrivalMissing`의 `ageMin`, FLEET "마지막 활동" | TOWER·OCC 요약과 BELL은 진술이 얼마나 낡았는지 말하지 않는다(I6a). RECALL이 막힘을 지우지 않는다 | **F6** |
| **NORDO는 "교신하다 잃음"** | FLEET: NORDO = 같은 이름의 살아 있는 세션 없이 죽은 세션([fleet.md](../fleet.md) 8.6절 AOG 행). TOWER는 NORDO STAND를 `open.orphans`로 센다([controller/CLAUDE.md](../../controller/CLAUDE.md)) | AIRCRAFT를 launch한 적 없는 STAND는 NORDO가 아니다(I6c) | **F5** |
| **사건 보고** | SAFETY REPORT([safety-report.md](../safety-report.md)): 관제 세션이 자기 매뉴얼의 마찰을 보고하고, 묶고, ENGINEERING으로 고친다 | 겪은 세션이 알아챌 *때만* 보고된다. 그날 아침 여섯 사고는 SUPERVISOR가 찾았다. 정해진 trigger로 자동 접수하지 않는다 | **F12** |

## 11. 제안하는 후속 작업

노력 대비 가치로 순위를 매겼다. **Tier**는 있을 법한 파일에 `deploy/landing-tier.mjs` 규칙을 댄 추정이다. **Size**는 wake 글자(L 작음, M 중간, H 큼). **설계 문서?**는 `docs/<주제>.md`가 먼저 필요한지다. 정해진 것은 없다.

| 순위 | ID | 제안 | 해결 | Tier | Size | 설계 문서? |
|---|---|---|---|---|---|---|
| 1 | **F1** | **OCC가 ARRIVED를 확인한다.** `dispatch report` 뒤 고정 답 `[OCC → TEAM_X] ROGER ARRIVED ATC-n`. ROGER가 15분 동안 없으면 CAPTAIN이 한 번 다시 보내고 최종 줄에 그렇게 적는다. `arrivalMissing`은 두 번째 검사로 남는다 | I4 | `occ/send-guard.mjs`가 바뀌면(새 전송 종류) `user`, 아니면 `flagged` | L–M | 아니오([occ.md](../occ.md)에 짧게 추가) |
| 2 | **F5** | **launch한 적 없는 STAND를 NORDO라 부르지 않는다.** NORDO는 살아 있는 세션(또는 launch)이 *있었다가* 사라졌을 때만. 아니면 `NOT LAUNCHED`나 `AWAITING LAUNCH`로 하고 `open.orphans`에 넣지 않는다 | I6c | `auto` | L | 아니오 |
| 3 | **F6** | **나이 표시.** TOWER LOG 줄, OCC 요약, `brief` 필드마다 `as of <시각>`을 적고, BELL과 요약은 N분보다 낡은 진술을 `STALE (Nm)`로 표시한다. RECALL이나 CLEARANCE 응답은 가리키는 막힘을 같은 단계에서 지운다 | I6a | `flagged`(관제 매뉴얼) | M | 짧게 |
| 4 | **F4** | **AIRCRAFT의 lost-comms 규칙.** CREW BRIEFING에(모든 AIRPORT 같은 한 문단): OCC나 TOWER에 닿지 못할 때의 행동 순서(*일을 안전하게 두기 → WIP 커밋 → 받아 둔 FLIGHT를 계획대로 계속 → OCC와 TOWER 둘 다에 이름으로 보고 → PR 본문에 두절 시각 적기*). 관련 없는 일은 시작하지 않는다. 계획 자체가 안전하지 않을 때만 탭으로 SUPERVISOR에게 묻는다 | I1, I3 | `flagged`(서버 글) | L | 아니오 |
| 5 | **F2** | **없는 사건을 위한 단계 사다리 하나**, 항공의 이름으로: `INCERFA`(아직 아무것도 없음: 문의), `ALERFA`(SUPERVISOR에게 경보: CAUTION), `DETRESFA`(행동: WARNING, 다음 행동 명시). 기존 규칙(NO READBACK, `no-departure`, `no-report`, `undelivered`, NEEDS YOU 나이, tick이 없는 관제 세션) 위의 순수 함수. 단계마다 타이머가 한 표에 있고 *다음에 누구를 부르는지* 말한다 | I1, I3, I4 | `flagged` | M | **예**(타이머와 용어 합의가 필요) |
| 6 | **F7** | **release 때 다시 확인.** `dispatch release` 전에 OCC가 이슈 상태와, 병합된 PR이 이미 `Fixes ATC-n`을 담고 있는지 다시 읽는다(MEL의 생각: release는 조건이 아직 맞을 때만 유효하다) | I6b | `flagged` | L | 아니오 |
| 7 | **F3** | **두 번째 길.** (a) FLIGHT PLAN·RECALL·CREW CHANGE 글을 두는 서버 쪽 **mailbox**: CAPTAIN이 hook이나 tick으로 읽어서 `SendMessage`가 실패해도 전달이 끝나지 않는다. (b) **중계**: 양쪽에 닿는 세션(TOWER나 같은 ACCOUNT 동료)이 전달한다. CREW CHANGE `undelivered`를 포함한다 | I1 | `user`(hook, guard) | H | **예** |
| 8 | **F8** | **관제 세션의 relief briefing.** STOP 전에 서버가 세션별 `handover` 기록을 쓴다(이미 있는 자료에서: 확인 안 된 보고, 열린 CLEARANCE, 10분 미만 `sent`, `wip`). 새 세션이 읽고 LOG에 "I have the position"이라 적는다. TOWER, MCC, ACCOUNT 이동으로 넓힌다 | I4, I5 | `flagged` | M | **예**(작게) |
| 9 | **F9** | **`docs/contingency.md`: ATC zero 계획.** 다른 관제 세션이 없을 때 각 세션이 할 일. **복구 순서**(확인할 제안: 서버, TOWER, OCC, CROSSCHECK·REVIEW, MCC는 마지막. AIRCRAFT 목록을 알 때까지 DISPATCH와 MCC는 붙잡음). 사람이 끝낼 때까지 landing과 RTS를 붙잡는 "recovery mode". ATC-255 일괄 LAUNCH와 연결 | I5 | 문서는 `auto`, 구현은 `user` | M–H | **예**(이 문서가 설계다) |
| 10 | **F11** | **순환 gate 금지.** 설계 검토 규칙과 테스트: fallback은 고장 난 것을 기다리지 않는다(APPLY NOW와 전송 교착). 이미 승인된 FLIGHT PLAN의 전송은 OCC의 움직임에 기대지 않는다 | I2 | `flagged` | L | 아니오(F9에 넣는다) |
| 11 | **F10** | **호스트 preflight.** LAUNCH ALL / RTS 전에 한 번 검사: 커널 task 한도 대 띄울 세션 수, 남은 메모리, `claude` daemon 상태. "launch하지 말 것" ALERT로 보인다 | I5 | `auto` | L–M | 아니오 |
| 12 | **F12** | **사건이 스스로 접수된다.** F2 사다리가 `ALERFA`에 닿거나 정해진 조건(전달 두 번 실패, 세션 NORDO 10분 초과)이면 atc가 아는 사실로 SAFETY REPORT 초안(S0)을 연다. 자발 보고는 그대로. 월간 "보고 덕에 바뀐 것" 목록이 루프를 닫는다 | 전부 | `flagged` | M | 짧게([safety-report.md](../safety-report.md)에) |

**자연스러운 작업 순서:** F1, F5, F6, F4, F7은 작고 서로 독립이며 실제 사례를 고친다. 설계 없이 시작할 수 있다. F2는 나머지를 일관되게 만드는 구조이므로 F1과 F5를 만드는 동안 짧은 설계를 쓴다. F3, F8, F9는 더 크고 각각 설계가 필요하다. 일괄 launch 구현 전에 F9(계획)가 먼저다.

## 12. 이 보고서가 말하지 않는 것

- 항공의 숫자(30분, 5분)가 atc에 맞는다고 말하지 않는다. **출발점의 모양**일 뿐이다. atc의 FLIGHT는 몇 분에서 하루까지 걸리므로 단계마다 값이 따로 필요하다(기존 NO READBACK 10분과 `no-report` 30분이 첫 추정이다).
- ICAO 단계 문구를 화면에 그대로 옮기자고 하지 않는다. SUPERVISOR가 읽는 글은 `docs/alerting.md`대로 둔다(WARNING·CAUTION·ADVISORY). INCERFA·ALERFA·DETRESFA는 사다리의 내부 이름이다(SUPERVISOR가 화면에서도 원하면 F2 설계에서 정할 일).
- 계정과 한도([accounts.md](../accounts.md), [ATC-251](https://linear.app/vocado/issue/ATC-251))는 다루지 않는다. 길을 잃었을 때 *무엇을 해야 하는지*만 다룬다.

## 출처

- ICAO: Annex 2(§3.6.5, 부록 1 light signal), Annex 10 vol II·vol IV(조난, 7500/7600/7700), Annex 11(§2.30, 5장 alerting), Annex 12, Annex 15, Annex 19. Doc 4444 PANS-ATM(12장, 15장), Doc 9426, Doc 9880(AMHS), Doc 10037 GOLD.
- FAA: [14 CFR 91.185](https://www.ecfr.gov/current/title-14/section-91.185)(IFR 양방향 무선 고장), 91.213(작동하지 않는 장비). [AIM](https://www.faa.gov/air_traffic/publications/atpubs/aim_html/) 4-3-13, 6-4-1, 6-4-2. [JO 7110.65](https://www.faa.gov/air_traffic/publications/atpubs/atc_html/) 2-1, 4-2-3, 10장. JO 7210.3, JO 1900.47, AC 00-46(ASRS).
- EU: [Reg (EU) 376/2014](https://eur-lex.europa.eu/eli/reg/2014/376/oj)(사건 보고), Reg (EU) 2017/373(ATM/ANS, contingency).
- [NASA ASRS](https://asrs.arc.nasa.gov/), [SKYbrary](https://skybrary.aero/)(radio communication failure, alerting service, position handover, ATC zero).
- atc: [alerting.md](../alerting.md), [fleet.md](../fleet.md), [occ.md](../occ.md), [dispatch.md](../dispatch.md), [control-recycle.md](../control-recycle.md), [radio.md](../radio.md), [squelch.md](../squelch.md), [safety-report.md](../safety-report.md), [atfm.md](../atfm.md), [mcc.md](../mcc.md), [aviation-signals.ko.md](aviation-signals.ko.md)(호출·확인·완료를 다룬 앞선 조사, ATC-118).
