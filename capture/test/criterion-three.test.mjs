/**
 * Amendment 51: a personal-name field that is a SEARCH KEY does not satisfy criterion 3.
 *
 * Two Ministry for Culture and Heritage pages - `28maoribattalion.org.nz` (`d-0736`) and
 * `vietnamwar.govt.nz` (`d-0741`) - carry record-search forms whose controls are
 * `field_surname_value` labelled "Surname" and `field_forename_value` labelled "Forename(s)". Read
 * literally, those pages ask for the name of a natural person, which is what criterion 3 says.
 * They are finding aids: the name is a QUERY against existing records, not something the form
 * collects, and the frozen annotation definition already excludes search boxes. Admitting them
 * would have put a finding aid into a corpus of name-entry forms and measured the length limit of
 * a search key as though it constrained somebody's name.
 *
 * The distinction is COLLECTION as part of the form's transaction versus QUERYING existing
 * records. It is not first-party versus third-party identity - a form asking for a child's, a
 * dependent's or a representative's name collects the name of a natural person and does satisfy
 * criterion 3. Whose name it is does not matter; what the form does with it does.
 *
 * Classification is pure and reported, never decisive: nothing here admits or excludes a page. The
 * researcher still asserts criterion 3 at the approval gate, and this is the structural evidence
 * that assertion has to be consistent with - the same division of labour as Amendment 46's
 * registration affordances.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNameField, NAME_FIELD_HINT, QUERY_SUBMIT_LABEL } from '../capture.mjs';

const role = (facts) => classifyNameField(facts).role;

describe('the two finding aids that prompted this', () => {
  test('28maoribattalion.org.nz: Surname is a search key', () => {
    const f = classifyNameField({
      name: 'field_surname_value', label: 'Surname',
      formAction: '/search/results', submitLabels: ['Search'],
    });
    assert.equal(f.role, 'query');
    // The basis is recorded, because a reader auditing a criterion-3 assertion needs to see WHY.
    assert.ok(f.basis.length > 0, 'it must say what made it a search key');
  });

  test('vietnamwar.govt.nz: Forename(s) is a search key on its button alone', () => {
    // This form posts to an opaque node path, so the action proves nothing. The control that
    // submits it is labelled "Search", and that is enough.
    const f = classifyNameField({
      name: 'field_forename_value', label: 'Forename(s)',
      formAction: '/node/127', submitLabels: ['Search'],
    });
    assert.equal(f.role, 'query');
    assert.match(f.basis.join('; '), /submit control/);
  });
});

describe('forms already in the corpus keep their name fields', () => {
  // Regression cases taken from captures already approved. If this interpretation reclassified
  // any of them it would be rewriting settled findings, not clarifying a boundary.
  test('the NZDF enquiry form collects FirstName and Surname', () => {
    assert.equal(role({ name: 'FirstName', label: 'First name', formAction: '/contact/', submitLabels: ['Submit'] }), 'collection');
    assert.equal(role({ name: 'Surname', label: 'Surname', formAction: '/contact/', submitLabels: ['Submit'] }), 'collection');
  });

  test('Te Kahui Mangai collects "Your name:" and "Your surname:"', () => {
    assert.equal(role({ name: 'name', label: 'Your name:', formAction: '/contact/', submitLabels: ['Send'] }), 'collection');
    assert.equal(role({ name: 'surname', label: 'Your surname:', formAction: '/contact/', submitLabels: ['Send'] }), 'collection');
  });
});

describe('criterion 3 is not about whose name it is', () => {
  test("a child's name is collected, so it qualifies", () => {
    assert.equal(role({
      name: 'child_first_name', label: 'Child’s first name',
      formAction: '/apply', submitLabels: ['Continue'],
    }), 'collection');
  });

  test("a dependent's and a representative's name likewise", () => {
    assert.equal(role({ name: 'dependant_surname', label: 'Dependant surname', formAction: '/apply', submitLabels: ['Next'] }), 'collection');
    assert.equal(role({ name: 'representative_name', label: 'Name of representative', formAction: '/claims/lodge', submitLabels: ['Lodge claim'] }), 'collection');
  });

  test('a deceased person’s name on an application is still collected', () => {
    // The strongest version of the point: the named person is not the submitter and cannot be,
    // and the form still collects a natural person's name as part of its transaction.
    assert.equal(role({
      name: 'deceased_full_name', label: 'Full name of the deceased',
      formAction: '/records/order-certificate', submitLabels: ['Order'],
    }), 'collection');
  });

  test('the same name, queried rather than collected, does not', () => {
    assert.equal(role({
      name: 'deceased_full_name', label: 'Full name of the deceased',
      formAction: '/records/search', submitLabels: ['Search'],
    }), 'query');
  });
});

describe('the query signals are narrow on purpose', () => {
  test('a search facility inside a collection form does not make it a query', () => {
    // A "Search" button beside "Apply" is a facility within the form, not its purpose. Treating
    // unanimity as optional here would reclassify ordinary application forms.
    assert.equal(role({ name: 'surname', label: 'Surname', formAction: '/apply', submitLabels: ['Search', 'Apply'] }), 'collection');
  });

  test('a form with no submit control establishes nothing either way', () => {
    assert.equal(role({ name: 'surname', label: 'Surname', formAction: '/apply', submitLabels: [] }), 'collection');
  });

  test('blank labels are not unanimity', () => {
    // An empty string matches nothing, and must not be counted as a query control - otherwise a
    // form whose button carries an icon and no text would read as a search.
    assert.equal(role({ name: 'surname', label: 'Surname', formAction: '/apply', submitLabels: ['', '  '] }), 'collection');
  });

  test('role="search" is decisive by itself', () => {
    assert.equal(role({ name: 'surname', label: 'Surname', formAction: '/people', formRole: 'search', submitLabels: ['Go'] }), 'query');
  });

  test('the form’s own identity counts', () => {
    assert.equal(role({ name: 'surname', label: 'Surname', formAction: '/people', formId: 'archway-finding-aid', submitLabels: ['Go'] }), 'query');
    assert.equal(role({ name: 'surname', label: 'Surname', formAction: '/people', formClass: 'views-exposed-form record-search', submitLabels: ['Go'] }), 'query');
  });

  test('a field that names itself a search key counts', () => {
    assert.equal(role({ name: 'name_keyword', label: 'Name keyword', formAction: '/x', submitLabels: ['Go'] }), 'query');
  });

  test('"Submit" and "Apply" are not query labels', () => {
    for (const label of ['Submit', 'Apply now', 'Send', 'Register', 'Continue', 'Lodge claim']) {
      assert.equal(QUERY_SUBMIT_LABEL.test(label), false, `${label} must not read as a query`);
    }
    for (const label of ['Search', 'Search records', 'Find', 'Look up', 'Browse', 'Filter', 'Go']) {
      assert.ok(QUERY_SUBMIT_LABEL.test(label), `${label} must read as a query`);
    }
  });
});

describe('the name hint catches the forms this study is about', () => {
  test('it matches the real field names already observed', () => {
    for (const n of [
      'field_surname_value', 'field_forename_value', 'FirstName', 'Surname', 'name',
      'first_name', 'given-names', 'family_name', 'fullname', 'preferred_name', 'middle names',
    ]) {
      assert.ok(NAME_FIELD_HINT.test(n), `${n} must read as a name field`);
    }
  });

  test('it does not match fields that merely contain the letters', () => {
    // `username` is a credential, not a personal name; the others are ordinary form fields that
    // a looser pattern would drag in.
    for (const n of ['username', 'nameserver', 'filename', 'surnamed_entity_id', 'renamed']) {
      assert.equal(NAME_FIELD_HINT.test(n), false, `${n} must not read as a personal-name field`);
    }
  });
});
