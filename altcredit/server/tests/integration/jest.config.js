// Separate Jest config for integration tests (real DB + real mock bank)
module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
  globalSetup: '<rootDir>/tests/integration/globalSetup.js',
  setupFiles: ['<rootDir>/tests/integration/setupEnv.js'],
  testTimeout: 30000,
};