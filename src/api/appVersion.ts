/**
 * GET /api/app/version — endpoint public (pas de JWT) consulté au lancement pour savoir si
 * une mise à jour doit être recommandée (`latestVersion`) ou imposée (`minVersion`). Distribution
 * hors Play Store : `downloadUrl` pointe l'APK de la dernière release GitHub (cf.
 * `.github/workflows/release-android.yml`).
 */
import { apiUrl } from './config';

export type AppVersionInfo = {
  minVersion: string;
  latestVersion: string;
  downloadUrl: string;
};

/** Renvoie `null` sur toute panne (réseau, backend down, endpoint absent) : jamais bloquant. */
export async function fetchAppVersion(): Promise<AppVersionInfo | null> {
  try {
    const response = await fetch(apiUrl('/api/app/version'), {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as Partial<AppVersionInfo>;
    if (
      typeof body.minVersion !== 'string' ||
      typeof body.latestVersion !== 'string' ||
      typeof body.downloadUrl !== 'string'
    ) {
      return null;
    }
    return {
      minVersion: body.minVersion,
      latestVersion: body.latestVersion,
      downloadUrl: body.downloadUrl,
    };
  } catch {
    return null;
  }
}
