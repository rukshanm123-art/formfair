#!/usr/bin/env node
/**
 * The capture harness must not be able to analyse anything.
 *
 * If it could, a page could be judged before the corpus that contains it was sealed, and
 * the seal's whole purpose is that no output is seen first. This checks imports rather
 * than grepping for a product name, because "formfair" appears legitimately in schema
 * identifiers and temporary directory names and a name-based grep fails on both.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Modules that would give this package the ability to produce findings. */
const FORBIDDEN = [
  /\bfrom\s+['"][^'"]*\bdist\/(index|node)\.js['"]/,
  /\bfrom\s+['"]formfair(\/|['"])/,
  /\bfrom\s+['"][^'"]*evaluation\/src\//,
  /\brequire\(\s*['"][^'"]*\bdist\/(index|node)\.js['"]/,
  /\brequire\(\s*['"]formfair(\/|['"])/,
];

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (full.endsWith('.mjs')) files.push(full);
  }
})(here);

const offences = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (FORBIDDEN.some((p) => p.test(line))) offences.push(`${file}:${i + 1}: ${line.trim()}`);
  });
}

if (offences.length) {
  console.error('the capture harness must not import the analyser:');
  for (const o of offences) console.error(`  ${o}`);
  process.exit(1);
}
console.log(`checked ${files.length} files: no analyser import.`);
