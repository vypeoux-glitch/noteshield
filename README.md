# NoteShield

Find sensitive data hiding in your Obsidian vault — national identifiers, bank accounts, payment
cards, API keys and passwords — **entirely offline**.

Notes accumulate things you never meant to keep: a client's ID number pasted from an email, an
account number copied off an invoice, an API key dropped into a scratch note "just for a second"
three months ago. Then the vault gets synced, shared, backed up to a cloud drive, or published as
a digital garden.

NoteShield scans for that, locally.

## What makes it different from grep

Every rule that *can* be verified arithmetically **is** verified before it is reported:

| Detected | Verified with |
| --- | --- |
| PESEL | weighted checksum + a plausible date |
| NIP, REGON (9 and 14 digits) | modulo 11 checksum |
| Polish ID card number | weighted checksum over letters and digits |
| IBAN (any country) | ISO 13616 mod-97 |
| Polish account number (26 digits, no prefix) | mod-97 as `PL` + digits |
| Payment cards | Luhn, 13–19 digits |

So an order number is not reported as a PESEL, and an invoice id is not reported as a NIP. When
two rules match the same characters, the longer, containing match wins — a bank account stays a
bank account instead of being announced as a payment card because sixteen of its digits happen to
satisfy Luhn.

Pattern-only rules (no arithmetic exists for them): private key blocks, AWS / Google / Stripe /
GitHub / Slack / AI-provider keys, JWTs, and credentials written next to their own name
(`password: …`, `api_key = …`).

## Privacy

- **No network calls.** Nothing is uploaded, no model is queried, no update is fetched.
- **No telemetry.**
- **Reports are redacted.** Findings and the exported report only ever carry `44•••••••59`, never
  the original value. That is what makes a report safe to attach to a ticket or commit next to
  the vault.

## Usage

Commands (`Ctrl/Cmd+P`):

- **NoteShield: Scan vault**
- **NoteShield: Scan current note**
- **NoteShield: Save last report to vault**

Results open in the right sidebar; click any finding to jump to that line.

### Silencing a finding

```markdown
PESEL 44051401359 <!-- noteshield-ignore -->

<!-- noteshield-ignore pl-pesel -->
44051401359 in a documentation example

<!-- noteshield-ignore-file -->
```

or in frontmatter:

```yaml
---
noteshield: ignore
---
```

### Settings

Rule packs can be toggled individually (Polish personal identifiers, financial data, credentials,
contact details), along with redaction mode, ignored paths (`Templates`, `Archive/**`), a file
size limit, and an optional quiet check of the note you just saved.

## Install

Until the plugin is in the community list:

1. Download `main.js`, `manifest.json` and `styles.css` from a release.
2. Put them in `<vault>/.obsidian/plugins/noteshield/`.
3. Enable **NoteShield** in Settings → Community plugins.

## Development

```bash
npm install
npm test      # 44 tests, no Obsidian needed — detection logic is pure
npm run build # type-check + bundle to main.js
```

The detection engine (`src/rules.ts`, `src/scanner.ts`, `src/report.ts`) imports nothing from
Obsidian, which is why it can be tested directly with `node --test`.

## Limits, stated honestly

NoteShield reduces the chance that sensitive data sits unnoticed in your notes. It is **not** a
compliance certification, it cannot prove a vault is clean, and it will miss data written in a
form no rule describes. Treat a clean report as "nothing matched the enabled rules", nothing more.

MIT licensed.
