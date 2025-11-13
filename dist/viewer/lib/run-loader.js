import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { extractPrimarySection } from "./primary-section.js";
import { sanitizeLabel } from "../../lib/benchmark.mjs";
const DEFAULT_RUNS_DIR = path.resolve(process.cwd(), "runs", "html-design");
async function loadVariants(options = {}) {
  const runsDir = options.runsDir ?? DEFAULT_RUNS_DIR;
  const entries = await safeReadDir(runsDir);
  const runs = entries.filter((entry) => entry.isDirectory());
  const variants = [];
  for (const runEntry of runs) {
    const runPath = path.join(runsDir, runEntry.name);
    const runMeta = await readRunMeta(runPath);
    if (!runMeta) continue;
    const variantEntries = await safeReadDir(runPath);
    for (const variantEntry of variantEntries) {
      if (!variantEntry.isDirectory()) continue;
      const variantPath = path.join(runPath, variantEntry.name);
      const variant = await buildVariant(runMeta, runEntry.name, variantPath);
      if (variant) {
        variants.push(variant);
      }
    }
  }
  return variants.sort((a, b) => a.runTimestamp.localeCompare(b.runTimestamp));
}
async function buildVariant(runMeta, runFolderName, variantPath) {
  const responsePath = path.join(variantPath, "response.txt");
  const metadataPath = path.join(variantPath, "metadata.json");
  const [responseText, variantMeta] = await Promise.all([
    safeReadFile(responsePath),
    readVariantMeta(metadataPath)
  ]);
  if (!responseText || !variantMeta) {
    return null;
  }
  const extraction = extractPrimarySection(responseText);
  const variantKey = getVariantKey(runFolderName, variantMeta, variantPath);
  return {
    variantKey,
    runId: runMeta.runId ?? runFolderName,
    runTimestamp: runMeta.timestamp,
    runMeta,
    metadata: variantMeta,
    responseTextPath: responsePath,
    primaryHtml: extraction.sanitizedHtml,
    primaryRaw: extraction.rawSection,
    sourceText: responseText
  };
}
function getVariantKey(runFolderName, metadata, variantPath) {
  const rawLabel = metadata.label ?? metadata.model ?? path.basename(variantPath);
  const label = sanitizeLabel(rawLabel);
  const composite = `${runFolderName}:${metadata.provider}:${metadata.model}:${label}`;
  const hash = crypto.createHash("sha1").update(composite).digest("hex").slice(0, 12);
  return `${runFolderName}/${label}-${hash}`;
}
async function readRunMeta(runPath) {
  const metaPath = path.join(runPath, "meta.json");
  try {
    const data = await fs.readFile(metaPath, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}
async function readVariantMeta(filePath) {
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}
async function safeReadFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}
async function safeReadDir(dirPath) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}
export {
  loadVariants
};
//# sourceMappingURL=run-loader.js.map
