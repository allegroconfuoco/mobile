/** Compare deux versions « x.y.z » (segments manquants/non numériques comptent pour 0). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function parseVersion(version: string): [number, number, number] {
  const parts = version
    .split('.')
    .slice(0, 3)
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}
