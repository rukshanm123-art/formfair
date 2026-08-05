import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { NameControl, SourceRef } from '../types.js';

type Element = DefaultTreeAdapterMap['element'];
type Node = DefaultTreeAdapterMap['node'];

const NAME_AUTOCOMPLETE = new Set([
  'name',
  'given-name',
  'additional-name',
  'family-name',
  'honorific-prefix',
  'honorific-suffix',
  'nickname',
]);

const NAME_HINT = /(^|[^a-z])(name|fname|lname|surname|forename|firstname|lastname|givenname|familyname)([^a-z]|$)/i;

const NOT_A_PERSON =
  /(user|file|company|business|organisation|organization|product|host|domain|brand|account|display|screen|pet|street|city|suburb|event|project)[\s_-]*name/i;

function attrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of el.attrs) out[a.name.toLowerCase()] = a.value;
  return out;
}

function isTextInput(el: Element, a: Record<string, string>): boolean {
  if (el.tagName !== 'input') return false;
  const type = (a['type'] ?? 'text').toLowerCase();
  return type === 'text' || type === 'search' || type === '';
}

/**
 * Heuristic identification of personal-name controls. Reported separately from
 * rule accuracy in the evaluation, because a control missed here is never examined
 * and its anti-patterns are silently absent from the output.
 */
export function isNameControl(el: Element, a: Record<string, string>): boolean {
  if (!isTextInput(el, a)) return false;

  const autocomplete = (a['autocomplete'] ?? '').toLowerCase().split(/\s+/).pop() ?? '';
  if (NAME_AUTOCOMPLETE.has(autocomplete)) return true;

  const haystack = [a['name'], a['id'], a['placeholder'], a['aria-label'], a['class']]
    .filter(Boolean)
    .join(' ');

  if (NOT_A_PERSON.test(haystack)) return false;
  return NAME_HINT.test(haystack);
}

function positionOf(el: Element): SourceRef {
  const loc = el.sourceCodeLocation;
  return {
    line: loc?.startLine ?? 0,
    column: loc?.startCol ?? 0,
    snippet: '',
  };
}

function intAttr(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function findNameControls(html: string): NameControl[] {
  const doc = parseFragment(html, { sourceCodeLocationInfo: true });
  const found: NameControl[] = [];

  const walk = (node: Node): void => {
    const el = node as Element;
    if (el.tagName) {
      const a = attrs(el);
      if (isNameControl(el, a)) {
        const loc = el.sourceCodeLocation;
        const snippet =
          loc && loc.startOffset != null && loc.endOffset != null
            ? html.slice(loc.startOffset, loc.endOffset)
            : '';
        found.push({
          pattern: a['pattern'] ?? null,
          minLength: intAttr(a['minlength']),
          maxLength: intAttr(a['maxlength']),
          required: 'required' in a,
          source: { ...positionOf(el), snippet },
          attrs: a,
        });
      }
    }
    for (const child of (el.childNodes ?? []) as Node[]) walk(child);
  };

  walk(doc as unknown as Node);
  return found;
}
