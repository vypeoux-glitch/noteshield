/**
 * Scanner behaviour that users notice: no duplicate reports for the same characters, working
 * suppression, and redaction that never echoes the original value back.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { defaultEnabledRules, isIgnoredPath, redact, scanText, summarise } from '../src/scanner.ts';
import type { ScanOptions } from '../src/scanner.ts';

const options: ScanOptions = { enabledRules: defaultEnabledRules(), redaction: 'partial' };

describe('scanText', () => {
	it('finds a PESEL and reports its line and column', () => {
		const text = 'Client notes\n\nPESEL: 44051401359 — confirmed by phone\n';
		const findings = scanText(text, options).filter((f) => f.ruleId === 'pl-pesel');
		assert.equal(findings.length, 1);
		assert.equal(findings[0].line, 3);
		assert.equal(findings[0].column, 8);
		assert.equal(findings[0].severity, 'critical');
	});

	it('never puts the original value in the excerpt', () => {
		const text = 'card 4111111111111111';
		const findings = scanText(text, options);
		assert.ok(findings.length > 0);
		for (const finding of findings) {
			assert.ok(!finding.excerpt.includes('4111111111111111'));
			assert.ok(finding.excerpt.includes('•'));
		}
	});

	it('reports a card number once, not also as a phone or an id', () => {
		const findings = scanText('4111 1111 1111 1111', options);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].ruleId, 'fin-card');
	});

	it('reports a bank account as an IBAN, not as a card that happens to pass Luhn', () => {
		// The digits inside this IBAN contain a 16-digit run with a closing Luhn checksum.
		const findings = scanText('Konto: PL61 1090 1014 0000 0712 1981 2874', options);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].ruleId, 'fin-iban');
	});

	it('prefers the longer match when one match sits inside another', () => {
		const findings = scanText('IBAN DE89370400440532013000 na fakturze', options);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].ruleId, 'fin-iban');
	});

	it('ignores numbers that fail their checksum', () => {
		const findings = scanText('order 44051401358 shipped', options);
		assert.equal(findings.filter((f) => f.ruleId === 'pl-pesel').length, 0);
	});

	it('honours a line-level ignore comment', () => {
		const text = 'PESEL 44051401359 <!-- noteshield-ignore -->';
		assert.equal(scanText(text, options).length, 0);
	});

	it('honours an ignore comment placed on the previous line', () => {
		const text = '<!-- noteshield-ignore -->\nPESEL 44051401359\n';
		assert.equal(scanText(text, options).length, 0);
	});

	it('honours a rule-scoped ignore, leaving other rules active', () => {
		const text = '<!-- noteshield-ignore pl-pesel -->\n44051401359 and key sk-abcdefghijklmnopqrstuvwxyz\n';
		const findings = scanText(text, options);
		assert.equal(findings.filter((f) => f.ruleId === 'pl-pesel').length, 0);
		assert.equal(findings.filter((f) => f.ruleId === 'sec-model-key').length, 1);
	});

	it('skips a whole file marked in frontmatter', () => {
		const text = '---\ntitle: Test data\nnoteshield: ignore\n---\n\nPESEL 44051401359\n';
		assert.equal(scanText(text, options).length, 0);
	});

	it('skips a whole file marked with the file-level comment', () => {
		const text = '<!-- noteshield-ignore-file -->\nPESEL 44051401359\n';
		assert.equal(scanText(text, options).length, 0);
	});

	it('respects disabled rules', () => {
		const only = { ...options, enabledRules: new Set(['sec-private-key']) };
		const findings = scanText('PESEL 44051401359', only);
		assert.equal(findings.length, 0);
	});

	it('finds credentials written next to their name', () => {
		const findings = scanText('password: hunter2superSecret', options);
		assert.equal(findings.some((f) => f.ruleId === 'sec-password-assignment'), true);
	});

	it('scans a second time without state left over from the first', () => {
		const text = 'PESEL 44051401359';
		assert.deepEqual(scanText(text, options), scanText(text, options));
	});
});

describe('redact', () => {
	it('keeps the ends of an identifier so it can be recognised', () => {
		const out = redact('44051401359', 'partial', 'pl-personal');
		assert.ok(out.startsWith('44'));
		assert.ok(out.endsWith('59'));
		assert.ok(!out.includes('051401'));
	});

	it('keeps no tail for secrets', () => {
		const out = redact('sk-abcdefghijklmnopqrstuvwxyz', 'partial', 'secrets');
		assert.ok(out.startsWith('sk-a'));
		assert.ok(!out.includes('wxyz'));
	});

	it('hides everything in full mode', () => {
		assert.equal(/^•+$/.test(redact('44051401359', 'full', 'pl-personal')), true);
	});
});

describe('isIgnoredPath', () => {
	it('matches a folder and everything under it', () => {
		assert.equal(isIgnoredPath('Templates/note.md', ['Templates']), true);
		assert.equal(isIgnoredPath('Templates', ['Templates']), true);
		assert.equal(isIgnoredPath('Template-notes/note.md', ['Templates']), false);
	});

	it('supports * inside a segment and ** across segments', () => {
		assert.equal(isIgnoredPath('Archive/2026/old.md', ['Archive/**']), true);
		assert.equal(isIgnoredPath('Daily/2026-08-19.md', ['Daily/*.md']), true);
		assert.equal(isIgnoredPath('Daily/sub/2026-08-19.md', ['Daily/*.md']), false);
	});

	it('ignores empty patterns', () => {
		assert.equal(isIgnoredPath('note.md', ['', '   ']), false);
	});
});

describe('summarise', () => {
	it('counts by severity and sorts the worst file first', () => {
		const files = [
			{ path: 'b.md', findings: scanText('email a@b.pl', options) },
			{ path: 'a.md', findings: scanText('PESEL 44051401359', options) },
		];
		const summary = summarise(files, 5);
		assert.equal(summary.filesScanned, 5);
		assert.equal(summary.filesWithFindings, 2);
		assert.equal(summary.bySeverity.critical, 1);
		assert.equal(summary.files[0].path, 'a.md');
	});
});
