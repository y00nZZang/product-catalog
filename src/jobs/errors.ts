// Never log raw database messages/connection URLs: they may contain secrets.
export function workerFailure(error: unknown, phase: string) {
  const e = error as {
    code?: unknown;
    errors?: Array<{ code?: unknown }>;
  } | null;
  const candidate = e?.code ?? e?.errors?.[0]?.code;
  const code =
    typeof candidate === "string" && /^[A-Z0-9_]{2,40}$/.test(candidate)
      ? candidate
      : "UNKNOWN";
  const hints: Record<string, string> = {
    "28000":
      "DATABASE_URL 사용자(role)가 실제 PostgreSQL에 존재하는지 확인하세요.",
    "28P01": "DATABASE_URL의 사용자·비밀번호를 확인하세요.",
    "3D000": "DATABASE_URL에 지정한 데이터베이스가 존재하는지 확인하세요.",
    "42P01": "대상 DB를 확인하고 npm run migrate를 실행하세요.",
    "42703": "DB 스키마가 코드와 다릅니다. npm run migrate를 실행하세요.",
    ECONNREFUSED:
      "PostgreSQL 실행 상태와 DATABASE_URL의 호스트·포트를 확인하세요.",
  };
  const fatal = ["28000", "28P01", "3D000", "42P01", "42703"].includes(code);
  return {
    event: "worker_error",
    phase,
    code,
    action: fatal ? "stopping" : "retrying",
    hint: hints[code] ?? "DB 연결과 worker 실행 환경을 확인하세요.",
  };
}
