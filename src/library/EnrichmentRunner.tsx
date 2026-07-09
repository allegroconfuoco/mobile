/**
 * Déclencheur de l'enrichissement MusicBrainz (issue #19).
 *
 * Composant sans UI, monté sous `AuthProvider` ET `LibraryProvider`. Quand l'app est authentifiée
 * et la bibliothèque prête, lance UNE passe d'enrichissement de fond (sérialisée) via
 * `runEnrichmentPass`, puis fait relire la base à la bibliothèque (`reloadTracks`) après chaque
 * lot pour afficher les pochettes/albums récupérés.
 *
 * Déclenché au montage/connexion (pas sur chaque changement de biblio) : les pistes ajoutées en
 * cours de session seront enrichies à la prochaine ouverture. Le proxy exigeant le JWT, tout est
 * gardé par `isAuthenticated`. Web (hors périmètre) : no-op.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { useLibrary } from './LibraryProvider';
import { runEnrichmentPass } from './enrichEngine';

const ENABLED = Platform.OS !== 'web';

export function EnrichmentRunner() {
  const { getAccessToken, isAuthenticated } = useAuth();
  const { status, tagging, reloadTracks } = useLibrary();

  // Passe en vol : sérialise (un seul run à la fois). `cancelled` coupe une passe au démontage.
  const runningRef = useRef(false);
  const cancelledRef = useRef(false);

  // `reloadTracks` est stable (useCallback), mais lu via ref pour ne pas relier l'effet dessus.
  const reloadRef = useRef(reloadTracks);
  useEffect(() => {
    reloadRef.current = reloadTracks;
  }, [reloadTracks]);

  useEffect(() => {
    // `tagging` : la passe de fond du scan (lot 5) n'a pas fini d'extraire les tags — enrichir
    // maintenant enverrait des requêtes bâties sur des noms de fichiers. L'effet se relance
    // quand elle se termine.
    if (!ENABLED || !isAuthenticated || status !== 'ready' || tagging || runningRef.current) {
      return;
    }
    runningRef.current = true;
    cancelledRef.current = false;
    // Reloads throttlés (lot 5) : `reloadTracks` rejoue un JOIN sur toute la bibliothèque, on ne
    // le fait plus après chaque lot de 20 mais au plus toutes les ~3 s, avec un reload final.
    let lastReload = 0;
    void runEnrichmentPass({
      getToken: getAccessToken,
      onBatchDone: () => {
        const now = Date.now();
        if (now - lastReload >= 3000) {
          lastReload = now;
          reloadRef.current();
        }
      },
      isCancelled: () => cancelledRef.current,
    }).finally(() => {
      runningRef.current = false;
      reloadRef.current();
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [isAuthenticated, status, tagging, getAccessToken]);

  return null;
}

export default EnrichmentRunner;
