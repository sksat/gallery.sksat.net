/**
 * A video's length as shown on tiles and in the info panel (format.spec.ts),
 * the same in the gallery and the admin: "0:05", "12:00", "1:02:03".
 */
export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};
