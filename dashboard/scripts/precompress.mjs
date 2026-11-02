// Writes .br and .gz siblings for text files in the build output so the API can
// serve them at maximum compression (@fastify/static preCompressed) without
// compressing on every request.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const COMPRESSIBLE_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt']);
/** Below this, the saved bytes are not worth the extra request-time file lookup. */
const MIN_SIZE_BYTES = 1024;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

const distDir = process.argv[2] ?? 'dist';
let written = 0;
for (const file of walk(distDir)) {
  if (!COMPRESSIBLE_EXTENSIONS.has(extname(file)) || statSync(file).size < MIN_SIZE_BYTES) continue;
  const source = readFileSync(file);
  const brotli = brotliCompressSync(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: source.length
    }
  });
  const gzip = gzipSync(source, { level: constants.Z_BEST_COMPRESSION });
  // A sibling that is not smaller would only cost bytes; static then serves the original
  if (brotli.length < source.length) writeFileSync(`${file}.br`, brotli);
  if (gzip.length < source.length) writeFileSync(`${file}.gz`, gzip);
  written++;
}
console.log(`precompress: wrote .br/.gz for ${written} files in ${distDir}`);
