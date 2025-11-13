import fs from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");

ensureLocalEnv();

export async function loadConfig(configPath) {
  const data = await fs.readFile(configPath, "utf8");
  return JSON.parse(data);
}

export function renderPrompt(template, description) {
  const parts = description.split(" - ");
  const productName = parts[0] || description;
  const valueProp = parts[1] || description;

  return template
    .replaceAll("[PRODUCT NAME]", productName)
    .replaceAll("[1-sentence value proposition]", valueProp);
}

export function buildRunId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${stamp}-${suffix}`;
}

export async function callModel(modelConfig, prompt, userMessage, globalConfig, onChunk) {
  const providerKey = (modelConfig.provider ?? "").toString().toLowerCase();
  switch (providerKey) {
    case "openai":
      return callOpenAI(modelConfig, prompt, userMessage, globalConfig, onChunk);
    case "anthropic":
      return callAnthropic(modelConfig, prompt, userMessage, globalConfig, onChunk);
    case "google":
      return callGoogle(modelConfig, prompt, userMessage, globalConfig, onChunk);
    default:
      throw new Error(`Unsupported provider '${modelConfig.provider}'.`);
  }
}

async function callOpenAI(modelConfig, prompt, userMessage, globalConfig, onChunk) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const client = new OpenAI({ apiKey });

  const params = {
    model: modelConfig.model,
    max_completion_tokens: modelConfig.maxOutputTokens ?? globalConfig.maxOutputTokens,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: userMessage },
    ],
    stream: !!onChunk,
  };

  if (!modelConfig.model.includes("gpt-5")) {
    params.temperature = modelConfig.temperature ?? globalConfig.temperature;
  }

  if (modelConfig.model.includes("gpt-5")) {
    params.store = true;
  }

  if (onChunk) {
    // Streaming mode
    const stream = await client.chat.completions.create(params);
    let fullText = "";
    let finalResponse = null;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        onChunk(delta);
      }
      if (chunk.choices?.[0]?.finish_reason) {
        finalResponse = chunk;
      }
    }

    return { rawResponse: finalResponse, outputText: fullText };
  } else {
    // Non-streaming mode
    const response = await client.chat.completions.create(params);
    const message = response?.choices?.[0]?.message;
    let outputText = normalizeOpenAIContent(message?.content ?? "");

    if (!outputText && message?.reasoning_content) {
      outputText = message.reasoning_content;
    }

    return { rawResponse: response, outputText };
  }
}

async function callAnthropic(modelConfig, prompt, userMessage, globalConfig, onChunk) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }

  const client = new Anthropic({ apiKey });

  const stream = await client.messages.create({
    model: modelConfig.model,
    temperature: modelConfig.temperature ?? globalConfig.temperature,
    max_tokens: modelConfig.maxOutputTokens ?? globalConfig.maxOutputTokens,
    system: prompt,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
    stream: true,
  });

  let fullText = "";
  let finalResponse = null;

  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
      fullText += chunk.delta.text;
      if (onChunk) {
        onChunk(chunk.delta.text);
      }
    } else if (chunk.type === "message_stop") {
      finalResponse = chunk;
    }
  }

  return { rawResponse: finalResponse, outputText: fullText };
}

async function callGoogle(modelConfig, prompt, userMessage, globalConfig, onChunk) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelConfig.model,
    systemInstruction: prompt,
  });

  const generationConfig = {
    temperature: modelConfig.temperature ?? globalConfig.temperature,
    maxOutputTokens: modelConfig.maxOutputTokens ?? globalConfig.maxOutputTokens,
  };

  if (onChunk) {
    // Streaming mode
    const result = await model.generateContentStream({
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig,
    });

    let fullText = "";
    let finalResponse = null;

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        fullText += chunkText;
        onChunk(chunkText);
      }
    }

    finalResponse = await result.response;
    return { rawResponse: finalResponse, outputText: fullText };
  } else {
    // Non-streaming mode
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig,
    });

    const response = await result.response;
    const outputText = response.text();
    return { rawResponse: response, outputText };
  }
}

function normalizeOpenAIContent(content) {
  if (Array.isArray(content)) {
    return content.map((chunk) => chunk?.text ?? "").join("");
  }
  return typeof content === "string" ? content : "";
}

export async function persistResult(modelDir, result, modelConfig, description, notes) {
  await fs.mkdir(modelDir, { recursive: true });

  await fs.writeFile(
    path.join(modelDir, "response.txt"),
    result.outputText ?? "",
    "utf8",
  );
  await fs.writeFile(
    path.join(modelDir, "response.json"),
    JSON.stringify(result.rawResponse ?? {}, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(modelDir, "metadata.json"),
    JSON.stringify(
      {
        provider: modelConfig.provider,
        model: modelConfig.model,
        label: modelConfig.label,
        temperature: modelConfig.temperature,
        maxOutputTokens: modelConfig.maxOutputTokens,
        description,
        notes,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function sanitizeLabel(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export { sanitizeLabel };

function ensureLocalEnv() {
  if (process.env.__DESIGN_ARENA_ENV_LOADED) {
    return;
  }

  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) {
    process.env.__DESIGN_ARENA_ENV_LOADED = "missing";
    return;
  }

  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!key || value === undefined) continue;
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
    process.env.__DESIGN_ARENA_ENV_LOADED = "true";
  } catch (error) {
    process.env.__DESIGN_ARENA_ENV_LOADED = "error";
    console.warn("[env] failed to load .env file", error);
  }
}
