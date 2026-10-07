# Product Catalog

상품 URL 하나로 **상품 수집 → 포장·배송 추정 → 관세 추정**을 수행하는 TypeScript/NestJS 서비스입니다. PostgreSQL 큐와 별도 워커를 사용하며 관측값·모델 가정·부분 견적을 구분합니다.

[라이브 데모](https://catalog.janghan.dev/) · [통합 포트폴리오 PDF](portfolio/crossborder-portfolio.pdf) · [편집용 PPTX](portfolio/crossborder-portfolio.pptx) · [검증과 한계](docs/verification.md) · [코드 구조](docs/architecture.md) · [구매대행 에이전트](https://github.com/y00nZZang/crossborder-purchase-agent)

## Jev 비교 실험

가정용·취미 상품으로 선별한 새93개에서 기존 단일 경로 Jev와 GPT-6 Luna를 비교했습니다. 중앙 처리시간은0.645초/4.510초, 추정 API 비용은$0.02258/$0.05266였습니다. 운영 서비스 도입이나 전체 URL 분석시간 개선 결과는 아닙니다.

전문가 참조 HS6 정답 수는 두 모델 모두41/93(44.1%)였습니다. 답변률은86.0%/64.5%, 답변한 사례의 정확도는51.3%/68.3%로 달라 판단 품질의 동등성을 주장하지 않습니다. 과거 전체94개, 과거 범위안78개, 새93개를 따로 기록했습니다.

[최신 실험 결과·정확도·한계](docs/service-scope-jev-experiment-2026-10-07.md) · [결과 노트북](notebooks/service-scope-results-2026-10-07.ipynb) · [실패 사례](notebooks/service-scope-failures-2026-10-07.json) · [선별 기준](datasets/customs/2026-10-07/service-scope/README.md) · [실행 안내](notebooks/README.md)

[초기 HF·메루카리 실험 기록](docs/jev-experiment-2026-10-06.md)은 별도 보존합니다. 복수 경로 Jev와 Jev 탐색+LLM 선택은 후속 비교에서 제외했습니다.

## 핵심 구현

- 라쿠텐 이치바·북스 공식 API, 공개 HTML, 필요 시 브라우저 수집. 접근 차단을 우회하지 않습니다.
- 판매글 ID·옵션별 캐시와 동시 요청 공유. 라쿠텐 6시간, 메루카리 1시간 TTL.
- 이미지·제품명·웹 검색으로 포장 무게와 세 변의 범위를 추정. 모델 추정은 실측과 구분합니다.
- HS2022 후보 → 한국 HSK 후보 → 관세청 공개 기본세율 조회 → 결정적 세액 계산.
- `analysis_runs`·`analysis_steps`에 실행·단계별 시간, 재시도, 비용·실패를 별도 기록.
- SSRF 방어, 제한된 재시도, 사이트별 간격 제한, 작업 임대·워커 중단 복구.

2026-10-05 기준 단위·회귀 298개, PostgreSQL 통합 17개 통과. 기능 회귀 검증이며 배송 실측·실제 납부 세액 정확도나 운영 SLA가 아닙니다. 소형 GCP VM에서 수동 배포했으며 CI/CD 자동 배포는 없습니다.

## 빠른 시작

Docker Compose를 이용하면 PostgreSQL·API·워커를 함께 실행할 수 있습니다.

```sh
cp .env.example .env
# API 키 없이 시작: LLM_ENABLED=false가 기본값
docker compose up --build
```

http://127.0.0.1:4310 에 접속합니다. 화면은 토큰 없는 URL 입력 방식입니다. 예제는 `CATALOG_PUBLIC_ACCESS=true`이며 Compose 포트는 127.0.0.1에만 바인딩합니다. 외부 공개는 별도 배포 설정을 검토하세요. AI 전체 흐름을 실행하려면 `.env`에 `OPENAI_API_KEY`, `LLM_ENABLED=true`, `OPENAI_DAILY_BUDGET_USD`를 설정하세요. 기본 0은 호출 예산 없음입니다. `OPENAI_BUDGET_UNLIMITED=true`는 앱의 일일 금액 한도를 명시적으로 해제합니다. 실호출은 요금이 발생합니다. 기본 모델은 현재 구현 기준 `gpt-6-luna`이며 계정에서 사용 가능한 모델로 설정해야 합니다.

라쿠텐 API는 `RAKUTEN_APPLICATION_ID`, `RAKUTEN_ACCESS_KEY` 및 제공자 측 접근 권한·IP 설정이 필요합니다. 키는 저장소에 포함하지 않습니다. 관세 환율 키는 선택 사항이며 미설정 시 검증된 공개 주간환율 경로를 사용합니다.

## 로컬 개발·테스트

Node.js 24+, PostgreSQL 17을 사용합니다.

```sh
npm ci
npm test
npm run typecheck
npm run build
# .env.local에 로컬 DATABASE_URL 설정 후:
npm run migrate
npm start
# 다른 터미널
npm run worker
# 테스트 전용 DB를 생성할 수 있는 PostgreSQL 계정으로:
npm run test:integration
```

단위 테스트는 저장된 fixture·mock을 사용합니다. integration은 임시 DB를 생성·삭제하므로 CREATEDB 권한이 필요합니다. `scripts/verification`과 일부 evaluation/capture 스크립트는 외부 API·유료 AI를 호출하므로 README의 오프라인 테스트와 구분하세요.

## 판단 근거와 한계

HS 분류는 LLM 후보이며 HSK 법적 확정이 아닙니다. 공개 A 기본세율과 일반 부가세 시나리오를 계산하되 FTA·WTO 적용조건, 추가 세목·종량세·면세·규제는 전부 자동 판정하지 않습니다. 주류는 별도 기존 프로필을 사용하며 입력 부족 시 보류합니다. [공개 세율 처리 범위](docs/public-hsk-rates-2026-10-05.md)를 참고하세요.

판매자 품절·삭제, HTML 변경, 서버 IP 차단으로 수집이 실패할 수 있습니다. 성공한 포장 추정은 무게·세 변을 모두 갖도록 검사하지만 근거 없는 확정치를 보장하지 않습니다. 부분 결과와 사용자 검토 필요를 유지합니다. 서로 다른 판매글의 동일 제품 병합은 구현 범위가 아닙니다.

개인 프로젝트이며 SAZO 및 판매처·물류사·관세청의 공식 서비스가 아닙니다. Codex를 구현·테스트에 사용했습니다. 공개본은 현재 구현의 정제된 스냅샷이며 운영 비밀값·개인 주문·원본 Git 이력은 포함하지 않습니다.
