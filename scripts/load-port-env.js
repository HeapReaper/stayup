// Preloaded (via NODE_OPTIONS="--require ./scripts/load-port-env.js") by the
// `dev`/`start` npm scripts so `next`'s CLI sees PORT *before* it parses argv
// to pick a default port.
//
// Why this exists: Next's CLI resolves its `-p`/`--port` default from
// process.env.PORT synchronously while commander parses argv, which happens
// before Next's own env loader (@next/env) ever reads .env — so a bare
// `next dev`/`next start` can never pick up a PORT set only in .env, only one
// already exported in the real shell environment (e.g. by Docker Compose's
// `env_file:`). This script closes that gap for local/non-Docker runs by
// reading .env's PORT line directly and exporting it before Next starts.
//
// Deliberately narrow: it does NOT replace @next/env — every other .env
// variable is still loaded the normal way, at the normal time. It only ever
// sets PORT, and only if PORT isn't already a real env var (so Docker
// Compose's env_file-provided PORT — or any explicit `PORT=1234 npm run
// dev` — always wins over whatever's in .env).
//
// Also has to be a plain `--require` preload, not `--env-file`/
// `--env-file-if-exists`: `next dev` re-execs itself into a child process and
// reconstructs NODE_OPTIONS from the parent's execArgv for that child, and
// Node explicitly disallows `--env-file*` inside NODE_OPTIONS — so that flag
// crashes the forked child on startup. `--require` is allow-listed and safe
// to re-apply in the child (setting the same PORT twice is a no-op).
if (!process.env.PORT) {
  const fs = require('node:fs');
  const path = require('node:path');

  const envPath = path.resolve(process.cwd(), '.env');
  let contents;
  try {
    contents = fs.readFileSync(envPath, 'utf8');
  } catch {
    return; // no .env — fall back to Next's built-in default (3000)
  }

  const match = contents.match(/^\s*PORT\s*=\s*(.*)\s*$/m);
  if (match) {
    process.env.PORT = match[1].trim().replace(/^["']|["']$/g, '');
  }
}
