/**
 * The audit report.
 *
 * The report is the artefact a user actually keeps: attached to a GDPR record, pasted into a
 * ticket, committed next to the vault. That is only safe because every value in it is already
 * redacted by the scanner — the report builder never sees an original value and cannot leak one.
 */

import { PACK_LABELS, RULES_BY_ID, SEVERITY_ORDER } from './rules.ts';
import type { Severity } from './rules.ts';
import type { ScanSummary } from './scanner.ts';

const SEVERITY_LABEL: Record<Severity, string> = {
	critical: 'Critical',
	high: 'High',
	medium: 'Medium',
	low: 'Low',
};

export interface ReportOptions {
	vaultName: string;
	/** Caller passes the timestamp so the report stays reproducible in tests. */
	generatedAt: Date;
}

export function buildReport(summary: ScanSummary, options: ReportOptions): string {
	const stamp = options.generatedAt.toISOString().replace('T', ' ').slice(0, 16);
	const lines: string[] = [
		'# NoteShield audit report',
		'',
		`- Vault: **${options.vaultName}**`,
		`- Generated: ${stamp} (local scan, no data left this device)`,
		`- Files scanned: ${summary.filesScanned}`,
		`- Files with findings: ${summary.filesWithFindings}`,
		`- Findings: **${summary.total}**`,
		'',
	];

	if (summary.total === 0) {
		lines.push('No sensitive data matched the enabled rules. Nothing to do.', '');
		lines.push(disclaimer());
		return lines.join('\n');
	}

	lines.push('## Summary', '', '| Severity | Findings |', '| --- | --- |');
	for (const severity of Object.keys(SEVERITY_ORDER) as Severity[]) {
		const count = summary.bySeverity[severity];
		if (count > 0) lines.push(`| ${SEVERITY_LABEL[severity]} | ${count} |`);
	}
	lines.push('');

	lines.push('## Findings by file', '');
	for (const file of summary.files) {
		lines.push(`### ${file.path}`, '');
		lines.push('| Line | Severity | Rule | Value (redacted) |');
		lines.push('| --- | --- | --- | --- |');
		for (const finding of file.findings) {
			lines.push(
				`| ${finding.line} | ${SEVERITY_LABEL[finding.severity]} | ${finding.ruleLabel} | \`${finding.excerpt}\` |`,
			);
		}
		lines.push('');
	}

	const triggered = new Set(summary.files.flatMap((f) => f.findings.map((x) => x.ruleId)));
	if (triggered.size > 0) {
		lines.push('## Why these matter', '');
		for (const ruleId of triggered) {
			const rule = RULES_BY_ID.get(ruleId);
			if (rule) lines.push(`- **${rule.label}** (${PACK_LABELS[rule.pack]}) — ${rule.why}`);
		}
		lines.push('');
	}

	lines.push(disclaimer());
	return lines.join('\n');
}

function disclaimer(): string {
	return [
		'---',
		'',
		'NoteShield is a local detection tool. It reduces the chance that sensitive data sits',
		'unnoticed in your notes; it is not a compliance certification and it cannot prove that a',
		'vault is clean. Values above are redacted — open the note at the given line to see the',
		'original. Suppress a checked line with `<!-- noteshield-ignore -->`.',
	].join('\n');
}

/** File name for a saved report — sortable, one per scan, no collisions inside a minute. */
export function reportFileName(generatedAt: Date): string {
	const iso = generatedAt.toISOString();
	return `NoteShield report ${iso.slice(0, 10)} ${iso.slice(11, 16).replace(':', '-')}.md`;
}
