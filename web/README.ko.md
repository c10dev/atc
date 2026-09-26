# web — ATC 화면

[English](README.md) · **한국어**

atc 웹 화면이다. Vite + React 19 단일 페이지 앱으로, atc 서버의 실시간 스냅샷을 항공 용어로 보여 준다. 데이터는 모두 서버의 `/api`에서 오고, 화면이 따로 저장하는 것은 브라우저의 표시 설정뿐이다.

## 실행

저장소 루트에서:

```bash
npm run dev        # vite :7700 (/api는 :7701 API 서버로 프록시) + --watch로 도는 API 서버
npm run build      # web/dist로 빌드. 서버가 :7700에서 제공한다
npm run typecheck
```

상시 운용에서는 systemd 서비스가 재시작할 때마다 다시 빌드한다([deploy](../deploy/README.ko.md)).

## 데이터 흐름

```
서버 ──SSE /api/events (2초마다 스냅샷)──▶ useSnapshot ──▶ buildIndex ──▶ 화면
```

- `useSnapshot.ts`가 `/api/events`에 `EventSource`를 열고 최신 `Snapshot`을 들고 있다. 머리글에 연결 상태(실시간·연결 중·끊김)를 보인다.
- `derive.ts`가 스냅샷에서 조회용 색인을 만든다(티켓 → 워크트리 → 점유 → 세션, 세션 위치, 정렬).
- 타입은 서버에서 그대로 가져온다(`../../server/model.ts` 등). 그래서 화면과 API가 어긋나지 않는다.
- METRICS, DISPATCH, SCHEDULE은 자기 API(`/api/metrics`, `/api/dispatch/…`, `/api/schedule/brief`)를 따로 부르고, 1분마다(스냅샷 시각 기준) 다시 부른다.

## 화면

탭은 URL 해시로 연다. 예전 북마크(`#map`, `#teams`, `#tickets`)도 열린다.

| 탭 | 해시 | 파일 | 보여 주는 것 |
|---|---|---|---|
| RADAR | `#radar` | `views/Map.tsx` | 세션 ─ 워크트리 ─ 티켓 3열을 선으로 연결. 교차가 줄도록 무게중심(barycenter) 순으로 정렬 |
| STRIPS | `#strips` | `views/Teams.tsx` | 세션마다 운항 스트립 하나: 상태, 점유한 STAND, 티켓, CLEARANCE(READBACK 대기 파랑, NO READBACK 주황, READBACK 점선) |
| FIDS | `#board` | `views/Tickets.tsx` | DEPARTURES 안내판(TIME · FLIGHT · DESTINATION · AIRCRAFT · STAND · PRI · REMARKS) 또는 비행 단계별 보드 |
| AIRPORTS | `#airports` | `views/Airports.tsx` | 저장소 등록부: 개설·이름 변경·폐쇄·재개·삭제, 소속 AIRCRAFT와 TRANSIENT |
| METRICS | `#metrics` | `views/Metrics.tsx` | FLIGHT RECORDER 운용 지표와 2단계 진입 점검 |
| FLEET | `#fleet` | `views/Fleet.tsx` | AIRCRAFT마다 상태, 지금 FLIGHT, 프로필(CREW, TYPE RATING, ROUTE, TARGET). ENTRY INTO SERVICE, CREW BRIEFING, AOG, RETIREMENT |
| DISPATCH | `#dispatch` | `views/Dispatch.tsx` | 2단계 제안: 2a에서는 그림자 판정, 2b에서는 승인·거절, IN FLIGHT(SENT, READBACK, 늦음)와 3단계 점검. 확인 창을 거치는 모드 전환 |
| SCHEDULE | `#schedule` | `views/Schedule.tsx` | OCC S1 초안(그림자 운용): S2 진입 점검 패널, 열린 초안 카드(FLIGHT, 지금 분류, 바뀔 것, OCC 근거)와 "승인했을 것 / 거절했을 것"(거절은 사유 칩과 메모), Linear에서 손으로 바꿀 것 안내, 후보, RECENT(최근 7일 닫힌 초안) |

