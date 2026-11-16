// RUSTLINE — entrypoint for the make.fun threejs-fps-02 bounty.
// Node 22, standard library only. The playable game is the static files in
// game/; the screenshots in screenshots/ are its cover images. This program
// hands both in: it copies them into the output directory and writes
// /output/dossier.json, the summary the judge reads, using the kit's own
// dossier builder in vendor/makefun-threejs.ts.
//
// Run it locally (no network, no build step):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play the game locally with `node serve.ts`, then open http://localhost:8080.
// In the grader, MAKEFUN_OUTPUT_DIR is unset and the output is /output.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Plain copies, so two runs write identical bytes: the dossier is built from
// the copied files alone, never from the clock or the environment.
mkdirSync(outDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// Gate caps from the kit's RULES.txt: dossier text at most 160 KiB, at most
// 4 screenshots of 256 KiB each, game/ at most 993 files and 48 MiB.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
