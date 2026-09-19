// Lightweight fuzzy matching to auto-correct OCR product names against
// a personal dictionary built from the user's own past corrections.

export function normalize(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

// Returns the closest known product name for a noisy OCR string, or null
// if nothing is close enough to trust as an auto-correction.
export function findBestMatch(ocrName, knownProducts) {
  const norm = normalize(ocrName);
  if (norm.length < 3 || knownProducts.length === 0) return null;

  let best = null;
  let bestRatio = Infinity;

  for (const product of knownProducts) {
    const candidateNorm = normalize(product.name);
    if (candidateNorm.length < 3) continue;

    if (candidateNorm === norm) return product; // exact match, no need to keep looking

    const dist = levenshtein(norm, candidateNorm);
    const maxLen = Math.max(norm.length, candidateNorm.length);
    const ratio = dist / maxLen;

    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = product;
    }
  }

  // Tolerance: allow more edits on longer names, but stay strict on short ones.
  const threshold = norm.length <= 6 ? 0.2 : 0.35;
  return bestRatio <= threshold ? best : null;
}
