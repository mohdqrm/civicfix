import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount whatever each test rendered so the next test starts with an empty page.
afterEach(cleanup);
