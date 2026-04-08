export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],

  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  }
};
