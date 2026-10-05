# 코드 구조와 유지보수 안내

초기 모듈 분리: 2026-09-23. HTTP API, 데이터베이스 스키마, 캐시 키, 프롬프트와 화면 동작을 유지하면서 역할별로 재구성했다.

## 먼저 볼 곳

| 바꾸려는 내용 | 위치 | 책임 |
| --- | --- | --- |
| API 경로·요청 검증 | `src/api/` | 컨트롤러는 입력을 검증하고 업무 함수를 호출한다. SQL·수집·요금 계산을 직접 수행하지 않는다. |
| 공통 데이터·오류·상품 식별 | `src/domain/` | Product, ClaimedRun, PackageInput, QuoteComparison과 URL 정규화 규칙. DB·SDK 의존 없음 |
| 환경 설정 | `src/config/` | 프로세스 환경변수 → .env.local → .env의 기존 우선순위 유지 |
| 수집 처리 순서 | `src/ingestion/collector.ts` | 획득 → 보완 → 환산 → 포장 조사 → 저장의 흐름 |
| API/HTML/브라우저 선택 | `src/ingestion/source-reader.ts` | 외부 획득과 결정적 파싱. 이전 관측 조회는 API 코드 재사용이 필요할 때만 호출 |
| 네트워크 제한·오류·브라우저 | `src/ingestion/network/` | 주소 검증, 실제 연결의 DNS 검증, HTTP 오류 분류, 격리된 브라우저 |
| 판매처 데이터 해석 | `src/merchants/` | 공통 JSON-LD 및 판매처별 HTML/API 매핑. 네트워크 없이 고정 표본으로 테스트 가능 |
| AI 요청 실행 | `src/ai/executor.ts` | 요청 캐시·예산 예약·SDK 호출·사용량 기록. 유료 요청의 공통 진입점 |
| 이미지·검색 기반 포장 추정 | `src/ai/package-estimate.ts`, `package-images.ts` | 이미지 확보 → 상품 단서 → 짧은 검색어 → 제품/포장 범위 추정. 자동/수동 공통 경로 |
| 포장 무게·치수 필수 계약 | `src/ai/package-completion.ts` | 정상 완료는 무게·세 변의 범위를 모두 반환. 미확인 근거는 모델 가정으로 표시하며 부피중량 대체·모순 값은 거절 |
| 포장 범위·근거 검증 | `src/ai/package-estimate-schema.ts`, `package-estimate-validation.ts` | 항목별 근거 유형, 제품값에서 포장값으로의 유도, 부분 결과·사용자 검토 |
| AI 프롬프트·출력 형식 | `src/ai/prompts.ts`, `schemas.ts`, `package-estimate-prompts.ts` | 추출/검색/포장 제안의 입력 지침과 구조화 출력 스키마 |
| AI 근거 검사 | `src/ai/package-validation.ts` | 인용 구절, 사용자 가정, 수치 범위 검증. 모델의 주장과 확인된 근거를 구분 |
| 수동 AI 포장 작업 | `src/packaging/service.ts` | 선택된 관측을 기준으로 제안을 만들고 별도 저장 |
| 관세 자동 연결·환율 | `src/customs/automatic.ts`, `fx.ts` | URL 관측·포장·공식 주간 과세환율 연결. transactional outbox로 후속 관세 작업 등록 |
| 관세 분류·세액 | `src/customs/` | 규칙/LLM 후보와 기본세율 계산 분리. 주류 별도 세목·명시적 입력·관측 연결 |
| 배송·환율·견적 업무 | `src/shipping/` | 순수 요율 계산, 환율 검증·환산, 사용자 견적 생성 |
| 큐·임대·실행시간 | `src/jobs/` | 워커 루프와 단계 시간 기록. 원자적 점유·복구 SQL은 persistence/job-queue.repository에서 관리 |
| 데이터 저장 | `src/persistence/` | 업무별 SQL과 트랜잭션 경계. 서비스 계층에서 SQL을 조립하지 않는다. |

`src/server.ts`와 `src/worker.ts`는 프로세스 시작만 담당한다. 기존 `npm start`, `npm run worker`와 컨테이너 진입점은 유지했다. `npm run build`는 `dist/`를 정리한 뒤 빌드하므로 이름이 바뀐 모듈의 오래된 실행 파일이 남지 않는다.

## 데이터 흐름과 중요한 경계

**수집:** HTTP 요청 → catalog repository의 요청/캐시 판정 → jobs의 작업 점유 → collector → source-reader/판매처 파서 → 선택적 AI·환산 → collection repository의 원자적 저장.

