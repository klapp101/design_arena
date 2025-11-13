import React, { useCallback, useMemo, useRef, useState } from "react";

type ModelStatus = "idle" | "generating" | "complete" | "error";

interface ModelState {
  label: string;
  displayLabel: string;
  provider: string;
  model: string;
  variantId?: string;
  status: ModelStatus;
  text: string;
  error?: string;
}

const OPTION_LABELS = ["Option A", "Option B", "Option C", "Option D", "Option E"];

type DemoSelection = "left" | "right";

interface DemoVotePayload {
  winnerVariantId: string;
  leftVariantId: string;
  rightVariantId: string;
  selection: DemoSelection;
}

interface ConfigModel {
  provider: string;
  model: string;
  label: string;
}

function getProviderLogo(provider: string): string {
  const logoMap: Record<string, string> = {
    OpenAI: "/img/openai_logo.png",
    Anthropic: "/img/anthropic_logo.png",
    Google: "/img/google_logo.png",
  };
  return logoMap[provider] || "";
}

export default function Demo() {
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [models, setModels] = useState<Record<string, ModelState>>({});
  const [runId, setRunId] = useState<string | null>(null);
  const [activeModelTab, setActiveModelTab] = useState<string | null>(null);
  const [modelOrder, setModelOrder] = useState<string[]>([]);
  const [favoriteModel, setFavoriteModel] = useState<string | null>(null);
  const [revealWinner, setRevealWinner] = useState(false);
  const [configModels, setConfigModels] = useState<ConfigModel[]>([]);
  const labelAssignmentsRef = useRef<Record<string, string>>({});
  const optionIndexRef = useRef(0);
  const voteSubmittedRef = useRef(false);

  // Fetch available models from config on mount
  React.useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data) => {
        if (data.models && Array.isArray(data.models)) {
          setConfigModels(data.models);
        }
      })
      .catch((err) => console.error("Failed to load models:", err));
  }, []);

  const getDisplayLabelForModel = useCallback((modelKey: string) => {
    const existing = labelAssignmentsRef.current[modelKey];
    if (existing) {
      return existing;
    }
    const nextIndex = optionIndexRef.current;
    const assigned = OPTION_LABELS[nextIndex] ?? `Option ${nextIndex + 1}`;
    labelAssignmentsRef.current[modelKey] = assigned;
    optionIndexRef.current = nextIndex + 1;
    return assigned;
  }, []);

  const submitDemoVote = useCallback(async (payload: DemoVotePayload | null) => {
    if (!payload || voteSubmittedRef.current) {
      return;
    }

    voteSubmittedRef.current = true;
    try {
      const response = await fetch("/api/demo/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Vote tracking failed (${response.status})`);
      }
    } catch (error) {
      console.error("Failed to record leaderboard vote", error);
      voteSubmittedRef.current = false;
    }
  }, []);

  const goToLeaderboard = useCallback(() => {
    window.location.href = "/leaderboard";
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;

    setIsGenerating(true);
    setModels({});
    setRunId(null);
    setActiveModelTab(null);
    setModelOrder([]);
    setFavoriteModel(null);
    setRevealWinner(false);
    labelAssignmentsRef.current = {};
    optionIndexRef.current = 0;
    voteSubmittedRef.current = false;

    try {
      const response = await fetch("/api/demo/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: input }),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("No response body");

      let buffer = "";
      const processBuffer = () => {
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          const lines = rawEvent.split("\n").filter(Boolean);
          let eventType = "message";
          let dataPayload = "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              if (dataPayload) dataPayload += "\n";
              dataPayload += line.slice(5).trim();
            }
          }

          if (dataPayload) {
            try {
              const parsed = JSON.parse(dataPayload);
              handleSSEEvent(eventType, parsed);
            } catch (parseError) {
              console.error("Failed to parse SSE payload", parseError, dataPayload);
            }
          }

          boundary = buffer.indexOf("\n\n");
        }
      };

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          processBuffer();
        }

        if (done) {
          buffer += decoder.decode();
          processBuffer();
          break;
        }
      }
    } catch (error) {
      console.error("Stream error:", error);
      alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsGenerating(false);
    }
  }, [input, isGenerating]);

  const handleSSEEvent = useCallback((event: string, data: any) => {
    switch (event) {
      case "run-start":
        setRunId(data.runId);
        break;

      case "model-start": {
        const displayLabel = getDisplayLabelForModel(data.label);
        setModels((prev) => ({
          ...prev,
          [data.label]: {
            label: data.label,
            displayLabel,
            provider: data.provider,
            model: data.model,
            variantId: data.variantKey,
            status: "generating",
            text: "",
          },
        }));
        setModelOrder((prev) => (prev.includes(data.label) ? prev : [...prev, data.label]));
        setActiveModelTab((prev) => prev || data.label);
        break;
      }

      case "chunk":
        setModels((prev) => {
          const target = prev[data.label];
          if (!target) return prev;
          return {
            ...prev,
            [data.label]: {
              ...target,
              variantId: target.variantId ?? data.variantKey,
              text: target.text + data.chunk,
            },
          };
        });
        break;

      case "model-complete":
        setModels((prev) => {
          const target = prev[data.label];
          if (!target) return prev;
          return {
            ...prev,
            [data.label]: {
              ...target,
              variantId: target.variantId ?? data.variantKey,
              status: "complete",
            },
          };
        });
        break;

      case "model-error":
        setModels((prev) => {
          const target = prev[data.label];
          if (!target) return prev;
          return {
            ...prev,
            [data.label]: {
              ...target,
              variantId: target.variantId ?? data.variantKey,
              status: "error",
              error: data.error,
            },
          };
        });
        break;

      case "run-complete":
        console.log("Run complete:", data);
        break;

      case "error":
        console.error("Server error:", data.error);
        alert(`Server error: ${data.error}`);
        break;
    }
  }, []);

  const modelsList = useMemo(
    () =>
      modelOrder
        .map((key) => models[key])
        .filter((entry): entry is ModelState => Boolean(entry)),
    [modelOrder, models],
  );
  const allComplete = modelsList.length > 0 && modelsList.every((m) => m.status === "complete" || m.status === "error");
  const selectedModelState = favoriteModel ? models[favoriteModel] ?? null : null;
  const selectionLocked = Boolean(favoriteModel);

  const handleFavoriteSelect = useCallback((modelKey: string) => {
    if (!allComplete) return;
    if (favoriteModel && favoriteModel !== modelKey) {
      return;
    }
    const leftKey = modelOrder[0];
    const rightKey = modelOrder[1];
    if (!leftKey || !rightKey) {
      return;
    }
    const leftVariantId = models[leftKey]?.variantId;
    const rightVariantId = models[rightKey]?.variantId;
    const winnerVariantId = models[modelKey]?.variantId;
    if (!leftVariantId || !rightVariantId || !winnerVariantId) {
      return;
    }

    let selection: DemoSelection | null = null;
    if (modelKey === leftKey) {
      selection = "left";
    } else if (modelKey === rightKey) {
      selection = "right";
    }
    if (!selection) {
      return;
    }

    setFavoriteModel(modelKey);
    setRevealWinner(false);

    submitDemoVote({
      winnerVariantId,
      leftVariantId,
      rightVariantId,
      selection,
    });
  }, [allComplete, favoriteModel, modelOrder, models, submitDemoVote]);

  return (
    <>
      <div className="demo-shell">
        {!isGenerating && modelsList.length === 0 ? (
          <div className="demo-landing">
            <header className="demo-header">
              <h1 className="demo-title">Design Arena</h1>
              <p className="demo-subtitle">
                Compare HTML designs across top AI models in real-time
              </p>
            </header>

          <div className="demo-models">
            {configModels.length > 0 ? (
              // Group models by provider and show unique provider logos
              Array.from(new Set(configModels.map(m => m.provider)))
                .slice(0, 5)
                .map((provider, idx) => {
                  const logo = getProviderLogo(provider);
                  return logo ? (
                    <div key={idx} className="model-logo-wrapper">
                      <img src={logo} alt={`${provider} logo`} className="model-provider-logo" />
                    </div>
                  ) : null;
                })
            ) : (
              <>
                <div className="model-logo-wrapper">
                  <img src="/img/openai_logo.png" alt="OpenAI logo" className="model-provider-logo" />
                </div>
                <div className="model-logo-wrapper">
                  <img src="/img/anthropic_logo.png" alt="Anthropic logo" className="model-provider-logo" />
                </div>
              </>
            )}
          </div>

          <form className="demo-input-form" onSubmit={handleSubmit}>
            <div className="demo-input-wrapper">
              <input
                type="text"
                className="demo-input"
                placeholder="Describe the design you want..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoFocus
              />
              <button type="submit" className="demo-submit" disabled={!input.trim()}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M5 12h14M12 5l7 7-7 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            <div className="demo-input-toolbar">
              <button type="button" className="demo-toolbar-btn" title="Add attachment">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
              <button type="button" className="demo-toolbar-btn" title="Browse web">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                  <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" strokeWidth="2"/>
                </svg>
              </button>
              <button type="button" className="demo-toolbar-btn" title="Add image">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="M21 15l-5-5L5 21" strokeWidth="2"/>
                </svg>
              </button>
              <button type="button" className="demo-toolbar-btn" title="Code mode">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <button
              type="button"
              className="demo-leaderboard-btn"
              onClick={goToLeaderboard}
            >
              View Leaderboard
            </button>
          </form>
        </div>
      ) : (
        <div className="demo-generation">
          <div className="demo-gen-header">
            <div className="demo-gen-header-left">
              <button
                type="button"
                className="demo-back-btn"
                onClick={() => {
                  setModels({});
                  setIsGenerating(false);
                  setRunId(null);
                  setActiveModelTab(null);
                  setModelOrder([]);
                  setFavoriteModel(null);
                  setRevealWinner(false);
                  labelAssignmentsRef.current = {};
                  optionIndexRef.current = 0;
                  voteSubmittedRef.current = false;
                }}
              >
                ← New Comparison
              </button>
              <div className="demo-gen-description">{input}</div>
            </div>
            <button
              type="button"
              className="demo-leaderboard-btn"
              onClick={goToLeaderboard}
            >
              Leaderboard
            </button>
          </div>

          <div className="demo-model-tabs">
            {modelsList.map((model) => (
              <button
                key={model.label}
                type="button"
                className={`demo-model-tab${activeModelTab === model.label ? " demo-model-tab--active" : ""}`}
                onClick={() => setActiveModelTab(model.label)}
              >
                <span className="demo-model-tab-label">{model.displayLabel}</span>
                <ModelStatusBadge status={model.status} />
              </button>
            ))}
          </div>

          {activeModelTab && models[activeModelTab] && (
            <ModelOutput model={models[activeModelTab]} />
          )}

          {modelsList.length > 0 && (
            <ArenaSelectionPanel
              models={modelsList}
              canSelect={allComplete}
              selectedModel={selectedModelState}
              onSelect={handleFavoriteSelect}
              revealDetails={revealWinner}
              onReveal={() => setRevealWinner(true)}
              selectionLocked={selectionLocked}
            />
          )}

          {allComplete && (
            <div className="demo-complete-actions">
              <button
                type="button"
                className="demo-action-btn demo-action-btn--primary"
                onClick={() => {
                  window.location.href = "/leaderboard";
                }}
              >
                View Leaderboard →
              </button>
              <button
                type="button"
                className="demo-action-btn"
                onClick={() => {
                  setModels({});
                  setIsGenerating(false);
                  setRunId(null);
                  setActiveModelTab(null);
                  setInput("");
                  setModelOrder([]);
                  setFavoriteModel(null);
                  setRevealWinner(false);
                  labelAssignmentsRef.current = {};
                  optionIndexRef.current = 0;
                  voteSubmittedRef.current = false;
                }}
              >
                Try Another
              </button>
            </div>
          )}
        </div>
      )}
      </div>
    </>
  );
}

