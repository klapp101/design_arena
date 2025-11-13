import React, { useCallback, useEffect, useMemo, useState } from "react";

type Selection = "left" | "right" | "tie" | "both_bad";
type ViewMode = "hero" | "source" | "rendered";
type Verdict = "neutral" | "selected" | "win" | "lose" | "tie" | "bad";

interface VariantContext {
  description?: string;
  productName?: string; // Legacy
  valueProp?: string; // Legacy
  notes?: string;
  runTimestamp?: string;
}

interface VariantView {
  token: string;
  html: string;
  source: string;
  heroRaw?: string;
  context?: VariantContext;
}

interface PairResponse {
  pairId: string | null;
  left?: VariantView;
  right?: VariantView;
  message?: string;
  variants?: number;
}

interface RevealMeta {
  variantKey: string;
  runId: string;
  runTimestamp: string;
  provider: string;
  model: string;
  label: string;
  temperature: number | null;
  maxOutputTokens: number | null;
}

interface VoteResponse {
  ok: boolean;
  selection: Selection;
  winnerVariantId: string | null;
  left: RevealMeta;
  right: RevealMeta;
}

export default function App() {
  const [pair, setPair] = useState<PairResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingVote, setPendingVote] = useState<Selection | null>(null);
  const [selectionMade, setSelectionMade] = useState<Selection | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("hero");
  const [infoBanner, setInfoBanner] = useState<string | null>(null);
  const [voteResult, setVoteResult] = useState<VoteResponse | null>(null);

  const loadPair = useCallback(async () => {
    setLoading(true);
    setError(null);
    setVoteResult(null);
    setSelectionMade(null);
    try {
      const response = await fetch("/api/pair");
      if (!response.ok) {
        throw new Error(`Pair request failed (${response.status})`);
      }
      const data = (await response.json()) as PairResponse;
      if (!data.pairId || !data.left || !data.right) {
        setPair(null);
        setInfoBanner(
          data.message ?? "Not enough variants yet. Run more benchmarks and reload.",
        );
      } else {
        setPair(data);
        setInfoBanner(null);
      }
    } catch (reason) {
      setError(String(reason));
      setPair(null);
    } finally {
      setLoading(false);
      setPendingVote(null);
    }
  }, []);

  useEffect(() => {
    loadPair();
  }, [loadPair]);

  const submitVote = useCallback(
    async (selection: Selection) => {
      if (!pair?.pairId || pendingVote || voteResult) return;
      setSelectionMade(selection);
      setPendingVote(selection);
      setError(null);

      try {
        const response = await fetch("/api/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pairId: pair.pairId,
            selection,
            scores: null,
            notes: null,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? `Vote failed (${response.status})`);
        }
        const votePayload = (await response.json()) as VoteResponse;
        setVoteResult(votePayload);
      } catch (reason) {
        setError(String(reason));
      } finally {
        setPendingVote(null);
      }
    },
    [pair?.pairId, pendingVote, voteResult],
  );

  const canVote = useMemo(
    () => Boolean(pair?.pairId) && !pendingVote && !voteResult && !loading,
    [pair?.pairId, pendingVote, voteResult, loading],
  );

  const verdictForSide = useCallback(
    (side: "left" | "right"): Verdict => {
      if (voteResult) {
        if (voteResult.selection === "tie" || voteResult.selection === "both_bad") {
          return voteResult.selection === "both_bad" ? "bad" : "tie";
        }
        return voteResult.selection === side ? "win" : "lose";
      }
      if (pendingVote === side || selectionMade === side) {
        return "selected";
      }
      return "neutral";
    },
    [voteResult, pendingVote, selectionMade],
  );

  const handleNextPair = useCallback(() => {
    loadPair();
  }, [loadPair]);

  return (
    <div className="viewer-shell">
      <header className="viewer-header">
        <div>
          <h1>Design Arena</h1>
          <p className="subhead">
            Blind compare landing page variants. Judge outcomes without knowing which model
            produced each option.
          </p>
        </div>
        <div className="header-actions">
          <button className="ghost-btn" onClick={loadPair} disabled={loading} type="button">
            {loading ? "Refreshing…" : "Reload Pair"}
          </button>
          <ViewToggle viewMode={viewMode} onChange={setViewMode} />
        </div>
      </header>

      {infoBanner && (
        <div className="banner">
          <span>{infoBanner}</span>
        </div>
      )}
      {error && (
        <div className="banner banner--error">
          <span>{error}</span>
        </div>
      )}

      <main className="viewer-main">
        <div className="variant-grid">
          <VariantColumn
            label="Option A"
            variant={pair?.left}
            viewMode={viewMode}
            verdict={verdictForSide("left")}
          />
          <VariantColumn
            label="Option B"
            variant={pair?.right}
            viewMode={viewMode}
            verdict={verdictForSide("right")}
          />
        </div>
      </main>

      <footer className="vote-footer">
        {voteResult ? (
          <ResultsPanel result={voteResult} onNext={handleNextPair} />
        ) : (
          <VoteControls canVote={canVote} onVote={submitVote} pendingSelection={pendingVote} />
        )}
      </footer>
    </div>
  );
}

interface VariantColumnProps {
  label: string;
  variant?: VariantView;
  viewMode: ViewMode;
  verdict: Verdict;
}

