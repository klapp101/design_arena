import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  renderPrompt,
  buildRunId,
  callModel,
  persistResult,
  sanitizeLabel,
} from "./lib/benchmark.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "benchmark.config.json");

const ARG_DEFAULTS = {
  "description": "Design a GitHub-style dashboard with activity graphs, repository cards, contribution heatmap, issue tracking, pull request overview, and clean, developer-focused UI.",
  notes: "",
  "dry-run": "false",
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(CONFIG_PATH);
  const promptTemplate = await fs.readFile(
    path.resolve(ROOT, config.promptPath),
    "utf8",
  );
  const description = args["description"];
  const renderedPrompt = renderPrompt(promptTemplate, description);
  const userMessage = buildUserMessage(args);

  const runId = buildRunId();
  const baseOutputDir = path.resolve(ROOT, config.outputDir, runId);
  await fs.mkdir(baseOutputDir, { recursive: true });
  await fs.writeFile(
    path.join(baseOutputDir, "prompt.md"),
    renderedPrompt,
    "utf8",
  );
  await fs.writeFile(
    path.join(baseOutputDir, "meta.json"),
    JSON.stringify(
      {
        benchmark: config.benchmarkName,
        runId,
        timestamp: new Date().toISOString(),
        description,
        notes: args.notes,
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        models: config.models,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    `Starting benchmark '${config.benchmarkName}' for ${config.models.length} models (run ${runId}).`,
  );

  for (const modelConfig of config.models) {
    const label = sanitizeLabel(modelConfig.label ?? modelConfig.model);
    const modelDir = path.join(baseOutputDir, label);

    try {
      const result = args["dry-run"] === "true"
        ? {
          outputText: "[dry-run] skipped model invocation.",
          rawResponse: { skipped: true },
        }
        : await callModel(modelConfig, renderedPrompt, userMessage, config);

      await persistResult(modelDir, result, modelConfig, description, args.notes);
      console.log(`✔ Saved output for ${modelConfig.provider}:${modelConfig.model}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✖ Failed ${modelConfig.provider}:${modelConfig.model} – ${message}`);
      await fs.writeFile(
        path.join(modelDir, "error.log"),
        message,
        "utf8",
      );
    }
  }

  console.log(`Run complete. Artifacts saved to ${baseOutputDir}`);
}

function parseArgs(argv) {
  const args = { ...ARG_DEFAULTS };
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, value] = token.slice(2).split("=");
    if (!key) continue;
    args[key] = value ?? "true";
  }
  return args;
}

function buildUserMessage(args) {
  return (
    args["description"] +
    (args.notes ? `\n\nAdditional notes: ${args.notes}` : "")
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
