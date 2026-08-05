/**
 * Compiles a declared pattern the way a browser does: anchored to the whole value,
 * with the `v` flag where supported and `u` as a fallback for older runtimes.
 */
export function compile(pattern: string): RegExp | null {
  for (const flags of ['v', 'u', '']) {
    try {
      return new RegExp(`^(?:${pattern})$`, flags);
    } catch {
      continue;
    }
  }
  return null;
}

export function accepts(re: RegExp, value: string): boolean {
  re.lastIndex = 0;
  return re.test(value);
}
