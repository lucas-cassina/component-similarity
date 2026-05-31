// component-similarity — example config.
// Copy to components.config.js and adjust to your project.
export default {
  // Required: directory to scan for .tsx files (recursive).
  srcDir: 'src/components',

  // Cosine similarity score above which two components are flagged.
  // 0.85 catches near-duplicates; lower catches looser matches.
  threshold: 0.85,

  // OpenAI embedding model.
  model: 'text-embedding-3-small',

  // Max parallel embedding requests.
  concurrency: 8,

  // Output directory for JSON files and the markdown report.
  outDir: 'out',
};
