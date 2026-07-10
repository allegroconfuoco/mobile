/**
 * Mise en forme des statistiques d'écoute (issue #25) — module **pur** (aucun import runtime),
 * testé au harnais tsx. Les agrégats bruts viennent de SQL (`db.listeningByDay`…) ; ici on
 * transforme en séries prêtes à dessiner : période → borne, jours → buckets de tendance,
 * (jour × tranche) → grille de heatmap.
 *
 * Toute l'arithmétique de dates passe par `setDate`/`setMonth` (jamais des multiples de 24 h)
 * pour rester juste aux changements d'heure été/hiver.
 */

/** Périodes du tableau de bord (cf. issue : 4 dernières semaines, 6 mois, depuis toujours). */
export type StatsPeriod = '4w' | '6m' | 'all';

/** Borne basse (epoch ms) d'une période, `null` = depuis toujours. */
export function periodStartMs(period: StatsPeriod, now: number = Date.now()): number | null {
  if (period === 'all') {
    return null;
  }
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === '4w') {
    d.setDate(d.getDate() - 27); // 28 jours pleins, aujourd'hui compris.
  } else {
    d.setMonth(d.getMonth() - 6);
  }
  return d.getTime();
}

/** Clé de jour local `YYYY-MM-DD`, alignée sur le `strftime(..., 'localtime')` de SQL. */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export type DayRow = { day: string; playedMs: number };

/** Un point de la courbe de tendance. */
export type TrendBucket = { label: string; playedMs: number };

const MONTH_SHORT = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

/**
 * Construit la série de tendance d'une période à partir des totaux par jour :
 *  - `4w`  → 28 buckets journaliers (label `j/m`) ;
 *  - `6m`  → 26 buckets hebdomadaires, semaine courante en dernier (label = 1er jour `j/m`) ;
 *  - `all` → un bucket par mois du premier mois écouté au mois courant (label `mois aa`).
 * Les trous sont remplis à zéro : la courbe garde une échelle temporelle honnête.
 */
