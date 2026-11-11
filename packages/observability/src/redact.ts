export const REDACTED = '[REDACTED]';

/**
 * Keys whose values are never logged: credentials, tokens, cookies, CSRF values, personal
 * data, academic data (scores, amounts, payloads), and page markup.
 */
const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|csrf|xsrf|viewstate|session|e-?mail|phone|chat_?id|student_?id|score|gpa|amount|balance|fee|debt|paid|payload|changed_?fields|before|after|html|dom|body|headers/i;

/** Values that look sensitive wherever they appear inside a string. */
const SENSITIVE_PATTERNS: [RegExp, string][] = [
  // JSON Web Tokens.
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}\b/g, REDACTED],
  // CampusWatch refresh and device tokens.
  [/\bcw[rd]_[\w-]{10,}/g, REDACTED],
  // Bearer / Basic credentials.
  [/\b(Bearer|Basic)\s+[\w.~+/=-]{6,}/gi, `$1 ${REDACTED}`],
  // Telegram bot tokens, including inside Bot API URLs.
  [/\d{5,}:[\w-]{30,}/g, REDACTED],
  // Email addresses.
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, REDACTED],
  // Cookies and CSRF/ASP.NET state passed as key=value.
  [
    /\b(cookie|set-cookie|csrf[\w-]*|__requestverificationtoken|__viewstate[\w]*|sessionid|asp\.net_sessionid)\s*[=:]\s*[^\s;,&]+/gi,
    `$1=${REDACTED}`,
  ],
  // Long digit runs: student IDs, phone numbers, chat ids, amounts.
  [/\b\d{7,}\b/g, REDACTED],
  // Digit-grouped money such as 9.800.000 or 9,800,000.
  [/\b\d{1,3}(?:[.,]\d{3}){2,}\b/g, REDACTED],
  // Page markup.
  [/<\s*\/?\s*[a-z][\w-]*(\s[^<>]*)?>/gi, REDACTED],
];

const MAX_STRING = 2000;
const MAX_DEPTH = 6;

export function redactString(value: string): string {
  let result = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Deep-copies a value for logging with sensitive keys removed and sensitive substrings masked.
 * Unknown objects become plain data; errors keep only their name and redacted message.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return `[${typeof value}]`;
  }
  if (depth >= MAX_DEPTH) {
    return '[Truncated]';
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1);
  }
  return result;
}
