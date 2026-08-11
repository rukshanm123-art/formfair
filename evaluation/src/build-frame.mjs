/**
 * Protocol section 1. Extracts the sampling frame from the archived CWAC "Website
 * scores" page into frame.csv, and writes the provenance record.
 *
 * The extraction is committed as a script rather than done by hand so the frame can be
 * rebuilt from the archived page and checked against this output. It asserts the counts
 * it expects: a silent mis-parse that quietly dropped agencies or websites would change
 * the sampling frame, and every draw position with it.
 *
 *   node src/build-frame.mjs frame/cwac-website-scores-2026-08-11.html
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Counts observed in the live page at retrieval, asserted against the parse. */
export const EXPECTED = { agencies: 45, websites: 504, notScanned: 13 };

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)));
}

const stripTags = (html) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Website cell text, with the two artefacts the page adds for screen readers and print
 * removed: the " (external link)" suffix and the "[Link: n]" print reference. Neither is
 * part of the website's name.
 */
function websiteName(cellHtml) {
  return stripTags(
    cellHtml
      .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '')
      .replace(/<sup[^>]*>[\s\S]*?<\/sup>/g, '')
  );
}

export function parseFrame(html) {
  const agencies = [];
  const detailsPattern = /<details id="(details-[^"]+)"[^>]*>([\s\S]*?)<\/details>/g;

  for (const [, id, block] of html.matchAll(detailsPattern)) {
    // Only accordions carrying a CWAC scores table are agencies. The page also uses this
    // component for explanatory panels ("How the scores are calculated"), which have an
    // accordion title but no table and must not enter the frame.
    if (!/class="[^"]*table-cwac/.test(block)) continue;

    const title = block.match(/<span class="accordion-title">([\s\S]*?)<\/span>/);
    if (!title) throw new Error(`no accordion title in ${id}`);
    const agency = stripTags(title[1]);

    const websites = [];
    const body = block.match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (!body) throw new Error(`no table body in ${id}`);

    for (const [, row] of body[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const header = row.match(/<th[^>]*>([\s\S]*?)<\/th>/);
      if (!header) continue;
      const url = header[1].match(/href="([^"]+)"/);
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
      const [score = '', change = '', pagesScanned = '', viewsWithIssues = '', totalIssues = ''] = cells;
      websites.push({
        website: websiteName(header[1]),
        url: url ? decodeEntities(url[1]) : '',
        score,
        change,
        pagesScanned,
        viewsWithIssues,
        totalIssues,
        // Kept in the frame deliberately: an unscanned site is still a monitored site,
        // and excluding it would narrow the population after the frame was fixed.
        notScanned: /^not scanned$/i.test(score),
      });
    }
    agencies.push({ id, agency, websites });
  }

  return agencies;
}

export function assertCounts(agencies, expected = EXPECTED) {
  const websites = agencies.reduce((n, a) => n + a.websites.length, 0);
  const notScanned = agencies.reduce((n, a) => n + a.websites.filter((w) => w.notScanned).length, 0);
  const actual = { agencies: agencies.length, websites, notScanned };
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `frame parse mismatch: expected ${expected[key]} ${key}, found ${actual[key]}. ` +
          'The archived page and this parser disagree; the frame must not be built until they agree.'
      );
    }
  }
  const empty = agencies.filter((a) => a.websites.length === 0);
  if (empty.length > 0) throw new Error(`agencies with no website: ${empty.map((a) => a.agency).join(', ')}`);
  return actual;
}

const csvField = (v) => (/[",\n]/.test(v) ? `"${String(v).replaceAll('"', '""')}"` : String(v));

export function toCsv(agencies, meta) {
  const lines = [
    '# FormFair Held-Out Evaluation Protocol v1.0, section 1',
    `# source_url=${meta.sourceUrl}`,
    `# retrieved_utc=${meta.retrievedUtc}`,
    `# scan_date=${meta.scanDate}`,
    `# page_sha256=${meta.pageSha256}`,
    `# agencies=${agencies.length}`,
    `# websites=${agencies.reduce((n, a) => n + a.websites.length, 0)}`,
    'agency,website,url,score,change,pages_scanned,views_with_issues,total_issues,not_scanned',
  ];
  for (const a of agencies) {
    for (const w of a.websites) {
      lines.push(
        [a.agency, w.website, w.url, w.score, w.change, w.pagesScanned, w.viewsWithIssues, w.totalIssues, w.notScanned]
          .map(csvField)
          .join(',')
      );
    }
  }
  return lines.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pagePath = process.argv[2] ?? 'frame/cwac-website-scores-2026-08-11.html';
  const outDir = dirname(pagePath);
  const raw = readFileSync(pagePath);
  const meta = {
    sourceUrl:
      'https://www.digital.govt.nz/standards-and-guidance/nz-government-web-standards/' +
      'centralised-web-accessibility-checker-cwac/website-scores-cwac',
    retrievedUtc: process.env.RETRIEVED_UTC ?? '2026-08-11T05:18:19Z',
    scanDate: '2026-06-30',
    pageSha256: sha256(raw),
    pageBytes: raw.length,
    pageFile: basename(pagePath),
  };

  const agencies = parseFrame(raw.toString('utf8'));
  const counts = assertCounts(agencies);

  const csv = toCsv(agencies, meta);
  writeFileSync(join(outDir, 'frame.csv'), csv);

  const provenance = {
    protocol: 'FormFair Held-Out Evaluation Protocol v1.0, section 1',
    ...meta,
    scanDateStatement: 'Website scores are based on the 30 June 2026 scan.',
    retrievalMethod:
      'Loaded in a browser and saved as the rendered document.documentElement.outerHTML. ' +
      'The site is behind an Imperva JS challenge, so a plain HTTP client receives a stub ' +
      'rather than the page; no attempt was made to defeat that.',
    counts,
    excludedAccordions: [
      { id: 'details-0', title: 'How the scores are calculated', reason: 'explanatory panel, not an agency' },
      { id: 'details-1', title: 'Scores are based on a random sample of web pages', reason: 'explanatory panel, not an agency' },
    ],
    frameCsvSha256: sha256(Buffer.from(csv, 'utf8')),
  };
  writeFileSync(join(outDir, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');

  console.log(`agencies:   ${counts.agencies}`);
  console.log(`websites:   ${counts.websites} (${counts.notScanned} not scanned, retained)`);
  console.log(`page hash:  ${meta.pageSha256}`);
  console.log(`frame hash: ${provenance.frameCsvSha256}`);
}
