# 문제 해결

## 화면에 세션이 안 보인다

- 세션 이름을 확인한다. 팀은 `TEAM_X`, 관제 세션은 TOWER·OCC.
- 세션이 도구를 한 번도 안 썼으면 늦게 잡힐 수 있다.
- atc가 떠 있는지: `systemctl --user status atc`.

## OCC·TOWER가 새 지침을 모른다

`/tick`이 매 바퀴 `manual check`로 `CLAUDE.md`·`/tick` 변경을 확인한다. `~/.local/state/atc/manuals/`에 그 폴더의 기록이 없으면 아직 한 바퀴도 안 돈 것이다. 세션이 `/loop`로 돌고 있는지 확인한다.

## 관제 세션이 "막혔다"고 보고한다

guard가 막은 것이다(fail-closed). 관제 세션은 다시 시도하지 않는다. 메시지의 사유를 보고:

- **허용되지 않은 명령**: 관제 세션이 할 일이 아니다. 필요하면 사용자가 직접 한다.
- **명령 치환·변수 확장**: 문구를 작은따옴표로 감싸면 된다.
- **읽기 전용이 아닌 MCP 도구**: OCC는 S2 전까지 Linear·GitHub에 쓰지 않는다. CROSSCHECK는 언제나 읽기만 한다.
- **CROSSCHECK가 쓸 수 없는 atc 명령**: CROSSCHECK는 읽기와 `crosscheck` 명령만 쓴다. 메모·HOLD·초안·판정은 OCC와 사용자 몫이다.

## 점유가 ESTIMATED TRACK으로만 보인다

점유 hook이 설치되지 않았거나, 세션이 워크트리에서 파일을 고치거나 `cd`·`git -C`로 들어가지 않았다. 경로를 읽기만 하는 명령은 점유로 치지 않는다.

## 제안이 잘 안 나온다

DISPATCH 탭의 "제외" 목록에 이유가 있다. 흔한 이유:

- 우선순위 없음 → Linear에서 우선순위를 정한다(또는 SCHEDULE의 PRIORITIZE 초안을 보고).
- 상위 이슈 → 하위 이슈가 작업이다.
- `tail:` 팀이 바쁨 / 자격 있는 팀 없음 → FLEET 탭에서 자격을 주거나 라벨을 조정한다.
- 거절한 짝은 24시간 동안 다시 제안하지 않는다.
- 다른 Linear 팀(예: ATC)의 FLIGHT → 기본은 보여 주기만 한다. 제외 목록에도 나오지 않는다(아래 "다른 Linear 팀이 안 보인다").

## 다른 Linear 팀이 안 보인다

atc는 `.env.local`의 `LINEAR_TEAM_KEY`(주 팀)만 읽는다. 팀을 더 읽으려면 설정 창 LINEAR 탭의 **TEAMS**에 쉼표로 적는다(`LINEAR_TEAM_KEYS=VOC,ATC`). 저장하면 바로 다시 읽는다.

- 한 팀을 읽지 못하면 연결 상태에 그 팀과 오류가 나온다. 그 팀은 마지막으로 읽은 티켓을 계속 보인다.
- 더 읽은 팀의 FLIGHT는 RADAR·STRIPS·FIDS에만 보인다. 그 팀의 프로젝트와 마일스톤은 NETWORK 탭 ROUTE MAP과 SCHEDULE 탭 LATE WAYPOINTS에도 보인다. DISPATCH 제안과 SCHEDULE 초안은 `~/.local/state/atc/dispatch.json`의 `candidateTeams`에 든 팀만 받는다(비면 주 팀만). 그 밖의 팀에 SCHEDULE 초안을 쓰면 "SCHEDULE 후보가 아님"으로 거절된다.
- 팀의 FLIGHT가 어느 AIRPORT인지는 프로젝트 매핑이 먼저이고, 매핑에 없으면 `teamAirports`(기본 `ATC → ATCC`)를 쓴다.
- 브랜치·워크트리 이름에는 그 팀의 key를 넣는다(`claude/atc-12-…`). 그래야 STAND와 LOGBOOK이 그 FLIGHT를 찾는다.

