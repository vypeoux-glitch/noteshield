/**
 * The checksum layer is the whole reason this plugin is not "another regex scanner", so the
 * negative cases matter more than the positive ones: an eleven-digit order number must NOT be
 * reported as a PESEL, and a ten-digit invoice id must NOT be reported as a NIP.
 *
 * Identifiers below are synthetic — generated to satisfy the checksum, not taken from any person
 * or company.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	isValidCardNumber,
	isValidDowodOsobisty,
	isValidIban,
	isValidNip,
	isValidPesel,
	isValidPlAccountNumber,
	isValidRegon,
} from '../src/rules.ts';

describe('PESEL', () => {
	it('accepts a number with a correct checksum and a real date', () => {
		assert.equal(isValidPesel('44051401359'), true);
		assert.equal(isValidPesel('02070803628'), true);
	});

	it('rejects a wrong checksum', () => {
		assert.equal(isValidPesel('44051401358'), false);
	});

	it('rejects a checksum-valid number with an impossible date', () => {
		// 00000000000 has a closing checksum but describes month 00, day 00.
		assert.equal(isValidPesel('00000000000'), false);
	});

	it('rejects anything that is not eleven digits', () => {
		assert.equal(isValidPesel('4405140135'), false);
		assert.equal(isValidPesel('440514013590'), false);
	});
});

describe('NIP', () => {
	it('accepts valid numbers, formatted or not', () => {
		assert.equal(isValidNip('7771234567'), true); // synthetic, checksum closes
		assert.equal(isValidNip('777-123-45-67'), true);
	});

	it('rejects a wrong checksum', () => {
		assert.equal(isValidNip('7771234568'), false);
	});

	it('rejects repeated digits', () => {
		assert.equal(isValidNip('0000000000'), false);
	});
});

describe('REGON', () => {
	it('accepts 9-digit and 14-digit numbers', () => {
		assert.equal(isValidRegon('123456785'), true);
		assert.equal(isValidRegon('12345678512347'), true);
	});

	it('rejects a wrong checksum', () => {
		assert.equal(isValidRegon('123456789'), false);
	});
});

describe('Polish ID card number', () => {
	it('accepts a valid series and number', () => {
		assert.equal(isValidDowodOsobisty('ABA300000'), true);
	});

	it('rejects a wrong checksum', () => {
		assert.equal(isValidDowodOsobisty('ABA300001'), false);
	});

	it('rejects the wrong shape', () => {
		assert.equal(isValidDowodOsobisty('AB1300000'), false);
	});
});

describe('IBAN', () => {
	it('accepts valid IBANs across countries and formats', () => {
		assert.equal(isValidIban('GB82 WEST 1234 5698 7654 32'), true);
		assert.equal(isValidIban('DE89370400440532013000'), true);
		assert.equal(isValidIban('PL61109010140000071219812874'), true);
	});

	it('rejects a mutated digit', () => {
		assert.equal(isValidIban('PL61109010140000071219812875'), false);
	});
});

describe('Polish account number without the PL prefix', () => {
	it('accepts the 26-digit form printed on invoices', () => {
		assert.equal(isValidPlAccountNumber('61109010140000071219812874'), true);
		assert.equal(isValidPlAccountNumber('61 1090 1014 0000 0712 1981 2874'), true);
	});

	it('rejects a wrong checksum', () => {
		assert.equal(isValidPlAccountNumber('61109010140000071219812875'), false);
	});
});

describe('Payment cards', () => {
	it('accepts Luhn-valid test numbers', () => {
		assert.equal(isValidCardNumber('4111111111111111'), true);
		assert.equal(isValidCardNumber('5500 0000 0000 0004'), true);
		assert.equal(isValidCardNumber('378282246310005'), true);
	});

	it('rejects a Luhn-invalid number', () => {
		assert.equal(isValidCardNumber('4111111111111112'), false);
	});

	it('rejects a run of identical digits', () => {
		assert.equal(isValidCardNumber('0000000000000000'), false);
	});
});
