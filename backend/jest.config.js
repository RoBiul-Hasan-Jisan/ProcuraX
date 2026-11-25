/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      { jsc: { target: 'es2022', parser: { syntax: 'typescript' } }, module: { type: 'commonjs' } },
    ],
  },
  // pdfkit 0.21 depends on an ESM-only font library that Jest's CommonJS sandbox cannot load; production Node loads the real package.
  moduleNameMapper: { '^pdfkit$': '<rootDir>/node_modules/pdfkit/js/pdfkit.standalone.js' },
  setupFiles: ['<rootDir>/tests/setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/mocks.ts'],
};
