# agent-crew

Claude Code에서 프롬프트 하나가 어떤 에이전트들로 처리되는지 보여주는 mod입니다. 메인 세션 아래에 서브에이전트, workflow, arena 후보 같은 에이전트들이 플로우차트로 그려지고, 패널은 채팅 옆에 열린 채로 실시간으로 바뀝니다.

각 에이전트가 지금 실행 중인지, 어떤 모델과 effort로 도는지, 어느 워크트리에서 일하는지, 어떤 스킬이나 플레이북을 썼는지를 카드 한 장에서 확인할 수 있습니다.

## 설치

Claude Code 터미널 세션의 프롬프트에서:

```
/plugin install agent-crew --marketplace hkkim-openbus/agent-crew
```

셸에서:

```
claude plugin install agent-crew --marketplace hkkim-openbus/agent-crew
```

`Add marketplace?`가 나오면 `y`, 설치 범위는 맨 위의 user scope를 고르면 됩니다. 설치한 뒤 시작하는 세션부터 적용됩니다.

데스크톱 앱에서는 프롬프트 옆 + 버튼, Plugins, Add marketplace에 `hkkim-openbus/agent-crew`를 넣고 Add plugin을 누릅니다.

## 사용법

`/crew`를 입력하면 패널이 열립니다. 서브에이전트가 시작될 때도 패널이 저절로 열립니다.

그다음은 평소처럼 작업을 시키면 됩니다. 직접 입력한 프롬프트 하나가 그래프 하나가 되고, 이전 그래프는 아래로 쌓여 기록으로 남습니다 (최근 150개 노드까지).

## 패널 구성

```
            tasks 2 · agents 3 · running 2

          ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
          ┃ 2. 슬러그 길이 제한 추가    ┃   ← 작업명 (haiku가 요약)
          ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                         ▼
               ╭──────────────────────╮
               │ ● main 42s ⚙ Agent   │   ← 상태 점, 이름, 경과 시간, 실행 중인 도구
               │ main session         │
               │ ◆ opus-5-5 · xhigh   │   ← 모델 · effort
               │ ⎇ slugify-unicode    │   ← 워크트리
               │ ✦ pstack:poteto-mode │   ← 사용한 스킬·플레이북
               ╰──────────────────────╯
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
 ╭──────────────────────╮    ╭──────────────────────╮
 │ ○ poteto-agent 18s   │    │ ● poteto-agent 31s   │
 │ Arena runner A       │    │ Arena runner B       │
 │ ◆ opus-5-5 · xhigh   │    │ ◆ fable-5-2 · high   │
 │ ⎇ new worktree       │    │ ⎇ new worktree       │
 ╰──────────────────────╯    ╰──────────────────────╯
```

### 맨 위 요약 줄

`tasks` 전체 작업 수, `agents` 지금까지 띄운 서브에이전트 수, `running` 지금 실행 중인 수입니다.

### 작업 상자

직접 입력한 프롬프트마다 하나씩 생깁니다. 처음에는 프롬프트 원문이 보이고, haiku가 2~5단어 작업명을 만들면 그걸로 바뀝니다. 서브에이전트의 결과 보고나 백그라운드 알림은 새 작업을 만들지 않고 진행 중인 그래프에 붙습니다.

### 카드

| 줄 | 내용 |
| --- | --- |
| 첫 줄 | 상태 점, 에이전트 종류(메인은 `main`), 경과 초, 실행 중인 도구(`⚙ Bash` 등) |
| 둘째 줄 | 에이전트에게 준 작업 설명 |
| `◆` | 실제 요청에 쓰인 모델과 effort |
| `⎇` | 워크트리 이름. 없으면 메인 체크아웃에서 작업 중 |
| `✦` | 사용한 스킬과 플레이북, 최근 4개 |

해당 정보가 없는 줄은 표시되지 않습니다.

### 상태 점

| 점 | 뜻 |
| --- | --- |
| `●` `○` 번갈아 깜빡임 (에이전트 색) | 실행 중 |
| 초록 `●` | 완료 |
| 빨간 `●` | 실패 또는 중단 |

### 색

메인 세션은 주황, workflow는 회색입니다. 서브에이전트는 종류(`Explore`, `general-purpose` 등)마다 색이 정해져 있어서, 같은 색이면 같은 종류입니다. 끝난 카드는 테두리가 흐려집니다.

### 연결선

부모 카드 아래 `│`와 `┌──┴──┐`로 자식 카드가 이어집니다. workflow로 띄운 에이전트는 workflow 카드 아래에 모입니다. 자식이 6개를 넘으면 `+N more`로 줄여 표시합니다.

## 무엇을 어떻게 잡는지

| 표시 | 출처 |
| --- | --- |
| 에이전트 | `agent.spawn` 이벤트 |
| 모델·effort | 매 모델 요청의 `turn.step` 이벤트 |
| 워크트리 | `EnterWorktree`·`ExitWorktree` 뒤의 세션 경로, `isolation: "worktree"`로 띄운 에이전트, 부모에게서 이어받은 값 |
| 스킬 | Skill 도구 호출, 인자가 있는 슬래시 명령(`/pstack:poteto-mode …`), `skills/<이름>/SKILL.md`나 `playbooks/<이름>.md`를 Read한 경우 |
| 작업명 | 프롬프트 앞 2,000자를 haiku에 보내 요약 |

## 알아둘 점

- 프롬프트를 보낼 때마다 작업명을 만드느라 haiku 호출이 한 번 나갑니다.
- 워크트리로 띄운 에이전트는 실제 경로를 알기 전이라 `new worktree`로 표시됩니다.
- 같은 설명(`description`)으로 워크트리 에이전트를 동시에 여러 개 띄우면 워크트리 표시가 다른 카드에 붙을 수 있습니다.
- `/crew`처럼 인자 없는 슬래시 명령은 작업으로 잡지 않습니다.

## 개발

```
claude plugin validate .
claude plugin test .
```

타입 검사는 mod가 한 번 로드되어 `.claude-plugin/types/`가 생긴 뒤 `tsc -p .`로 합니다.
