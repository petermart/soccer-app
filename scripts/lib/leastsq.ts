/**
 * Ordinary least squares via normal equations with a small ridge term.
 * Shared by the slot-rating and attribute-imputation fits.
 */
export function solveLeastSquares(rows: number[][], targets: number[], features: number): number[] {
  const n = features + 1; // + intercept
  const ata = Array.from({ length: n }, () => new Float64Array(n));
  const aty = new Float64Array(n);

  for (let r = 0; r < rows.length; r++) {
    const x = rows[r]!;
    const y = targets[r]!;
    for (let i = 0; i < n; i++) {
      const xi = i === features ? 1 : x[i]!;
      aty[i]! += xi * y;
      for (let j = i; j < n; j++) {
        const xj = j === features ? 1 : x[j]!;
        ata[i]![j]! += xi * xj;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    ata[i]![i]! += 1e-6; // keep collinear columns from making this singular
    for (let j = 0; j < i; j++) ata[i]![j]! = ata[j]![i]!;
  }

  const m = Array.from({ length: n }, (_, i) => [...ata[i]!, aty[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const pv = m[col]![col]!;
    if (Math.abs(pv) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / pv;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c]! -= factor * m[col]![c]!;
    }
  }
  return Array.from({ length: n }, (_, i) => {
    const pv = m[i]![i]!;
    return Math.abs(pv) < 1e-12 ? 0 : m[i]![n]! / pv;
  });
}
