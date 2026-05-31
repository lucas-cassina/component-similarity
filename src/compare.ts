import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import type {
  ComponentSignature,
  ComponentsEmbeddings,
  ComponentsManifest,
  ComponentsSimilarity,
  SimilarityCluster,
  SimilarityPair,
} from './types.js';

function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p !== x) this.parent.set(x, this.find(p));
    return this.parent.get(x)!;
  }

  union(x: string, y: string): void {
    const px = this.find(x);
    const py = this.find(y);
    if (px !== py) this.parent.set(px, py);
  }
}

function buildSuggestion(members: string[], sigMap: Map<string, ComponentSignature>): string {
  const sigs = members.map((m) => sigMap.get(m)).filter((s): s is ComponentSignature => s !== undefined);
  if (sigs.length < 2) return `These ${members.length} components have high structural overlap. Consider consolidation.`;

  const propSets = sigs.map((s) => new Set(s.props.map((p) => p.name)));
  const allPropNames = new Set<string>();
  for (const ps of propSets) for (const p of ps) allPropNames.add(p);
  const sharedProps = [...allPropNames].filter((p) => propSets.every((ps) => ps.has(p)));

  const jsxSets = sigs.map((s) => new Set(s.jsxTags));
  const sharedTags = [...jsxSets[0]].filter((t) => jsxSets.every((s) => s.has(t)));

  const hints: string[] = [];
  if (sharedProps.length >= 2) hints.push(`shared props (${sharedProps.slice(0, 3).join(', ')})`);
  if (sharedTags.length >= 2) hints.push(`similar DOM structure`);

  if (hints.length === 0) return `These ${members.length} components have high semantic overlap. Consider extracting a unified component with variant props.`;
  return `These ${members.length} components share ${hints.join(' and ')}. Consider extracting a single component with variant props.`;
}

export async function compare(configPath?: string): Promise<ComponentsSimilarity> {
  const config = await loadConfig(configPath);
  const outDir = resolve(process.cwd(), config.outDir);
  const { threshold } = config;

  const embeddings: ComponentsEmbeddings = JSON.parse(
    await readFile(join(outDir, 'components-embeddings.json'), 'utf8'),
  );
  const manifest: ComponentsManifest = JSON.parse(
    await readFile(join(outDir, 'components-manifest.json'), 'utf8'),
  );
  const sigMap = new Map(manifest.components.map((c) => [c.name, c]));

  const { components } = embeddings;
  console.log(`Comparing ${components.length} components (threshold=${threshold})...`);

  const pairs: SimilarityPair[] = [];
  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      const score = cosine(components[i].vector, components[j].vector);
      if (score >= threshold) {
        pairs.push({
          nameA: components[i].name, fileA: components[i].relativePath,
          nameB: components[j].name, fileB: components[j].relativePath,
          score: Math.round(score * 10000) / 10000,
        });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const uf = new UnionFind();
  for (const pair of pairs) uf.union(pair.nameA, pair.nameB);

  const groups = new Map<string, string[]>();
  for (const c of components) {
    const root = uf.find(c.name);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(c.name);
  }

  const clusters: SimilarityCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const memberSet = new Set(members);
    const totals = new Map<string, number>();
    for (const p of pairs) {
      if (memberSet.has(p.nameA) && memberSet.has(p.nameB)) {
        totals.set(p.nameA, (totals.get(p.nameA) ?? 0) + p.score);
        totals.set(p.nameB, (totals.get(p.nameB) ?? 0) + p.score);
      }
    }
    const representative = members.reduce(
      (best, m) => (totals.get(m) ?? 0) > (totals.get(best) ?? 0) ? m : best,
      members[0],
    );
    const clusterPairs = pairs.filter((p) => memberSet.has(p.nameA) && memberSet.has(p.nameB));
    const avgScore = clusterPairs.length
      ? Math.round((clusterPairs.reduce((s, p) => s + p.score, 0) / clusterPairs.length) * 10000) / 10000
      : threshold;
    clusters.push({ representative, members, avgScore, suggestion: buildSuggestion(members, sigMap) });
  }
  clusters.sort((a, b) => b.avgScore - a.avgScore);

  const result: ComponentsSimilarity = {
    comparedAt: new Date().toISOString(),
    threshold,
    totalComponents: components.length,
    pairsAboveThreshold: pairs.length,
    pairs,
    clusters,
  };

  await writeFile(join(outDir, 'components-similarity.json'), JSON.stringify(result, null, 2));
  console.log(`${pairs.length} similar pairs, ${clusters.length} clusters → ${config.outDir}/components-similarity.json`);
  return result;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  compare().catch((err) => { console.error(err); process.exit(1); });
}