interface ModelIconProps {
  name: string;
  color: string;
}

function ModelIcon({ name, color }: ModelIconProps) {
  return (
    <div className="model-icon" style={{ borderColor: color }}>
      <div className="model-icon-inner" style={{ backgroundColor: color }}>
        {name[0]}
      </div>
      <span className="model-icon-label">{name}</span>
    </div>
  );
}

interface ModelOutputProps {
  model: ModelState;
}

function ModelOutput({ model }: ModelOutputProps) {
  const [viewMode, setViewMode] = useState<"code" | "preview">("preview");
  const renderableHtml = useMemo(
    () => extractRenderableHtml(model.text),
    [model.text],
  );
  const previewDoc = renderableHtml || model.text || "";

  return (
    <div className="demo-output-container">
      <div className="model-output-view-toggle">
        <button
          type="button"
          className={`model-view-icon-btn${viewMode === "preview" ? " model-view-icon-btn--active" : ""}`}
          onClick={() => setViewMode("preview")}
          title="Preview"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeWidth="2"/>
            <circle cx="12" cy="12" r="3" strokeWidth="2"/>
          </svg>
        </button>
        <button
          type="button"
          className={`model-view-icon-btn${viewMode === "code" ? " model-view-icon-btn--active" : ""}`}
          onClick={() => setViewMode("code")}
          title="Code"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {model.status === "error" ? (
        <div className="model-output-error">
          <p>Error: {model.error}</p>
        </div>
      ) : viewMode === "code" ? (
        <pre className="model-output-code">
          <code>{renderableHtml || model.text || "Waiting..."}</code>
        </pre>
      ) : (
        <iframe
          className="model-output-preview"
          srcDoc={previewDoc}
          title={`${model.displayLabel} preview`}
          sandbox="allow-scripts"
        />
      )}
    </div>
  );
}

