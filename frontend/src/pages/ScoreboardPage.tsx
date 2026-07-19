import { useEffect, useState } from "react";
import { publicEc2Json } from "../api";
import BrandHeader from "../components/BrandHeader";
import NavBar from "../components/NavBar";
import { t } from "../i18n";

interface CategoryResults {
  category: string;
  ranked: Array<{
    rank: number;
    teamName: string;
    aggregateTimeMs: number;
    penaltyTimeMs: number;
    finalTimeMs: number;
  }>;
  disqualified: Array<{ teamName: string }>;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(3)} s`;

export default function ScoreboardPage() {
  const [state, setState] = useState<"PROVISIONAL" | "FINAL">("PROVISIONAL");
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
          const result = await publicEc2Json<{ state: "PROVISIONAL" | "FINAL"; categories: CategoryResults[] }>("/public/scoreboard");
          if (!cancelled) { setCategories(result.categories); setState(result.state); setError(null); }
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
      <BrandHeader title="Competition results" description="จัดอันดับด้วยเวลาสุทธิน้อยที่สุด / Ranked by lowest final time" />
      <div className={state === "FINAL" ? "notice-banner" : "warning-banner"} role="status" aria-live="polite">
        <strong>{state === "FINAL" ? t("ผลอย่างเป็นทางการ", "Final results") : t("ผลชั่วคราว", "Provisional results")}</strong>
        {state === "PROVISIONAL" && t(" — อัปเดตอัตโนมัติทุก 5 วินาที", "refreshes every 5 seconds")}
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {categories.length === 0 && !error && <div className="empty-state">{t("กำลังรอผลการแข่งขัน", "Waiting for results")}</div>}

      {categories.map((category) => (
        <section className="card" key={category.category}>
          <span className="section-kicker">CATEGORY</span>
          <h2>{category.category}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("อันดับ", "Rank")}</th><th>{t("ทีม", "Team")}</th><th>{t("เฉลี่ย", "Average")}</th><th>{t("โทษ", "Penalty")}</th><th>{t("สุทธิ", "Final")}</th></tr></thead>
              <tbody>
                {category.ranked.map((item) => (
                  <tr key={`${item.rank}-${item.teamName}`}>
                    <td><span className={`rank-mark rank-${item.rank}`}>{item.rank}</span></td>
                    <td><strong>{item.teamName}</strong></td>
                    <td className="technical">{seconds(item.aggregateTimeMs)}</td>
                    <td className="technical">+{seconds(item.penaltyTimeMs)}</td>
                    <td className="technical"><strong>{seconds(item.finalTimeMs)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {category.disqualified.length > 0 && (
            <div className="dq-list"><h3>{t("ตัดสิทธิ์", "Disqualified")}</h3><ul>{category.disqualified.map((item) => <li key={item.teamName}>{item.teamName}</li>)}</ul></div>
          )}
        </section>
      ))}
    </div>
  );
}
