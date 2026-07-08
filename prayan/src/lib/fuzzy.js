// Simple subsequence fuzzy matcher for the command palette (PLAN.md §1.4) —
// original implementation, no dependency pulled in for this.

/**
 * Every character of `query`, in order, must appear in `target`
 * (case-insensitive). Consecutive matches score higher. Returns -1 when
 * `query` isn't a subsequence of `target`.
 */
export function fuzzyScore(query, target) {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  let score = 0
  let lastIndex = -2
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += lastIndex === ti - 1 ? 3 : 1
      lastIndex = ti
      qi++
    }
  }
  return qi === q.length ? score : -1
}
