/**
 * Pre-data synthetic cases for the solo technical evaluation.
 *
 * These are seeded faults, not observations from government forms and not an
 * independently labelled ground truth. Each mutant records an executable browser
 * behaviour check as well as the FormFair rule it is intended to exercise.
 */

export const RULE_IDS = ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05'];

const PERMISSIVE = String.raw`[\p{L}\p{M}\u0027\u2019 \x2D]+`;

export function form(attrs, variant = 0) {
  const signals = [
    `<label for="person-${variant}">Full name</label><input id="person-${variant}" ${attrs}>`,
    `<input autocomplete="name" aria-label="Your name" ${attrs}>`,
    `<label>Legal name <input ${attrs}></label>`,
    `<input name="givenName" ${attrs}>`,
    `<input autocomplete="family-name" ${attrs}>`,
  ];
  return `<form>${signals[variant % signals.length]}</form>`;
}

const mutation = (id, rule, family, baselineAttrs, mutantAttrs, browser) => ({
  id,
  rule,
  family,
  baselineHtml: form(baselineAttrs, Number(id.split('-').at(-1)) || 0),
  mutantHtml: form(mutantAttrs, Number(id.split('-').at(-1)) || 0),
  browser,
});

/**
 * Five structurally different seeded faults per rule. Repetition across different name
 * signals is deliberate: it checks that the rule layer is not accidentally coupled to
 * one particular stage-one signal, while `family` prevents that repetition being hidden.
 */
export const MUTATION_CASES = [
  mutation('FF01-1', 'FF-01', 'ASCII ranges', `pattern="${PERMISSIVE}"`, 'pattern="[A-Za-z]+"', {
    pattern: '[A-Za-z]+', accepts: ['Smith'], rejects: ['Tāwhiao'],
  }),
  mutation('FF01-2', 'FF-01', 'hexadecimal ASCII ranges', `pattern="${PERMISSIVE}"`, String.raw`pattern="[\x41-\x5A\x61-\x7A]+"`, {
    pattern: String.raw`[\x41-\x5A\x61-\x7A]+`, accepts: ['Ana'], rejects: ['Émile'],
  }),
  mutation('FF01-3', 'FF-01', 'fixed ASCII positions', `pattern="${PERMISSIVE}"`, 'pattern="[A-Z][a-z]+"', {
    pattern: '[A-Z][a-z]+', accepts: ['Smith'], rejects: ['Łukasz'],
  }),
  mutation('FF01-4', 'FF-01', 'lowercase ASCII only', `pattern="${PERMISSIVE}"`, 'pattern="[a-z]+"', {
    pattern: '[a-z]+', accepts: ['ana'], rejects: ['ngātā'],
  }),
  mutation('FF01-5', 'FF-01', 'ASCII with punctuation', `pattern="${PERMISSIVE}"`, String.raw`pattern="[A-Za-z\u0027 \x2D]+"`, {
    pattern: String.raw`[A-Za-z\u0027 \x2D]+`, accepts: ["Anne-Marie"], rejects: ['Ngātā'],
  }),

  mutation('FF02-1', 'FF-02', 'macron-only extension', `pattern="${PERMISSIVE}"`, String.raw`pattern="[A-Za-z\u0101]+"`, {
    pattern: String.raw`[A-Za-z\u0101]+`, accepts: ['ā'], rejects: ['é'],
  }),
  mutation('FF02-2', 'FF-02', 'Latin-1 extension only', `pattern="${PERMISSIVE}"`, String.raw`pattern="[A-Za-z\u00C0-\u00FF]+"`, {
    pattern: String.raw`[A-Za-z\u00C0-\u00FF]+`, accepts: ['É'], rejects: ['ā'],
  }),
  mutation('FF02-3', 'FF-02', 'Polish letters only', `pattern="${PERMISSIVE}"`, String.raw`pattern="[A-Za-z\u0141\u0142]+"`, {
    pattern: String.raw`[A-Za-z\u0141\u0142]+`, accepts: ['Ł'], rejects: ['ễ'],
  }),
  mutation('FF02-4', 'FF-02', 'Vietnamese range only', `pattern="${PERMISSIVE}"`, String.raw`pattern="[A-Za-z\u1E00-\u1EFF]+"`, {
    pattern: String.raw`[A-Za-z\u1E00-\u1EFF]+`, accepts: ['ễ'], rejects: ['ā'],
  }),
  mutation('FF02-5', 'FF-02', 'modifier-letter extension only', `pattern="${PERMISSIVE}"`, String.raw`pattern="[A-Za-z\u02BB]+"`, {
    pattern: String.raw`[A-Za-z\u02BB]+`, accepts: ['ʻ'], rejects: ['ü'],
  }),

  mutation('FF03-1', 'FF-03', 'precomposed letters without marks', `pattern="${PERMISSIVE}"`, String.raw`pattern="[A-Za-z\u00C0-\u00FF]+"`, {
    pattern: String.raw`[A-Za-z\u00C0-\u00FF]+`, accepts: ['Émile'], rejects: ['E\u0301mile'],
  }),
  mutation('FF03-2', 'FF-03', 'maxlength five boundary', '', 'maxlength="5"', {
    accepts: ['Émile'], rejects: ['E\u0301mile'], maxlength: 5,
  }),
  mutation('FF03-3', 'FF-03', 'maxlength six boundary', '', 'maxlength="6"', {
    accepts: ['Müller'], rejects: ['Mu\u0308ller'], maxlength: 6,
  }),
  mutation('FF03-4', 'FF-03', 'maxlength seven boundary', '', 'maxlength="7"', {
    accepts: ['Tāwhiao'], rejects: ['Ta\u0304whiao'], maxlength: 7,
  }),
  mutation('FF03-5', 'FF-03', 'Unicode letters without combining marks', `pattern="${PERMISSIVE}"`, String.raw`pattern="[\p{L}]+"`, {
    pattern: String.raw`[\p{L}]+`, accepts: ['Émile'], rejects: ['E\u0301mile'],
  }),

  mutation('FF04-1', 'FF-04', 'letters only', `pattern="${PERMISSIVE}"`, String.raw`pattern="[\p{L}\p{M}]+"`, {
    pattern: String.raw`[\p{L}\p{M}]+`, accepts: ['Smith'], rejects: ["O'Brien"],
  }),
  mutation('FF04-2', 'FF-04', 'space but no apostrophe or hyphen', `pattern="${PERMISSIVE}"`, String.raw`pattern="[\p{L}\p{M} ]+"`, {
    pattern: String.raw`[\p{L}\p{M} ]+`, accepts: ['van der Berg'], rejects: ['Anne-Marie'],
  }),
  mutation('FF04-3', 'FF-04', 'apostrophes but no space or hyphen', `pattern="${PERMISSIVE}"`, String.raw`pattern="[\p{L}\p{M}\u0027\u2019]+"`, {
    pattern: String.raw`[\p{L}\p{M}\u0027\u2019]+`, accepts: ["O'Brien"], rejects: ['van der Berg'],
  }),
  mutation('FF04-4', 'FF-04', 'hyphen and space but no apostrophe', `pattern="${PERMISSIVE}"`, String.raw`pattern="[\p{L}\p{M} \x2D]+"`, {
    pattern: String.raw`[\p{L}\p{M} \x2D]+`, accepts: ['Anne-Marie'], rejects: ['O’Connor'],
  }),
  mutation('FF04-5', 'FF-04', 'ASCII letters and space', `pattern="${PERMISSIVE}"`, 'pattern="[A-Za-z ]+"', {
    pattern: '[A-Za-z ]+', accepts: ['Mary Jane'], rejects: ['Anne-Marie'],
  }),

  mutation('FF05-1', 'FF-05', 'minlength two', 'minlength="1"', 'minlength="2"', {
    accepts: ['Al'], rejects: ['I'], minlength: 2,
  }),
  mutation('FF05-2', 'FF-05', 'minlength three', 'minlength="1"', 'minlength="3"', {
    accepts: ['Ana'], rejects: ['I'], minlength: 3,
  }),
  mutation('FF05-3', 'FF-05', 'bounded pattern minimum', 'pattern="[A-Za-z]+"', 'pattern="[A-Za-z]{2,40}"', {
    pattern: '[A-Za-z]{2,40}', accepts: ['Li'], rejects: ['I'],
  }),
  mutation('FF05-4', 'FF-05', 'two required positions', 'pattern="[A-Za-z]+"', 'pattern="[A-Za-z][A-Za-z]"', {
    pattern: '[A-Za-z][A-Za-z]', accepts: ['Li'], rejects: ['I'],
  }),
  mutation('FF05-5', 'FF-05', 'fixed length three', 'pattern="[A-Za-z]+"', 'pattern="[A-Za-z]{3}"', {
    pattern: '[A-Za-z]{3}', accepts: ['Ana'], rejects: ['I'],
  }),
];