## 초안이 사라졌다

SCHEDULE 초안은 FLIGHT가 Todo·Backlog를 벗어나거나, Linear에 이미 반영됐거나, 3일 동안 판정이 없으면 닫힌다. 최근 7일 표에서 사유를 본다.

## PR이 CLEARED TO LAND가 안 된다

PR에 붙은 막힌 조건을 본다([개념](concepts.md)의 LANDING SEQUENCE).

- `review-stale` / `no-review` → head(최신 커밋)에 리뷰도, 그 뒤에 달린 Codex 👍도 없다. push 뒤에는 리뷰를 다시 받는다(`@codex review` 등). PR 작성자 계정의 댓글은 세지 않는다. 문구가 "Codex 한도 — 사람 리뷰 필요"면 Codex가 한도에 걸린 것이라 사람이 리뷰해야 한다.
- `review-findings`(리뷰 지적) → Codex가 head에 COMMENTED 리뷰로 문제를 짚었거나, Codex 한도 때 착륙 리뷰 세션(DeepSeek)이 P0·P1 지적을 남겼다(글이 "DEEPSEEK 지적(…)"으로 시작하고 지적 내용이 들어 있다. TOWER가 CAPTAIN에게 전한다). Codex 지적이면 PR의 P1·P2 줄 댓글을 반영해 push하면 새 head를 Codex가 다시 본다(필요하면 `@codex review`). 지적이 틀렸다고 판단하면 스레드에 이유를 답하고 `@codex review`로 재리뷰를 받거나, 사람(작성자 계정 아님)이 지적을 보고 head에 APPROVED한다(Codex가 한도에 걸렸을 때도 이 길). 지적 뒤에 달린 Codex 👍나 지적 뒤의 사람 APPROVED가 있어야 풀린다. 지적 전의 APPROVED나 사람 COMMENTED로는 풀리지 않는다.
- `review-findings` 글이 "Codex P3 지적 … 해결·답글 없음"이면 → P3만 남았다. 고칠 만하면 고쳐 push하고, 아니면 스레드에 이유를 답글로 달거나 resolve한다. 그러면 착륙을 막지 않는다.
- `blocked` 글에 "해결 안 된 리뷰 스레드 N개"가 있으면 → vocado 보호 규칙(스레드 해결 필수)이다. 지적을 반영했거나 답했으면 GitHub에서 스레드를 resolve한다.
- `behind` → main이 앞서 갔다. rebase하고 push한다(CI와 리뷰를 다시 받는다).
- `no-checks` → 그 저장소에 CI가 없다(atc 등). CLEARED TO LAND가 될 수 없으니 SUPERVISOR가 직접 판단한다.
- `merge-unknown` → GitHub이 머지 가능 여부를 계산 중이다. 잠시 뒤 풀린다.
- PR이 아예 안 보인다 → Draft인지(Draft는 LANDING SEQUENCE에 없다), AIRPORT의 git remote가 GitHub인지, 서버 사용자로 `gh auth status`가 되는지 본다. `gh`가 실패하면 스냅샷의 `github.error`에 이유가 뜬다.

## 새 기능이 안 보인다 · 코드를 고친 뒤 화면이 그대로다

운영 서비스는 main 체크아웃에서 빌드한다. 머지 뒤 `systemctl --user restart atc`. 새 의존성이 생겼으면 먼저 `npm install`.

배포 전에 열어 둔 탭은 옛 화면을 계속 돌린다. 서버가 새 번들을 내주기 시작하면 그 탭 상단(콘솔 바로 아래)에 **"새 버전이 배포됨 · 새로고침"** 알림이 뜬다. 새로고침을 눌러야 새 화면이 된다. 입력 중인 내용(거절 사유 등)이 날아가지 않게 저절로 새로고침하지 않는다. 닫기를 누르면 그 번들에 대해서는 다시 뜨지 않고, 다음 배포 때 다시 뜬다.

알림이 없는데도 새 기능이 안 보이면 서비스가 다시 빌드됐는지 본다: `curl -s localhost:7700/api/version`의 `build`(`/assets/index-<hash>.js`)와 `startedAt`.
