# 이름 규칙

[English](naming.md) · **한국어**

atc는 브랜치 이름으로 티켓을 찾고, hook이 남긴 점유 기록으로 세션과 워크트리를 잇는다. 아래 규칙을 지키면 추정 없이 연결된다.

## 티켓

- Linear 팀 `Vocado`, key `VOC-<n>`.

## 브랜치 (기존 규칙 유지)

```
claude/voc-<n>-<slug>     # Claude 세션
codex/voc-<n>-<slug>      # Codex 세션
```

- 티켓 없는 작업은 `claude/<slug>` 그대로 둔다. atc에서는 **AD HOC**(티켓 없는 작업, 예: 팀에 직접 맡긴 5줄 이하 수정)으로 표시된다. 티켓이 필요한 일은 CHARTER DESK를 거친다([occ.ko.md](occ.ko.md)).

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

## 관제 세션

| 세션 이름 | 폴더 | 역할 |
|---|---|---|
| `TOWER` | `controller/` | 교통관제: CLEARANCE, READBACK |
| `OCC` | `occ/` | 운항관제: DISPATCH 검토, SCHEDULE 초안, 운항 추적 |
| `CROSSCHECK` | `crosscheck/` | OCC와 다른 계열의 모델이 SUPERVISOR 판정 전에 예비 판정을 달아 둔다 |
| `MCC` | `mcc/` | Maintenance Control: atc 자신의 PR INSPECTION, 착륙, RETURN TO SERVICE([mcc.md](mcc.md)) |

- **CROSSCHECK**는 조종실의 cross-check(다른 조종사가 설정을 따로 확인하는 절차)에서 따온 말이다. 열린 DISPATCH 제안(`D-xxxx`)이나 SCHEDULE 초안(`S-xxxx`)에 다는 예비 판정(`agree`/`disagree`와 이유 한 줄)이고, **mark**라고도 부른다. 제안·초안의 상태를 바꾸지 않고, 어떤 게이트에도 세지 않는다.
- **CROSSCHECK 일치**: 사람이 판정한 건 중 판정 전에 mark가 있던 건에서, mark가 사람 판정과 맞은 비율(agree ↔ agreed·approved, disagree ↔ disagreed·rejected). 전체와 모델별로 보인다. mark마다 CROSSCHECK 세션의 모델 id가 남고(이 필드가 생기기 전의 mark는 `unknown`), 화면에는 짧은 이름(`muse-spark-1.3-contributor`, `gpt-5.6-terra`)으로 보인다.

## 작업 세션

| 세션 이름 | 어디서 | 역할 |
|---|---|---|
| `TEAM_X` | 작업마다 워크트리 | AIRCRAFT: FLIGHT를 만들고 PR을 올린다 |
| `ENGINEERING` | 이 저장소, 필요할 때 연다 | 설계와 작업 지시: 설계 문서(`docs/<주제>.md`), Linear 이슈(EO), 큰 이슈 나누기, 보고 받기. 머지·배포·팀 교신은 하지 않는다(루트 `CLAUDE.md` "ENGINEERING") |

- **ENGINEERING**은 항공사의 Technical Services다. 개조와 개선을 설계하고 작업 지시서(Engineering Order, EO)를 낸다. 이 역할에 쓰던 임시 이름 `structure`를 대신한다(GitHub #121, 2026-09-28). `structure`의 다른 역할인 atc PR 착륙·배포는 MCC가 `land` 모드가 될 때까지 사용자가, 그 뒤로는 MCC가 맡는다.
- 옛 기록은 쓸 때의 이름을 그대로 둔다. 예: LOGBOOK `measured` 줄의 `by: "structure"`.

## 화면의 FUEL 말

- **FOB(FUEL ON BOARD)**는 AIRCRAFT 자기 연료, 곧 아직 비어 있는 맥락 창이다(`FOB 50% · 504k/1M`). **남은** 몫이다.
- ACCOUNT의 사용 한도는 늘 **쓴** 몫이다(`사용 87% · resets 21:00Z`). 같은 ACCOUNT의 모든 AIRCRAFT가 같이 쓰므로 FOB라고 부르지 않는다. 정의는 [fuel.md](fuel.md) 3절.

## 점유 기록

- 점유는 Claude Code hook이 자동으로 남긴다([README.ko.md "점유 hook"](../README.ko.md#점유-hook)). 리더나 팀원이 따로 쓸 것은 없다.
- 워크트리를 다 쓴 팀은 그 워크트리를 더 건드리지 않으면 된다. 3시간 뒤 점유가 풀린다.
- 파일을 고치거나, Bash에서 `cd`·`git -C`로 워크트리에 들어가야 점유로 잡힌다. 경로를 읽기만 하는 명령은 잡히지 않는다.
- 두 팀이 같은 워크트리에 잡히면 충돌(LOSS OF SEPARATION)로 표시된다.
