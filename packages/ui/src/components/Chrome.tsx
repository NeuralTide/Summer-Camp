export function Meter({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="meter__fill" style={{ width: `${pct}%`, ...(color ? { ["--meter-color" as string]: color } : {}) }} />
    </div>
  );
}

/**
 * A course identifies itself with the first letter of its title, set in the
 * display serif. Skips leading punctuation and quotes so a title like
 * "«Beowulf» in context" marks itself B rather than a stray bracket.
 */
export function monogram(title: string): string {
  const first = title.match(/[\p{L}\p{N}]/u);
  return first ? first[0].toUpperCase() : "?";
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${totalMinutes % 60}m`;
}

/** Brief burst of particles for a lesson well done. Hand-rolled, no extra dependency. */
export function Confetti({ colors }: { colors: string[] }) {
  const pieces = Array.from({ length: 40 }, (_, i) => {
    const left = Math.random() * 100;
    const delay = Math.random() * 0.35;
    const duration = 1.6 + Math.random() * 1.1;
    const size = 6 + Math.random() * 7;
    const rotate = Math.random() * 360;
    return (
      <span
        key={i}
        style={{
          position: "absolute",
          left: `${left}%`,
          top: "-6%",
          width: size,
          height: size * 0.55,
          background: colors[i % colors.length],
          border: "1px solid var(--ink)",
          borderRadius: 2,
          transform: `rotate(${rotate}deg)`,
          animation: `confetti-fall ${duration}s ${delay}s cubic-bezier(0.3, 0.7, 0.6, 1) forwards`,
        }}
      />
    );
  });

  return (
    <div className="confetti" aria-hidden="true">
      <style>{`@keyframes confetti-fall {
        to { transform: translateY(108vh) rotate(760deg); opacity: 0; }
      }`}</style>
      {pieces}
    </div>
  );
}
