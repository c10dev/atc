# atc

로컬 관제 웹. 어떤 세션(팀)이 어떤 워크트리를 점유하고, 그 워크트리가 어떤 Linear 티켓을 처리 중인지 한 화면에 보여준다.

- 실행 위치: 이 머신(`/home/c10/projects/atc`), 포트 `7700`
- 접속(맥에서): `ssh -L 7700:localhost:7700 <host>` 후 `http://localhost:7700`
- 읽기 전용 관제가 기본이다. 워크트리 생성·삭제나 Linear 쓰기는 하지 않는다.

## 화면

| 화면 | 보여주는 것 |
|---|---|
| Teams | 세션(TEAM_A…F, Codex 세션)마다 카드 하나. 상태(busy/idle), 점유 중인 워크트리, 연결된 티켓 |
| Tickets | Linear 보드처럼 상태 열(Todo / In Progress / In Review / Done)에 VOC 티켓 카드. 카드에 점유 팀 배지 |
| Map | 세션 ─ 워크트리 ─ 티켓 3열을 선으로 연결. 주인 없는 워크트리, 워크트리 없는 In Progress 티켓을 강조 |

## 용어 (코드에서 쓰는 이름)

| 이름 | 뜻 | 식별자 |
|---|---|---|
| `Session` | Claude Code / Codex 세션 하나 | `sessionId` |
| `Workspace` | git worktree 하나 (본 체크아웃 포함) | 절대 경로 |
| `Ticket` | Linear 이슈 | `VOC-191` 같은 key |
| `Claim` | 세션이 워크스페이스를 점유한다는 기록 | `sessionId` + 경로 |

"팀"은 UI 표기일 뿐 코드에서는 `Session`이다.

## 데이터 소스와 연결 키

```
Session ──claim──▶ Workspace ──branch──▶ Ticket
```

| 소스 | 위치 | 얻는 것 |
|---|---|---|
| Claude 세션 | `~/.claude/sessions/*.json` | pid, sessionId, cwd, name, status |
| Claude 기록 | `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` | 세션이 건드린 워크트리 경로 (추정용) |
| Codex 세션 | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | Codex 세션과 cwd |
| git | 각 저장소 `git worktree list --porcelain` | 워크트리 경로, 브랜치, HEAD, dirty 여부 |
| Linear | GraphQL API (`LINEAR_API_KEY`) | 티켓 제목, 상태, 담당, URL |
| Claim | `~/.local/state/atc/claims/<sessionId>/*.json` | hook이 남긴 점유 기록 |

연결 규칙:

1. **Workspace → Ticket**: 브랜치 이름에서 `voc-(\d+)`를 뽑아 `VOC-n`. 디렉터리 이름은 쓰지 않는다(지금 이름이 제각각이라서).
2. **Session → Workspace**: hook 기록이 있으면 그것(`hook`). Codex는 세션 cwd(`cwd`). 둘 다 없으면 대화 기록에서 가장 최근에 언급된 워크트리(`transcript`, 점선으로 표시).
   팀 세션의 cwd는 모두 `vocado_nextjs` 본 디렉터리라 cwd로는 구분이 안 된다. 기록 추정은 한 세션이 여러 워크트리를 오가서 부정확하므로 Claim이 기준이다.

## 실행

```bash
npm install
npm run build && npm start      # http://localhost:7700 (web/dist 제공)
npm run dev                     # 개발: vite 7700 + API 서버 7701
npm run typecheck
```

상시 실행은 systemd 사용자 서비스로 한다.

```bash
cp deploy/atc.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now atc     # 시작 + 부팅 시 자동 시작
systemctl --user restart atc          # 코드 수정 후 (빌드 포함)
journalctl --user -u atc -f           # 로그
```

`.env.local`에 `LINEAR_API_KEY`가 없으면 Linear 없이 브랜치에서 찾은 티켓만 보여준다.

## 점유 hook

`~/.claude/settings.json`의 `PostToolUse`(Edit·Write·MultiEdit·NotebookEdit·Bash, async)가 `hooks/claim.mjs`를 실행한다.

- Edit·Write의 파일 경로, Bash의 `cd <dir>`·`git -C <dir>` 대상, 세션 cwd를 보고 `.git`이 **파일**인 디렉터리(linked worktree)를 찾는다. 본 체크아웃은 기록하지 않는다.
- Bash에서 경로를 언급만 하는 명령(`ls`, `cat`, `grep` 등)은 점유로 치지 않는다. 그래서 리뷰어가 읽기만 해서는 점유가 생기지 않는다.
- `~/.local/state/atc/claims/<sessionId>/<인코딩된 경로>.json`을 처음 한 번 만들고 이후에는 mtime만 갱신한다. 동시 호출에도 안전하다.
- 마지막 갱신 뒤 `ATC_CLAIM_TTL_MIN`(기본 180분)이 지나면 점유가 끝난 것으로 본다.
- hook을 끄려면 settings.json에서 해당 항목을 지우면 된다. 기록 폴더는 지워도 된다.

## 폴더 구조

```
atc/
├── hooks/claim.mjs         # PostToolUse hook (의존성 없음)
├── server/                 # Node 24 + Hono. 2초마다 스냅샷을 만들어 SSE로 푸시
│   ├── sources/
│   │   ├── claude.ts       # ~/.claude/sessions, hook 기록, 대화 기록 추정
│   │   ├── codex.ts        # ~/.codex/sessions (cwd로 점유)
│   │   ├── git.ts          # git worktree list, dirty, 마지막 커밋
│   │   └── linear.ts       # Linear GraphQL, 1분마다
│   ├── model.ts            # Session / Workspace / Ticket / Claim / Alert
│   ├── snapshot.ts         # 소스 병합 + 경고 계산
│   └── index.ts            # /api/snapshot, /api/events
├── web/src/                # Vite + React. 연결 / 팀 / 티켓 화면
├── deploy/atc.service      # systemd 사용자 서비스
└── docs/naming.md
```

## 경고

| 종류 | 조건 |
|---|---|
| 충돌 | 살아 있는 세션 둘 이상이 같은 워크트리를 hook·cwd로 점유 |
| 고아 점유 | 종료된 세션의 점유가 TTL 안에 남아 있음 |
| 주인 없는 변경 | 변경 파일이 있는데 점유한 세션이 없음 |
| 워크트리 없는 진행 티켓 | Linear started 상태인데 브랜치가 가리키는 워크트리가 없음 |
