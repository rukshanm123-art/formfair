/**
 * Protocol section 2. A reproducible agency order, fixed before any form is visited.
 *
 * The order is a pure function of the tag, the frame's hash and the agency name, so it
 * can be recomputed by anyone holding the frame and cannot be quietly re-rolled: any
 * change to the frame changes every position at once, visibly.
 */

import { createHash } from 'node:crypto';

export const DRAW_TAG = 'evaluation-v1.0.0';

export function drawKey(agencyName, frameSha256, tag = DRAW_TAG) {
  return createHash('sha256').update(`${tag}|${frameSha256}|${agencyName}`, 'utf8').digest('hex');
}

/**
 * Agencies in draw order. Sorted by exact name first so the input order of frame.csv
 * cannot influence the result, then by the draw key. Ties break on name, which keeps the
 * function total even in the impossible case of a hash collision.
 */
export function drawOrder(agencies, frameSha256, tag = DRAW_TAG) {
  const names = [...new Set(agencies.map((a) => a.trim()))].filter(Boolean);
  if (names.length !== agencies.length) {
    // Not fatal, but the frame should be clean; the caller reports it.
  }
  return names
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((agency) => ({ agency, key: drawKey(agency, frameSha256, tag) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.agency < b.agency ? -1 : 1))
    .map((row, index) => ({ position: index + 1, ...row }));
}

/**
 * Reads the first field of a CSV line, honouring quoting.
 *
 * Splitting on the first comma silently truncates any agency whose name contains one -
 * "Ministry of Business, Innovation and Employment" becomes "Ministry of Business" -
 * and since the draw key is computed from the exact name, that would corrupt the frozen
 * order without any visible error.
 */
export function firstField(line) {
  if (line[0] !== '"') return (line.split(',')[0] ?? '').trim();
  let out = '';
  for (let i = 1; i < line.length; i++) {
    if (line[i] === '"') {
      if (line[i + 1] === '"') { out += '"'; i++; continue; }
      break;
    }
    out += line[i];
  }
  return out.trim();
}

export function toCsv(rows, frameSha256, tag = DRAW_TAG) {
  const header = [
    `# FormFair Held-Out Evaluation Protocol v1.0, section 2`,
    `# tag=${tag}`,
    `# frame_sha256=${frameSha256}`,
    `# agencies=${rows.length}`,
    'position,agency,draw_key',
  ];
  const body = rows.map((r) => `${r.position},${csvField(r.agency)},${r.key}`);
  return [...header, ...body].join('\n') + '\n';
}

function csvField(value) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
