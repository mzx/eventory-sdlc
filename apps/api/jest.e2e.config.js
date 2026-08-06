/** @type {import('jest').Config} */
module.exports = {
  displayName: 'e2e',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testEnvironment: 'node',
  /**
   * Runs tests sequentially (no parallelism) so all e2e tests share the same
   * database state without race conditions.
   */
  maxWorkers: 1,
  /**
   * Give each test suite a generous timeout — NestJS app bootstrap + DB ops
   * can take a few seconds.
   */
  testTimeout: 30_000,
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
};
