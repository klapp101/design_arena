import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const DIST_DIR = path.join(ROOT, "dist", "viewer");
const LIB_DIST_DIR = path.join(DIST_DIR, "lib");

/**
 * @typedef {Object} BuildOptions
 * @property {boolean} [watch]
 * @property {boolean} [minify]
 * @property {boolean} [sourcemap]
 * @property {boolean} [skipClient]
 * @property {boolean} [skipLib]
 */

export async function buildViewer(options = {}) {
  const {
    watch = false,
    minify = false,
    sourcemap = true,
    skipClient = false,
    skipLib = false,
  } = options;

  await fs.mkdir(DIST_DIR, { recursive: true });

  const tasks = [];

  if (!skipClient) {
    const clientBuildOptions = {
      entryPoints: [path.join(__dirname, "app", "main.tsx")],
      outfile: path.join(DIST_DIR, "app.js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: ["es2020"],
      sourcemap,
      minify,
      jsx: "automatic",
      loader: {
        ".png": "dataurl",
        ".svg": "dataurl",
        ".jpg": "dataurl",
        ".jpeg": "dataurl",
        ".gif": "dataurl",
      },
      define: {
        "process.env.NODE_ENV": JSON.stringify(minify ? "production" : "development"),
      },
    };

    if (watch) {
      const ctx = await esbuild.context(clientBuildOptions);
      await ctx.watch();
    } else {
      tasks.push(esbuild.build(clientBuildOptions));
    }

    tasks.push(copyStaticAssets());
  }

  if (!skipLib) {
    await fs.mkdir(LIB_DIST_DIR, { recursive: true });
    const libBuildOptions = {
      entryPoints: [
        path.join(__dirname, "lib", "run-loader.ts"),
        path.join(__dirname, "lib", "primary-section.ts"),
      ],
      outdir: LIB_DIST_DIR,
      bundle: false,
      format: "esm",
      platform: "node",
      target: ["node20"],
      sourcemap,
      minify: false,
      jsx: "automatic",
    };

    if (watch) {
      const ctx = await esbuild.context(libBuildOptions);
      await ctx.watch();
    } else {
      tasks.push(esbuild.build(libBuildOptions));
    }

    // Copy benchmark library files to dist
    tasks.push(copyBenchmarkLib());
  }

  await Promise.all(tasks);
}

async function copyStaticAssets() {
  const files = [
    { source: path.join(__dirname, "app", "index.html"), target: path.join(DIST_DIR, "index.html") },
    { source: path.join(__dirname, "app", "global.css"), target: path.join(DIST_DIR, "app.css") },
  ];

  // Copy logo images
  const imgDir = path.join(ROOT, "img");
  const distImgDir = path.join(DIST_DIR, "img");
  await fs.mkdir(distImgDir, { recursive: true });

  const logoFiles = [
    { source: path.join(imgDir, "anthropic_logo.png"), target: path.join(distImgDir, "anthropic_logo.png") },
    { source: path.join(imgDir, "google_logo.png"), target: path.join(distImgDir, "google_logo.png") },
    { source: path.join(imgDir, "openai_logo.png"), target: path.join(distImgDir, "openai_logo.png") },
  ];

  const allFiles = [...files, ...logoFiles];

  await Promise.all(
    allFiles.map(async ({ source, target }) => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.copyFile(source, target);
      } catch (error) {
        if (error && error.code === "ENOENT") {
          console.warn(`[viewer:build] skipped missing asset ${source}`);
          return;
        }
        throw error;
      }
    }),
  );
}

async function copyBenchmarkLib() {
  const benchmarkLibDir = path.join(ROOT, "dist", "lib");
  await fs.mkdir(benchmarkLibDir, { recursive: true });

  const files = [
    { source: path.join(ROOT, "src", "lib", "benchmark.mjs"), target: path.join(benchmarkLibDir, "benchmark.mjs") },
  ];

  await Promise.all(
    files.map(async ({ source, target }) => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Set(process.argv.slice(2));
  buildViewer({
    watch: args.has("--watch"),
    minify: args.has("--minify"),
    sourcemap: !args.has("--no-sourcemap"),
  }).catch((error) => {
    console.error("[viewer:build] failed", error);
    process.exitCode = 1;
  });
}
