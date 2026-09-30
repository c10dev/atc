# deploy — systemd 사용자 서비스

[English](README.md) · **한국어**

`atc.service`는 Claude Code·Codex 세션이 도는 머신에서 atc를 상시 실행하는 **systemd 사용자 서비스**다. 웹 화면과 API를 `127.0.0.1:7700`에서 제공한다.

## 유닛이 하는 일

| 줄 | 효과 |
|---|---|
| `WorkingDirectory=/home/c10/projects/atc` | 저장소 체크아웃에서 실행 |
| `Environment="PATH=…/node/v24.19.0/bin:…"` | 사용자 서비스는 셸 프로필을 읽지 않으므로 nvm으로 설치한 Node 24를 PATH에 넣는다 |
| `ExecStartPre=… node --run build` | 시작할 때마다 웹 화면을 새로 빌드(`vite build`)한다. 화면을 고친 뒤 재시작만 하면 반영된다 |
| `ExecStart=… node server/index.ts` | 서버 시작(Node가 TypeScript를 바로 실행) |
| `Restart=always`, `RestartSec=5` | 프로세스가 무슨 이유로든 죽으면(크래시든 잘못 날아온 `kill`이든) 5초 뒤 다시 시작(ATC-134). `systemctl --user stop atc`로 일부러 멈춘 것은 멈춘 채로 남고, `restart`(RTS)는 전과 같다 |
| `StartLimitIntervalSec=600`, `StartLimitBurst=20` | 10분에 20번 넘게 다시 뜨면(빌드 실패 등) systemd가 포기하고 멈춘 채로 둔다. 깨진 체크아웃이 끝없이 도는 것을 막는다 |
| `WantedBy=default.target` | 사용자 세션과 함께 시작 |

경로는 이 머신 기준이다. 다른 머신에서는 `WorkingDirectory`, `PATH`의 node 경로, `ExecStartPre`, `ExecStart`를 자기 것으로 바꾼다(`which node`가 Node 24 이상이어야 한다).

## 설치

```bash
cp deploy/atc.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now atc     # 지금 시작 + 로그인 시 자동 시작
```

사용자 서비스는 로그아웃하면 멈춘다. 로그인 세션 없이도 계속 돌게 하려면(SSH로만 들어가는 서버 등):

```bash
loginctl enable-linger "$USER"
```

## 운용

```bash
systemctl --user restart atc          # 코드 수정 후 (화면 다시 빌드)
systemctl --user status atc
journalctl --user -u atc -f           # 로그
systemctl --user disable --now atc    # 멈추고 자동 시작에서 빼기
```

`atc.service` 자체를 고쳤으면 다시 복사하고 `systemctl --user daemon-reload`한 뒤 재시작한다. **ATC-134가 유닛을 바꾸므로(`Restart=always`) SUPERVISOR가 한 번 다시 설치한다**(RTS는 `deploy/*.service`가 바뀐 범위를 거절한다):

```bash
cp deploy/atc.service ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user restart atc
```

## 시험 서버를 안전하게 끄기 (ATC-134)

2026-09-29 07:12에 한 팀이 7702 시험 서버를 `pkill -f "node server/index.ts"`로 끄다가, 같은 패턴에 걸린 운영 7700까지 껐다. 그 뒤로:

- 시험 서버는 띄울 때 PID를 저장하고(`( … exec node server/index.ts ) & echo $! > <임시 폴더>/server.pid`. `exec`가 서브셸의 PID를 node의 것으로 만든다) `kill "$(cat <임시 폴더>/server.pid)"`로만 끈다(루트 `CLAUDE.md` "검증").
- 루트 `.claude/settings.json`의 `PreToolUse(Bash)` hook `hooks/kill-guard.mjs`가 패턴에 `server/index`·`atc`·`node`가 든 `pkill`/`killall`, `kill $(pgrep …)`, `pgrep … | xargs kill`, `fuser -k`, `systemctl --user stop|restart|kill|disable|mask atc`를 막는다. fail-closed(`… || exit 2`)이고 `kill <pid>`와 `atc-rts`는 막지 않는다. [hooks/README.ko.md](../hooks/README.ko.md) 참고.
- 그래도 죽으면 `Restart=always`가 5초 안에 7700을 다시 띄운다.
- 서버는 시작할 때 `pid`·`ppid`·포트를 찍고, `SIGTERM`/`SIGINT`/`SIGHUP`을 받으면 끝나기 전에 로그를 남긴다. `journalctl --user -u atc`로 볼 수 있다. Node는 신호를 보낸 쪽을 알 수 없다. `systemctl`로 멈췄다면 같은 저널에 `Stopping …`도 남는다.

## RETURN TO SERVICE(MCC)

`atc-rts.service`는 머지된 `origin/main`을 도는 서비스에 올리는 oneshot 유닛이다([docs/mcc.md](../docs/mcc.md) 6장). MCC 스위치가 `land+rts`일 때 atc 서버가 `systemctl --user start --no-block atc-rts`로 시작한다. 서비스 밖에서 돌아야 재시작을 끝까지 본다. 한 번 설치한다(`enable`하지 않는다: 부를 때만 돈다):

```bash
cp deploy/atc-rts.service ~/.config/systemd/user/ && systemctl --user daemon-reload
```

`deploy/rts.mjs`가 하는 순서:

