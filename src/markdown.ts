/**
 * Shared CommonMark (GFM) rendering helpers used by both the comparison
 * messages and the Markdown report renderer.
 */

/**
 * Renders a value as a CommonMark inline code span.
 *
 * Backslash-escaped backticks are invalid inside code spans — the escaped
 * backtick terminates the span — so values containing backticks use the
 * N+1 delimiter form instead: one more backtick than the longest backtick
 * run in the value, with a single space of padding when the value starts or
 * ends with a backtick so the delimiters remain separate runs.
 */
export function inlineCode(value: string): string {
  const longestRun = (value.match(/`+/g) ?? []).reduce(
    (longest, run) => Math.max(longest, run.length),
    0,
  );
  const delimiter = "`".repeat(longestRun + 1);
  const needsPadding = value.startsWith("`") || value.endsWith("`");
  const content = needsPadding ? ` ${value} ` : value;
  return `${delimiter}${content}${delimiter}`;
}
