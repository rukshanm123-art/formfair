/**
 * The calibration corpus, defined once and used to generate both the pages annotators
 * see and the answer key they are scored against.
 *
 * EVERY LABEL HERE IS DERIVED FROM catalogue-v1.0.0 BY READING IT, not from running
 * FormFair. That direction matters: a key generated from the tool would train annotators
 * to agree with the tool, and the evaluation would then measure how well two people had
 * learned to imitate it. `cross-check.mjs` runs the frozen analyser afterwards and reports
 * disagreements for a human to resolve AGAINST THE CATALOGUE - it never rewrites the key.
 *
 * Labels are written FF-01..FF-05 as a five-character string, '+' positive, '-' negative.
 */

/** Admits all four of U+0027 U+2019 U+0020 U+002D, so FF-04 does not fire. */
const PUNCT = "'’ \\-";

export const NAME_CONTROLS = [
  // --- FF-01 positive: a decidable pattern admitting Basic Latin letters and no others.
  // FF-02 is subsumed throughout this group; FF-03 cannot fire because both the NFC and
  // NFD forms of every accented fixture name are rejected, which is symmetric treatment.
  { id: 'A01', pattern: '[A-Za-z]+', labels: '+--+-', note: 'the plainest Basic-Latin class' },
  { id: 'A02', pattern: '[A-Za-z]{2,40}', labels: '+--++', note: 'quantifier sets a minimum above one' },
  { id: 'A03', pattern: "[A-Za-z'" + ' \\-]+', labels: '+--+-', note: 'admits apostrophe but not U+2019' },
  { id: 'A04', pattern: `[A-Za-z${PUNCT}]+`, labels: '+----', note: 'all four punctuation characters admitted' },
  { id: 'A05', pattern: `[A-Za-z${PUNCT}]{2,50}`, labels: '+---+', note: 'punctuation fine, minimum is two' },
  { id: 'A06', pattern: '[A-Za-z]{3,20}', labels: '+--++', note: 'minimum of three' },
  { id: 'A07', pattern: '[A-Za-z ]+', labels: '+--+-', note: 'space admitted, apostrophe and hyphen not' },
  { id: 'A08', pattern: '[A-Za-z\\-]+', minlength: 2, labels: '+--++', note: 'explicit minlength' },
  { id: 'A09', pattern: '[A-Za-z]+', maxlength: 5, labels: '+--+-', note: 'maxlength cannot cause asymmetry when both forms are already rejected' },
  { id: 'A10', pattern: `[A-Za-z${PUNCT}]+`, minlength: 4, labels: '+---+', note: 'minlength of four' },
  { id: 'A11', pattern: '[A-Za-z]{1,30}', labels: '+--+-', note: 'minimum of one, so FF-05 does not fire' },
  { id: 'A12', pattern: `[A-Za-z${PUNCT}]{2,}`, labels: '+---+', note: 'open-ended maximum, minimum two' },

  // --- FF-01 negative: letters outside Basic Latin are admitted.
  // B01 and B02 admit combining marks as well as precomposed letters, so the macron is
  // reachable (FF-02 clean) and NFC and NFD are treated alike (FF-03 clean).
  { id: 'B01', pattern: `[\\p{L}\\p{M}${PUNCT}]+`, labels: '-----', note: 'property escapes admit the macron and combining marks alike' },
  { id: 'B02', pattern: `[\\p{L}\\p{M}${PUNCT}]{2,}`, labels: '----+', note: 'as B01, minimum of two' },

  // The rest admit PRECOMPOSED accented letters but no combining marks. Each therefore
  // accepts the NFC form of an accented fixture name and rejects its NFD form, which is
  // FF-03's trigger; and none reaches U+0101, which is FF-02's.
  { id: 'B03', pattern: '[A-Za-zÀ-ÿ]+', labels: '-+++-', note: 'Latin-1 Supplement stops short of Latin Extended-A' },
  { id: 'B04', pattern: `[A-Za-zÀ-ÿ${PUNCT}]+`, labels: '-++--', note: 'as B03 with punctuation admitted' },
  { id: 'B05', pattern: '[A-Za-zÀ-ÿ]{2,40}', labels: '-++++', note: 'as B03 with a minimum of two' },
  { id: 'B06', pattern: '[A-Za-zÉéèêëàâ]+', labels: '-+++-', note: 'a hand-listed French subset' },
  { id: 'B07', pattern: `[A-Za-zÉéèêë${PUNCT}]{2,}`, labels: '-++-+', note: 'hand-listed subset, minimum two' },
  { id: 'B08', pattern: `[A-Za-zÀ-ÿ${PUNCT}]{3,}`, labels: '-++-+', note: 'minimum of three' },
  { id: 'B09', pattern: '[A-Za-zÀ-ÿ]+', maxlength: 8, labels: '-+++-', note: 'maxlength present but not the cause of the asymmetry' },
  { id: 'B10', pattern: `[A-Za-zÀ-ÿ${PUNCT}]{2,60}`, labels: '-++-+', note: 'wide range, minimum two' },
  { id: 'B11', pattern: `[A-Za-zÉéèêëàâîô${PUNCT}]+`, minlength: 2, labels: '-++-+', note: 'explicit minlength alongside the class' },
  { id: 'B12', pattern: `[A-Za-zÁÉÍÓÚáéíóú${PUNCT}]+`, labels: '-++--', note: 'a hand-listed Spanish subset' },
];

