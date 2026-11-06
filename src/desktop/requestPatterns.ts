/** Compile once per registration change, not once per network request. */
export function compileRequestPatterns(patterns: readonly string[]): (url: string) => boolean {
  if (patterns.includes('<all_urls>')) return () => true;
  const expressions = patterns.map((pattern) => {
    const expression = pattern
      .split('*')
      .map((literal) => RegExp.escape(literal))
      .join('.*');
    return new RegExp(`^${expression}$`);
  });
  return (url) => expressions.some((expression) => expression.test(url));
}
