import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { Detection, NameControl, SourceRef } from '../types.js';

type Element = DefaultTreeAdapterMap['element'];
type Node = DefaultTreeAdapterMap['node'];
type TextNode = DefaultTreeAdapterMap['textNode'];

export const NAME_AUTOCOMPLETE = new Set([
  'name',
  'given-name',
  'additional-name',
  'family-name',
  'honorific-prefix',
  'honorific-suffix',
  'nickname',
]);

/** Tokens that say nothing about what the field holds, so they weigh neither way. */
const NEUTRAL_AUTOCOMPLETE = new Set(['', 'on', 'off']);

export const NAME_HINT =
  /(^|[^a-z])(name|fname|lname|surname|forename|firstname|lastname|givenname|familyname|fullname|middlename|preferredname|maidenname|legalname|nickname)([^a-z]|$)/i;

export const NOT_A_PERSON =
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
 * How much each place a signal can appear is worth.
 *
 * Evidence is summed rather than vetoed. An `id` of "user-name-field" on a control
 * whose `name` is "firstName" describes the widget, not the datum, and should not
 * withdraw the stronger signal; treating any negative match as decisive lost such
 * controls entirely, and a control that is never identified is never examined.
 */
const WEIGHT = {
  autocomplete: { positive: 4, negative: 4 },
  name: { positive: 4, negative: 4 },
  label: { positive: 3, negative: 3 },
  id: { positive: 2, negative: 3 },
  /** `placeholder` and `aria-label`: visible prompts, weaker than a declared name. */
  prompt: { positive: 2, negative: 2 },
  class: { positive: 1, negative: 1 },
} as const;

/** The score at which the accumulated evidence is taken to identify a name control. */
const THRESHOLD = 3;

export function scoreNameControl(
  el: Element,
  a: Record<string, string>,
  labelText = ''
): Detection {
  if (!isTextInput(el, a)) return { score: 0, signals: [] };

  let score = 0;
  const signals: string[] = [];

  const weigh = (field: keyof typeof WEIGHT, text: string | undefined): void => {
    if (!text) return;
    if (NAME_HINT.test(text)) {
      score += WEIGHT[field].positive;
      signals.push(`+${field}`);
    }
    if (NOT_A_PERSON.test(text)) {
      score -= WEIGHT[field].negative;
      signals.push(`-${field}`);
    }
  };

  const token = (a['autocomplete'] ?? '').toLowerCase().split(/\s+/).pop() ?? '';
  if (NAME_AUTOCOMPLETE.has(token)) {
    score += WEIGHT.autocomplete.positive;
    signals.push('+autocomplete');
  } else if (!NEUTRAL_AUTOCOMPLETE.has(token)) {
    // The author has declared what this field holds, and it is not a name.
    score -= WEIGHT.autocomplete.negative;
    signals.push('-autocomplete');
  }

  weigh('name', a['name']);
  weigh('label', labelText);
  weigh('id', a['id']);
  weigh('prompt', [a['placeholder'], a['aria-label']].filter(Boolean).join(' '));
  weigh('class', a['class']);

  return { score, signals };
}

/**
 * Heuristic identification of personal-name controls. Reported separately from rule
 * accuracy in the evaluation, because a control missed here is never examined and its
 * anti-patterns are silently absent from the output.
 */
export function isNameControl(
  el: Element,
  a: Record<string, string>,
  labelText = ''
): boolean {
  return scoreNameControl(el, a, labelText).score >= THRESHOLD;
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

function textOf(node: Node): string {
  if (node.nodeName === '#text') return (node as TextNode).value;
  return ((node as Element).childNodes ?? [])
    .map((child) => textOf(child as Node))
    .join(' ');
}

interface Labels {
  /** Text of every `<label for="...">` pointing at a given id. */
  readonly forId: Map<string, string[]>;
  readonly byId: Map<string, Element>;
}

function indexLabels(root: Node): Labels {
  const forId = new Map<string, string[]>();
  const byId = new Map<string, Element>();

  const walk = (node: Node): void => {
    const el = node as Element;
    if (el.tagName) {
      const a = attrs(el);
      const id = a['id'];
      if (id !== undefined && !byId.has(id)) byId.set(id, el);
      const target = a['for'];
      if (el.tagName === 'label' && target !== undefined) {
        forId.set(target, [...(forId.get(target) ?? []), textOf(el)]);
      }
    }
    for (const child of (el.childNodes ?? []) as Node[]) walk(child);
  };

  walk(root);
  return { forId, byId };
}

/**
 * The accessible label text a control carries, from all three ways markup associates
 * one: an enclosing `<label>`, a `<label for>` elsewhere in the document, and
 * `aria-labelledby`. Where the attributes name the widget rather than the datum, this
 * text is often the only place the human-facing word "name" appears.
 */
function labelTextFor(a: Record<string, string>, ancestor: string, labels: Labels): string {
  const parts = [ancestor];

  const id = a['id'];
  if (id !== undefined) parts.push(...(labels.forId.get(id) ?? []));

  for (const ref of (a['aria-labelledby'] ?? '').split(/\s+/).filter(Boolean)) {
    const target = labels.byId.get(ref);
    if (target) parts.push(textOf(target));
  }

  return parts.filter(Boolean).join(' ');
}

export function findNameControls(html: string): NameControl[] {
  const doc = parseFragment(html, { sourceCodeLocationInfo: true }) as unknown as Node;
  const labels = indexLabels(doc);
  const found: NameControl[] = [];

  const walk = (node: Node, ancestorLabel: string): void => {
    const el = node as Element;
    let label = ancestorLabel;

    if (el.tagName) {
      const a = attrs(el);
      if (el.tagName === 'label') label = [label, textOf(el)].filter(Boolean).join(' ');

      const detection = scoreNameControl(el, a, labelTextFor(a, label, labels));
      if (detection.score >= THRESHOLD) {
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
          detection,
        });
      }
    }

    for (const child of (el.childNodes ?? []) as Node[]) walk(child, label);
  };

  walk(doc, '');
  return found;
}
