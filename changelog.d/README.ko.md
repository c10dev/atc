# changelog.d — CHANGELOG 조각

[English](README.md) · **한국어**

PR은 `CHANGELOG.md`·`CHANGELOG.ko.md`를 고치지 않는다. 자기 `[Unreleased]` 항목을 여기에 언어마다 하나씩, 조각 두 개로 둔다. 여러 PR이 같은 줄에서 부딪치지 않게 하려는 것이다(ATC-64).

```
changelog.d/ATC-64.md       영어
changelog.d/ATC-64.ko.md    한국어
```

- 이름: 이슈 키(`ATC-64`). 이슈가 없으면 `claude/`를 뺀 브랜치 이름. PR마다 한 쌍이고, 같은 이슈의 후속 PR은 `ATC-64-2`처럼 붙인다.
- 내용: `### <절>` 제목 하나 이상과 그 아래 항목. CHANGELOG에 들어갈 모습 그대로 쓴다. 첫 제목 앞에는 아무것도 두지 않는다.
- 절: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, `Docs`. 한국어 조각은 `추가`, `변경`, `폐기 예정`, `제거`, `수정`, `보안`, `문서`(또는 영어 이름)를 쓴다.

```markdown
### 변경
- 무엇이 왜 바뀌었는지(ATC-64, [docs/…](docs/…)).
  - 자세히.
```

## 접기

```bash
node server/changelog-fold.ts           # 모든 짝을 [Unreleased]에 넣고 지운다
node server/changelog-fold.ts --check   # 짝과 형식만 본다
```

접기는 항목을 `[Unreleased]`에서 이름이 같은 첫 절의 맨 위에 넣는다(이름이 뒤인 조각이 위로 온다: `ATC-10`이 `ATC-9` 위). 아직 없는 절은 Keep a Changelog 순서로 앞 절 뒤에 만든다. 기존 줄과 릴리스된 버전은 움직이지 않는다. 이미 `[Unreleased]`에 있는 항목은 다시 넣지 않으므로 다시 돌려도 바뀌는 것이 없다. 짝이 없거나 형식이 틀린 조각이 하나라도 있으면 아무것도 바꾸지 않고 1로 끝난다.

접기는 ENGINEERING이나 사용자가 늦어도 릴리스 전에 돌리고, 따로 PR로 올린다. 그때까지 DOCS 탭의 변경 기록 쪽이 한국어 조각을 `[Unreleased]` 아래에 함께 보이고, `npm test`가 여기 있는 조각이 모두 짝이 있고 깔끔하게 접히는지 본다.
