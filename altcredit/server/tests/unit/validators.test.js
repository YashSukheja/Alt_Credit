const {
  validateTransaction, validateUser, validateFeatures, validateProduct, parseDate, parseInterestRate,
} = require('../../src/importers/validators');

const goodTxn = { transaction_id: 'TXN_1', user_id: 'USR_001', date: '6/30/2023', amount: '105', category: 'Food', type: 'DEBIT', status: 'Completed' };
const fields = (r) => r.errors.map((e) => e.field);

describe('parseDate', () => {
  test.each([
    ['6/30/2023', '2023-06-30'], ['2023-06-30', '2023-06-30'], ['2/30/2023', null], ['June', null], ['', null],
  ])('%s -> %s', (input, expected) => expect(parseDate(input)).toBe(expected));
});

describe('parseInterestRate', () => {
  test('parses "17.00% PA" and "12% APR"', () => {
    expect(parseInterestRate('17.00% PA')).toEqual({ interest_rate: 17, rate_unit: 'PA' });
    expect(parseInterestRate('12% APR')).toEqual({ interest_rate: 12, rate_unit: 'APR' });
    expect(parseInterestRate('cheap')).toBeNull();
  });
});

describe('validateTransaction', () => {
  test('accepts a good row and normalises date and amount', () => {
    expect(validateTransaction(goodTxn)).toEqual({ ok: true, value: expect.objectContaining({ txn_date: '2023-06-30', amount: 105 }) });
  });
  // One bad field at a time -> that exact field must be reported
  test.each([
    [{ user_id: '' }, 'user_id'], [{ date: '2/30/2023' }, 'date'], [{ amount: '-5' }, 'amount'],
    [{ amount: 'abc' }, 'amount'], [{ category: 'Gambling' }, 'category'], [{ status: 'Pending' }, 'status'],
    [{ category: 'Salary', type: 'DEBIT' }, 'type'], [{ user_id: 'BAD' }, 'user_id'],
  ])('rejects %o (field %s)', (change, field) => {
    const r = validateTransaction({ ...goodTxn, ...change });
    expect(r.ok).toBe(false);
    expect(fields(r)).toContain(field);
  });
  test('reports ALL problems in a row, not just the first', () => {
    expect(fields(validateTransaction({ ...goodTxn, amount: 'x', status: 'y' }))).toEqual(expect.arrayContaining(['amount', 'status']));
  });
});

describe('other validators', () => {
  test('user: city_tier must be 1-3', () => {
    const r = validateUser({ user_id: 'USR_001', applicant_id: '8a0d6320-e982-445b-afa8-bb9e0054aca9', age: 23, monthly_income: 1000, city_tier: 4 });
    expect(fields(r)).toEqual(['city_tier']);
  });
  test('features: rates must be 0-1 and housing from the list', () => {
    const r = validateFeatures({ applicant_id: '8a0d6320-e982-445b-afa8-bb9e0054aca9', on_time_rate: 1.5, housing: 'castle' });
    expect(fields(r)).toEqual(expect.arrayContaining(['on_time_rate', 'housing']));
  });
  test('product: interest rate must look like "12% APR"', () => {
    const r = validateProduct({ product_id: 'P_X', product_name: 'X', type: 'Loan', min_score: 300, interest_rate: 'cheap' });
    expect(fields(r)).toEqual(['interest_rate']);
  });
});
