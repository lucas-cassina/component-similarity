# component-similarity

Detects near-duplicate React components in your codebase using semantic embeddings.

Scans your `.tsx`/`.jsx` source files, extracts each component's props and JSX structure, embeds them with OpenAI, and computes pairwise cosine similarity. Components that are too similar get flagged and grouped into clusters with a consolidation suggestion. Results are posted as a sticky comment on the pull request.

---

## The problem it solves

Every team eventually ends up with three versions of the same card, two loaders that do the same thing, and four ways to show an empty state. Nobody did it on purpose — they just didn't know the other one existed.

This tool runs in CI and surfaces those overlaps before they accumulate.

---

## Installation

```bash
npm install --save-dev component-similarity
```

Add a `components.config.js` to the root of your project (see [Configuration](#configuration) below).

---

## Usage

```bash
# Full pipeline: scan → embed → compare → report
npx csa analyze

# Then post the report as a sticky PR comment
npx csa comment

# Or run each step individually
npx csa scan      # → out/components-manifest.json
npx csa embed     # → out/components-embeddings.json
npx csa compare   # → out/components-similarity.json
npx csa report    # → out/report.md
```

---

## Configuration

Copy `components.config.example.js` to `components.config.js` and adjust:

```js
export default {
  srcDir: 'src/components',
  threshold: 0.85,
  model: 'text-embedding-3-small',
  concurrency: 8,
  outDir: 'out',
};
```

### `srcDir` (required)

Path to the directory that contains your components, relative to the project root. The scan is recursive — it walks all subdirectories.

```js
srcDir: 'src/components'       // standard Create React App / Vite layout
srcDir: 'components'           // Next.js layout
srcDir: 'src/ui'               // custom
```

Both `.tsx` and `.jsx` files are picked up. Files that don't export a PascalCase name are skipped (utilities, hooks, re-export barrels, etc.).

### `threshold`

A number between 0 and 1. Two components are flagged as similar when their cosine similarity score is **at or above** this value.

- **0.90** — very conservative. Only catches near-identical components (same props, same DOM structure).
- **0.85** — recommended default. Catches genuine duplicates and components that grew apart from the same origin.
- **0.80** — broader net. Will surface components that share a general purpose (e.g. all form fields) even if their props differ significantly. Expect more noise.
- **0.75** — mostly noise for a typical codebase.

Start at 0.85. If the report is empty and you suspect there are duplicates, lower to 0.82 or 0.80.

### `model`

The OpenAI embeddings model to use. `text-embedding-3-small` is the right choice for this task: it's fast, cheap, and produces high-quality semantic vectors for code-like text.

`text-embedding-3-large` costs 13× more and doesn't meaningfully improve results for component similarity. Don't change this unless you have a specific reason.

### `concurrency`

How many embedding requests to send to OpenAI in parallel. The default (8) saturates the free-tier rate limit without exceeding it. If you're on a paid tier with higher rate limits you can raise this; if you're hitting 429 errors lower it.

### `outDir`

Where the JSON intermediate files and the final `report.md` are written. Defaults to `out`. If your project already uses an `out` directory for something else, change this to avoid conflicts (e.g. `out-similarity`).

---

## How it works

### 1. Scan (no API calls)

`csa scan` walks `srcDir` and parses each file with [ts-morph](https://ts-morph.com/). For each component it extracts:

- **Props** — TypeScript interfaces/type aliases, or destructured function parameters for JS files
- **JSX structure** — the HTML element tags (`div`, `button`, `img`, …) in depth-first order, up to 60 tags
- **Imports** — named and default imports from all `import` statements

These three signals together give a compact semantic fingerprint of what the component does and how it's built.

### 2. Embed (OpenAI API)

`csa embed` serializes each component into a short text string and calls the OpenAI embeddings API:

```
Component: MantineDateField
Props: name, label, format?, isRequired?, isDateType?, onChange?, minDate?
JSX structure: (none)
Imports: React, DatePicker, useField, useFormikContext
```

The resulting vector (1536 dimensions) encodes the semantic meaning of the component. Components that do similar things end up close together in this space regardless of naming.

**Embedding cache:** the hash of each source file is stored alongside its vector. On subsequent runs, only files that changed since the last run are re-embedded. Unchanged components are read from `out/components-embeddings.json` at zero cost. In CI, pair this with `actions/cache` (see [GitHub Actions](#github-actions)) to persist the cache across runs.

### 3. Compare (no API calls)

`csa compare` computes cosine similarity for every pair of components and groups the similar ones into clusters using union-find. Clusters get a heuristic consolidation suggestion based on shared props and DOM structure.

### 4. Report

`csa report` writes `out/report.md` — a Markdown file ready to be posted as a GitHub PR comment. `csa comment` upserts it as a sticky comment (updates on re-runs, doesn't spam the PR).

---

## Cost

The only step that calls the OpenAI API is `csa embed`. `text-embedding-3-small` is priced at **$0.020 per 1 million tokens**.

Each component's text representation is roughly 100–300 tokens depending on how many props and JSX tags it has.

| Codebase size | Tokens per run | Cost per run | 50 PRs/month |
|---------------|---------------|-------------|--------------|
| 20 components | ~1,500 | $0.000030 | $0.002/mo |
| 100 components | ~10,000 | $0.000200 | $0.010/mo |
| 300 components | ~40,000 | $0.000800 | $0.040/mo |
| 600 components | ~100,000 | $0.002000 | $0.100/mo |

**With the file-hash cache active, the real cost per run is proportional to how many components actually changed in the PR** — not the total component count. A PR that touches 5 components out of 300 costs ~$0.000013.

For reference: a single GPT-4o visual regression classification call (3 screenshots) costs ~$0.009. The full embedding run for a 100-component codebase costs less than classifying one changed screen.

---

## GitHub Actions

Add this workflow to run on every PR that touches your components directory:

```yaml
# .github/workflows/component-similarity.yml
name: Component Similarity

on:
  pull_request:
    paths:
      - 'src/components/**'   # adjust to your srcDir

permissions:
  pull-requests: write

jobs:
  component-similarity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci

      # Restore embedding cache. Exact key hit = 0 API calls this run.
      # Prefix hit = partial restore; only changed files are re-embedded.
      - uses: actions/cache@v4
        with:
          path: out/components-embeddings.json
          key: csa-embed-${{ hashFiles('src/components/**/*.tsx', 'src/components/**/*.jsx') }}
          restore-keys: csa-embed-

      - name: Analyze
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: npx csa analyze

      - name: Comment on PR
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx csa comment
```

Required secrets: `OPENAI_API_KEY`. `GITHUB_TOKEN` is provided automatically by GitHub Actions.

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Required for `csa embed`. |
| `GITHUB_TOKEN` | Required for `csa comment`. |
| `CSA_CONFIG` | Override the config file path (default: `components.config.js`). |
| `CSA_PR_NUMBER` | Override PR number for commenting (auto-detected in GitHub Actions). |