/** Stage-one negatives. None of these collects the name of a natural person. */
export const NON_NAME_CONTROLS = [
  { id: 'N01', markup: '<label for="q">Search this site</label><input id="q" type="search" name="q">', why: 'site search' },
  { id: 'N02', markup: '<label for="u">Username</label><input id="u" name="username" autocomplete="username">', why: 'username, not a personal name' },
  { id: 'N03', markup: '<label for="org">Organisation name</label><input id="org" name="organisation">', why: 'organisation' },
  { id: 'N04', markup: '<label for="st">Street address</label><input id="st" name="street" autocomplete="street-address">', why: 'street name' },
  { id: 'N05', markup: '<label for="pet">Pet name</label><input id="pet" name="petName">', why: 'not a natural person' },
  { id: 'N06', markup: '<label for="prod">Product name</label><input id="prod" name="productName">', why: 'product' },
  { id: 'N07', markup: '<label for="city">Town or city</label><input id="city" name="city" autocomplete="address-level2">', why: 'place name' },
  { id: 'N08', markup: '<label for="dn">Display name shown to other users</label><input id="dn" name="displayName">', why: 'display name, explicitly excluded' },
  { id: 'N09', markup: '<label for="ref">Reference number</label><input id="ref" name="reference" pattern="[A-Z0-9\\-]+">', why: 'identifier' },
  { id: 'N10', markup: '<label for="sub">Subject</label><input id="sub" name="subject">', why: 'message subject' },
  { id: 'N11', markup: '<label for="bus">Trading name of your business</label><input id="bus" name="tradingName">', why: 'business name' },
  { id: 'N12', markup: '<label for="occ">Occupation</label><input id="occ" name="occupation">', why: 'occupation' },
  { id: 'N13', markup: '<label for="pc">Postcode</label><input id="pc" name="postcode" pattern="[0-9]{4}">', why: 'postcode' },
  { id: 'N14', markup: '<label for="cnt">Country</label><input id="cnt" name="country" autocomplete="country-name">', why: 'country' },
  { id: 'N15', markup: '<label for="dept">Department</label><input id="dept" name="department">', why: 'department' },
  { id: 'N16', markup: '<label for="file">File name</label><input id="file" name="fileName">', why: 'file name' },
  { id: 'N17', markup: '<label for="vehicle">Vehicle registration</label><input id="vehicle" name="plate" pattern="[A-Z0-9]{2,6}">', why: 'registration' },
  { id: 'N18', markup: '<label for="course">Course title</label><input id="course" name="courseTitle">', why: 'course title' },
  { id: 'N19', markup: '<label for="kw">Keywords</label><input id="kw" type="search" name="keywords">', why: 'search keywords' },
  { id: 'N20', markup: '<label for="role">Role or job title</label><input id="role" name="jobTitle" pattern="[A-Za-z ]+">', why: 'job title, and the constrained pattern is a distractor' },
  { id: 'N21', markup: '<label for="bank">Account nickname</label><input id="bank" name="accountNickname">', why: 'a label for an account, not a person' },
  { id: 'N22', markup: '<label for="sch">School name</label><input id="sch" name="schoolName">', why: 'institution' },
  { id: 'N23', markup: '<label for="proj">Project name</label><input id="proj" name="projectName" pattern="[A-Za-z]{2,}">', why: 'project, and the pattern is a distractor' },
  { id: 'N24', markup: '<label for="street2">Suburb</label><input id="street2" name="suburb">', why: 'place name' },
];

export const RULES = ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05'];
