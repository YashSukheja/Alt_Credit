const fs = require('fs');
const { parse } = require('csv-parse/sync');
const AppError = require('../utils/AppError');

function readJsonArray(filePath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new AppError(400, 'BAD_FILE', `Cannot read ${filePath}: ${err.message}`);
  }
  if (!Array.isArray(data)) throw new AppError(400, 'BAD_FILE', `${filePath} must contain a JSON array`);
  return data;
}

function readCsv(filePath) {
  try {
    return parse(fs.readFileSync(filePath, 'utf8'), {
      columns: true,          // first line is the header -> objects keyed by column name
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true, // a short/long row becomes a validation error, not a crash
    });
  } catch (err) {
    throw new AppError(400, 'BAD_FILE', `Cannot parse ${filePath}: ${err.message}`);
  }
}

module.exports = { readJsonArray, readCsv };