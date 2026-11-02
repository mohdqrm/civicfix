// Mobile checks (runs in the "mobile" project, Pixel 7 viewport):
// no page scrolls sideways, and the collapsed menu opens and works.
import { test, expect } from '@playwright/test';

const PAGES = ['/', '/issues', '/map', '/login', '/register', '/issues/1', '/admin/login'];

for (const p of PAGES) {
  test(`no horizontal scrolling on ${p}`, async ({ page }) => {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('menu button opens the navigation on small screens', async ({ page }) => {
  await page.goto('/');
  const browse = page.getByRole('link', { name: 'Browse issues' });
  await expect(browse).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(browse).toBeVisible();
  await browse.click();
  await expect(page).toHaveURL(/\/issues$/);
  await expect(browse).toBeHidden(); // closes after navigating
});
