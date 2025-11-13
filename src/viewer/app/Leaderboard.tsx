import React, { useCallback, useEffect, useMemo, useState } from "react";

interface LeaderboardEntry {
  variantId: string;
  wins: number;
  label: string;
  provider: string | null;
  model: string | null;
  description?: string | null;
  runTimestamp?: string | null;
}

interface LeaderboardStats {
  totalVotes: number;
  totalModels: number;
  lastUpdated: string | null;
}

interface LeaderboardPayload {
  entries: LeaderboardEntry[];
  stats?: LeaderboardStats;
}

interface BattleVariant {
  variantId: string;
  label: string;
  provider: string | null;
  model: string | null;
}

interface Battle {
  id: string;
  createdAt: string;
  left: BattleVariant;
  right: BattleVariant;
  winner: BattleVariant | null;
  selection: string;
  notes?: string | null;
}

interface BattlesPayload {
  battles: Battle[];
}

type TabType = "leaderboard" | "battles";

export default function Leaderboard() {
  const [activeTab, setActiveTab] = useState<TabType>("leaderboard");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [stats, setStats] = useState<LeaderboardStats | null>(null);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/leaderboard");
      if (!response.ok) {
        throw new Error(`Leaderboard request failed (${response.status})`);
      }
      const payload = (await response.json()) as LeaderboardPayload;
      setEntries(payload.entries ?? []);
      setStats(payload.stats ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBattles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/battles");
      if (!response.ok) {
        throw new Error(`Battles request failed (${response.status})`);
      }
      const payload = (await response.json()) as BattlesPayload;
      setBattles(payload.battles ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (activeTab === "leaderboard") {
      await fetchLeaderboard();
    } else {
      await fetchBattles();
    }
  }, [activeTab, fetchLeaderboard, fetchBattles]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const normalizedQuery = search.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedQuery) return entries;
    return entries.filter((entry) => {
      const haystack = [
        entry.label,
        entry.provider,
        entry.model,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [entries, normalizedQuery]);

  const filteredBattles = useMemo(() => {
    if (!normalizedQuery) return battles;
    return battles.filter((battle) => {
      const haystack = [
        battle.left.label,
        battle.left.provider,
        battle.right.label,
        battle.right.provider,
        battle.winner?.label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [battles, normalizedQuery]);

  const lastUpdated = useMemo(() => {
    if (!stats?.lastUpdated) return "—";
    const normalized = stats.lastUpdated.includes("T")
      ? stats.lastUpdated
      : `${stats.lastUpdated.replace(" ", "T")}Z`;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return stats.lastUpdated;
    }
    return parsed.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  }, [stats?.lastUpdated]);

  const totalVotes = stats?.totalVotes ?? 0;
  const totalModels = stats?.totalModels ?? filteredEntries.length;

  return (
    <div className="leaderboard-page">
      <header className="leaderboard-page-header">
        <div className="leaderboard-hero">
          <button
            type="button"
            className="leaderboard-back-btn"
            onClick={() => {
              window.location.href = "/";
            }}
          >
            ← Back to Demo
          </button>
          <h1>Design Arena Leaderboard</h1>
          <p>
            Track which variants earn the most wins across demo runs and arena comparisons.
            Use the search bar to find specific models or explore the current leaders.
          </p>
        </div>
        <div className="leaderboard-metrics">
          <div className="leaderboard-metric">
            <span className="leaderboard-metric-label">Last Updated</span>
            <strong>{lastUpdated}</strong>
          </div>
          <div className="leaderboard-metric">
            <span className="leaderboard-metric-label">Total Votes</span>
            <strong>{totalVotes.toLocaleString()}</strong>
          </div>
          <div className="leaderboard-metric">
            <span className="leaderboard-metric-label">Total Models</span>
            <strong>{totalModels.toLocaleString()}</strong>
          </div>
        </div>
      </header>

      <div className="leaderboard-tabs">
        <button
          type="button"
          className={`leaderboard-tab${activeTab === "leaderboard" ? " leaderboard-tab--active" : ""}`}
          onClick={() => setActiveTab("leaderboard")}
        >
          Leaderboard
        </button>
        <button
          type="button"
          className={`leaderboard-tab${activeTab === "battles" ? " leaderboard-tab--active" : ""}`}
          onClick={() => setActiveTab("battles")}
        >
          Battle History
        </button>
      </div>

      <div className="leaderboard-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="11" cy="11" r="8" strokeWidth="2" />
          <path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by model or description…"
        />
        <button type="button" onClick={fetchData}>
          Refresh
        </button>
      </div>

      <section className="leaderboard-table-card">
        {loading ? (
          <div className="leaderboard-state">Loading {activeTab === "leaderboard" ? "leaderboard" : "battle history"}…</div>
        ) : error ? (
          <div className="leaderboard-state leaderboard-state--error">{error}</div>
        ) : activeTab === "leaderboard" ? (
          filteredEntries.length === 0 ? (
            <div className="leaderboard-state">No results match your search.</div>
          ) : (
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Model</th>
                  <th>Model ID</th>
                  <th>Provider</th>
                  <th>Wins</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry, index) => (
                  <tr key={entry.variantId}>
                    <td>{index + 1}</td>
                    <td>
                      <strong>{entry.label || "Unknown"}</strong>
                    </td>
                    <td className="leaderboard-model-id">{entry.model ?? "—"}</td>
                    <td>{entry.provider ?? "—"}</td>
                    <td>
                      <strong>{entry.wins.toLocaleString()}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : filteredBattles.length === 0 ? (
          <div className="leaderboard-state">No battle history found.</div>
        ) : (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Model A</th>
                <th>Model B</th>
                <th>Winner</th>
              </tr>
            </thead>
            <tbody>
              {filteredBattles.map((battle) => {
                const createdDate = new Date(battle.createdAt);
                const formattedDate = createdDate.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "numeric",
                });

                return (
                  <tr key={battle.id}>
                    <td>{formattedDate}</td>
                    <td>
                      <div className="battle-model">
                        <strong>{battle.left.label}</strong>
                        <span>{battle.left.provider ?? "—"}</span>
                      </div>
                    </td>
                    <td>
                      <div className="battle-model">
                        <strong>{battle.right.label}</strong>
                        <span>{battle.right.provider ?? "—"}</span>
                      </div>
                    </td>
                    <td>
                      {battle.winner ? (
                        <span className={`battle-result battle-result--winner`}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M4 22h16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          {battle.winner.label}
                        </span>
                      ) : battle.selection === "tie" ? (
                        <span className="battle-result battle-result--tie">
                          Tie
                        </span>
                      ) : (
                        <span className="battle-result battle-result--both_bad">
                          Both Bad
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
