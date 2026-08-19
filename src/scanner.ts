/**
 * Scanning a note into findings.
 *
 * Two things matter here beyond "run the regexes":
 *
 * 1. **Overlap resolution.** A 16-digit card number also matches the phone rule and, cut into
 *    pieces, the NIP rule. Reporting the same characters three times under three names makes the
 *    panel useless, so overlapping matches are resolved once, by severity and then by length.
 * 2. **Suppression.** Every scanner that cannot be told "yes, I know, this one is fine" ends up
 *    ignored wholesale. NoteShield takes an ignore comment per line, per rule, per file, plus a
 *    frontmatter switch — so a user silences one example, not the entire plugin.
 *
 * The raw matched value never leaves this module: findings carry a redacted excerpt only, which
 * is what lets the report be committed to a repo or pasted into a ticket.
 */

import { RULES, RULES_BY_ID, SEVERITY_ORDER } from './rules.ts';
import type { Rule, RulePack, Severity } from './rules.ts';

export interface Finding {
	ruleId: string;
	ruleLabel: string;
	pack: RulePack;
	severity: Severity;
	/** 1-based, so it can be handed straight to the editor. */
	line: number;
	/** 1-based column of the first matched character. */
	column: number;
	/** Redacted — never the original value. */
	excerpt: string;
	/** Length of the original match, kept for context in the report. */
	length: number;
}

export interface ScanOptions {
	enabledRules: Set<string>;
	/** 'partial' keeps the first and last two characters, 'full' keeps none. */
	redaction: 'partial' | 'full';
}

const IGNORE_FILE = /<!--\s*noteshield-ignore-file\s*-->/i;
const IGNORE_LINE = /<!--\s*noteshield-ignore(?:\s+([a-z0-9-]+))?\s*-->/i;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const FRONTMATTER_IGNORE = /^\s*noteshield\s*:\s*(ignore|false|off)\s*$/im;

/**
 * Redaction keeps enough of a value to recognise which one it is, and not enough to use it.
 * Secrets get no tail at all — the last four characters of a token are a real fingerprint.
 */
export function redact(value: string, mode: 'partial' | 'full', pack: RulePack): string {
	const compact = value.replace(/\s+/g, ' ').trim();
	if (mode === 'full' || compact.length <= 6) {
		return '•'.repeat(Math.min(compact.length, 12));
	}
	if (pack === 'secrets') {
		return compact.slice(0, 4) + '•'.repeat(Math.min(compact.length - 4, 16));
	}
	return compact.slice(0, 2) + '•'.repeat(Math.min(compact.length - 4, 16)) + compact.slice(-2);
}

export function defaultEnabledRules(): Set<string> {
	return new Set(RULES.map((rule) => rule.id));
}

interface RawMatch {
	rule: Rule;
	start: number;
	end: number;
	value: string;
}

const contains = (outer: RawMatch, inner: RawMatch): boolean =>
	outer.start <= inner.start && outer.end >= inner.end && outer.end - outer.start > inner.end - inner.start;

/**
 * Which of two overlapping matches survives.
 *
 * Containment beats severity, and that ordering is not cosmetic: the digits of an IBAN contain a
 * 16-digit run that passes Luhn roughly one time in ten, so a plain severity comparison reports
 * a bank account as a payment card. The longer, fully containing match is the one that describes
 * what the characters actually are.
 */
function beats(a: RawMatch, b: RawMatch): boolean {
	if (contains(a, b)) return true;
	if (contains(b, a)) return false;
	const bySeverity = SEVERITY_ORDER[a.rule.severity] - SEVERITY_ORDER[b.rule.severity];
	if (bySeverity !== 0) return bySeverity < 0;
	return a.end - a.start > b.end - b.start;
}

function lineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '\n') starts.push(i + 1);
	}
	return starts;
}

function locate(starts: number[], offset: number): { line: number; column: number } {
	// binary search for the last line start <= offset
	let lo = 0;
	let hi = starts.length - 1;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (starts[mid] <= offset) lo = mid;
		else hi = mid - 1;
	}
	return { line: lo + 1, column: offset - starts[lo] + 1 };
}

