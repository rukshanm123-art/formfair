/**
 * Compiles a declared pattern the way a browser does: anchored to the whole value and
 * compiled with the `v` flag.
 *
 * There is deliberately no fallback to `u` or to no flag. A pattern that only compiles
 * without `v` is not a valid HTML `pattern`, and analysing it under looser semantics
 * would describe an expression the browser never runs. Such a control is declined.
 */
export function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(`^(?:${pattern})$`, 'v');
  } catch {
    return null;
  }
}

export function accepts(re: RegExp, value: string): boolean {
  re.lastIndex = 0;
  return re.test(value);
}
