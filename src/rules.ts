/**
 * Detection rules for NoteShield.
 *
 * Design decision that separates this plugin from a pile of regexes: every rule that CAN be
 * verified arithmetically IS verified. A PESEL is not "eleven digits", it is eleven digits
 * whose weighted sum closes; an IBAN is not "PL + 26 digits", it is a number congruent to 1
 * modulo 97. Regex alone turns any order number, phone list or git hash into a "critical
 * finding", and a scanner that cries wolf gets uninstalled after the first run.
 *
 * No network, no telemetry, no AI: everything here is local arithmetic over the note text.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type RulePack = 'pl-personal' | 'financial' | 'secrets' | 'contact';

export interface Rule {
	id: string;
	/** Shown in the results panel and the report. */
	label: string;
	pack: RulePack;
	severity: Severity;
	pattern: RegExp;
	/**
	 * Optional arithmetic check on the raw match. Returning false discards the match silently —
	 * this is what keeps invoice numbers from being reported as national identifiers.
	 */
	validate?: (match: string) => boolean;
	/** Short "why it matters", printed once per rule in the report. */
	why: string;
}

const digits = (value: string): number[] =>
	value.replace(/\D/g, '').split('').map((d) => Number(d));

/** PESEL — Polish national identification number: 11 digits, weighted checksum. */
export function isValidPesel(value: string): boolean {
	const d = digits(value);
	if (d.length !== 11) return false;
	const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
	const sum = weights.reduce((acc, w, i) => acc + w * d[i], 0);
	const check = (10 - (sum % 10)) % 10;
	if (check !== d[10]) return false;
	// A valid checksum still has to describe a real date, otherwise 00000000000 passes.
	const month = d[2] * 10 + d[3];
	const day = d[4] * 10 + d[5];
	const monthInCentury = month % 20;
	return monthInCentury >= 1 && monthInCentury <= 12 && day >= 1 && day <= 31;
}

/** NIP — Polish tax identification number: 10 digits, modulo 11 checksum. */
export function isValidNip(value: string): boolean {
	const d = digits(value);
	if (d.length !== 10) return false;
	if (d.every((x) => x === d[0])) return false; // 0000000000 and friends
	const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
	const sum = weights.reduce((acc, w, i) => acc + w * d[i], 0);
	const check = sum % 11;
	return check !== 10 && check === d[9];
}

/** REGON — Polish business registry number: 9 or 14 digits, modulo 11 checksum. */
export function isValidRegon(value: string): boolean {
	const d = digits(value);
	const check = (weights: number[], expected: number): boolean => {
		const sum = weights.reduce((acc, w, i) => acc + w * d[i], 0);
		return sum % 11 % 10 === expected;
	};
	if (d.length === 9) return check([8, 9, 2, 3, 4, 5, 6, 7], d[8]);
	if (d.length === 14) {
		return (
			check([8, 9, 2, 3, 4, 5, 6, 7], d[8]) &&
			check([2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8], d[13])
		);
	}
	return false;
}

/**
 * Polish ID card number: three letters, a check digit, then five digits.
 * The check digit sits at position 3 and is excluded from its own sum.
 */
export function isValidDowodOsobisty(value: string): boolean {
	const raw = value.replace(/\s/g, '').toUpperCase();
	if (!/^[A-Z]{3}\d{6}$/.test(raw)) return false;
	const codeOf = (ch: string): number =>
		/\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 55; // A = 10 … Z = 35
	const weights = [7, 3, 1, 7, 3, 1, 7, 3];
	const positions = [0, 1, 2, 4, 5, 6, 7, 8];
	const sum = positions.reduce((acc, position, i) => acc + weights[i] * codeOf(raw[position]), 0);
	return sum % 10 === codeOf(raw[3]);
}

/** IBAN — ISO 13616 checksum (mod 97 = 1), any country. */
export function isValidIban(value: string): boolean {
	const raw = value.replace(/[\s-]/g, '').toUpperCase();
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(raw)) return false;
	const rearranged = raw.slice(4) + raw.slice(0, 4);
	const expanded = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
	// Chunked modulo — the number is far beyond Number.MAX_SAFE_INTEGER.
	let remainder = 0;
	for (const ch of expanded) {
		remainder = (remainder * 10 + Number(ch)) % 97;
	}
	return remainder === 1;
}

/** Payment card number — Luhn checksum, 13–19 digits. */
export function isValidCardNumber(value: string): boolean {
	const d = digits(value);
	if (d.length < 13 || d.length > 19) return false;
	if (d.every((x) => x === d[0])) return false;
	let sum = 0;
	let double = false;
	for (let i = d.length - 1; i >= 0; i--) {
		let n = d[i];
		if (double) {
			n *= 2;
			if (n > 9) n -= 9;
		}
		sum += n;
		double = !double;
	}
	return sum % 10 === 0;
}

/**
 * A Polish account number written without the country prefix (26 digits) is still an IBAN —
 * banks print it that way on invoices, so we validate it as PL + the digits.
 */
export function isValidPlAccountNumber(value: string): boolean {
	const raw = value.replace(/[\s-]/g, '');
	if (!/^\d{26}$/.test(raw)) return false;
	return isValidIban('PL' + raw);
}

