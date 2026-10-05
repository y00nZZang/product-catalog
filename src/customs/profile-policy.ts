/** Audited calculation scope. An official calculator row is not automatically a supported tax regime. */
export const calculationProfiles: Record<number, string> = {
  46: "toy",
  213: "cushion",
  39: "apparel",
  250: "recorded_media",
  29: "wine",
  30: "whisky",
  128: "sake",
  129: "brandy",
  40: "shoes",
  173: "hosiery",
  175: "tie",
  176: "scarf",
  177: "hat",
  178: "umbrella",
  179: "gloves",
  180: "belt",
  186: "suitcase",
  189: "wallet",
  190: "phone_case",
  191: "sports_apparel",
  192: "sports_shoes",
  193: "sports_gloves",
  194: "swimwear",
  202: "tent",
  169: "towel",
  209: "bedsheet",
  210: "blanket",
  211: "sleeping_bag",
  212: "curtain",
  216: "table_mat",
  15: "stroller",
  16: "baby_walker",
  14: "diaper",
  9: "baby_cosmetics",
  34: "skincare",
  35: "makeup",
  32: "lipstick",
  33: "face_powder",
  36: "shampoo",
  10: "bath_products",
  158: "cleanser",
  160: "hand_cream",
  167: "soap",
  168: "detergent",
  217: "lighting",
  218: "tableware",
  221: "cutlery",
  222: "tumbler",
  223: "computer",
  41: "laptop",
  227: "keyboard",
  228: "mouse",
  229: "printer",
  230: "scanner",
  231: "smartphone",
  233: "power_bank",
  235: "digital_camera",
  237: "camcorder",
  238: "vacuum",
  239: "humidifier",
  241: "hair_dryer",
  242: "electric_shaver",
  245: "headphones",
  246: "speaker",
  247: "microphone",
  249: "blank_media",
};
export function reviewReason(id: number, group: string) {
  if (calculationProfiles[id]) return null;
  if ([37, 44, 181, 203, 244].includes(id))
    return "가격·재질에 따른 개별소비세 등 추가 세목을 확인해야 합니다.";
  if (id === 248)
    return "서적·잡지의 부가세 면제 및 구성품 조건을 확인해야 합니다. 관세 0%만으로 전체 세금을 판단하지 않습니다.";
  if (id === 31) return "향수의 용량·수량별 면세 조건을 확인해야 합니다.";
  if (group.startsWith("식품") || [11, 12, 13].includes(id))
    return "식품·의약품의 자가사용 수량, 성분·함량 및 세율 종류를 확인해야 합니다.";
  if ([165, 166, 240, 243].includes(id))
    return "의약·의료·담배 등 품목 구분과 추가 세목·수입요건 확인이 필요합니다.";
  return "원재료·용도·세부 품목 또는 추가 세목을 검증하지 않아 참고 세율만 제공합니다.";
}
// Generic rows must not mask possible luxury-item taxation. Threshold is a conservative review gate, not a tax formula.
export function valueReviewThreshold(id: number) {
  return [235, 237].includes(id) ? 2_000_000 : null;
}
