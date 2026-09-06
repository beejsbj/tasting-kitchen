/** Compact presentation only; configuration identities retain their full values. */
export function effortLabel(effort: string): string {
  return ({ none: 'N', minimal: 'MIN', low: 'L', medium: 'M', high: 'H', xhigh: 'XH', max: 'MAX', ultra: 'U' } as Record<string, string>)[effort] ?? effort.toUpperCase();
}
