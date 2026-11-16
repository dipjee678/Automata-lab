/** Enumerate all strings over `alphabet` in shortlex order (by length, then alphabetically). */
export function* shortlex(alphabet: string[], maxLen: number): Generator<string> {
  yield '';
  if (alphabet.length === 0) return;
  let layer = [''];
  for (let len = 1; len <= maxLen; len++) {
    const next: string[] = [];
    for (const prefix of layer)
      for (const c of alphabet) {
        const s = prefix + c;
        yield s;
        next.push(s);
      }
    layer = next;
  }
}

/** Largest length L ≤ maxLen such that the number of strings of length ≤ L stays within `cap`. */
export function boundedLengthFor(alphabetSize: number, maxLen: number, cap: number): number {
  let total = 1;
  let power = 1;
  let len = 0;
  while (len < maxLen) {
    power *= Math.max(alphabetSize, 1);
    if (alphabetSize === 0 || total + power > cap) break;
    total += power;
    len++;
  }
  return len;
}

export interface BoundedComparison {
  /** Length up to which EVERY string was tested. */
  testedLength: number;
  tested: number;
  both: number;
  onlyExpected: number;
  onlyActual: number;
  neither: number;
  /** Shortest string on which the two disagree, if any. */
  firstDifference: { input: string; expected: boolean; actual: boolean } | null;
}

/**
 * Bounded testing: compare two membership oracles on every string up to a
 * length bound. Agreement here is evidence, NOT a proof of equivalence.
 */
export function boundedCompare(
  expected: (s: string) => boolean,
  actual: (s: string) => boolean,
  alphabet: string[],
  maxLen: number,
  cap = 3000,
): BoundedComparison {
  const sigma = [...new Set(alphabet)].sort();
  const testedLength = boundedLengthFor(sigma.length, maxLen, cap);
  const out: BoundedComparison = { testedLength, tested: 0, both: 0, onlyExpected: 0, onlyActual: 0, neither: 0, firstDifference: null };
  for (const s of shortlex(sigma, testedLength)) {
    const e = expected(s);
    const a = actual(s);
    out.tested++;
    if (e && a) out.both++;
    else if (e) out.onlyExpected++;
    else if (a) out.onlyActual++;
    else out.neither++;
    if (e !== a && !out.firstDifference) out.firstDifference = { input: s, expected: e, actual: a };
  }
  return out;
}

/**
 * Balanced accuracy in [0, 1]: the mean of "fraction of the language that is
 * accepted" and "fraction of the complement that is rejected". Trivial
 * answers (accept everything / nothing) score 0.5.
 */
export function balancedAccuracy(c: { both: number; onlyExpected: number; onlyActual: number; neither: number }): number {
  const pos = c.both + c.onlyExpected;
  const neg = c.onlyActual + c.neither;
  const tpr = pos === 0 ? 1 : c.both / pos;
  const tnr = neg === 0 ? 1 : c.neither / neg;
  return (tpr + tnr) / 2;
}

export const showString = (s: string) => (s === '' ? 'ε (the empty string)' : `"${s}"`);