export function buildTrend(
  rows: DayRow[],
  period: StatsPeriod,
  now: number = Date.now()
): TrendBucket[] {
  const byDay = new Map(rows.map((r) => [r.day, r.playedMs]));

  if (period === '4w') {
    const out: TrendBucket[] = [];
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 27);
    for (let i = 0; i < 28; i += 1) {
      out.push({
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        playedMs: byDay.get(localDayKey(d)) ?? 0,
      });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  if (period === '6m') {
    // 26 semaines glissantes, la plus ancienne d'abord. On remonte jour par jour depuis
    // aujourd'hui : le jour n tombe dans la semaine floor(n/7) (0 = semaine en cours).
    const sums = new Array<number>(26).fill(0);
    const starts = new Array<string>(26).fill('');
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    for (let daysAgo = 0; daysAgo < 26 * 7; daysAgo += 1) {
      const week = Math.floor(daysAgo / 7);
      sums[week] += byDay.get(localDayKey(d)) ?? 0;
      starts[week] = `${d.getDate()}/${d.getMonth() + 1}`; // écrasé jusqu'au 1er jour de la semaine.
      d.setDate(d.getDate() - 1);
    }
    return sums.map((playedMs, week) => ({ label: starts[week], playedMs })).reverse();
  }

  // `all` : du premier mois écouté au mois courant. Sans écoute, pas de courbe.
  if (rows.length === 0) {
    return [];
  }
  const byMonth = new Map<string, number>();
  for (const row of rows) {
    const key = row.day.slice(0, 7); // YYYY-MM
    byMonth.set(key, (byMonth.get(key) ?? 0) + row.playedMs);
  }
  const firstKey = [...byMonth.keys()].sort()[0];
  const cursor = new Date(Number(firstKey.slice(0, 4)), Number(firstKey.slice(5, 7)) - 1, 1);
  const end = new Date(now);
  const out: TrendBucket[] = [];
  while (
    cursor.getFullYear() < end.getFullYear() ||
    (cursor.getFullYear() === end.getFullYear() && cursor.getMonth() <= end.getMonth())
  ) {
    const key = `${cursor.getFullYear()}-${(cursor.getMonth() + 1).toString().padStart(2, '0')}`;
    out.push({
      label: `${MONTH_SHORT[cursor.getMonth()]} ${cursor.getFullYear().toString().slice(2)}`,
      playedMs: byMonth.get(key) ?? 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

/**
 * Jours d'écoute **consécutifs** se terminant aujourd'hui (ou hier — la journée en cours ne
 * casse pas la série tant qu'elle n'est pas finie). Base : totaux par jour (`listeningByDay`).
 */
export function currentStreakDays(rows: DayRow[], now: number = Date.now()): number {
  const played = new Set(rows.filter((r) => r.playedMs > 0).map((r) => r.day));
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  // La série peut commencer hier si rien n'a encore été écouté aujourd'hui.
  if (!played.has(localDayKey(d))) {
    d.setDate(d.getDate() - 1);
  }
  let streak = 0;
  while (played.has(localDayKey(d))) {
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/** Un badge gagné (gamification locale, #25). `icon` = sous-ensemble d'`IconName`. */
export type Badge = {
  icon: 'timer' | 'group' | 'library_music' | 'graphic_eq';
  label: string;
  hint: string;
};

/** Paliers par catégorie : on n'affiche que le plus haut atteint (pas de mur de badges). */
const HOUR_STEPS = [500, 100, 50, 10, 1];
const ARTIST_STEPS = [100, 50, 10];
const TRACK_STEPS = [500, 200, 50];
const STREAK_STEPS = [30, 7, 3];

/**
 * Badges gagnés sur les compteurs **depuis toujours**. Volontairement local et sobre :
 * les badges comparatifs (« top 1 % des fans ») exigent d'autres utilisateurs → Phase 2.
 */
export function buildBadges(input: {
  playedMs: number;
  uniqueTracks: number;
  uniqueArtists: number;
  streakDays: number;
}): Badge[] {
  const out: Badge[] = [];
  const hours = Math.floor(input.playedMs / 3_600_000);
  const hourStep = HOUR_STEPS.find((step) => hours >= step);
  if (hourStep !== undefined) {
    out.push({
      icon: 'timer',
      label: `${hourStep} h d'écoute`,
      hint: `${hours} h au total`,
    });
  }
  const artistStep = ARTIST_STEPS.find((step) => input.uniqueArtists >= step);
  if (artistStep !== undefined) {
    out.push({
      icon: 'group',
      label: `${artistStep} artistes`,
      hint: `${input.uniqueArtists} artistes écoutés`,
    });
  }
  const trackStep = TRACK_STEPS.find((step) => input.uniqueTracks >= step);
  if (trackStep !== undefined) {
    out.push({
      icon: 'library_music',
      label: `${trackStep} titres`,
      hint: `${input.uniqueTracks} titres différents`,
    });
  }
  const streakStep = STREAK_STEPS.find((step) => input.streakDays >= step);
  if (streakStep !== undefined) {
    out.push({
      icon: 'graphic_eq',
      label: `${streakStep} jours d'affilée`,
      hint: `Série en cours : ${input.streakDays} jours`,
    });
  }
  return out;
}

export type HeatmapRow = { weekday: number; slot: number; playedMs: number };

/** Libellés des lignes (lundi d'abord) et des colonnes (tranches de 3 h) de la heatmap. */
export const HEATMAP_DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
export const HEATMAP_SLOTS = ['0h', '3h', '6h', '9h', '12h', '15h', '18h', '21h'];

/**
 * Grille 7 (jours, lundi d'abord) × 8 (tranches de 3 h) des temps écoutés, + maximum pour
 * normaliser l'intensité. `weekday` entre en convention SQLite `%w` (0 = dimanche).
 */
export function buildHeatmapGrid(rows: HeatmapRow[]): { grid: number[][]; max: number } {
  const grid = Array.from({ length: 7 }, () => new Array<number>(8).fill(0));
  let max = 0;
  for (const row of rows) {
    const day = (row.weekday + 6) % 7; // %w : 0 = dimanche → index 6 ; 1 = lundi → index 0.
    const slot = Math.min(Math.max(row.slot, 0), 7);
    grid[day][slot] += row.playedMs;
    max = Math.max(max, grid[day][slot]);
  }
  return { grid, max };
}
