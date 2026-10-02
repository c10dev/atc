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
- 같은 스트림으로 `version`(서버가 내주는 번들)도 온다. `main.tsx`가 `new URL(import.meta.url).pathname`(빌드에서는 `/assets/index-<hash>.js`)으로 이 화면의 번들을 재고, 둘이 다르면 `NewVersion.tsx`가 머리글 아래에 "새 버전이 배포됨 · 새로고침"을 띄운다(`server/version.ts`의 `showNewVersion`). 저절로 새로고침하지 않고, 닫기를 누르면 탭이 떠 있는 동안 그 빌드에 대해서는 숨긴다. 개발 서버(`/src/main.tsx`)이거나 서버에 빌드가 없으면 뜨지 않는다.
- **코드 나누기.** 첫 화면인 RADAR와 공용 부분(머리글, 새 버전 알림, SSE)만 메인 번들에 있다. 나머지 탭은 처음 열 때 불러오는 `React.lazy` 청크이고, 그 탭의 CSS와 그 탭만 쓰는 라이브러리도 함께 간다(DOCS에 `marked`와 안내 Markdown). 이름 있는 export view는 `lazyTab.tsx`가 감싼다. 불러오는 동안 탭에 "화면 불러오는 중…"이 보인다. 빌드(2026-09-27): 메인 `index` 261 kB(gzip 83 kB, 한 번들이던 때 512 kB·159 kB)와 CSS 47.7 kB, DOCS 107 kB, DISPATCH 46 kB, SCHEDULE 28 kB, FLEET 24 kB, NETWORK 16 kB, 나머지는 12 kB 아래. 500 kB 경고는 없어졌다.
- **배포 뒤 예전 탭.** 빌드가 `web/dist`를 비우므로, 배포 전에 연 탭은 이제 없는 청크 파일을 부른다(404). 탭마다 오류 경계(`TabBoundary`)가 있어, 청크를 못 불러오면 그 탭에만 "이 화면을 불러오지 못함"과 새로고침 버튼이 뜬다. 서버의 빌드가 이 화면과 다르면(`showNewVersion`) "새 버전이 배포되어 …"라고, 아니면 파일을 받지 못했다고 쓴다. `isChunkLoadError`(`server/version.ts`)가 Chrome·Firefox·Safari와 Vite CSS 미리 읽기의 문구를 알아본다. 이미 불러온 탭은 그대로 동작하고, 저절로 새로고침하지 않으며(입력 중인 글이 남는다), 새 버전 알림도 그대로 뜬다. 탭 안의 다른 오류도 같은 경계가 받아 화면 전체가 비지 않는다. 빌드 정체는 그대로 진입 스크립트다: 진입 파일에 lazy 청크 이름이 들어 있어 청크나 그 CSS가 바뀌면 진입 해시도 바뀐다.
- `derive.ts`가 스냅샷에서 조회용 색인을 만든다(티켓 → 워크트리 → 점유 → 세션, 세션 위치, 정렬).
- 타입은 서버에서 그대로 가져온다(`../../server/model.ts` 등). 그래서 화면과 API가 어긋나지 않는다.
- METRICS, DISPATCH, SCHEDULE은 자기 API(`/api/metrics`, `/api/dispatch/…`, `/api/schedule/brief`)를 따로 부르고, 1분마다(스냅샷 시각 기준) 다시 부른다.

## 화면

탭은 URL 해시로 연다. 예전 북마크(`#map`, `#teams`, `#tickets`)도 열린다.

