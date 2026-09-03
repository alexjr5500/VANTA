/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      useESM: false,
    }],
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  collectCoverage: false,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/__tests__/', '/dist/', '/prisma/'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  verbose: true,
  testTimeout: 30000,
  maxWorkers: 1,
  forceExit: false,
  detectOpenHandles: true,
};