1. `~/.local/state/atc/rts.lock`을 잡는다(한 번에 하나, 10분 넘은 잠금은 죽은 것으로 본다).
2. 본 체크아웃이 `main`이고 커밋하지 않은 변경이 없고 `origin/main`으로 fast-forward할 수 있고, `origin/main`의 CI `check`가 통과했을 때만 한다.
3. 범위가 `package.json`·`package-lock.json`의 의존성(`npm ci` 필요. `license`·`scripts`·`version` 같은 변경은 아니고, 읽지 못한 파일은 바뀐 것으로 본다)이나 `deploy/*.service`·`*.timer`(`daemon-reload` 필요)를 바꾸면 거절한다: 사용자가 배포한다.
4. `git merge --ff-only`, `systemctl --user restart atc`(유닛의 `ExecStartPre`가 화면을 다시 빌드한다). 체크아웃은 이미 대상인데 서비스가 다른 커밋을 알리면 재시작만 한다.
5. 90초까지 상태 확인: `/api/version`이 대상 `head`와 더 늦은 `startedAt`을 알리고 `/api/snapshot`이 답한다.
6. 세션 점검(ATC-102), 30초까지 더: 재시작 전 살아 있던 백그라운드 세션(관제·팀)이 모두 그대로 살아 있고, `/api/control/sessions`의 `daemonInService`가 `false`이고, 그 엔드포인트가 답한다. RTS는 읽기만 한다: 세션을 멈추거나 메시지를 보내지 않는다. 재시작 전에 `claude agents --json`을 적어 둔다(`pid`·`status` 없는 유령 줄은 뺀다).
7. 5나 6이 실패하면 ROLLBACK: 직전 커밋으로 `git reset --hard`하고 재시작한다(죽은 세션은 되살리지 않는다. `rts.jsonl` 기록이 실패한 점검과 죽은 세션을 `sessions: [{id, name}]`으로 적는다). 그 뒤 RTS는 SUPERVISOR가 설정 창에서 MCC 모드를 다시 고를 때까지 멈춘다.

시도마다 `~/.local/state/atc/rts.jsonl`에 한 줄을 붙인다(`running` 다음 `ok`·`refused`·`rollback`·`failed`).

## CI와 LANDING CLEARANCE 등급

`.github/workflows/ci.yml`은 모든 PR과 main 푸시에서 `check` 작업을 돌린다: `npm ci`, `npm test`, `npx tsc --noEmit -p .`, `npx vite build`. PR에서는 그 PR의 LANDING CLEARANCE 등급도 실행 요약에 적는다.

`deploy/landing-tier.mjs`는 바뀐 파일 경로만으로 등급을 정한다:

| 등급 | 경로 | 뜻 |
|---|---|---|
| `user` | guard(`*guard*.mjs`), `.claude/` 설정(관제 세션 폴더의 `skills/` 제외), 루트 `.claude/` 전부(팀 세션 skill), 루트 `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/`(README 제외) | 사용자가 정해야 함 |
| `flagged` | `controller/`, `occ/`, `crosscheck/`, `review/`, `mcc/`, `dispatch/`(매뉴얼, skill, atc CLI, guard 테스트) | 관제 세션이 하는 일이 바뀜. 바뀐 규칙을 따로 알린다 |
| `auto` | 나머지(서버, 화면, 문서, 테스트) | 안전장치·권한과 무관 |

바뀐 파일 중 가장 높은 등급을 쓴다. 등급마다 누가 머지하는지는 루트 `CLAUDE.md`가 정한다.

```bash
gh pr diff 61 --name-only | node deploy/landing-tier.mjs
```

## 설정

서버가 저장소 루트의 `.env.local`을 직접 읽는다(`.env.example` 참고). 유닛에 `EnvironmentFile`은 필요 없다.

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `ATC_PORT` | `7700` | 포트(항상 `127.0.0.1`에만 연다) |
| `LINEAR_API_KEY` | — | Linear 개인 API 키. 없으면 브랜치 이름에서 찾은 티켓만 보인다 |
| `LINEAR_TEAM_KEY` | `VOC` | 주 Linear 팀 키(S2의 새 이슈가 이 팀에 만들어진다) |
| `LINEAR_TEAM_KEYS` | 주 팀 | 읽을 Linear 팀 전부. 쉼표로 구분(예: `VOC,ATC`). 주 팀이 언제나 맨 앞. DISPATCH·SCHEDULE 후보는 `dispatch.json`의 `candidateTeams`에 든 팀만(기본: 주 팀). 나머지는 보여 주기만 |
| `ATC_PROJECTS_DIR` | `~/projects` | git 저장소를 AIRPORT로 자동 개설하는 폴더 |
| `ATC_STATE_DIR` | `~/.local/state/atc` | 점유, AIRPORT 등록부, CLEARANCE, FLIGHT RECORDER |
| `ATC_CLAIM_TTL_MIN` | `180` | 마지막 접촉 뒤 점유가 끝나는 시간(분) |
| `ATC_HANDOFF_GRACE_MIN` | `5` | HANDOFF·충돌 판정 기준 시간(분) |

LANDING SEQUENCE는 GitHub CLI로 열린 PR을 읽는다. 서비스를 돌리는 사용자에게 `gh`가 설치되어 로그인되어 있어야 한다(`gh auth status`). 없으면 PR이 빠지고 오류가 스냅샷의 `github` 필드에 뜬다. `ATC_LANDING_STATE`는 더 이상 읽지 않는다. `.env.local`에 남은 줄은 아무 일도 하지 않는다.

## 다른 컴퓨터에서 접속

서버는 localhost에만 열린다. SSH 터널로 들어간다.

```bash
ssh -L 7700:localhost:7700 <host>
```

그다음 `http://localhost:7700`을 연다.