export const METAMORPHIC_CASES = [
  {
    id: 'MR-01',
    relation: 'wrapping the same control in neutral markup does not change rule outcomes',
    source: form('pattern="[A-Za-z]{2,40}"'),
    followUp: `<main><section>${form('pattern="[A-Za-z]{2,40}"')}</section></main>`,
  },
  {
    id: 'MR-02',
    relation: 'an unrelated email input does not change rule outcomes for the name control',
    source: form(String.raw`pattern="[\p{L}]+"`),
    followUp: `${form(String.raw`pattern="[\p{L}]+"`)}<input type="email" name="email">`,
  },
  {
    id: 'MR-03',
    relation: 'adding required does not alter any catalogue rule',
    source: form(String.raw`pattern="[\p{L}]+"`),
    followUp: form(String.raw`required pattern="[\p{L}]+"`),
  },
  {
    id: 'MR-04',
    relation: 'redundant anchors do not alter HTML pattern outcomes',
    source: form('pattern="[A-Za-z]+"'),
    followUp: form('pattern="^[A-Za-z]+$"'),
  },
  {
    id: 'MR-05',
    relation: 'attribute order does not alter rule outcomes',
    source: form('pattern="[A-Za-z]+" minlength="2" maxlength="40"'),
    followUp: form('maxlength="40" minlength="2" pattern="[A-Za-z]+"'),
  },
];

export const FUZZ_PATTERNS = [
  undefined,
  '',
  '[A-Za-z]+',
  String.raw`[\p{L}\p{M}\u0027\u2019 \x2D]+`,
  String.raw`[A-Za-z\u00C0-\u00FF]+`,
  '[A-Za-z]{1,3}',
  '[A-Za-z]{2,40}',
  '[0-9]{1}',
  '(?:[A-Za-z]+ )?[A-Za-z]+',
  '[A-Za-z]+|[0-9]+',
  '(?=.{2,})[A-Za-z]+',
  "[A-Za-z' -]+",
  '[',
  String.raw`[\q{abc}]`,
];
