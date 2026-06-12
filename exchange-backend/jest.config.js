export default {
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s', '**/?(*.)+(spec|test).mjs'],
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.cjs'],
  reporters: [
    'default',
    [
      'jest-html-reporters',
      {
        publicPath: './reports/jest',
        filename: 'report.html',
        expand: true,
        pageTitle: 'API Test Report',
        hideIcon: false,
      },
    ],
  ],
  modulePathIgnorePatterns: ['<rootDir>/node_modules/'],
};
