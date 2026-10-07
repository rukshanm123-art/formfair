/**
 * Synthetic examples for the demonstration interface.
 *
 * Every one of these is written for this page. None is captured from a real website, and
 * none is drawn from the evaluation corpus: the corpus is held out, and previewing it
 * through a demonstration page would be exactly the kind of early look the protocol's
 * seal exists to prevent. These are illustrations of constraint shapes, not evidence.
 */

export interface Example {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly html: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'ascii-only',
    title: 'ASCII-only pattern',
    note: 'A pattern restricting input to unaccented Latin letters. Rejects Māori macrons, and any name carrying a diacritic.',
    html: `<form>
  <label for="given">First name</label>
  <input id="given" name="given_name" type="text" pattern="[A-Za-z]+" required>

  <label for="family">Last name</label>
  <input id="family" name="family_name" type="text" pattern="[A-Za-z]+" required>
</form>`,
  },
  {
    id: 'no-punctuation',
    title: 'Letters only, no punctuation',
    note: "Excludes the apostrophe and hyphen that appear in many names, often added as an injection defence.",
    html: `<form>
  <label for="full">Full name</label>
  <input id="full" name="fullName" type="text" pattern="[a-zA-Z ]{2,40}">
</form>`,
  },
  {
    id: 'min-length',
    title: 'Minimum length above one',
    note: 'Single-character given names exist. A minimum of two characters refuses them.',
    html: `<form>
  <label for="name">Your name</label>
  <input id="name" name="name" type="text" minlength="2" maxlength="50" required>
</form>`,
  },
  {
    id: 'short-max',
    title: 'Short maximum length',
    note: 'A low maximum truncates long names. Reported as an advisory rather than a finding: markup alone cannot witness a name being refused.',
    html: `<form>
  <label for="surname">Surname</label>
  <input id="surname" name="surname" type="text" maxlength="15">
</form>`,
  },
  {
    id: 'near-miss',
    title: 'Unicode-aware, but one character short',
    note: "A careful pattern: letters from any script, marks, spaces, the ASCII apostrophe and a hyphen. It still rejects O\u2019Brien, because that name is normally written with U+2019, not U+0027. This is the case the catalogue exists to catch.",
    html: `<form>
  <label for="name">Full name</label>
  <input id="name" name="name" type="text"
         pattern="[\\p{L}\\p{M} '\\-]+" required>
</form>`,
  },
  {
    id: 'unicode-aware',
    title: 'Unicode-aware pattern (no findings)',
    note: 'The same pattern with U+2019 admitted as well. No rule reports a finding. One rule still declines, because a Unicode property escape cannot be enumerated - a decline is reported rather than passed over in silence.',
    html: `<form>
  <label for="name">Full name</label>
  <input id="name" name="name" type="text"
         pattern="[\\p{L}\\p{M} '\u2019\\-]+" required>
</form>`,
  },
  {
    id: 'mixed',
    title: 'Several controls together',
    note: 'A registration form mixing a constrained name field, an unconstrained one and an email field, to show how findings are attributed per control.',
    html: `<form>
  <label for="preferred">Preferred name</label>
  <input id="preferred" name="preferred_name" type="text" pattern="[A-Za-z]{2,}">

  <label for="legal">Legal name</label>
  <input id="legal" name="legal_name" type="text">

  <label for="email">Email</label>
  <input id="email" name="email" type="email" required>
</form>`,
  },
];
