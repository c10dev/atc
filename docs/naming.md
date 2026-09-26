# 이름 규칙

atc는 브랜치 이름으로 티켓을 찾고, hook이 남긴 점유 기록으로 세션과 워크트리를 잇는다. 아래 규칙을 지키면 추정 없이 연결된다.

## 티켓

- Linear 팀 `Vocado`, key `VOC-<n>`.

## 브랜치 (기존 규칙 유지)

```
claude/voc-<n>-<slug>     # Claude 세션
codex/voc-<n>-<slug>      # Codex 세션
```

- 티켓 없는 작업은 `claude/<slug>` 그대로 둔다. atc에서는 "티켓 없음"으로 표시된다.

## 워크트리 디렉터리

```
/home/c10/projects/worktrees/<repo>-voc-<n>-<slug>
```

- 브랜치에서 에이전트 접두사를 뺀 이름에 저장소 이름을 붙인다.
  `claude/voc-191-close-anon-write-tables` → `vocado-voc-191-close-anon-write-tables`
- `voc185`처럼 하이픈 없는 형태나 `vocado-voc-171`처럼 slug 없는 형태는 새로 만들지 않는다.
- atc는 디렉터리 이름에 의존하지 않으므로 기존 워크트리를 바꿀 필요는 없다.

## 세션(팀)

- 세션 이름 `TEAM_A` … `TEAM_F`는 오래 가는 작업 줄(lane)이다. 티켓은 바뀌고 팀 이름은 유지된다.
- 서브에이전트의 도구 호출은 리더 세션 ID로 기록되므로, 리더가 여러 워크트리에 일을 나눠 보내면 모두 그 팀의 점유로 보인다. 별도 프로세스로 뜨는 팀원은 자기 세션으로 따로 보일 수 있다.

## 점유 기록

- 점유는 Claude Code hook이 자동으로 남긴다(README "점유 hook"). 리더나 팀원이 따로 쓸 것은 없다.
- 워크트리를 다 쓴 팀은 그 워크트리를 더 건드리지 않으면 된다. 3시간 뒤 점유가 풀린다.
- 파일을 고치거나, Bash에서 `cd`·`git -C`로 워크트리에 들어가야 점유로 잡힌다. 경로를 읽기만 하는 명령은 잡히지 않는다.
- 두 팀이 같은 워크트리에 잡히면 충돌(LOSS OF SEPARATION)로 표시된다.
