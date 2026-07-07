/**
 * Moteur d'enrichissement MusicBrainz (issue #19).
 *
 * Passe de fond qui, pour chaque piste locale pas encore tentée, construit une requête
 * artiste+titre (`buildMatchQuery`, issue #18), interroge le proxy backend (`resolveMetadata`) et
 * persiste l'issue (`saveEnrichment`). Le proxy est sérialisé/rate-limité en amont : on traite donc
 * **une piste à la fois**. Toute panne (réseau, 401, 503 MusicBrainz throttle, 5xx) arrête la passe
 * sans marquer la piste en cours — elle repartira à la passe suivante, rien n'est marqué à tort.
 *
 * `resolve` exige artiste ET titre : une piste sans artiste exploitable (nom de fichier sans
 * séparateur) est marquée `skipped` plutôt que devinée — l'UI de correction (#20) la reprendra.
 */
import * as db from './db';
import { buildMatchQuery } from './matchQuery';
import { resolveMetadata } from './musicbrainzApi';

/** Nombre de pistes traitées par lot avant de rendre la main (rafraîchit l'UI entre les lots). */
const BATCH_SIZE = 20;

export type EnrichmentDeps = {
  /** Renvoie un JWT valide (refresh transparent), ou `null` si non authentifié. */
  getToken: () => Promise<string | null>;
  /** Appelé après chaque lot persisté : l'UI relit la base pour afficher les pochettes récupérées. */
  onBatchDone?: () => void;
  /** Interrompt la passe (déconnexion, démontage du provider). */
  isCancelled: () => boolean;
};

/**
 * Enrichit les pistes non tentées, lot par lot, jusqu'à épuisement ou interruption. Ne rejette
 * jamais : une erreur réseau/serveur arrête proprement la passe (retry à la prochaine).
 */
export async function runEnrichmentPass(deps: EnrichmentDeps): Promise<void> {
  for (;;) {
    if (deps.isCancelled()) {
      return;
    }
    const candidates = db.loadEnrichmentCandidates(BATCH_SIZE);
    if (candidates.length === 0) {
      return;
    }

    let persisted = 0;
    for (const track of candidates) {
      if (deps.isCancelled()) {
        break;
      }
      const query = buildMatchQuery(track);
      const now = Date.now();

      // Pas d'artiste exploitable → on ne devine pas, on laisse à l'UI de correction (#20).
      if (!query || !query.artist) {
        db.saveEnrichment(track.id, 'skipped', null, now);
        persisted += 1;
        continue;
      }

      const token = await deps.getToken();
      if (!token) {
        // Non authentifié : le proxy exige le JWT, inutile de continuer cette passe.
        if (persisted > 0) {
          deps.onBatchDone?.();
        }
        return;
      }

      try {
        const match = await resolveMetadata(token, query.artist, query.title);
        if (match) {
          db.saveEnrichment(
            track.id,
            'matched',
            {
              mbid: match.mbid,
              album: match.album,
              coverArtUrl: match.coverArtUrl,
              releaseGroupMbid: match.releaseGroupMbid,
            },
            now
          );
        } else {
          db.saveEnrichment(track.id, 'nomatch', null, now);
        }
        persisted += 1;
      } catch (e) {
        // Réseau / 401 / 503 (MusicBrainz throttle) / 5xx : on arrête la passe SANS marquer cette
        // piste (elle sera retentée), après avoir rafraîchi ce qui a déjà été écrit.
        if (__DEV__) {
          console.warn('[enrichEngine] passe interrompue', e);
        }
        if (persisted > 0) {
          deps.onBatchDone?.();
        }
        return;
      }
    }

    if (persisted > 0) {
      deps.onBatchDone?.();
    }
  }
}
