/**
 * Search and grouping for long option lists (the Model chip, the counter's
 * model facet). Kept free of runtime imports so node's type-stripping test
 * runner can load it.
 */

/** Lists longer than this get a search field. */
export const SEARCH_THRESHOLD = 8;

/** Every word of the query appears somewhere in the text, in any order and case. */
export function matchesQuery(text: string, query: string) {
  const haystack = text.toLowerCase();
  return query.toLowerCase().split(/\s+/u).filter(Boolean).every((word) => haystack.includes(word));
}

/**
 * Options split into groups, in the order each group first appears, so a list
 * already ranked (reachable before impossible) keeps its best group first.
 * Options without a group form one unnamed group.
 */
export function groupOptions<T extends { group?: string }>(options: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const option of options) {
    const key = option.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }
  return [...groups].map(([group, items]) => ({ group: group || undefined, options: items }));
}

/** The options a query keeps, matched on what a reader sees and searches by: label, group, badge and any extra terms. */
export function searchOptions<T extends { label: string; group?: string; badge?: string; terms?: string }>(options: readonly T[], query: string) {
  if (!query.trim()) return [...options];
  return options.filter((option) => matchesQuery([option.label, option.group, option.badge, option.terms].filter(Boolean).join(" "), query));
}
