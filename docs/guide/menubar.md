# Mac 메뉴 막대

화면을 열지 않아도 Mac 메뉴 막대에서 atc를 봅니다. [SwiftBar](https://github.com/swiftbar/SwiftBar) 플러그인 하나가 15초마다 atc를 읽어 지금 기다리는 것과 그 심각도를 제목에 보이고, 항목을 누르면 브라우저에서 알맞은 atc 탭이 열립니다. **읽기만 합니다**: 승인, ACK, 스위치는 브라우저에서 합니다.

## 무엇이 보이나

- **제목**: `✈ 2 +18 5h 33% · 7d 53%`. 앞 숫자는 조치가 필요한 WARNING·CAUTION 수(화면 상단 숫자와 같다), `+18`은 ADVISORY 수, 뒤는 가장 많이 쓴 ACCOUNT의 FUEL(5시간·7일)입니다. WARNING이 있으면 빨강, CAUTION이 있으면 호박색, ADVISORY만 있으면 기본색입니다.
- **펼친 메뉴**:
  - 등급별 항목(높은 것 먼저, 등급마다 15개까지, 나머지는 `외 n개`). 각 줄은 문구와 다음 한 걸음이고, 누르면 그 항목이 있는 탭이 열립니다.
  - DISPATCH 승인 대기 수(누르면 `#dispatch`), 마지막 RTS 결과와 시각, 일하는 AIRCRAFT와 관제 세션 수.
  - `Open atc`(첫 화면), `Refresh`(바로 다시 읽기).
- **알림**: 새로 생긴 항목 가운데 등급이 WARNING이거나 CALL(SUPERVISOR를 기다리는 새 항목)인 것마다 macOS 알림이 한 번 뜹니다. 이미 본 항목은 플러그인이 SwiftBar 플러그인 캐시 폴더에 적어 두고(atc 상태 폴더가 아닙니다), 처음 실행할 때는 지금 있는 항목을 모두 본 것으로 치고 알리지 않습니다.
- **atc에 닿지 않으면** 제목이 `✈ —`이고 메뉴에 "atc 연결 안 됨: SSH 포워딩 확인"만 보입니다.

## 설치

1. SwiftBar를 설치합니다(`brew install --cask swiftbar`). Mac에 node도 있어야 합니다.
2. atc 저장소의 `menubar/` 폴더를 SwiftBar의 플러그인 폴더로 지정하거나, `menubar/atc.15s.mjs`와 `menubar/format.mjs`를 플러그인 폴더에 같이 복사합니다(플러그인이 옆의 `format.mjs`를 읽습니다). 스크립트에 실행 권한을 줍니다: `chmod +x atc.15s.mjs`.
3. 파일 이름의 `15s`가 갱신 주기입니다. atc 주소가 `http://localhost:7700`이 아니면 SwiftBar 플러그인 환경 변수 `ATC_URL`에 적습니다.

## atc가 도는 곳이 다른 컴퓨터일 때: SSH 포워딩

Mac의 브라우저가 이미 `http://localhost:7700`으로 atc를 열고 있다면 포워딩이 이미 있는 것이니 **더 할 것이 없습니다.**

atc가 다른 컴퓨터(서버)에서 돈다면 Mac에서 로컬 포워딩을 계속 켜 둡니다:

```bash
ssh -N -L 7700:127.0.0.1:7700 <호스트>
```

끊겨도 다시 붙게 하려면 `autossh -M 0 -N -L 7700:127.0.0.1:7700 <호스트>`를 쓰거나, 로그인할 때 시작하는 launchd 유닛으로 둡니다(`~/Library/LaunchAgents/dev.atc.forward.plist`, `launchctl load`로 켠다):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.atc.forward</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/ssh</string><string>-N</string>
    <string>-o</string><string>ExitOnForwardFailure=yes</string>
    <string>-o</string><string>ServerAliveInterval=30</string>
    <string>-L</string><string>7700:127.0.0.1:7700</string>
    <string><호스트></string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

## 7700을 LAN에 열지 마세요

메뉴 막대를 위해 atc를 `0.0.0.0`이나 LAN 주소로 열지 않습니다. atc에는 로그인이 없어서, 그 주소에 닿는 누구나 알림을 보고 **승인·스위치·머지 흐름까지 누를 수 있습니다.** 서버의 Origin 검사는 다른 사이트가 브라우저를 통해 몰래 요청하는 것을 막을 뿐 접근 통제가 아닙니다(직접 요청을 보내는 쪽은 `Origin: http://localhost` 헤더를 스스로 적어 통과할 수 있고, 읽기 요청은 검사도 없습니다). 그래서 atc는 `127.0.0.1`에만 듣고, 다른 컴퓨터에서는 SSH 포워딩으로만 닿습니다. 메뉴 막대를 위한 새 엔드포인트, 토큰, CORS 변경도 없습니다: 플러그인은 이미 있는 `GET /api/supervisor-alerts`, `/api/fleet`, `/api/update`, `/api/control/sessions`만 읽습니다.

## 문제 해결

- **`✈ —`만 보임**: 브라우저로 `http://localhost:7700`이 열리는지 봅니다. 안 열리면 SSH 포워딩이 끊긴 것입니다.
- **알림이 안 옴**: SwiftBar의 알림 권한(시스템 설정 → 알림)을 확인합니다. 처음 실행한 바퀴에는 알리지 않습니다.
- **알림이 다시 옴**: 플러그인 캐시 폴더의 `seen.json`이 지워졌거나 7일이 지난 항목입니다.

이 플러그인의 SwiftBar 표시와 macOS 알림은 Linux에서 만들어 Mac에서 아직 확인하지 않았습니다. 처음 쓰는 사람이 확인해 주세요. 소스와 시험은 저장소의 `menubar/`에 있습니다.
