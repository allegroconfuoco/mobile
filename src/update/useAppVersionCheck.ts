/**
 * Vérifie au montage si l'appli installée est à jour vis-à-vis du backend (`/api/app/version`).
 * Non bloquant par nature : une panne réseau ou un backend injoignable laisse simplement passer
 * (`status: 'error'`), jamais de blocage sur un problème qui n'a rien à voir avec la version.
 */
import { useEffect, useState } from 'react';
import * as Application from 'expo-application';

import { fetchAppVersion } from '@/api/appVersion';
import { compareVersions } from './version';

export type AppVersionStatus =
  'checking' | 'up-to-date' | 'outdated-suggested' | 'outdated-forced' | 'error';

export type AppVersionCheckResult = {
  status: AppVersionStatus;
  currentVersion: string | null;
  latestVersion: string | null;
  downloadUrl: string | null;
};

export function useAppVersionCheck(): AppVersionCheckResult {
  // Initialiseur paresseux (pas un effet) : web/version native illisible n'a rien à comparer,
  // l'app n'y est de toute façon pas distribuée — état final direct, pas de setState en cascade.
  const [result, setResult] = useState<AppVersionCheckResult>(() => {
    const current = Application.nativeApplicationVersion;
    return {
      status: current ? 'checking' : 'up-to-date',
      currentVersion: current,
      latestVersion: null,
      downloadUrl: null,
    };
  });

  useEffect(() => {
    const current = Application.nativeApplicationVersion;
    if (!current) {
      return;
    }

    let cancelled = false;
    (async () => {
      const info = await fetchAppVersion();
      if (cancelled) return;
      if (!info) {
        setResult((r) => ({ ...r, status: 'error' }));
        return;
      }
      const status: AppVersionStatus =
        compareVersions(current, info.minVersion) < 0
          ? 'outdated-forced'
          : compareVersions(current, info.latestVersion) < 0
            ? 'outdated-suggested'
            : 'up-to-date';
      setResult({
        status,
        currentVersion: current,
        latestVersion: info.latestVersion,
        downloadUrl: info.downloadUrl,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return result;
}