export const RULES: Rule[] = [
	{
		id: 'pl-pesel',
		label: 'PESEL',
		pack: 'pl-personal',
		severity: 'critical',
		pattern: /\b\d{11}\b/g,
		validate: isValidPesel,
		why: 'PESEL identifies a specific person and is a special category of personal data under GDPR.',
	},
	{
		id: 'pl-dowod',
		label: 'Polish ID card number',
		pack: 'pl-personal',
		severity: 'high',
		pattern: /\b[A-Z]{3}\s?\d{6}\b/g,
		validate: isValidDowodOsobisty,
		why: 'ID card numbers are used for identity verification and are a common target of fraud.',
	},
	{
		id: 'pl-nip',
		label: 'NIP',
		pack: 'pl-personal',
		severity: 'medium',
		pattern: /\b\d{3}[- ]?\d{3}[- ]?\d{2}[- ]?\d{2}\b|\b\d{10}\b/g,
		validate: isValidNip,
		why: 'A NIP identifies a business or a sole trader — for sole traders it is personal data.',
	},
	{
		id: 'pl-regon',
		label: 'REGON',
		pack: 'pl-personal',
		severity: 'low',
		pattern: /\b\d{9}\b|\b\d{14}\b/g,
		validate: isValidRegon,
		why: 'REGON is public for companies, but pins a note to a specific registered entity.',
	},
	{
		id: 'fin-iban',
		label: 'IBAN',
		pack: 'financial',
		severity: 'high',
		pattern: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{2,4}){2,8}\b/g,
		validate: isValidIban,
		why: 'A bank account number in a synced note is a direct path to payment fraud.',
	},
	{
		id: 'fin-pl-account',
		label: 'Polish bank account (26 digits)',
		pack: 'financial',
		severity: 'high',
		pattern: /\b\d{2}(?:[ -]?\d{4}){6}\b|\b\d{26}\b/g,
		validate: isValidPlAccountNumber,
		why: 'Invoices print accounts without the PL prefix; it is still a full account number.',
	},
	{
		id: 'fin-card',
		label: 'Payment card number',
		pack: 'financial',
		severity: 'critical',
		pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
		validate: isValidCardNumber,
		why: 'Card numbers must never sit in plain text (PCI DSS); a note sync is an exfiltration path.',
	},
	{
		id: 'sec-private-key',
		label: 'Private key block',
		pack: 'secrets',
		severity: 'critical',
		pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
		why: 'A private key grants access to servers, repositories or signed identities.',
	},
	{
		id: 'sec-aws-key',
		label: 'AWS access key id',
		pack: 'secrets',
		severity: 'critical',
		pattern: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g,
		why: 'AWS keys are scraped from public notes and repos within minutes of exposure.',
	},
	{
		id: 'sec-google-key',
		label: 'Google API key',
		pack: 'secrets',
		severity: 'high',
		pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
		why: 'Google API keys are billable — a leaked key becomes someone else’s invoice.',
	},
	{
		id: 'sec-model-key',
		label: 'AI provider API key',
		pack: 'secrets',
		severity: 'critical',
		pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,
		why: 'Model API keys are billed per token and are trivially abused once leaked.',
	},
	{
		id: 'sec-github-token',
		label: 'GitHub token',
		pack: 'secrets',
		severity: 'critical',
		pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
		why: 'A GitHub token can read private repositories and push code in your name.',
	},
	{
		id: 'sec-slack-token',
		label: 'Slack token',
		pack: 'secrets',
		severity: 'high',
		pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
		why: 'Slack tokens expose message history and can post as you.',
	},
	{
		id: 'sec-stripe-key',
		label: 'Stripe secret key',
		pack: 'secrets',
		severity: 'critical',
		pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
		why: 'A live Stripe key can move real money.',
	},
	{
		id: 'sec-jwt',
		label: 'JWT',
		pack: 'secrets',
		severity: 'medium',
		pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
		why: 'Session tokens usually stay valid long after they are pasted into a note.',
	},
	{
		id: 'sec-password-assignment',
		label: 'Password / secret written next to its name',
		pack: 'secrets',
		severity: 'high',
		pattern:
			/(?:password|passwd|pwd|hasło|haslo|secret|api[_-]?key|token)\s*[:=]\s*["']?[^\s"']{6,}/gi,
		why: 'A labelled credential is the easiest thing in the world to grep for.',
	},
	{
		id: 'contact-email',
		label: 'Email address',
		pack: 'contact',
		severity: 'low',
		pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
		why: 'Client email addresses in a shared or published vault are personal data.',
	},
	{
		id: 'contact-phone-pl',
		label: 'Polish phone number',
		pack: 'contact',
		severity: 'low',
		pattern: /(?:\+48[ -]?)?\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/g,
		validate: (m) => {
			const d = m.replace(/\D/g, '').replace(/^48/, '');
			return d.length === 9 && !/^(\d)\1{8}$/.test(d) && !/^0/.test(d);
		},
		why: 'Phone numbers identify a person and are the usual pivot for social engineering.',
	},
];

export const RULES_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

export const PACK_LABELS: Record<RulePack, string> = {
	'pl-personal': 'Polish personal identifiers (PESEL, ID card, NIP, REGON)',
	financial: 'Financial data (IBAN, bank accounts, cards)',
	secrets: 'Credentials and API keys',
	contact: 'Contact details (email, phone)',
};

export const SEVERITY_ORDER: Record<Severity, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
};