function VariantColumn({ label, variant, viewMode, verdict }: VariantColumnProps) {
  const timestamp = variant?.context?.runTimestamp
    ? new Date(variant.context.runTimestamp).toLocaleString()
    : "—";

  return (
    <article className={`variant-column variant-column--${verdict}`}>
      <header className="variant-header">
        <span className="variant-label">{label}</span>
        <span className="variant-timestamp">{timestamp}</span>
      </header>
      <section
        className={`variant-stage${viewMode === "hero" || viewMode === "rendered" ? "" : " variant-stage--code"}`}
        aria-label={`${label} preview`}
      >
        {variant ? (
          viewMode === "hero" ? (
            <div className="hero-canvas" dangerouslySetInnerHTML={{ __html: variant.html }} />
          ) : viewMode === "rendered" ? (
            <iframe
              className="rendered-frame"
              srcDoc={variant.source}
              title={`${label} rendered preview`}
              sandbox="allow-scripts"
            />
          ) : (
            <pre className="code-block">{variant.source}</pre>
          )
        ) : (
          <div className="placeholder">Awaiting variant…</div>
        )}
      </section>
      <footer className="variant-meta">
        <MetaRow
          label="Description"
          value={variant?.context?.description ??
                 (variant?.context?.productName && variant?.context?.valueProp
                   ? `${variant.context.productName} - ${variant.context.valueProp}`
                   : "—")}
        />
        {variant?.context?.notes ? <MetaRow label="Notes" value={variant.context.notes} /> : null}
      </footer>
    </article>
  );
}

interface MetaRowProps {
  label: string;
  value: string;
}

function MetaRow({ label, value }: MetaRowProps) {
  return (
    <div className="meta-row">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
}

interface VoteControlsProps {
  canVote: boolean;
  pendingSelection: Selection | null;
  onVote: (selection: Selection) => void;
}

function VoteControls({ canVote, pendingSelection, onVote }: VoteControlsProps) {
  const buttons: Array<{ label: string; selection: Selection; accent?: boolean }> = [
    { label: "Left is better", selection: "left", accent: true },
    { label: "It's a tie", selection: "tie" },
    { label: "Both are bad", selection: "both_bad" },
    { label: "Right is better", selection: "right", accent: true },
  ];

  return (
    <div className="vote-controls">
      {buttons.map((button) => (
        <button
          key={button.selection}
          type="button"
          className={`vote-button vote-button--${button.accent ? "accent" : "neutral"}${
            pendingSelection === button.selection ? " vote-button--pending" : ""
          }`}
          disabled={!canVote}
          onClick={() => onVote(button.selection)}
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}

interface ResultsPanelProps {
  result: VoteResponse;
  onNext: () => void;
}

function ResultsPanel({ result, onNext }: ResultsPanelProps) {
  return (
    <div className="results-panel">
      <div className="results-summary">
        <span className="summary-label">Your call:</span>
        <strong className="summary-value">{formatSelection(result.selection)}</strong>
        {result.selection === "left" || result.selection === "right" ? (
          <span className="summary-detail">
            Winner: {result.selection === "left" ? result.left.label : result.right.label}
          </span>
        ) : null}
      </div>
      <div className="reveal-grid">
        <RevealCard title="Option A" meta={result.left} />
        <RevealCard title="Option B" meta={result.right} />
      </div>
      <button type="button" className="next-button" onClick={onNext}>
        Next comparison →
      </button>
    </div>
  );
}

function formatSelection(selection: Selection): string {
  switch (selection) {
    case "left":
      return "Left is better";
    case "right":
      return "Right is better";
    case "tie":
      return "It's a tie";
    case "both_bad":
      return "Both were off";
    default:
      return selection;
  }
}

interface RevealCardProps {
  title: string;
  meta: RevealMeta;
}

function RevealCard({ title, meta }: RevealCardProps) {
  return (
    <article className="reveal-card">
      <header>
        <span className="reveal-title">{title}</span>
        <span className="reveal-model">{meta.label}</span>
      </header>
      <dl>
        <div>
          <dt>Provider</dt>
          <dd>{meta.provider}</dd>
        </div>
        <div>
          <dt>Model ID</dt>
          <dd>{meta.model}</dd>
        </div>
        <div>
          <dt>Run ID</dt>
          <dd>{meta.runId}</dd>
        </div>
        <div>
          <dt>Timestamp</dt>
          <dd>{new Date(meta.runTimestamp).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Temperature</dt>
          <dd>{meta.temperature ?? "—"}</dd>
        </div>
        <div>
          <dt>Max tokens</dt>
          <dd>{meta.maxOutputTokens ?? "—"}</dd>
        </div>
      </dl>
    </article>
  );
}

interface ViewToggleProps {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

function ViewToggle({ viewMode, onChange }: ViewToggleProps) {
  return (
    <div className="view-toggle" role="tablist" aria-label="Preview mode">
      <ToggleOption
        label="Hero"
        selected={viewMode === "hero"}
        onClick={() => onChange("hero")}
      />
      <ToggleOption
        label="Rendered"
        selected={viewMode === "rendered"}
        onClick={() => onChange("rendered")}
      />
      <ToggleOption
        label="Source"
        selected={viewMode === "source"}
        onClick={() => onChange("source")}
      />
    </div>
  );
}

interface ToggleOptionProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}

function ToggleOption({ label, selected, onClick }: ToggleOptionProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`toggle-option${selected ? " toggle-option--active" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

