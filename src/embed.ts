import OpenAI from 'openai';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import type { ComponentSignature, ComponentEmbedding, ComponentsEmbeddings, ComponentsManifest } from './types.js';

export function toText(c: ComponentSignature): string {
  const propsStr = c.props.length
    ? c.props.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    : 'none';
  const jsxStr = c.jsxTags.length ? c.jsxTags.join(', ') : 'none';
  const importsStr = c.imports.length ? c.imports.join(', ') : 'none';
  return `Component: ${c.name}\nProps: ${propsStr}\nJSX structure: ${jsxStr}\nImports: ${importsStr}`;
}

async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function loadCache(cachePath: string, model: string): Promise<Map<string, ComponentEmbedding>> {
  try {
    const cached: ComponentsEmbeddings = JSON.parse(await readFile(cachePath, 'utf8'));
    if (cached.model !== model) return new Map();
    const map = new Map<string, ComponentEmbedding>();
    for (const e of cached.components) {
      if (e.fileHash) map.set(e.relativePath, e);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function embed(configPath?: string): Promise<ComponentsEmbeddings> {
  const config = await loadConfig(configPath);
  const outDir = resolve(process.cwd(), config.outDir);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for embedding.');
  }

  const manifest: ComponentsManifest = JSON.parse(
    await readFile(join(outDir, 'components-manifest.json'), 'utf8'),
  );
  const { components } = manifest;

  if (components.length === 0) {
    console.log('No components found in manifest — skipping embedding.');
    const result: ComponentsEmbeddings = { embeddedAt: new Date().toISOString(), model: config.model, components: [] };
    await writeFile(join(outDir, 'components-embeddings.json'), JSON.stringify(result, null, 2));
    return result;
  }

  const { model, concurrency } = config;
  const cachePath = join(outDir, 'components-embeddings.json');
  const cache = await loadCache(cachePath, model);
  if (cache.size > 0) console.log(`Cache: ${cache.size} existing embeddings loaded.`);

  const client = new OpenAI();
  const embedded: ComponentEmbedding[] = new Array(components.length);
  let hits = 0;
  let misses = 0;
  let next = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= components.length) return;
      const c = components[idx];
      const fileHash = await hashFile(c.filePath);
      const cached = cache.get(c.relativePath);

      if (cached?.fileHash === fileHash) {
        embedded[idx] = cached;
        hits++;
        console.log(`  cached:   ${c.name}`);
      } else {
        const text = toText(c);
        const res = await client.embeddings.create({ model, input: text });
        embedded[idx] = { name: c.name, filePath: c.filePath, relativePath: c.relativePath, vector: res.data[0].embedding, textRepresentation: text, fileHash };
        misses++;
        console.log(`  embedded: ${c.name}`);
      }
    }
  });
  await Promise.all(workers);

  const result: ComponentsEmbeddings = { embeddedAt: new Date().toISOString(), model, components: embedded };
  await writeFile(cachePath, JSON.stringify(result, null, 2));
  console.log(`Done: ${hits} cached, ${misses} re-embedded (${misses} API call${misses === 1 ? '' : 's'}).`);
  return result;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  embed().catch((err) => { console.error(err); process.exit(1); });
}
