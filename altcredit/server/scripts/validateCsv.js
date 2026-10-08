// Dry run: check a transactions CSV without touching the database.
// npm run validate:csv -- tests/fixtures/bad_transactions.csv
const { readCsv } = require('../src/importers/readers');
const { validateTransaction } = require('../src/importers/validators');
const { validateAll } = require('../src/importers/importDataset');

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run validate:csv -- <path-to-csv>');
  process.exit(1);
}

const rows = readCsv(file);
const { good, bad } = validateAll(rows, validateTransaction, 2);
console.log(`\n${file}\n  total: ${rows.length}  accepted: ${good.length}  rejected: ${bad.length}\n`);
bad.forEach((b) => {
  b.errors.forEach((e) => console.log(`  row ${b.row}: ${e.field} ${e.reason}`));
});