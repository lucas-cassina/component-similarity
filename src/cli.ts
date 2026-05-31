#!/usr/bin/env node
import { scan } from './scan.js';
import { embed } from './embed.js';
import { compare } from './compare.js';
import { report } from './report.js';
import { comment } from './comment.js';

const HELP = `component-similarity

Usage: csa <command>

Commands:
  scan     Scan srcDir for .tsx components  → out/components-manifest.json
  embed    Embed each component via OpenAI  → out/components-embeddings.json
  compare  Cosine similarity + clustering   → out/components-similarity.json
  report   Build the markdown report        → out/report.md
  comment  Upsert report as a sticky PR comment
  analyze  scan + embed + compare + report

Config is read from components.config.js (or $CSA_CONFIG). See components.config.example.js.`;

async function main(): Promise<void> {
  const [cmd] = process.argv.slice(2);
  switch (cmd) {
    case 'scan':    await scan();    break;
    case 'embed':   await embed();   break;
    case 'compare': await compare(); break;
    case 'report':  await report();  break;
    case 'comment': await comment(); break;
    case 'analyze':
      await scan();
      await embed();
      await compare();
      await report();
      break;
    case 'help':
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
