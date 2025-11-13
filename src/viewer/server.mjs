import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildViewer } from "./build.mjs";
import { initDatabase, recordVote, listRecentVotes, listLeaderboard, getVoteStats, listBattleHistory } from "./lib/sqlite.mjs";
import {
  loadConfig,
  renderPrompt,
  buildRunId,
  callModel,
  persistResult,
  sanitizeLabel,
} from "../lib/benchmark.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const DIST_DIR = path.join(ROOT, "dist", "viewer");
const LIB_DIST = path.join(DIST_DIR, "lib");

const PAIR_LIFETIME_MS = 1000 * 60 * 30; // 30 minutes
const DEMO_MODEL_COUNT = 2;

/**
 * @typedef {import('./lib/run-loader.js').BenchmarkVariant} BenchmarkVariant
 */

const state = {
  variants: /** @type {BenchmarkVariant[]} */ ([]),
  variantIndex: new Map(),
  pairs: new Map(),
  dbCtx: null,
};

async function ensureBundles() {
  const required = [
    path.join(DIST_DIR, "app.js"),
    path.join(DIST_DIR, "index.html"),
    path.join(LIB_DIST, "run-loader.js"),
  ];

  const missing = required.some((file) => !existsSync(file));
  if (missing) {
    console.log("[viewer] building assets…");
    await buildViewer();
  }
}

async function loadVariantModule() {
  await ensureBundles();
  const modulePath = path.join(LIB_DIST, "run-loader.js");
  return import(pathToFileURL(modulePath).href);
}

async function refreshVariants(options = {}) {
  const { runsDir } = options;
  const { loadVariants } = await loadVariantModule();
  state.variants = await loadVariants({ runsDir });
  state.variantIndex = new Map();
  for (const variant of state.variants) {
    state.variantIndex.set(variant.variantKey, variant);

    const parsed = parseVariantKey(variant.variantKey);
    if (!parsed) continue;
    const normalizedLabel = sanitizeLabel(
      variant.metadata.label ??
      variant.metadata.model ??
      parsed.label,
    );
    if (normalizedLabel === parsed.label) {
      continue;
    }
    const legacyKey = computeVariantKey(
      parsed.runFolderName,
      variant.metadata.provider,
      variant.metadata.model,
      normalizedLabel,
    );
    if (!state.variantIndex.has(legacyKey)) {
      state.variantIndex.set(legacyKey, variant);
    }
  }
  console.log(`[viewer] loaded ${state.variants.length} variants`);
}

function pickRandomPair() {
  if (state.variants.length < 2) {
    return null;
  }

  const firstIndex = Math.floor(Math.random() * state.variants.length);
  let secondIndex = Math.floor(Math.random() * state.variants.length);
  while (secondIndex === firstIndex) {
    secondIndex = Math.floor(Math.random() * state.variants.length);
  }

  const variants = [state.variants[firstIndex], state.variants[secondIndex]];
  return variants;
}

function pickRandomSubset(items, count) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function computeVariantKey(runFolderName, provider, model, label) {
  const composite = `${runFolderName}:${provider}:${model}:${label}`;
  const hash = crypto.createHash("sha1").update(composite).digest("hex").slice(0, 12);
  return `${runFolderName}/${label}-${hash}`;
}

/**
 * Parse a variant key to extract run folder and label
 * Format: {runFolderName}/{label}-{hash}
 */
function parseVariantKey(variantKey) {
  const match = variantKey.match(/^([^/]+)\/(.+)-([a-f0-9]{12})$/);
  if (match) {
    return {
      runFolderName: match[1],
      label: match[2],
      hash: match[3],
    };
  }
  return null;
}

function formatVariantForClient(token, variant) {
  return {
    token,
    html: variant.primaryHtml,
    source: variant.sourceText,
    heroRaw: variant.primaryRaw,
    context: {
      description: variant.runMeta.description ||
                   `${variant.runMeta.productName || ""} - ${variant.runMeta.valueProp || ""}`,
      productName: variant.runMeta.productName, // Legacy
      valueProp: variant.runMeta.valueProp, // Legacy
      notes: variant.runMeta.notes ?? "",
      runTimestamp: variant.runMeta.timestamp,
    },
  };
}

