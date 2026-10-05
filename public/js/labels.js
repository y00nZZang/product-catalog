export const errors = {
  invalid_package_weight:
    "유효한 포장 무게 범위를 산정하지 못했습니다. 제품보다 가볍거나 지원 범위를 벗어난 추정은 저장하지 않습니다.",
  customs_fx_stale: "현재 적용기간의 과세환율을 확인하지 못했습니다.",
  customs_fx_api_error: "관세청 환율 API 응답을 확인하지 못했습니다.",
  customs_fx_missing_currency: "필요한 통화의 과세환율이 누락되었습니다.",
  tax_observation_changed:
    "상품 정보가 갱신되었습니다. 최신 관측에서 품목을 다시 추론해주세요.",
  tax_classification_required: "최신 품목 후보를 선택하고 확인해주세요.",
  tax_analysis_in_progress: "다른 관세 품목 분석이 진행 중입니다.",
  dimensions_ready_weight_required:
    "가로·세로·높이 추정은 완료했습니다. 배송비 계산에는 포장 무게를 추가해주세요.",
  invalid_dimension_estimate:
    "AI가 유효한 세 변 추정값을 반환하지 못했습니다. 이번 분석은 완료되지 않았습니다.",
  no_supported_product_image:
    "분석 가능한 상품 이미지가 없어 텍스트·검색으로 진행했습니다.",
  no_cited_source: "검색에서 인용 출처를 확보하지 못했습니다.",
  image_too_large: "용량 제한으로 일부 이미지를 제외했습니다.",
  image_type_unsupported: "지원하지 않는 이미지 형식입니다.",
  image_invalid: "이미지 파일을 확인하지 못했습니다.",
  collection_in_progress:
    "상품 정보를 갱신 중입니다. 완료 후 다시 추정해주세요.",
  package_observation_changed:
    "상품 정보가 갱신되었습니다. 최신 정보에서 다시 요청해주세요.",
  unsupported_url:
    "지원하는 라쿠텐 이치바·북스 또는 메루카리 상품 URL을 입력해주세요.",
  invalid_url: "상품 URL을 확인해주세요.",
  invalid_input: "입력 형식과 범위를 확인해주세요.",
  access_denied: "판매처 접근이 제한되었습니다.",
  rakuten_ip_not_allowed: "라쿠텐 API의 허용 IP 설정을 확인해주세요.",
  api_item_not_found: "API에 일치하는 상품이 없어 원본 페이지를 확인했습니다.",
  api_identifier_unresolved:
    "API용 상품 식별자를 확인하지 못해 원본 페이지를 사용했습니다.",
  api_identity_mismatch:
    "API 응답의 상품이 입력 링크와 달라 저장하지 않았습니다.",
  llm_disabled: "자동 추정이 비활성화되어 있습니다.",
  ai_budget_exhausted: "오늘의 AI 호출 상한에 도달했습니다.",
  ai_budget_required: "AI 호출 예산을 설정해주세요.",
  ai_request_pending_or_unknown:
    "같은 AI 요청이 진행 중이거나 결과 확인이 필요해 재전송하지 않았습니다.",
  ai_previous_request_failed:
    "이전 AI 요청이 실패해 추가 과금을 막기 위해 재전송하지 않았습니다.",
  package_analysis_in_progress:
    "다른 포장 분석이 진행 중입니다. 완료 후 다시 요청해주세요.",
  observation_required: "먼저 상품 정보를 분석해주세요.",
  package_not_established:
    "포장 무게와 크기를 확정할 근거가 부족합니다. 확인된 내용을 참고해 직접 입력해주세요.",
  exact_identifier_required:
    "정확한 모델 식별자를 확인하지 못했습니다. 추가 정보가 있으면 입력해 다시 추정하세요.",
  awaiting_package_input:
    "포장 정보를 추정하지 못했습니다. 추가 정보로 다시 추정하거나 직접 수정할 수 있습니다.",
  seller_unknown: "판매자 정보를 확인하지 못했습니다.",
  availability_unknown: "판매 상태를 확인하지 못했습니다.",
  description_missing: "상세 설명을 확인하지 못했습니다.",
  price_missing: "가격을 확인하지 못했습니다.",
  domestic_shipping_unknown: "현지 배송비를 확인하지 못했습니다.",
  option_price_requires_verification:
    "옵션에 따라 가격이 달라 선택 조건 확인이 필요합니다.",
  auction_price_requires_review: "경매 매물의 가격은 별도 확인이 필요합니다.",
  llm_supplement_used: "일부 정보에 AI 해석을 사용했습니다.",
  fx_unavailable: "환율을 확인하지 못했습니다.",
  unauthorized: "서버 접근 설정을 확인해주세요.",
};

export const labels = {
  queued: "작업 대기",
  running: "분석 중",
  waiting: "같은 작업 진행 중",
  succeeded: "분석 완료",
  failed: "처리 실패",
  interrupted: "작업 중단",
  estimated: "추정 견적",
  partial: "일부 비용만 확인",
  rate_review_required: "요율 재확인 필요",
  unsupported: "계산 범위 밖",
  in_stock: "판매 가능",
  sold_out: "판매 종료·품절",
  preorder: "예약 판매",
  backorder: "입고 대기 주문",
  unknown: "미확인",
};

export const stages = {
  customs_fx: "관세청 과세환율 조회",
  customs_hs_4_reconsider: "HS 품목 재검토",
  customs_hs_6_reconsider: "HS 세부품목 재검토",
  customs_hs_research: "공식 품목분류 사례 검색",
  customs_tariff_lookup: "한국 HSK 기본세율 조회",
  customs_tariff_detail: "조건부 세율·내국세 확인",
  customs_hsk_select: "한국 HSK 세부품목 추론",
  customs_hs_2: "HS 대분류 선택",
  customs_hs_4: "HS 품목 선택",
  customs_hs_6: "HS 세부품목 선택",
  customs_classify: "관세 품목 추론",
  customs_classification: "관세 품목 분류",
  tax_calculate: "관세·주류 세액 계산",
  package_images: "상품 이미지 확보",
  package_visual: "이미지·상품 식별",
  package_search: "동일·유사 상품 검색",
  package_estimate_v3: "포장 범위 추정",
  fetch: "정보 수집",
  parse: "상품 해석",
  resolve_api_code: "API 식별자 확인",
  fx: "환율 조회",
  web_search: "포장 사양 검색",
  spec_estimate: "포장 사양 정리",
  llm_extract: "상품 정보 추론",
  package_estimate: "포장 추정",
  quote: "견적 계산",
};

export const methods = {
  rakuten_books_api: "라쿠텐 북스 API",
  books_api: "북스 API",
  rakuten_ichiba_api: "라쿠텐 이치바 API",
  rakuten_api: "이치바 API",
  ichiba_api: "이치바 API",
  http: "웹페이지",
  html: "HTML",
  browser: "브라우저",
  rendered_html: "화면 해석",
  rate_table: "요율표",
  openai_responses: "OpenAI",
};

export const explain = (s) => errors[s] || s;
