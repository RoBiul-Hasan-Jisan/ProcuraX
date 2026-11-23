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
  setupFiles: ['<rootDir>/tests/setup.ts'],
};
