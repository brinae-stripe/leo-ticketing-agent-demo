#!/usr/bin/env node
/**
 * check-names — build guard for reserved brand names.
 *
 * A small list of adjacent/competitor brand names must never appear anywhere in
 * this repository: not in code, not in copy, not in seeded data, not in docs.
 * This script walks the working tree and fails the build (exit 1) on any
 * case-insensitive match, in file contents or in file paths.
 *
 * The terms are stored here as fragment arrays and joined at runtime so that
 * this file does not itself contain a literal match.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();

const RESERVED = [
  ['le', 'ap'],
  ['show', 'cl', 'ix'],
  ['ticket', 'le', 'ap'],
  ['pat', 'ron'],
  ['green', 'copper'],
].map((parts) => parts.join(''));

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.vercel',
  'out',
  'build',
  'coverage',
  '.turbo',
]);

const SKIP_FILES = new Set(['check-names.mjs']);

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svgz',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.zip', '.gz', '.tgz', '.mp4', '.mov', '.mp3', '.wav',
  '.tsbuildinfo',
]);

/** @type {{file: string, line: number, term: string, text: string}[]} */
const hits = [];
let filesScanned = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(abs);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;

    const rel = relative(ROOT, abs);

    // Paths are checked for every file, including binaries.
    const relLower = rel.toLowerCase();
    for (const term of RESERVED) {
      if (relLower.includes(term)) {
        hits.push({ file: rel, line: 0, term, text: '<file path>' });
      }
    }

    if (BINARY_EXT.has(extname(entry.name).toLowerCase())) continue;
    if (statSync(abs).size > 8 * 1024 * 1024) continue;

    filesScanned += 1;
    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const lower = line.toLowerCase();
      for (const term of RESERVED) {
        if (lower.includes(term)) {
          hits.push({
            file: rel,
            line: i + 1,
            term,
            text: line.trim().slice(0, 160),
          });
        }
      }
    });
  }
}

walk(ROOT);

if (hits.length > 0) {
  console.error(`\ncheck:names FAILED — ${hits.length} reserved-name match(es):\n`);
  for (const hit of hits) {
    const where = hit.line === 0 ? hit.file : `${hit.file}:${hit.line}`;
    console.error(`  ${where}\n    matched "${hit.term}" in: ${hit.text}`);
  }
  console.error('\nRename or reword the above before building.\n');
  process.exit(1);
}

console.log(
  `check:names passed — scanned ${filesScanned} text files, 0 reserved-name matches.`,
);
