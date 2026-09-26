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
- **읽기 전용이 아닌 MCP 도구**: OCC는 S2 전까지 Linear·GitHub에 쓰지 않는다.

## 점유가 ESTIMATED TRACK으로만 보인다

점유 hook이 설치되지 않았거나, 세션이 워크트리에서 파일을 고치거나 `cd`·`git -C`로 들어가지 않았다. 경로를 읽기만 하는 명령은 점유로 치지 않는다.

## 제안이 잘 안 나온다

DISPATCH 탭의 "제외" 목록에 이유가 있다. 흔한 이유:

- 우선순위 없음 → Linear에서 우선순위를 정한다(또는 SCHEDULE의 PRIORITIZE 초안을 보고).
- 상위 이슈 → 하위 이슈가 작업이다.
- `tail:` 팀이 바쁨 / 자격 있는 팀 없음 → FLEET 탭에서 자격을 주거나 라벨을 조정한다.
- 거절한 짝은 24시간 동안 다시 제안하지 않는다.

## 초안이 사라졌다

SCHEDULE 초안은 FLIGHT가 Todo·Backlog를 벗어나거나, Linear에 이미 반영됐거나, 3일 동안 판정이 없으면 닫힌다. 최근 7일 표에서 사유를 본다.

## PR이 CLEARED TO LAND가 안 된다

PR에 붙은 막힌 조건을 본다([개념](concepts.md)의 LANDING SEQUENCE).

- `review-stale` / `no-review` → head(최신 커밋)에 리뷰도, 그 뒤에 달린 Codex 👍도 없다. push 뒤에는 리뷰를 다시 받는다(`@codex review` 등). PR 작성자 계정의 댓글은 세지 않는다. 문구가 "Codex 한도 — 사람 리뷰 필요"면 Codex가 한도에 걸린 것이라 사람이 리뷰해야 한다.
- `behind` → main이 앞서 갔다. rebase하고 push한다(CI와 리뷰를 다시 받는다).
- `no-checks` → 그 저장소에 CI가 없다(atc 등). CLEARED TO LAND가 될 수 없으니 SUPERVISOR가 직접 판단한다.
- `merge-unknown` → GitHub이 머지 가능 여부를 계산 중이다. 잠시 뒤 풀린다.
- PR이 아예 안 보인다 → Draft인지(Draft는 LANDING SEQUENCE에 없다), AIRPORT의 git remote가 GitHub인지, 서버 사용자로 `gh auth status`가 되는지 본다. `gh`가 실패하면 스냅샷의 `github.error`에 이유가 뜬다.

## 코드를 고친 뒤 화면이 그대로다

운영 서비스는 main 체크아웃에서 빌드한다. 머지 뒤 `systemctl --user restart atc`. 새 의존성이 생겼으면 먼저 `npm install`.
