import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test', UPLOAD_DIR: 'uploads-test', STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? 'local' },
    include: ['tests/**/*.test.js'],
    // Unit tests written for Node's built-in runner are run separately (see package.json).
    exclude: ['tests/**/*.node.test.js', 'node_modules/**'],
    globalSetup: ['tests/globalSetup.js'],
    // All API test files share one test database, so run them one after another.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
