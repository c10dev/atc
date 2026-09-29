# menubar/ — SUPERVISOR용 macOS 메뉴 막대

[English](README.md) · **한국어**

[SwiftBar](https://github.com/swiftbar/SwiftBar) 플러그인(ATC-149). 15초마다 atc를 읽어 지금 기다리는 것과 그 심각도를 메뉴 막대 제목에 보이고, 항목을 누르면 브라우저에서 알맞은 atc 탭이 열린다. **읽기만 한다**: GET만 하고 주소를 열 뿐이다. 승인, ACK, 스위치는 브라우저에서 한다. 새 엔드포인트, 토큰, CORS 변경은 없다. 사용 안내: [docs/guide/menubar.md](../docs/guide/menubar.md).

| 파일 | 하는 일 |
|---|---|
| `atc.15s.mjs` | 플러그인. Mac의 node가 돌린다(`#!/usr/bin/env node`, `15s`가 갱신 주기). GET을 하고 메뉴를 출력하고 알림을 보내고, 본 key를 `$SWIFTBAR_PLUGIN_CACHE_PATH/seen.json`에 둔다 |
| `format.mjs` | 순수 표시 함수: alerts·fleet·update·control JSON을 받아 SwiftBar 줄을 내고, 새 key 비교와 `swiftbar://notify` 주소를 만든다 |
| `format.test.mjs` | Linux에서 도는 `node:test`(빈 것, advisory만, warning, call, 연결 안 됨, `\|`가 든 한글 문구). `npm test`에 든다 |

## 읽는 것

| 엔드포인트 | 쓰임 |
|---|---|
| `GET /api/supervisor-alerts` | 항목(level, cue, text, next, link). 꼭 필요하다: 실패하면 제목이 `✈ —` |
| `GET /api/fleet` | `fuelAccounts`(가장 많이 쓴 ACCOUNT: `5h 33% · 7d 53%`)와 `busy`인 AIRCRAFT 수 |
| `GET /api/update` | 마지막 RTS(`RTS ok 15:21 · …`) |
| `GET /api/control/sessions` | 일하는 관제 세션 수 |

꼭 필요하지 않은 엔드포인트가 안 되면 그 줄만 빠진다. 주소는 `ATC_URL`(기본 `http://localhost:7700`)이다.

## 메뉴

- 제목: `✈ <WARNING+CAUTION> [+<ADVISORY>] <FUEL>`. WARNING이 있으면 빨강, CAUTION이 있으면 호박색, 아니면 기본색. atc에 닿지 않으면 `✈ —`와 "atc 연결 안 됨: SSH 포워딩 확인".
- 등급별 항목(높은 것 먼저, 등급마다 15개, 나머지는 `외 n개`), 각 줄은 `text — next`, 누르면 `<ATC_URL>/<link>`가 열린다.
- DISPATCH 승인 대기 수(`#dispatch`), 마지막 RTS, 일하는 AIRCRAFT와 관제 세션 수, `Open atc`, `Refresh`.
- 알림: 지난 실행 뒤 처음 본 key 가운데 level이 `warning`이거나 cue가 `call`인 것마다 `swiftbar://notify`를 한 번 보낸다(`open -g`). 처음 실행은 지금 있는 것을 본 것으로 치고 알리지 않는다. 본 key는 7일 뒤 지운다.

문구 속 `|`는 SwiftBar의 매개변수 구분자라서 `¦`로 보인다. 줄바꿈은 공백이 되고 맨 앞 `-`(하위 메뉴 표시)는 `–`가 된다.

## 설치

안내 쪽을 본다. 요약: SwiftBar를 설치하고, 이 폴더를 플러그인 폴더로 지정하거나(`atc.15s.mjs`와 `format.mjs`를 같이 복사), `chmod +x atc.15s.mjs`, `localhost:7700`이 atc에 닿게 한다. atc가 다른 곳에서 돌면 SSH 로컬 포워딩(`ssh -N -L 7700:127.0.0.1:7700 <호스트>`)을 쓴다. **7700을 LAN에 열지 않는다**: atc에는 로그인이 없고 Origin 검사는 접근 통제가 아니다.

Mac에서 확인하지 않은 것: SwiftBar 표시와 알림은 Linux에서 만들었다(순수 모듈은 거기서 시험한다). 머지 뒤 SUPERVISOR가 확인한다.
