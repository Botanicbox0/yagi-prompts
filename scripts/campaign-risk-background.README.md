# Windows에서 캠페인 위험 워커를 조용히 실행하기

현재 구현 준비 단계다. **설정·예약 작업 설치·활성화는 자동으로 하지 않는다.** TWINGS 서버 배포·DB·정책·secret이 준비된 뒤 parent가 실행 순서를 조정한다. 공유 Ollama·CRM 서비스나 모델의 상주 설정을 변경하지 않는다.

사용 런타임은 Python312 `pythonw.exe`, 기존 `D:/dev/agent-harnesses/windows-background/agent-harness/quiet_run.pyw`, 해당 체크아웃의 Node/tsx다. 부모 저장소 `.env.local`을 읽거나 복사하지 않는다. Slack 봇 토큰은 TWINGS 서버에만 필요하며 로컬 워커에 저장하지 않는다.

## 구성

이미 안전하게 주입된 `CAMPAIGN_RISK_WORKER_SECRET`을 현재 Windows 사용자 DPAPI로 암호화한다. 명령 인자·로그·응답·커밋에 값을 넣지 않는다. 서버에 설정한 것과 같은 값이어야 한다.

```powershell
python scripts/campaign-risk-background.py configure --repo D:/dev/.worktrees/twings/kapier-self-serve --origin https://twings.app --model qwen3.8:27b-q4_K_M --worker-id twings-risk-windows
python scripts/campaign-risk-background.py status
```

현재 경로는 작업 체크아웃 예시다. parent가 병합·배포한 뒤 실제 유지할 체크아웃으로 확정한다. model은 명시해야 하며 임의의 기본 모델은 없다. 환경 구성은 encrypted secret과 origin/model/worker ID만 저장한다. 다른 서비스의 secret을 검색하지 않는다.

기본 상태 폴더는 `%LOCALAPPDATA%/TWINGS/campaign-risk-worker`다. 설정은 `config.json`, 암호문은 `secret.dpapi.json`이다. Windows 비밀번호를 저장하지 않는다. 다른 사용자·컴퓨터로 암호문을 복사해 사용할 수 없다.

## 수동 1회와 예약 작업

parent가 실제 서버와의 연결을 허용한 뒤 `run`을 실행한다. 아직 서버가 구버전이면 호출하지 않는다.

```powershell
python scripts/campaign-risk-background.py run
python scripts/campaign-risk-background.py status
```

예약 작업은 먼저 비활성 상태로 설치한다. 활성화는 서버 배포·정책 게이트·동일 worker secret·채널 설정을 확인한 뒤 수행한다.

```powershell
python scripts/campaign-risk-background.py install-disabled
python scripts/campaign-risk-background.py status
python scripts/campaign-risk-background.py enable --server-ready
```

작업 이름은 `TWINGS Campaign Risk Worker`. 2분 간격으로 실행하고, 이미 실행 중이면 새 인스턴스는 건너뛴다. Windows 파일 잠금으로 수동 실행과의 겹침도 막는다. 관리자가 종료됐더라도 기록된 quiet 자식 프로세스가 살아 있으면 새 pass를 시작하지 않는다. 잘못된 상태를 자동으로 지우거나 다른 프로세스를 강제 종료하지 않는다.

예약 작업은 현재 로그인한 사용자 권한(`InteractiveToken`, `LeastPrivilege`)으로만 실행된다. 로그아웃 중에도 실행되는 Windows 서비스는 아니다. 자격증명이나 PC 상시 운영 방식을 바꿔야 한다면 별도 운영 결정을 따른다.

일시 중지:

```powershell
python scripts/campaign-risk-background.py disable
```

`disable`은 다음 예약 시작을 막으며 이미 실행 중인 모델 추론을 강제 종료하지 않는다. 실제 스캔의 즉시 차단은 서버의 위험 스캔 게이트로 처리한다. 서비스 재시작이나 모델 unload는 하지 않는다.

## 상태·로그

`status`에는 설정/암호문 존재 여부, 예약 작업 설치·활성 여부, 현재 실행 여부, 마지막 종료 코드만 나온다. 원문·계좌·계약·토큰·전체 환경변수는 출력하지 않는다.

- `run.json`: 마지막 관리 실행 상태·시작/종료 시각·종료 코드. 실패는 고정 오류 코드만 기록한다.
- `worker.log`: 기존 quiet wrapper가 모은 워커 출력. 2MiB 초과 시 `.previous`로 교체한다.
- `worker.log.last.json`: quiet wrapper의 마지막 실제 실행 영수증.
- `run.lock`: Windows가 프로세스 수명 동안 보유하는 중복 실행 잠금.

Node 워커는 한 pass에서 최대 10건을 한 건씩 처리하고 종료한다. 모델 요청은 최대 180초이며 5분 lease 안에서 완료 보고한다. 로컬 모델 장애가 한 번 발생하면 오류를 서버에 기록한 뒤 pass를 중단한다. heartbeat는 프로세스 접속일 뿐 모델 성공을 증명하지 않는다. 관리자 위험 검토함에서 실제 미분석·실패 상태를 함께 확인한다.

## 로컬 실행기 검증

```powershell
python scripts/campaign-risk-background.test.py
```

실제 Windows DPAPI 왕복, 파일 잠금, 무창 Python 자식 실행·중복 실행 차단·영수증을 임시 폴더에서 검사한다. TWINGS API·실제 워커·Ollama·Slack은 호출하지 않는다. 테스트는 예약 작업을 설치하거나 활성화하지 않는다.
