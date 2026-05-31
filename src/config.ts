import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface CsaConfig {
  /** Directory to scan for .tsx files (recursive), relative to cwd. */
  srcDir: string;
  /** Output directory for JSON and report files. Default: "out". */
  outDir: string;
  /** Cosine similarity threshold above which two components are flagged (0..1). Default: 0.85. */
  threshold: number;
  /** OpenAI embedding model. Default: "text-embedding-3-small". */
  model: string;
  /** Max parallel embedding requests. Default: 8. */
  concurrency: number;
}

export type UserCsaConfig = Partial<CsaConfig> & Pick<CsaConfig, 'srcDir'>;

const DEFAULTS: Omit<CsaConfig, 'srcDir'> = {
  outDir: 'out',
  threshold: 0.85,
  model: 'text-embedding-3-small',
  concurrency: 8,
};

const CONFIG_CANDIDATES = [
  'components.config.js',
  'components.config.mjs',
  'components.config.json',
];

function findConfigPath(explicit?: string): string {
  const candidate = explicit ?? process.env.CSA_CONFIG;
  if (candidate) {
    const abs = resolve(process.cwd(), candidate);
    if (!existsSync(abs)) throw new Error(`Config not found at ${abs}`);
    return abs;
  }
  for (const name of CONFIG_CANDIDATES) {
    const abs = resolve(process.cwd(), name);
    if (existsSync(abs)) return abs;
  }
  throw new Error(
    'No config found. Create components.config.js (see components.config.example.js) or set CSA_CONFIG.',
  );
}

export async function loadConfig(explicit?: string): Promise<CsaConfig> {
  const configPath = findConfigPath(explicit);
  const mod = await import(pathToFileURL(configPath).href);
  const user = (mod.default ?? mod) as UserCsaConfig;
  if (!user.srcDir) throw new Error('Config: "srcDir" is required.');
  return { ...DEFAULTS, ...user, srcDir: user.srcDir };
}
