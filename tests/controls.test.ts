import { describe, expect, it } from 'vitest';
import { findNameControls } from '../src/parse/controls.js';

describe('name-control identification', () => {
  it('accepts an autocomplete token', () => {
    expect(findNameControls('<input autocomplete="given-name">')).toHaveLength(1);
  });

  it('accepts a sectioned autocomplete token', () => {
    expect(findNameControls('<input autocomplete="section-a shipping family-name">')).toHaveLength(1);
  });

  it('accepts a name hint in the name attribute', () => {
    expect(findNameControls('<input name="surname">')).toHaveLength(1);
  });

  it('rejects controls that are not text inputs', () => {
    expect(findNameControls('<input type="email" name="name">')).toHaveLength(0);
    expect(findNameControls('<input type="checkbox" name="firstName">')).toHaveLength(0);
  });

  it('rejects names that are not personal names', () => {
    for (const attr of ['username', 'file_name', 'company-name', 'product name', 'displayName']) {
      expect(findNameControls(`<input name="${attr}">`), attr).toHaveLength(0);
    }
  });

  it('reads declared constraints from the control', () => {
    const [control] = findNameControls(
      '<input name="name" pattern="[A-Za-z]+" minlength="2" maxlength="30" required>'
    );
    expect(control?.pattern).toBe('[A-Za-z]+');
    expect(control?.minLength).toBe(2);
    expect(control?.maxLength).toBe(30);
    expect(control?.required).toBe(true);
  });

  it('preserves the source snippet for evidence', () => {
    const [control] = findNameControls('<div><input name="name" pattern="[A-Za-z]+"></div>');
    expect(control?.source.snippet).toContain('pattern="[A-Za-z]+"');
  });

  it('finds controls nested inside a form', () => {
    const html = '<form><fieldset><input autocomplete="name"><input name="email" type="email"></fieldset></form>';
    expect(findNameControls(html)).toHaveLength(1);
  });
});