| 탭 | 해시 | 파일 | 보여 주는 것 |
|---|---|---|---|
| RADAR | `#radar` | `views/Map.tsx` | 세션 ─ 워크트리 ─ 티켓 3열을 선으로 연결. 교차가 줄도록 무게중심(barycenter) 순으로 정렬 |
| STRIPS | `#strips` | `views/Teams.tsx`, `views/Teams.css` | 맨 위 LANDING SEQUENCE(`snapshot.pulls`의 열린 PR: CLEARED TO LAND는 `readyAt` 순, APPROACH는 접어서, Draft는 흐리게 접어서. `github.error`가 있으면 안내), 그 아래 세션마다 운항 스트립 하나: 상태, 점유한 STAND와 STAND별 PR 배지(`CLEARED TO LAND` + `SEQ n`, 또는 `APPROACH` + 막는 조건 수와 펼치는 조건 목록, `#PR` 링크), 티켓, CLEARANCE(READBACK 대기 파랑, NO READBACK 주황, READBACK 점선) |
| FIDS | `#board` | `views/Tickets.tsx` | DEPARTURES 안내판(TIME · FLIGHT · DESTINATION · AIRCRAFT · STAND · PRI · REMARKS) 또는 비행 단계별 보드 |
| AIRPORTS | `#airports` | `views/Airports.tsx` | 저장소 등록부: 개설·이름 변경·폐쇄·재개·삭제, 소속 AIRCRAFT와 TRANSIENT |
| METRICS | `#metrics`, `#metrics/leaks`, `#metrics/misfire`, `#metrics/fuel`, `#metrics/network` | `views/Metrics.tsx` | 하위 화면 OPERATIONS, LEAKS, MISFIRE(사람 없이 도는 모든 레인: DISPATCH·SCHEDULE·FLEET PLAN, `views/MetricsMisfire.tsx`), FUEL, NETWORK(`views/Network.tsx`, `GET /api/network`의 4단계 읽기 전용 개요. 옛 `#network`도 여기) |
| FLEET | `#fleet` | `views/fleet/Fleet.tsx`(부분마다 `views/fleet/`의 파일 하나) | AIRCRAFT마다 상태, 지금 FLIGHT, 프로필(CREW, TYPE RATING, ROUTE, TARGET). ENTRY INTO SERVICE, CREW BRIEFING, AOG, RETIREMENT |
| DISPATCH | `#dispatch` | `views/Dispatch.tsx` | 2단계 제안: 2a에서는 그림자 판정, 2b에서는 승인·거절, IN FLIGHT(SENT, READBACK, 늦음)와 3단계 점검. 확인 창을 거치는 모드 전환 |

머리글은 1760px 넘는 폭에서 로고·탭·수치를 한 줄에 둔다. 861~1760px에서는 탭이 머리글 둘째 줄로 내려가고, 860px 이하에서는 탭이 여러 줄로 감긴다.

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
| `src/main.tsx` | 첫 화면을 그리기 전에 저장된 설정을 적용하고, 이 화면의 번들 경로를 재고, `App`을 띄운다 |
| `src/App.tsx` | 머리글, 탭, ALERT 티커, HANDOFF 목록, 시계. 탭 view를 lazy로 불러온다(`tabView`) |
| `src/lazyTab.tsx` | `lazyTab`(이름 있는 export용 React.lazy), `TabLoading` 자리 표시, `TabBoundary`(청크를 못 불러온 경우의 안내가 있는 탭별 오류 경계) |
| `src/useSnapshot.ts` | SSE 연결(스냅샷과 서버의 번들). `useNow`는 상대 시간이 흘러가도록 다시 그린다 |
| `src/NewVersion.tsx` | "새 버전이 배포됨 · 새로고침" 알림(polite `role="status"` 영역) |
| `src/derive.ts` | 스냅샷 색인과 도우미 함수 |
| `src/aviation.ts` | 코드 이름 → 항공 용어, 비행 단계 색과 약호 |
| `src/settings.ts` | 설정 저장소, 테마, 시각 표기 |
| `src/SettingsPanel.tsx` | 설정 창 |
| `src/SplitFlap.tsx` | Solari 스플릿 플랩 글자. 칸이 드럼(공백, A–Z, 0–9, `: - . /`) 순으로 최대 6판, 왼쪽부터 넘어간다. 판(타일)은 실제 판처럼 떨어지고, 판 없는 글자는 한 글자씩 떨어져 앉는다. 화면에 보이는 판만 움직인다 |
| `src/Ticker.tsx` | 흐르는 ALERT 티커 |
| `src/Starfield.tsx` | Night Sky 배경(30fps 제한, 탭이 가려지면 멈춤)과 오늘의 달 모양 아이콘 |
| `src/ui.tsx` | 작은 공용 조각: AIRPORT 코드, OUTSTATION 표시, 세션 위치, 상태 점, 우선순위 표시 |
| `src/styles.css`, `src/ui.css`, `src/views/*.css` | 테마 토큰과 스타일 |
| `src/views/*.tsx` | 탭마다 파일 하나. FLEET는 폴더 `src/views/fleet/`이고, 부분(쪽 틀, 운항 상태 목록, 카드, FUEL, ENTRY INTO SERVICE, LAUNCH·CREW BRIEFING 패널, 편집기)마다 파일 하나에 CSS가 옆에 있다 |
