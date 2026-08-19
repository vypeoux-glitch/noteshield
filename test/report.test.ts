import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildReport, reportFileName } from '../src/report.ts';
import { defaultEnabledRules, scanText, summarise } from '../src/scanner.ts';

const at = new Date('2026-08-19T15:45:00Z');
const options = { enabledRules: defaultEnabledRules(), redaction: 'partial' as const };

describe('buildReport', () => {
	it('says so plainly when there is nothing to report', () => {
		const report = buildReport(summarise([], 12), { vaultName: 'Work', generatedAt: at });
		assert.ok(report.includes('No sensitive data matched'));
		assert.ok(report.includes('Files scanned: 12'));
	});

	it('lists findings per file and explains each triggered rule', () => {
		const files = [{ path: 'Clients/acme.md', findings: scanText('PESEL 44051401359', options) }];
		const report = buildReport(summarise(files, 1), { vaultName: 'Work', generatedAt: at });
		assert.ok(report.includes('### Clients/acme.md'));
		assert.ok(report.includes('PESEL'));
		assert.ok(report.includes('## Why these matter'));
	});

	it('carries no unredacted value into the report', () => {
		const files = [
			{ path: 'notes.md', findings: scanText('card 4111111111111111 pesel 44051401359', options) },
		];
		const report = buildReport(summarise(files, 1), { vaultName: 'Work', generatedAt: at });
		assert.ok(!report.includes('4111111111111111'));
		assert.ok(!report.includes('44051401359'));
	});
});

describe('reportFileName', () => {
	it('is sortable and safe as a vault file name', () => {
		const name = reportFileName(at);
		assert.equal(name, 'NoteShield report 2026-08-19 15-45.md');
		assert.ok(!/[\\/:*?"<>|]/.test(name.replace('.md', '')));
	});
});
