import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { COMMENT_MARKER } from './report.js';

const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';

interface GhComment { id: number; body: string; }
interface GhResponse<T> { data: T; nextUrl?: string; }

function resolvePrNumber(): number | undefined {
  if (process.env.CSA_PR_NUMBER) return Number(process.env.CSA_PR_NUMBER);
  const ref = process.env.GITHUB_REF ?? '';
  const m = ref.match(/refs\/pull\/(\d+)\//);
  if (m) return Number(m[1]);
  return undefined;
}

function parseNextLink(link: string | null): string | undefined {
  if (!link) return undefined;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return undefined;
}

async function ghRequest<T>(url: string, init?: RequestInit): Promise<GhResponse<T>> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required to post PR comments.');
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}: ${await res.text()}`);
  const data = (res.status === 204 ? undefined : await res.json()) as T;
  return { data, nextUrl: parseNextLink(res.headers.get('link')) };
}

async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await ghRequest<T>(`${API}${path}`, init);
  return data;
}

async function findStickyComment(repo: string, prNumber: number): Promise<GhComment | undefined> {
  let url: string | undefined = `${API}/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
  while (url) {
    const res: GhResponse<GhComment[]> = await ghRequest<GhComment[]>(url);
    const hit = res.data.find((c: GhComment) => c.body?.includes(COMMENT_MARKER));
    if (hit) return hit;
    url = res.nextUrl;
  }
  return undefined;
}

export async function comment(configPath?: string): Promise<void> {
  const config = await loadConfig(configPath);
  const outDir = resolve(process.cwd(), config.outDir);
  const body = await readFile(join(outDir, 'report.md'), 'utf8');

  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = resolvePrNumber();
  if (!repo || !prNumber) {
    console.log('No GITHUB_REPOSITORY / PR number in env — printing report instead:\n');
    console.log(body);
    return;
  }

  const mine = await findStickyComment(repo, prNumber);
  if (mine) {
    await gh(`/repos/${repo}/issues/comments/${mine.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    console.log(`Updated existing comment ${mine.id} on PR #${prNumber}.`);
  } else {
    await gh(`/repos/${repo}/issues/${prNumber}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    console.log(`Created comment on PR #${prNumber}.`);
  }
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  comment().catch((err) => { console.error(err); process.exit(1); });
}
