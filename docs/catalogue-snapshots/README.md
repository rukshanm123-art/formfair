# Catalogue snapshots

Rule catalogues for the seven production analysers compared in Table 4 of the Assessment 1 proposal, captured 2026-08-05.

Catalogues change between releases. These captures fix what was inspected so each row of Table 4 can be
checked against the artefact as it stood, rather than against a page that has since moved.

Verify integrity:

```
shasum -a 256 -c SHA256SUMS
```

| Tool | Version | Released | Captured file | SHA-256 (first 16) |
|---|---|---|---|---|
| axe-core | 4.12.1 | 2026-06-10 | `axe-core-v4.12.1-rule-descriptions.md` | `7de9a1ffa7da7943…` |
| Lighthouse | 13.4.1 | 2026-07-20 | `lighthouse-accessibility-scoring.html` | `9f419012a7e09d9a…` |
| WAVE | API 3.1 | 2020-09-22 | `wave-api-changelog.html` | `77ca773b29743c54…` |
| WAVE | API 3.1 | 2020-09-22 | `wave-api-index.html` | `daf4c1207562e08b…` |
| eslint-plugin-jsx-a11y | 6.10.2 | npm 2024-10-26; GitHub release 2025-01-05 | `eslint-plugin-jsx-a11y-v6.10.2-README.md` | `f62ec4262e1adf8d…` |
| SonarQube Server | 26.7.0.124771 | 2026-07-08 | `sonarqube-rules-overview.html` | `c7ae3b058a82704e…` |
| eslint-plugin-i18next | 6.1.5 | 2026-06-28 | `eslint-plugin-i18next-v6.1.5-README.md` | `6c47ce27715ef448…` |
| eslint-plugin-formatjs | 6.4.20 | npm 2026-07-31 | `eslint-plugin-formatjs-linter.html` | `02d13c6516d4e1e0…` |

## Sources

- **axe-core** — https://raw.githubusercontent.com/dequelabs/axe-core/v4.12.1/doc/rule-descriptions.md  
  Rule catalogue at release tag v4.12.1.
- **Lighthouse** — https://developer.chrome.com/docs/lighthouse/accessibility/scoring  
  Accessibility scoring documentation. Audits delegate to axe-core.
- **WAVE** — https://wave.webaim.org/api/changelog  
  API changelog establishing 3.1 as current. Hosted evaluation tool publishes no version.
- **WAVE** — https://wave.webaim.org/api/  
  API landing page captured alongside the changelog.
- **eslint-plugin-jsx-a11y** — https://raw.githubusercontent.com/jsx-eslint/eslint-plugin-jsx-a11y/v6.10.2/README.md  
  Supported rule list at release tag v6.10.2.
- **SonarQube Server** — https://docs.sonarsource.com/sonarqube-server/latest/user-guide/rules/overview/  
  Rules overview. Catalogue is specific to the server release; page itself is unversioned.
- **eslint-plugin-i18next** — https://raw.githubusercontent.com/edvardchen/eslint-plugin-i18next/v6.1.5/README.md  
  Rule documentation at release tag v6.1.5.
- **eslint-plugin-formatjs** — https://formatjs.github.io/docs/tooling/linter/  
  Linter rule documentation. Documentation site is unversioned; npm release recorded.

## Finding

Across these catalogues, no rule evaluates accepted character classes, the `pattern` attribute,
`minlength`, or Unicode normalisation.

axe-core carries several rules addressed to form controls — `label`, `label-title-only`,
`label-content-name-mismatch`, `form-field-multiple-labels`, `select-name`,
`input-button-name`, `aria-input-field-name` and `autocomplete-valid` among them — but
they concern whether a control is named and labelled, not what it accepts. Of these,
`autocomplete-valid` is the only one that inspects a validation-adjacent attribute
value, and it checks the syntax of the autocomplete token list rather than the input
the control will admit.
