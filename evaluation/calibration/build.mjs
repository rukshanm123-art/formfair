/**
 * Generates the calibration pages and the answer key from calibration/controls.mjs.
 *
 * Deterministic: no randomness anywhere, so the same corpus is produced on every machine
 * and the exercise can be reproduced by an examiner. Run with --write to emit files.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME_CONTROLS, NON_NAME_CONTROLS, RULES } from './controls.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PAGES = 6;

const NAME_FIELDS = [
  { label: 'First name', name: 'firstName', autocomplete: 'given-name' },
  { label: 'Last name', name: 'lastName', autocomplete: 'family-name' },
  { label: 'Given name', name: 'givenName', autocomplete: 'given-name' },
  { label: 'Family name', name: 'familyName', autocomplete: 'family-name' },
  { label: 'Preferred name', name: 'preferredName', autocomplete: 'nickname' },
  { label: 'Full name', name: 'fullName', autocomplete: 'name' },
];

const attr = (k, v) => (v === undefined ? '' : ` ${k}="${String(v).replace(/"/g, '&quot;')}"`);

function nameMarkup(c, i) {
  const f = NAME_FIELDS[i % NAME_FIELDS.length];
  const id = `c-${c.id}`;
  return (
    `<label for="${id}">${f.label}</label>` +
    `<input id="${id}" name="${f.name}" autocomplete="${f.autocomplete}" type="text"` +
    attr('pattern', c.pattern) +
    attr('minlength', c.minlength) +
    attr('maxlength', c.maxlength) +
    '>'
  );
}

// Interleaved one-for-one so no page is all names or all distractors, and an annotator
// cannot infer a label from position. Deterministic, not shuffled.
const rows = [];
for (let i = 0; i < Math.max(NAME_CONTROLS.length, NON_NAME_CONTROLS.length); i++) {
  if (NAME_CONTROLS[i]) rows.push({ kind: 'name', c: NAME_CONTROLS[i], i });
  if (NON_NAME_CONTROLS[i]) rows.push({ kind: 'non-name', c: NON_NAME_CONTROLS[i], i });
}

const perPage = Math.ceil(rows.length / PAGES);
const pages = [];
for (let p = 0; p < PAGES; p++) pages.push(rows.slice(p * perPage, (p + 1) * perPage));

const key = { exercise: 'calibration-v1.0.0', catalogue: 'catalogue-v1.0.0', pages: [] };
const files = [];

pages.forEach((rowsOnPage, p) => {
  const pageId = `calibration-${String(p + 1).padStart(3, '0')}`;
  const body = rowsOnPage
    .map((r) => (r.kind === 'name' ? nameMarkup(r.c, r.i) : r.c.markup))
    .map((m) => `    <p>${m}</p>`)
    .join('\n');

  files.push([
    `${pageId}.html`,
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Calibration page ${p + 1}</title></head>
<body>
  <h1>Calibration page ${p + 1}</h1>
  <p>Synthetic. Not a real form, and not from any agency.</p>
  <form action="#" method="post">
${body}
    <button type="submit">Submit</button>
  </form>
</body>
</html>
`,
  ]);

  key.pages.push({
    pageId,
    controls: rowsOnPage.map((r) => {
      const base = { controlId: `c-${r.c.id}`, calibrationId: r.c.id };
      if (r.kind !== 'name') {
        return { ...base, stageOne: 'negative', basis: `Not a natural person's name: ${r.c.why}.` };
      }
      const rules = {};
      RULES.forEach((rule, ri) => {
        rules[rule] = r.c.labels[ri] === '+' ? 'positive' : 'negative';
      });
      return {
        ...base,
        stageOne: 'positive',
        basis: `Personal-name control. ${r.c.note}.`,
        pattern: r.c.pattern,
        minlength: r.c.minlength ?? null,
        maxlength: r.c.maxlength ?? null,
        rules,
      };
    }),
  });
});

const counts = {
  pages: key.pages.length,
  stageOnePositive: NAME_CONTROLS.length,
  stageOneNegative: NON_NAME_CONTROLS.length,
  perRule: Object.fromEntries(
    RULES.map((r, i) => [
      r,
      {
        positive: NAME_CONTROLS.filter((c) => c.labels[i] === '+').length,
        negative: NAME_CONTROLS.filter((c) => c.labels[i] === '-').length,
      },
    ])
  ),
};
key.counts = counts;

if (process.argv.includes('--write')) {
  const outPages = join(here, 'pages');
  mkdirSync(outPages, { recursive: true });
  for (const [name, html] of files) writeFileSync(join(outPages, name), html, 'utf8');
  writeFileSync(join(here, 'answer-key.json'), JSON.stringify(key, null, 2) + '\n', 'utf8');
  console.log(`wrote ${files.length} pages and answer-key.json`);
} else {
  console.log('dry run; pass --write to emit. Summary:');
}
console.log(JSON.stringify(counts, null, 2));
