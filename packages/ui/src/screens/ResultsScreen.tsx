import { useEffect, useState } from "react";
import { Confetti } from "../components/Chrome";
import { IconBolt, IconFlame, IconStar } from "../components/Icons";
import type { CompleteResponse } from "../lib/types";

interface Props {
  result: CompleteResponse;
  courseColor: string;
  onContinue: () => void;
}

export function ResultsScreen({ result, courseColor, onContinue }: Props) {
  const [showConfetti, setShowConfetti] = useState(result.passed);

  useEffect(() => {
    if (!showConfetti) return;
    const timer = window.setTimeout(() => setShowConfetti(false), 2600);
    return () => window.clearTimeout(timer);
  }, [showConfetti]);

  const heading = !result.passed
    ? "Lesson incomplete"
    : result.perfect
      ? "Perfect lesson!"
      : result.crownEarned
        ? "Lesson complete!"
        : "Nice review!";

  const sub = !result.passed
    ? `You got ${result.correctCount} of ${result.total} first try. Give it another go.`
    : result.perfect
      ? "Every answer right on the first try."
      : `${result.correctCount} of ${result.total} correct on the first try.`;

  return (
    <div className="results">
      {showConfetti && <Confetti colors={[courseColor, "var(--gold)", "var(--correct)", "#fff"]} />}
      <div className="results__inner">
        <div style={{ fontSize: 60 }}>{result.passed ? (result.perfect ? "🏆" : "🎉") : "💪"}</div>
        <h1 className="results__title">{heading}</h1>
        <p className="muted">{sub}</p>

        <div className="tiles">
          <div className="tile-stat" style={{ ["--tile-accent" as string]: "var(--gold)" }}>
            <div className="tile-stat__label">
              <IconBolt size={13} /> XP
            </div>
            <div className="tile-stat__value">+{result.xpAwarded}</div>
          </div>
          <div className="tile-stat" style={{ ["--tile-accent" as string]: courseColor }}>
            <div className="tile-stat__label">Score</div>
            <div className="tile-stat__value">{Math.round(result.score * 100)}%</div>
          </div>
          <div className="tile-stat" style={{ ["--tile-accent" as string]: "var(--flame)" }}>
            <div className="tile-stat__label">
              <IconFlame size={13} /> Streak
            </div>
            <div className="tile-stat__value">{result.progress.streak.current}</div>
          </div>
        </div>

        {result.crownEarned && (
          <div className="notice notice--info" style={{ justifyContent: "center", marginBottom: 20 }}>
            <IconStar size={18} />
            Crown earned — the next lesson just unlocked.
          </div>
        )}

        <button className="btn btn--primary btn--lg" style={{ background: courseColor }} onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