자동 분석도 현재 포장 추정 결과를 `requiresReview`로 저장하며 견적을 자동 확정하지 않는다. 텍스트 전용 `package-research.ts`, `package-proposal.ts`, `package-validation.ts`는 이전 방식의 회귀/비교 기준으로 보존했고 운영 진입점은 `AiService` → `package-estimate.ts`다.

**수동 포장 분석:** HTTP 요청 → packaging service → package repository의 동일 요청 공유 → 워커 → AI 제안 및 근거 검사 → 제안 저장. 사용자가 적용하기 전까지 확정 견적을 만들지 않는다.

**견적:** HTTP 요청 → quote service → calculator/환율 → quote repository. 사용자 입력이 판매처 실측으로 승격되지 않도록 입력 기준을 보존한다.

다음 경계는 합치거나 편의상 생략하지 않는다.

- 관측·견적·공유 요청 완료는 collection repository의 같은 트랜잭션에서 저장한다. 쓰기 전에 임대 토큰을 확인해 오래된 워커가 결과를 덮어쓰지 못하게 한다.
- AI 요청은 executor를 통한다. 모호한 전송 결과를 자동 재전송하지 않으며 캐시 적중에 이전 사용량을 다시 과금하지 않는다.
- 프롬프트나 출력 계약을 바꿀 때 AI 캐시 버전/계약도 검토한다. 이번 이동에서는 문자열과 키를 바꾸지 않았다.
- 파서는 제목이 비슷하다는 이유로 다른 판매글·판본·옵션을 병합하지 않는다. 이치바와 북스의 API 배송 플래그는 각각의 매퍼에서 해석한다.
- 프런트엔드는 API 토큰을 로컬 저장소에 저장하지 않는다. 늦게 도착한 응답은 선택 상태의 generation을 검사해 다른 상품을 덮어쓰지 않는다.

## 화면 코드

```text
public/app.js                  초기화만 수행하는 ES 모듈 진입점
public/js/api.js               인증 헤더와 응답 오류 처리
public/js/state.js             현재 상품·작업·입력 상태
public/js/controllers/         사용자 이벤트와 비동기 요청
public/js/presenters/          관측 변경과 입력값 보존, 화면 갱신 조합
public/js/views/               상품 목록·AI 제안·견적·실행 기록의 DOM 표시
public/js/labels.js            사용자에게 보이는 상태·오류 문구
public/js/format.js            시간·금액 표시
public/styles/                기본 테마 / 컴포넌트 / 반응형 스타일
```

API 호출은 controller, 표시 형식은 view/format, 화면 문구는 labels에서 수정한다. 같은 관측의 재표시가 사용자의 작성 중인 포장 입력을 초기화하지 않도록 presenter의 관측 ID 비교를 유지한다. CSS 로딩 순서도 기존 cascade를 유지한다.

## 작업 스크립트와 검증

- `scripts/database/`: 마이그레이션. 실제 DB 변경 명령이다.
- `scripts/evaluation/`: 고정 표본 평가·캡처 도구. `evaluate`는 로컬 자료만 읽지만 캡처/확대 스크립트는 외부 조회를 한다.
- `scripts/diagnostics/`: 실행 지표 조회·명시한 URL의 접근 검사.
- `scripts/verification/`: OpenAI·라쿠텐 실호출 검증. 반복 실행 전에 비용과 기존 결과를 확인한다.
- `scripts/experiments/`: 특정 날짜의 표본 발견 작업. 운영 크롤러와 분리한다.
- `scripts/testing/`: 임시 DB를 생성·정리하는 통합 테스트 실행기.

```sh
npm run typecheck
npm run format:check
npm test
npm run test:integration
npm run build
```

통합 테스트는 별도 임시 DB를 사용하며 외부 LLM·판매처 호출을 모의 처리한다. `test/support/jobs.ts`는 테스트가 준비한 작업이 실제로 점유됐는지 명시적으로 검사한다. 기존 스냅샷과 비용 계산의 동일성은 [리팩터링 검증 기록](#코드-구조와-유지보수-안내)에 남겼다.

판매처를 추가할 때는 해당 매퍼, URL 식별/허용 주소 규칙, source-reader 선택, 고정 표본을 함께 검토한다. 새로운 추상화는 반복되는 실제 요구가 생겼을 때 도입한다.


## 공개 세율 경로 (2026-10-05)

`src/customs/hs-classifier.ts`의 HS 후보를 `src/customs/tariff/resolver.ts`가 HSK로 연결한다. `client.ts`는 공개 목록·상세·세율을 조회하고 `policy.ts`는 계산 가능 조건을 검사한다. `tariff.repository.ts`는 6시간 캐시·잠금을 관리한다. 공개 세율은 기존 프로필과 별도로 근거·기간을 보존한다.