/** Rule ids suppressed on a given 1-based line, '*' meaning "everything on this line". */
function suppressions(lines: string[]): Map<number, Set<string>> {
	const map = new Map<number, Set<string>>();
	const add = (line: number, ruleId: string): void => {
		const set = map.get(line) ?? new Set<string>();
		set.add(ruleId);
		map.set(line, set);
	};
	lines.forEach((text, index) => {
		const match = IGNORE_LINE.exec(text);
		if (!match) return;
		const ruleId = match[1] && RULES_BY_ID.has(match[1]) ? match[1] : '*';
		add(index + 1, ruleId); // the directive line itself
		add(index + 2, ruleId); // and the line it introduces
	});
	return map;
}

export function scanText(text: string, options: ScanOptions): Finding[] {
	if (IGNORE_FILE.test(text)) return [];
	const frontmatter = FRONTMATTER.exec(text);
	if (frontmatter && FRONTMATTER_IGNORE.test(frontmatter[1])) return [];

	const accepted: RawMatch[] = [];
	for (const rule of RULES) {
		if (!options.enabledRules.has(rule.id)) continue;
		// Rules are module-level and carry /g, so lastIndex has to be reset per scan.
		const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(text)) !== null) {
			if (match[0].length === 0) {
				pattern.lastIndex++;
				continue;
			}
			if (rule.validate && !rule.validate(match[0])) continue;
			const candidate: RawMatch = {
				rule,
				start: match.index,
				end: match.index + match[0].length,
				value: match[0],
			};
			const overlapping = accepted.filter((a) => a.start < candidate.end && candidate.start < a.end);
			if (overlapping.length === 0) {
				accepted.push(candidate);
				continue;
			}
			if (overlapping.every((other) => beats(candidate, other))) {
				for (const other of overlapping) {
					accepted.splice(accepted.indexOf(other), 1);
				}
				accepted.push(candidate);
			}
		}
	}

	const starts = lineStarts(text);
	const suppressed = suppressions(text.split('\n'));
	const findings: Finding[] = [];
	for (const match of accepted.sort((a, b) => a.start - b.start)) {
		const { line, column } = locate(starts, match.start);
		const silenced = suppressed.get(line);
		if (silenced && (silenced.has('*') || silenced.has(match.rule.id))) continue;
		findings.push({
			ruleId: match.rule.id,
			ruleLabel: match.rule.label,
			pack: match.rule.pack,
			severity: match.rule.severity,
			line,
			column,
			excerpt: redact(match.value, options.redaction, match.rule.pack),
			length: match.value.length,
		});
	}
	return findings;
}

export interface FileFindings {
	path: string;
	findings: Finding[];
}

export interface ScanSummary {
	files: FileFindings[];
	filesScanned: number;
	filesWithFindings: number;
	total: number;
	bySeverity: Record<Severity, number>;
}

export function summarise(files: FileFindings[], filesScanned: number): ScanSummary {
	const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
	let total = 0;
	for (const file of files) {
		for (const finding of file.findings) {
			bySeverity[finding.severity]++;
			total++;
		}
	}
	return {
		files: files
			.filter((file) => file.findings.length > 0)
			.sort((a, b) => worstSeverity(a) - worstSeverity(b) || a.path.localeCompare(b.path)),
		filesScanned,
		filesWithFindings: files.filter((file) => file.findings.length > 0).length,
		total,
		bySeverity,
	};
}

function worstSeverity(file: FileFindings): number {
	return Math.min(...file.findings.map((f) => SEVERITY_ORDER[f.severity]));
}

/**
 * Path filter. Deliberately a small glob (`*` inside a segment, `**` across segments) rather than
 * a dependency: a scanner that pulls in a matching library to skip a folder is not worth the
 * supply chain it costs.
 */
export function isIgnoredPath(path: string, patterns: string[]): boolean {
	const normalised = path.replace(/^\/+/, '');
	return patterns.some((raw) => {
		const pattern = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');
		if (!pattern) return false;
		if (!pattern.includes('*')) {
			return normalised === pattern || normalised.startsWith(pattern + '/');
		}
		const source = pattern
			.split('**')
			.map((part) =>
				part
					.replace(/[.+^${}()|[\]\\]/g, '\\$&')
					.replace(/\*/g, '[^/]*'),
			)
			.join('.*');
		return new RegExp('^' + source + '$').test(normalised);
	});
}
