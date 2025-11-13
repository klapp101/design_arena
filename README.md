## Design Arena Benchmark Harness

A repeatable workflow for comparing HTML/CSS design generation quality across multiple LLMs. Models receive a design brief and generate complete, standalone HTML files with Tailwind CSS.

### Prerequisites
- Node.js 20+
- `OPENAI_API_KEY` for GPT-5 access
- `ANTHROPIC_API_KEY` for Claude access
- `GOOGLE_API_KEY` for Gemini access

Export keys in your shell or create a `.env` file at the repo root.

### Arena Viewer

Start the viewer server:

```bash
npm run viewer:start
```

The viewer runs on **`http://localhost:4173`** with two main views:

- **Main Demo** (`http://localhost:4173`): Generate new designs on-demand and compare model outputs side-by-side
- **Leaderboard** (`http://localhost:4173/leaderboard`): Track model win rates and battle history

**Features:**
- Auto-builds bundles on first start
- Reads artifacts from `runs/html-design/`
- Writes votes to `data/arena-viewer.sqlite`
- Toggle between rendered preview and raw source
- Demo mode: generate new designs on-demand in the UI
- Leaderboard: model win rates and battle history

**Dev mode** (live rebuilds):
```bash
npm run viewer:dev    # watch mode
npm run viewer:start  # separate terminal
```

### Models

Configured in `benchmark.config.json`:
- **OpenAI**: GPT-5, GPT-5-nano, GPT-5-mini
- **Anthropic**: Claude Sonnet 4.5, Haiku 4.5, Opus 4.1
- **Google**: Gemini 2.5 Pro, Gemini 2.5 Flash

### Evaluation

1. View outputs in the arena viewer or open `response.txt` files directly in a browser
2. Score designs on visual quality, UX, code quality, and prompt adherence
3. Use the viewer's leaderboard to track model performance over time
4. Adjust `benchmark.config.json` (temperature, max tokens, models) and iterate