머리글은 1560px 넘는 폭에서 로고·탭·수치를 한 줄에 둔다. 861~1560px에서는 탭이 머리글 둘째 줄로 내려가고, 860px 이하에서는 탭이 여러 줄로 감긴다.

위쪽에는 ALERT 티커(`Ticker.tsx`, 폭을 넘칠 때만 흐르고 마우스를 올리거나 포커스하면 멈춤)와 HANDOFF 목록이 있다.

## 항공 용어

코드 이름을 화면 이름으로 바꾸는 곳은 `aviation.ts` 하나다. 세션 상태 → AIRBORNE / HOLDING / PARKED / NORDO, Linear 상태 → 비행 단계(FILED, ENROUTE, APPROACH, CLEARED TO LAND …), 경보 → LOSS OF SEPARATION, NORDO STAND, UNIDENTIFIED, NO CONTACT. 코드와 API는 `Session`, `Workspace`, `Ticket`, `Claim`을 그대로 쓴다([용어](../README.ko.md#용어)).

## 설정

ATC 로고를 누르면 설정 창이 열린다(`SettingsPanel.tsx`, Esc나 바깥을 누르면 닫힘). 설정은 이 브라우저의 `localStorage`(`atc.settings`)에만 저장되고 서버에는 가지 않는다.

| 설정 | 값 | 기본값 |
|---|---|---|
| 테마 | Radar Console(`radar`) · Glass Cockpit(`cockpit`) · Night Sky(`night`) | `radar` |
| 애니메이션 | 켜기/끄기 — 레이더 스윕, 별, 깜빡임, 스플릿 플랩, 티커 흐름 | OS가 동작 줄이기를 요청하면 끔 |
| 시각 | UTC(`06:24Z`) / 지역 시각(`15:24L`) | UTC |
| 밀도 | 보통 / 촘촘(한 단계 4px씩 좁게) | 보통 |
| 유성 | 켜기/끄기(Night Sky) | 켜기 |
| FIDS 보기 | 목록 / 보드 | 목록 |
| FIDS 범위 | SCHEDULED와 지난 ARRIVED·CANCELLED 포함 | 끔 |

테마는 `styles.css`의 `:root[data-theme="…"]` 아래 CSS 토큰 묶음이다. `settings.ts`가 `<html>`에 `data-theme`, `data-motion`, `data-density`를 단다.

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 진입 페이지 |
| `src/main.tsx` | 첫 화면을 그리기 전에 저장된 설정을 적용하고 `App`을 띄운다 |
| `src/App.tsx` | 머리글, 탭, ALERT 티커, HANDOFF 목록, 시계 |
| `src/useSnapshot.ts` | SSE 연결. `useNow`는 상대 시간이 흘러가도록 다시 그린다 |
| `src/derive.ts` | 스냅샷 색인과 도우미 함수 |
| `src/aviation.ts` | 코드 이름 → 항공 용어, 비행 단계 색과 약호 |
| `src/settings.ts` | 설정 저장소, 테마, 시각 표기 |
| `src/SettingsPanel.tsx` | 설정 창 |
| `src/SplitFlap.tsx` | Solari 스플릿 플랩 글자. 칸이 드럼(공백, A–Z, 0–9, `: - . /`) 순으로 최대 6판, 왼쪽부터 넘어간다. 판(타일)은 실제 판처럼 떨어지고, 판 없는 글자는 한 글자씩 떨어져 앉는다. 화면에 보이는 판만 움직인다 |
| `src/Ticker.tsx` | 흐르는 ALERT 티커 |
| `src/Starfield.tsx` | Night Sky 배경(30fps 제한, 탭이 가려지면 멈춤)과 오늘의 달 모양 아이콘 |
| `src/ui.tsx` | 작은 공용 조각: AIRPORT 코드, OUTSTATION 표시, 세션 위치, 상태 점, 우선순위 표시 |
| `src/styles.css`, `src/ui.css`, `src/views/*.css` | 테마 토큰과 스타일 |
| `src/views/*.tsx` | 탭마다 파일 하나 |
