export const money = (n, c) =>
  n == null
    ? "미확인"
    : `${Number(n).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} ${c || "통화 미확인"}`;

export const ms = (n) =>
  n == null ? "미측정" : `${Math.round(n).toLocaleString()} ms`;
