import { useEffect, useState } from "react";
import { publicEc2Json } from "../api";
import BrandHeader from "../components/BrandHeader";
import NavBar from "../components/NavBar";
import { t } from "../i18n";

interface CategoryResults {
  category: string;
  stage: "ROUND_1" | "BEST_OF_4" | "BEST_OF_2" | "THE_BEST";
  scoringMode: "CHECKPOINT_LAP" | "TIME_AVERAGE";
  ranked: Array<{
    rank: number;
    teamName: string;
    stage: "ROUND_1" | "BEST_OF_4" | "BEST_OF_2" | "THE_BEST";
    scoringMode: "CHECKPOINT_LAP" | "TIME_AVERAGE";
    completedLap: boolean;
    lapTimeMs: number | null;
    furthestCheckpoint: number;
    aggregateTimeMs: number | null;
    penaltyTimeMs: number;
    finalTimeMs: number | null;
  }>;
  unranked: Array<{ teamName: string }>;
  disqualified: Array<{ teamName: string }>;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(3)} s`;
const stageLabel = { ROUND_1: "Round 1", BEST_OF_4: "Best of 4", BEST_OF_2: "Best of 2", THE_BEST: "The Best" } as const;

export default function ScoreboardPage() {
  const [state, setState] = useState<"PROVISIONAL" | "FINAL">("PROVISIONAL");
  const [activeStage, setActiveStage] = useState<keyof typeof stageLabel>("ROUND_1");
  const [categories, setCategories] = useState<CategoryResults[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        if (import.meta.env.VITE_EVENT_MODE === "concluded") {
          const result = await fetch("/results.json").then((response) => response.json()) as { categories: CategoryResults[] };
          if (!cancelled) { setCategories(result.categories); setState("FINAL"); setError(null); }
        } else {
          const result = await publicEc2Json<{ state: "PROVISIONAL" | "FINAL"; activeStage: keyof typeof stageLabel; categories: CategoryResults[] }>("/public/scoreboard");
          if (!cancelled) { setCategories(result.categories); setState(result.state); setActiveStage(result.activeStage); setError(null); }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load results");
      }
    };
    poll();
    const interval = import.meta.env.VITE_EVENT_MODE === "concluded" ? undefined : setInterval(poll, 5000);
    return () => { cancelled = true; if (interval !== undefined) clearInterval(interval); };
  }, []);

  return (
    <div className="page page-wide">
      <NavBar />
      <BrandHeader title="Competition results" description="ผลแต่ละรอบแยกจากกัน / Each stage is scored independently" />
      <div className={state === "FINAL" ? "notice-banner" : "warning-banner"} role="status" aria-live="polite">
        <strong>{state === "FINAL" ? t("ผลอย่างเป็นทางการ", "Final results") : t("ผลชั่วคราว", "Provisional results")}</strong>
        {state === "PROVISIONAL" && ` · ${stageLabel[activeStage]}`}
        {state === "PROVISIONAL" && t(" — อัปเดตอัตโนมัติทุก 5 วินาที", "refreshes every 5 seconds")}
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {categories.length === 0 && !error && <div className="empty-state">{t("กำลังรอผลการแข่งขัน", "Waiting for results")}</div>}

      {categories.map((category) => (
        <section className="card" key={category.category}>
          <span className="section-kicker">
            {state === "FINAL"
              ? t("ผลอย่างเป็นทางการ", "Final standings")
              : `${stageLabel[category.stage]} · ${category.scoringMode === "CHECKPOINT_LAP" ? "CHECKPOINT / LAP" : "TWO-ATTEMPT AVERAGE"}`}
          </span>
          <h2>{category.category}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("อันดับ", "Rank")}</th><th>{t("ทีม", "Team")}</th><th>{t("รอบที่ถึง", "Reached")}</th><th>{state === "FINAL" ? t("ผล", "Result") : (category.scoringMode === "CHECKPOINT_LAP" ? t("ผลรอบ", "Stage result") : t("เฉลี่ย", "Average"))}</th><th>{t("โทษ", "Penalty")}</th><th>{t("สุทธิ", "Final")}</th></tr></thead>
              <tbody>
                {category.ranked.map((item) => (
                  <tr key={`${item.rank}-${item.teamName}`}>
                    <td><span className={`rank-mark rank-${item.rank}`}>{item.rank}</span></td>
                    <td><strong>{item.teamName}</strong></td>
                    <td>{stageLabel[item.stage]}</td>
                    <td className="technical">{item.scoringMode === "CHECKPOINT_LAP" ? (item.completedLap && item.lapTimeMs != null ? seconds(item.lapTimeMs) : `${item.furthestCheckpoint} checkpoint${item.furthestCheckpoint === 1 ? "" : "s"}`) : (item.aggregateTimeMs == null ? "—" : seconds(item.aggregateTimeMs))}</td>
                    <td className="technical">+{seconds(item.penaltyTimeMs)}</td>
                    <td className="technical"><strong>{item.finalTimeMs == null ? "—" : seconds(item.finalTimeMs)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {category.disqualified.length > 0 && (
            <div className="dq-list"><h3>{t("ตัดสิทธิ์", "Disqualified")}</h3><ul>{category.disqualified.map((item) => <li key={item.teamName}>{item.teamName}</li>)}</ul></div>
          )}
          {category.unranked.length > 0 && <div className="dq-list"><h3>{t("ยังไม่จัดอันดับ", "Unranked")}</h3><ul>{category.unranked.map((item) => <li key={item.teamName}>{item.teamName}</li>)}</ul></div>}
        </section>
      ))}
    </div>
  );
}
