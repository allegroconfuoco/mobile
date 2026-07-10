import type { PlayEventExportRow } from '@/library/db';

/**
 * Sérialisation de l'export de l'historique d'écoute (issue #25, data-ownership/RGPD) —
 * fonctions **pures** (testables au harnais) ; l'écriture fichier + partage vivent dans
 * l'écran appelant (`exportHistory` du dashboard). Tombstones inclus (`deleted: true`) :
 * l'export est le dump brut des données, pas une vue.
 */

/** JSON indenté : enveloppe avec méta (date d'export, volume) + événements bruts. */
export function buildExportJson(rows: PlayEventExportRow[], now: number = Date.now()): string {
  return JSON.stringify(
    {
      exportedAt: new Date(now).toISOString(),
      app: 'fuoco',
      kind: 'play-history',
      count: rows.length,
      events: rows.map((row) => ({
        ...row,
        startedAtIso: new Date(row.startedAt).toISOString(),
      })),
    },
    null,
    2
  );
}

/** Échappe une valeur CSV (RFC 4180 : guillemets doublés, champ cité si séparateur/retour). */
function csvField(value: string | number | boolean | null): string {
  if (value === null) {
    return '';
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const CSV_HEADER = [
  'id',
  'sharedTrackId',
  'title',
  'artist',
  'album',
  'startedAtIso',
  'startedAtMs',
  'playedMs',
  'durationMs',
  'skipped',
  'completed',
  'context',
  'deleted',
].join(',');

/** CSV RFC 4180 (séparateur virgule, en-tête inclus). */
export function buildExportCsv(rows: PlayEventExportRow[]): string {
  const lines = rows.map((row) =>
    [
      csvField(row.id),
      csvField(row.sharedTrackId),
      csvField(row.title),
      csvField(row.artist),
      csvField(row.album),
      csvField(new Date(row.startedAt).toISOString()),
      csvField(row.startedAt),
      csvField(row.playedMs),
      csvField(row.durationMs),
      csvField(row.skipped),
      csvField(row.completed),
      csvField(row.context),
      csvField(row.deleted),
    ].join(',')
  );
  return [CSV_HEADER, ...lines].join('\n');
}
