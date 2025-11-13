# SaaS Landing Page Benchmark

This benchmark compares different LLMs on their ability to output a modern SaaS landing page built with Next.js 14, Tailwind CSS, and shadcn/ui. The shared instructions live in `SYSTEM_PROMPT.md` at the repo root so that every model receives the exact same brief.

## Structure
- `benchmark.config.json` – central configuration that lists the prompt path, output directory, shared sampling parameters, and target models.
- `runs/saas-landing-page/<timestamp>/<model>/` – generated artifacts for each run (raw response, extracted code, rendered assets, evaluation notes).
- `reports/` – optional summaries or comparison write-ups per batch of runs.

## Evaluation Dimensions
1. **Visual Design:** layout balance, typography, palette execution, motion details.
2. **UX Compliance:** nav and anchor alignment, responsive collapse behavior, CTA clarity.
3. **Code Quality:** semantic HTML, shadcn usage, Tailwind efficiency, accessibility.
4. **Prompt Adherence:** section coverage, data-driven copy, prohibition on stock placeholders.

## Workflow Overview
1. Use `npm run benchmark` (see root README) to invoke each model with `SYSTEM_PROMPT.md`, storing responses under `runs/`.
2. Inspect generated code and render it locally (Next.js dev server or headless renderer).
3. Score each dimension on a 1–5 scale, log findings in a shared worksheet, and optionally generate a `reports/*.md` comparison summary.

This folder will evolve as the automation pieces land, but it already captures the benchmark’s intent, outputs, and review criteria so the team can start consistent manual scoring immediately.
