/**
 * Protocol section 7. The neutral control inventory.
 *
 * Annotators label this inventory, not whatever FormFair happened to find. It is built
 * before annotation and frozen, so the set of things being judged cannot be influenced
 * by the tool's output.
 *
 * It is parsed with the instrument's own pinned parse5, from the exact captured bytes.
 * A different parser, or a different version, can report different source positions, and
 * a position that disagrees with the analyser's would break the join silently.
 *
 * Line and column alone are too weak an identity: two inputs can share a position after
 * a whitespace change, and a position can move if the bytes are ever re-saved. Each
 * record therefore also carries the SHA-256 of the element's exact source slice, and the
 * join requires page, position and snippet hash to agree together.
 */

import { createHash } from 'node:crypto';

export const sha256 = (text) =>
  createHash('sha256').update(typeof text === 'string' ? Buffer.from(text, 'utf8') : text).digest('hex');

/** Protocol section 7: the only controls the frozen stage one considers. */
export function isSupportedInput(tagName, attrs) {
  if (tagName !== 'input') return false;
  const type = attrs.find((a) => a.name.toLowerCase() === 'type');
  if (type === undefined) return true;
  const value = type.value.trim().toLowerCase();
  return value === '' || value === 'text' || value === 'search';
}

function normalisedType(attrs) {
  const type = attrs.find((a) => a.name.toLowerCase() === 'type');
  if (type === undefined) return null;
  const value = type.value.trim().toLowerCase();
  return value === '' ? '' : value;
}

/**
 * Builds the inventory for one captured page.
 *
 * `parseFragment` is injected rather than imported so this module stays free of any
 * import that must resolve at load time; the caller supplies the instrument's parse5.
 */
export function buildInventory({ html, pageId, parseFragment, parserVersion }) {
  const htmlSha256 = sha256(html);
  const doc = parseFragment(html, { sourceCodeLocationInfo: true });
  const controls = [];

  const walk = (node) => {
    if (node.tagName && isSupportedInput(node.tagName, node.attrs ?? [])) {
      const loc = node.sourceCodeLocation;
      const snippet =
        loc && loc.startOffset != null && loc.endOffset != null
          ? html.slice(loc.startOffset, loc.endOffset)
          : '';
      const ordinal = controls.length;
      controls.push({
        controlId: `${pageId}#c${String(ordinal).padStart(3, '0')}`,
        pageId,
        ordinal,
        line: loc?.startLine ?? 0,
        column: loc?.startCol ?? 0,
        snippetSha256: sha256(snippet),
        inputType: normalisedType(node.attrs ?? []),
      });
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(doc);

  return {
    instrument: 'evaluation-v1.0.0',
    pageId,
    htmlSha256,
    parser: `parse5 ${parserVersion}`,
    controls,
  };
}

/**
 * Matches one detected control, as `findNameControls` reported it, to exactly one
 * inventory record. Ambiguity is an error rather than a best guess: scoring against the
 * wrong record would silently move a label from one control to another.
 */
export function matchDetected(inventory, source) {
  const candidates = inventory.controls.filter(
    (c) =>
      c.line === source.line &&
      c.column === source.column &&
      c.snippetSha256 === sha256(source.snippet ?? '')
  );
  if (candidates.length === 1) return { matched: candidates[0] };
  if (candidates.length === 0) {
    const nearby = inventory.controls.filter((c) => c.line === source.line && c.column === source.column);
    return {
      error:
        `no inventory record at line ${source.line}, column ${source.column} with a matching ` +
        `snippet hash` +
        (nearby.length
          ? '. A record exists at that position but its snippet differs, so the captured ' +
            'bytes and the analysed bytes are not the same.'
          : '. The analyser saw a control the inventory does not contain.'),
    };
  }
  return {
    error:
      `${candidates.length} inventory records match line ${source.line}, column ` +
      `${source.column} and that snippet. The identity is ambiguous and cannot be scored.`,
  };
}
