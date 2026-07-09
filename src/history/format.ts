/**
 * Formatage des dates/durées de l'onglet Écoutes (issue #25) — module pur, partagé entre
 * l'historique et le tableau de bord. Locale française en dur, comme le reste de l'UI.
 */

/** Durée lisible : « 45 s », « 3 min », « 1 h 12 min ». */
export function formatDuration(ms: number): string {
  if (ms < 60_000) {
    return `${Math.max(1, Math.round(ms / 1000))} s`;
  }
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes.toString().padStart(2, '0')} min` : `${hours} h`;
}

/** Heure locale « HH:MM » d'un timestamp. */
export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Clé de regroupement par jour local (stable pour les sections de l'historique). */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Libellé de section : « Aujourd'hui », « Hier », sinon « mercredi 8 juillet ». */
export function dayLabel(ms: number, now: number = Date.now()): string {
  const key = dayKey(ms);
  if (key === dayKey(now)) {
    return "Aujourd'hui";
  }
  if (key === dayKey(now - 86_400_000)) {
    return 'Hier';
  }
  const label = new Date(ms).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