interface ModelStatusBadgeProps {
  status: ModelStatus;
}

interface ArenaSelectionPanelProps {
  models: ModelState[];
  canSelect: boolean;
  selectedModel: ModelState | null;
  onSelect: (modelKey: string) => void;
  revealDetails: boolean;
  onReveal: () => void;
  selectionLocked: boolean;
}

function ArenaSelectionPanel({
  models,
  canSelect,
  selectedModel,
  onSelect,
  revealDetails,
  onReveal,
  selectionLocked,
}: ArenaSelectionPanelProps) {
  const hint = canSelect
    ? selectionLocked
      ? "Selection locked. Reveal the model or start a new comparison to pick again."
      : "Tap an option once you're ready to crown a winner."
    : "Selections unlock after every option finishes generating.";

  return (
    <div className="demo-arena-panel">
      <div className="demo-arena-panel-header">
        <div>
          <h3>Pick the strongest option</h3>
          <p>{hint}</p>
        </div>
        <span className="demo-arena-panel-count">
          {models.length} option{models.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="demo-arena-option-grid">
        {models.map((model) => {
          const isSelected = selectedModel?.label === model.label;
          const disableButton = !canSelect || model.status !== "complete" || (selectionLocked && !isSelected);
          return (
            <button
              key={model.label}
              type="button"
              className={`demo-arena-option${isSelected ? " demo-arena-option--selected" : ""}`}
              disabled={disableButton}
              onClick={() => onSelect(model.label)}
            >
              <span className="demo-arena-option-title">{model.displayLabel}</span>
              <ModelStatusBadge status={model.status} />
            </button>
          );
        })}
      </div>

      {selectedModel && (
        <div className="demo-arena-reveal">
          <div className="demo-arena-reveal-text">
            <p>
              You picked <strong>{selectedModel.displayLabel}</strong>.
            </p>
            {!revealDetails && (
              <small>Ready to see who built it? Reveal once you&rsquo;re done judging.</small>
            )}
          </div>
          {revealDetails ? (
            <div className="demo-arena-reveal-details">
              <div>
                <span className="demo-arena-reveal-label">Provider</span>
                <span className="demo-arena-reveal-value">{selectedModel.provider}</span>
              </div>
              <div>
                <span className="demo-arena-reveal-label">Model</span>
                <span className="demo-arena-reveal-value">{selectedModel.model}</span>
              </div>
            </div>
          ) : (
            <button type="button" className="demo-reveal-btn" onClick={onReveal}>
              Reveal model identity
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ModelStatusBadge({ status }: ModelStatusBadgeProps) {
  const labels: Record<ModelStatus, string> = {
    idle: "Idle",
    generating: "Generating...",
    complete: "Complete",
    error: "Error",
  };

  return (
    <span className={`model-status model-status--${status}`}>
      {status === "generating" && <span className="model-status-spinner" />}
      {labels[status]}
    </span>
  );
}

function extractRenderableHtml(raw: string) {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) {
    return raw;
  }

  const closing = trimmed.lastIndexOf("```");
  if (closing <= 3) {
    return raw;
  }

  let inner = trimmed.slice(3, closing).trim();
  if (!inner) {
    return "";
  }

  if (inner.toLowerCase().startsWith("html")) {
    inner = inner.slice(4).trimStart();
  } else {
    const newlineIndex = inner.indexOf("\n");
    if (newlineIndex !== -1) {
      const firstLine = inner.slice(0, newlineIndex).trim().toLowerCase();
      if (firstLine === "html" || firstLine === "markup") {
        inner = inner.slice(newlineIndex + 1).trimStart();
      }
    }
  }

  return inner || raw;
}
