// Re-runs the API tests with photos stored in PostgreSQL (STORAGE_DRIVER=database),
// the setting used on Render. Written in Node so it works the same on Windows,
// macOS and Linux (an inline `VAR=value cmd` doesn't work in Windows cmd).
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['vitest', 'run'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, STORAGE_DRIVER: 'database' },
});
process.exit(result.status ?? 1);
