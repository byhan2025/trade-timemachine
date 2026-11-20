import type { Dataset } from "./types";

/**
 * CSV 내보내기 유틸 — RFC 4180 이스케이프 + 수식 인젝션 방어 (v2.3.2 → v2.3.3).
 *
 * 왜 필요한가
 * 1. RFC 4180: 값 안에 쉼표(`,`)·큰따옴표(`"`)·줄바꿈(`\n`, `\r`)이 있으면 그 칸 전체를
 *    큰따옴표로 감싸고, 값 안의 큰따옴표는 두 번(`""`) 써야 한다. 그러지 않으면 엑셀·구글
 *    스프레드시트에서 열이 밀리거나 한 줄이 여러 줄로 쪼개진다.
 *    레코드 구분자도 표준(CRLF)을 쓴다 — v2.3.3 에서 `\n` → `\r\n`.
 * 2. 수식 인젝션(CSV injection): `=`, `+`, `-`, `@` 로 시작하는 칸은 스프레드시트가 수식으로
 *    해석한다(=HYPERLINK(...), =cmd|... 등). 사람이 읽는 텍스트 칸은 맨 앞에 작은따옴표(`'`)를
 *    붙여 "글자"로 고정한다. 다만 `-1000` 처럼 그 자체가 음수인 칸은 수치 데이터이므로 방어하지
 *    않는다(음수가 망가지면 안 된다). `+82` 는 엑셀이 `82` 라는 수식으로 읽으므로 막는다.
 * 3. (v2.3.3) 앞에 공백·탭·개행이 붙은 `  =1+1`, `\t@SUM(A1)` 도 수식이므로 같이 막는다.
 *    엑셀은 칸 앞쪽 공백을 지우고 다시 수식으로 읽기 때문에, 선두 문자만 보던 v2.3.2 규칙으로는
 *    새어 나갔다.
 */

export const CSV_HEADER = ["시각", "시가", "고가", "저가", "종가", "거래량"] as const;

/** 레코드 구분자 — RFC 4180 은 CRLF 다 (v2.3.3). 파서는 `\r?\n` 이라 LF 로 저장된 파일도 읽는다 */
export const CSV_EOL = "\r\n";

/** 스프레드시트가 수식으로 해석하는 선두 문자 (탭·CR·LF 도 함께 막는다) */
const FORMULA_LEAD = /^[=+\-@\t\r\n]/;

/** 앞쪽 공백·탭·개행을 건너뛴 첫 글자가 수식 트리거인 경우 (v2.3.3) */
const FORMULA_AFTER_SPACE = /^\s*[=+\-@]/;

/** 부호 있는 숫자 문자열 — 음수(`-1000`)는 수치 데이터이므로 방어하지 않는다 */
const NEGATIVE_NUMBER = /^-(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** 쉼표·큰따옴표·줄바꿈이 있으면 인용이 필요한 칸 */
const NEEDS_QUOTE = /[",\r\n]/;

function isNegativeNumber(s: string): boolean {
  return s !== "" && NEGATIVE_NUMBER.test(s);
}

/**
 * 값 하나 → CSV 칸.
 * - null/undefined → 빈 칸
 * - 숫자(Number) → 그대로 (음수 포함). 유한하지 않으면 빈 칸
 * - 문자열 → 수식 인젝션 방어 후 필요하면 인용
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "number") {
    text = Number.isFinite(value) ? String(value) : "";
  } else if (typeof value === "boolean") {
    text = value ? "true" : "false";
  } else {
    text = String(value);
    // 사람이 읽는 글자 칸만 방어한다. 음수(-1000, "  -1000")는 그대로 두고, '+' 는 엑셀이
    // 수식(+82)으로 읽으므로 숫자 모양이어도 막는다. 앞쪽 공백·탭·개행 뒤의 트리거도 함께 막는다.
    const lead = FORMULA_LEAD.test(text) || FORMULA_AFTER_SPACE.test(text);
    if (lead && !isNegativeNumber(text.trim())) text = `'${text}`;
  }
  if (NEEDS_QUOTE.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** 한 줄 = 칸들을 쉼표로 잇는다 (줄바꿈은 넣지 않는다) */
export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * 데이터셋의 마지막 n일 → CSV 텍스트 (형식 예시 / 내려받기).
 * 모든 칸이 이 유틸을 거치므로 열이 밀리거나 수식이 실행되지 않는다.
 * v2.3.3 — 레코드 구분자만 CRLF 로 바꾼다(줄 내용·줄 수·마지막 줄 처리 방식은 v2.3.2 그대로).
 */
export function toCsv(d: Dataset, n: number): string {
  const lines: string[] = [csvRow(CSV_HEADER)];
  for (const s of d.sessions.slice(-n)) {
    s.bars.forEach((b, i) => {
      lines.push(csvRow([`${s.date} ${d.times[i]}`, b[0], b[1], b[2], b[3], b[4] ?? 0]));
    });
  }
  return lines.join(CSV_EOL);
}