function buildRevealPayload(variant) {
  return {
    variantKey: variant.variantKey,
    runId: variant.runId,
    runTimestamp: variant.runTimestamp,
    provider: variant.metadata.provider,
    model: variant.metadata.model,
    label: variant.metadata.label ?? variant.metadata.model,
    temperature: variant.metadata.temperature ?? null,
    maxOutputTokens: variant.metadata.maxOutputTokens ?? null,
  };
}

function registerPair(pairId, pair) {
  state.pairs.set(pairId, {
    ...pair,
    createdAt: Date.now(),
  });
}

function purgeExpiredPairs() {
  const now = Date.now();
  for (const [pairId, info] of state.pairs.entries()) {
    if (now - info.createdAt > PAIR_LIFETIME_MS) {
      state.pairs.delete(pairId);
    }
  }
}

function resolvePairSelection(pair, selection) {
  switch (selection) {
    case "left":
      return pair.left.variant.variantKey;
    case "right":
      return pair.right.variant.variantKey;
    case "tie":
    case "both_bad":
      return null;
    default:
      return null;
  }
}

export async function createServer(options = {}) {
  const {
    port = Number(process.env.PORT) || 4173,
    host = process.env.HOST || "0.0.0.0",
    runsDir,
  } = options;

  if (!state.dbCtx) {
    state.dbCtx = initDatabase(ROOT);
  }

  await refreshVariants({ runsDir });

  const app = fastify({ logger: true });

  await app.register(fastifyStatic, {
    root: DIST_DIR,
    prefix: "/",
    index: ["index.html"],
  });

  app.get("/api/health", async () => ({
    ok: true,
    variants: state.variants.length,
    dbPath: state.dbCtx?.dbPath ?? null,
  }));

  app.get("/api/models", async () => {
    const CONFIG_PATH = path.join(ROOT, "benchmark.config.json");
    try {
      const config = await loadConfig(CONFIG_PATH);
      return {
        models: config.models || [],
      };
    } catch (error) {
      return { models: [] };
    }
  });

  app.get("/api/pair", async () => {
    purgeExpiredPairs();
    const picked = pickRandomPair();
    if (!picked) {
      return {
        pairId: null,
        variants: 0,
        message: "Not enough variants to compare yet.",
      };
    }

    const [first, second] = picked;
    const pairId = crypto.randomUUID();
    const leftToken = crypto.randomUUID();
    const rightToken = crypto.randomUUID();

    registerPair(pairId, {
      left: { token: leftToken, variant: first },
      right: { token: rightToken, variant: second },
    });

    return {
      pairId,
      left: formatVariantForClient(leftToken, first),
      right: formatVariantForClient(rightToken, second),
    };
  });

  app.post("/api/vote", async (request, reply) => {
    const body = request.body ?? {};
    const { pairId, selection, scores, notes } = body;
    if (!pairId || !selection) {
      reply.status(400);
      return { error: "pairId and selection are required." };
    }

    const pair = state.pairs.get(pairId);
    if (!pair) {
      reply.status(404);
      return { error: "Pair not found or expired." };
    }

    if (!["left", "right", "tie", "both_bad"].includes(selection)) {
      reply.status(400);
      return { error: "Invalid selection option." };
    }

    const winnerVariantKey = resolvePairSelection(pair, selection);

    recordVote(state.dbCtx, {
      pairId,
      leftVariantId: pair.left.variant.variantKey,
      rightVariantId: pair.right.variant.variantKey,
      winnerVariantId: winnerVariantKey,
      selection,
      scores,
      notes,
    });

    const responsePayload = {
      ok: true,
      selection,
      winnerVariantId: winnerVariantKey,
      left: buildRevealPayload(pair.left.variant),
      right: buildRevealPayload(pair.right.variant),
    };

    state.pairs.delete(pairId);

    return responsePayload;
  });

  app.post("/api/reload", async () => {
    await refreshVariants({ runsDir });
    return { ok: true, variants: state.variants.length };
  });

  app.get("/api/votes/recent", async () => ({
    votes: listRecentVotes(state.dbCtx),
  }));

  app.get("/api/leaderboard", async (request) => {
    const limitParam = Number(request.query?.limit);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100;
    const rows = listLeaderboard(state.dbCtx, limit);
    const stats = getVoteStats(state.dbCtx);

    // Load config to get all models
    const CONFIG_PATH = path.join(ROOT, "benchmark.config.json");
    let configModels = [];
    try {
      const config = await loadConfig(CONFIG_PATH);
      configModels = config.models || [];
    } catch (error) {
      console.error("Failed to load config for leaderboard:", error);
    }

    const rawEntries = rows.map((row) => {
      const variant = state.variantIndex.get(row.variantId);
      if (variant) {
        return {
          variantId: row.variantId,
          wins: row.wins,
          label: variant.metadata.label ?? variant.metadata.model ?? "Unknown",
          provider: variant.metadata.provider ?? null,
          model: variant.metadata.model ?? null,
          description: variant.runMeta.description ?? null,
          runTimestamp: variant.runTimestamp ?? null,
        };
      }

      const parsed = parseVariantKey(row.variantId);
      if (parsed) {
        let inferredProvider = null;
        let inferredModel = parsed.label;
        let displayLabel = parsed.label;
        if (parsed.label.toLowerCase().includes("claude")) {
          inferredProvider = "Anthropic";
          displayLabel = parsed.label.replace(/-(\d+)-(\d+)$/, ".$1.$2");
          inferredModel = parsed.label.replace(/-(\d+)-(\d+)$/, "-$1-$2");
        } else if (parsed.label.toLowerCase().includes("gpt")) {
          inferredProvider = "OpenAI";
          displayLabel = parsed.label.replace(/-/g, " ").replace(/\b(\w)/g, (_, c) => c.toUpperCase());
        }

        return {
          variantId: row.variantId,
          wins: row.wins,
          label: displayLabel,
          provider: inferredProvider,
          model: inferredModel,
          description: null,
          runTimestamp: parsed.runFolderName.match(/^\d{4}-\d{2}-\d{2}/)
            ? parsed.runFolderName.replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3").replace(/Z-/, "Z")
            : null,
        };
      }

      return {
        variantId: row.variantId,
        wins: row.wins,
        label: row.variantId,
        provider: null,
        model: null,
        description: null,
        runTimestamp: null,
      };
    });

    const groupedEntries = new Map();
    const makeGroupKey = (entry) =>
      `${entry.provider ?? "unknown"}::${entry.model ?? entry.label ?? entry.variantId}`;

    for (const entry of rawEntries) {
      const key = makeGroupKey(entry);
      if (groupedEntries.has(key)) {
        const existing = groupedEntries.get(key);
        existing.wins += entry.wins;
        if (!existing.description && entry.description) {
          existing.description = entry.description;
        }
        if (!existing.runTimestamp && entry.runTimestamp) {
          existing.runTimestamp = entry.runTimestamp;
        }
      } else {
        groupedEntries.set(key, { ...entry });
      }
    }

    configModels.forEach((configModel) => {
      const key = `${configModel.provider ?? "unknown"}::${configModel.model ?? configModel.label}`;
      if (!groupedEntries.has(key)) {
        groupedEntries.set(key, {
          variantId: `config-${configModel.model}`,
          wins: 0,
          label: configModel.label ?? configModel.model,
          provider: configModel.provider ?? null,
          model: configModel.model ?? null,
          description: null,
          runTimestamp: null,
        });
      }
    });

    const entries = Array.from(groupedEntries.values());

    // Sort by wins (descending), then by label (ascending)
    entries.sort((a, b) => {
      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }
      return (a.label || '').localeCompare(b.label || '');
    });

    return {
      entries,
      stats,
    };
  });

  app.get("/api/battles", async (request) => {
    const limitParam = Number(request.query?.limit);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
    const battles = listBattleHistory(state.dbCtx, limit);

    const enrichVariant = (variantId) => {
      const variant = state.variantIndex.get(variantId);
      if (variant) {
        return {
          variantId,
          label: variant.metadata.label ?? variant.metadata.model ?? "Unknown",
          provider: variant.metadata.provider ?? null,
          model: variant.metadata.model ?? null,
        };
      }

      const parsed = parseVariantKey(variantId);
      if (parsed) {
        let inferredProvider = null;
        let displayLabel = parsed.label;

        if (parsed.label.toLowerCase().includes("claude")) {
          inferredProvider = "Anthropic";
          displayLabel = parsed.label.replace(/-(\d+)-(\d+)$/, ".$1.$2");
        } else if (parsed.label.toLowerCase().includes("gpt")) {
          inferredProvider = "OpenAI";
        }

        return {
          variantId,
          label: displayLabel,
          provider: inferredProvider,
          model: parsed.label,
        };
      }

      return {
        variantId,
        label: variantId,
        provider: null,
        model: null,
      };
    };

    return {
      battles: battles.map((battle) => ({
        id: battle.id,
        createdAt: battle.createdAt,
        left: enrichVariant(battle.leftVariantId),
        right: enrichVariant(battle.rightVariantId),
        winner: battle.winnerVariantId ? enrichVariant(battle.winnerVariantId) : null,
        selection: battle.selection,
        notes: battle.notes,
      })),
    };
  });

  app.post("/api/demo/vote", async (request, reply) => {
    const { leftVariantId, rightVariantId, winnerVariantId, selection } = request.body || {};
    if (!leftVariantId || !rightVariantId || !winnerVariantId || !selection) {
      reply.status(400);
      return { error: "leftVariantId, rightVariantId, winnerVariantId, and selection are required" };
    }

    if (!["left", "right"].includes(selection)) {
      reply.status(400);
      return { error: "selection must be 'left' or 'right'" };
    }

    if (![leftVariantId, rightVariantId].includes(winnerVariantId)) {
      reply.status(400);
      return { error: "winnerVariantId must match leftVariantId or rightVariantId" };
    }

    if (leftVariantId === rightVariantId) {
      reply.status(400);
      return { error: "leftVariantId and rightVariantId must differ" };
    }

    if (!state.variantIndex.has(leftVariantId) || !state.variantIndex.has(rightVariantId)) {
      console.warn("[demo/vote] variant metadata missing; proceeding with raw ids", {
        leftVariantId,
        rightVariantId,
      });
    }

    const pseudoPairId = `demo-${crypto.randomUUID()}`;
    recordVote(state.dbCtx, {
      pairId: pseudoPairId,
      leftVariantId,
      rightVariantId,
      winnerVariantId,
      selection,
      notes: "demo",
    });

    return { ok: true };
  });

  app.post("/api/demo/run", async (request, reply) => {
    const { description } = request.body || {};
    if (!description) {
      reply.status(400);
      return { error: "description is required" };
    }

    const demoRequestId = crypto.randomUUID();
    console.log(`[demo][${demoRequestId}] request received`, { description });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    const sendEvent = (event, data) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const CONFIG_PATH = path.join(ROOT, "benchmark.config.json");
      const config = await loadConfig(CONFIG_PATH);
      const promptTemplate = await fs.readFile(
        path.resolve(ROOT, config.promptPath),
        "utf8",
      );
      const renderedPrompt = renderPrompt(promptTemplate, description);
      const userMessage = description;

      const runId = buildRunId();
      const baseOutputDir = path.resolve(ROOT, config.outputDir, runId);
      await fs.mkdir(baseOutputDir, { recursive: true });
      console.log(`[demo][${demoRequestId}] run ${runId} initialized at ${baseOutputDir}`);

      await fs.writeFile(path.join(baseOutputDir, "prompt.md"), renderedPrompt, "utf8");
      await fs.writeFile(
        path.join(baseOutputDir, "meta.json"),
        JSON.stringify({
          benchmark: config.benchmarkName,
          runId,
          timestamp: new Date().toISOString(),
          description,
          temperature: config.temperature,
          maxOutputTokens: config.maxOutputTokens,
          models: config.models,
        }, null, 2),
        "utf8",
      );

      const selectedModels = pickRandomSubset(config.models ?? [], DEMO_MODEL_COUNT);
      if (selectedModels.length === 0) {
        throw new Error("No models configured to run.");
      }

      sendEvent("run-start", { runId, modelCount: selectedModels.length });

      // Run selected models in parallel
      await Promise.all(
        selectedModels.map(async (modelConfig) => {
          const label = sanitizeLabel(modelConfig.label ?? modelConfig.model);
          const modelDir = path.join(baseOutputDir, label);
          const variantKey = computeVariantKey(
            path.basename(baseOutputDir),
            modelConfig.provider,
            modelConfig.model,
            modelConfig.label ?? modelConfig.model ?? label,
          );

          sendEvent("model-start", {
            provider: modelConfig.provider,
            model: modelConfig.model,
            label,
            variantKey,
          });
          console.log(
            `[demo][${demoRequestId}] model-start ${label} (${modelConfig.provider}:${modelConfig.model})`,
          );

          try {
            let accumulatedText = "";
            let chunkCount = 0;
            const result = await callModel(
              modelConfig,
              renderedPrompt,
              userMessage,
              config,
              (chunk) => {
                accumulatedText += chunk;
                chunkCount += 1;
                if (chunkCount === 1 || chunkCount % 20 === 0) {
                  console.log(
                    `[demo][${demoRequestId}] model-chunk ${label} chunks=${chunkCount} chars=${accumulatedText.length}`,
                  );
                }
                sendEvent("chunk", {
                  provider: modelConfig.provider,
                  model: modelConfig.model,
                  label,
                  variantKey,
                  chunk,
                  accumulated: accumulatedText.length,
                });
              }
            );

            await persistResult(modelDir, result, modelConfig, description, "");

            sendEvent("model-complete", {
              provider: modelConfig.provider,
              model: modelConfig.model,
              label,
              variantKey,
              outputLength: result.outputText?.length || 0,
            });
            console.log(
              `[demo][${demoRequestId}] model-complete ${label} outputLength=${result.outputText?.length || 0}`,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await fs.mkdir(modelDir, { recursive: true });
            await fs.writeFile(path.join(modelDir, "error.log"), message, "utf8");

            sendEvent("model-error", {
              provider: modelConfig.provider,
              model: modelConfig.model,
              label,
              variantKey,
              error: message,
            });
            console.error(
              `[demo][${demoRequestId}] model-error ${label}`,
              error,
            );
          }
        })
      );

      await refreshVariants({ runsDir });
      sendEvent("run-complete", { runId, outputDir: baseOutputDir });
      console.log(`[demo][${demoRequestId}] run ${runId} complete`);
      reply.raw.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendEvent("error", { error: message });
      console.error(`[demo][${demoRequestId}] run failed`, error);
      reply.raw.end();
    }
  });

  app.setNotFoundHandler(async (request, reply) => {
    const accept = request.headers.accept ?? "";
    if (accept.includes("text/html")) {
      return reply.sendFile("index.html");
    }
    reply.status(404).send({ error: "Not found" });
  });

  await app.listen({ port, host });

  console.log(`[viewer] server listening on http://${host}:${port}`);

  return app;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer().catch((error) => {
    console.error("[viewer] failed to start", error);
    process.exitCode = 1;
  });
}
