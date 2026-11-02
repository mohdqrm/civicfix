// The complete CivicFix journey from the project brief (Step 9E), in a real browser:
//  citizen registers → logs in → reports a pothole with a photo → sees it on the
//  dashboard and the public map → admin logs in, opens it, changes the status →
//  citizen logs back in and sees the update. Plus a failed submission and an
//  unauthorized admin attempt.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.join(here, 'fixtures/pothole.jpg');
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? 'admin@civicfix.demo', password: process.env.E2E_ADMIN_PASSWORD ?? 'Admin@12345' };
const shots = (name) => ({ path: path.join(here, '../test-results/journey', `${name}.png`), fullPage: true });

const stamp = Date.now().toString(36);
const citizen = { name: 'Meera Joshi', email: `meera.${stamp}@example.test`, password: 'Pothole2026' };
const report = {
  title: `Deep pothole near Gate 4 (${stamp})`,
  description: 'A deep pothole has opened up in the left lane right outside Gate 4. Two-wheelers are swerving into traffic to avoid it.',
};

async function logIn(page, { email, password }, { expectFailure = false } = {}) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  // Wait for the post-login redirect so the next step doesn't race it.
  if (!expectFailure) await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe.configure({ mode: 'serial' });

let trackingId;
let complaintId;

test('1–2. a citizen registers, logs out and logs back in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign up' }).click();
  await page.getByLabel('Full name').fill(citizen.name);
  await page.getByLabel('Email').fill(citizen.email);
  await page.getByLabel('Password', { exact: true }).fill(citizen.password);
  await page.getByLabel('Confirm password').fill(citizen.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Hello, Meera' })).toBeVisible();
  await expect(page.getByText('You haven’t reported anything yet')).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();

  await logIn(page, { email: citizen.email, password: 'WrongPass1' }, { expectFailure: true });
  await expect(page.getByRole('alert')).toContainText('Incorrect email or password');
  await logIn(page, citizen);
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('failed submissions: empty form and a disguised file are refused with clear messages', async ({ page }) => {
  await logIn(page, citizen);
  await page.goto('/report');
  let posted = false;
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/complaints') && (posted = true));
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByText('Choose what kind of problem this is')).toBeVisible();
  await expect(page.getByText('Mark where the problem is on the map')).toBeVisible();
  await expect(page.getByText('Add a photo of the problem')).toBeVisible();
  expect(posted).toBe(false); // the browser caught it before calling the server
  await page.screenshot(shots('report-validation'));

  // A text file renamed to .jpg passes the browser's check, but the server inspects the bytes.
  await page.getByText('Roads & Potholes', { exact: true }).click();
  await page.getByLabel('Title').fill('This upload is not really a photo');
  await page.getByLabel('Description').fill('Testing that disguised files are rejected by the server.');
  await page.locator('.leaflet-container').click({ position: { x: 200, y: 150 } });
  await page.setInputFiles('#photo', { name: 'pothole.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('<?php echo "hi"; ?>') });
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByRole('alert')).toContainText('not a valid image');
  await expect(page.getByRole('heading', { name: 'Report submitted' })).toHaveCount(0);
});

test('3–6. the citizen reports a pothole with a photo and sees it on their dashboard', async ({ page }) => {
  await logIn(page, citizen);
  await page.getByRole('link', { name: 'Report an issue' }).first().click();
  await expect(page.getByRole('heading', { name: 'Report an issue' })).toBeVisible();

  await page.getByText('Roads & Potholes', { exact: true }).click();
  await page.getByLabel('Title').fill(report.title);
  await page.getByLabel('Description').fill(report.description);
  const map = page.locator('.leaflet-container');
  const box = await map.boundingBox();
  // Vary the spot each run so repeated runs don't stack pins on top of each other.
  const jitter = (parseInt(stamp.slice(-3), 36) % 200) - 100;
  await map.click({ position: { x: box.width / 2 + jitter, y: box.height / 2 - jitter / 2 } });
  await expect(page.getByText(/^Pinned at /)).toBeVisible();
  await page.getByLabel('Nearby landmark (optional)').fill('Outside Gate 4');
  await page.setInputFiles('#photo', PHOTO);
  await expect(page.getByAltText('Selected photo')).toBeVisible();
  await page.screenshot(shots('report-filled'));

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/complaints') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Submit report' }).click(),
  ]);
  expect(response.status()).toBe(201);
  complaintId = (await response.json()).complaint.id;

  await expect(page.getByRole('heading', { name: 'Report submitted' })).toBeVisible();
  trackingId = (await page.locator('.ticket-id').textContent()).trim();
  expect(trackingId).toMatch(/^CF-\d{6}$/);
  await expect(page.getByText('Public Works')).toBeVisible(); // auto-routed by category
  await page.screenshot(shots('report-submitted'));

  // 5. Saved in the database: the API (which reads the DB) returns it, photo included.
  const saved = await page.request.get(`/api/complaints/${trackingId}`);
  expect(saved.status()).toBe(200);
  const body = await saved.json();
  expect(body.complaint.title).toBe(report.title);
  expect(body.complaint.imageUrl).toMatch(/\.webp$/);
  expect((await page.request.get(body.complaint.imageUrl)).headers()['content-type']).toBe('image/webp');

  // 6. Appears on the citizen dashboard.
  await page.getByRole('link', { name: 'Go to my reports' }).click();
  const row = page.locator('.row', { hasText: report.title });
  await expect(row).toBeVisible();
  await expect(row).toContainText(trackingId);
  await expect(row.locator('.badge')).toHaveText('Submitted');
  await page.screenshot(shots('dashboard-submitted'));
});

test('7. the complaint is on the public map without the reporter’s identity', async ({ page }) => {
  await page.goto('/map'); // logged out: anyone can see the map
  const pin = page.locator(`.leaflet-marker-icon[title^="${trackingId}:"]`);
  await expect(pin).toHaveCount(1);
  await pin.dispatchEvent('click'); // click this exact pin even if another overlaps it
  const popup = page.locator('.leaflet-popup-content');
  await expect(popup).toContainText(report.title);
  await expect(popup).not.toContainText(citizen.name);
  await expect(popup).not.toContainText(citizen.email);
  await page.screenshot(shots('map-popup'));

  // The public details page doesn't reveal the reporter either.
  await popup.getByRole('link', { name: 'View details' }).click();
  await expect(page.getByRole('heading', { name: report.title })).toBeVisible();
  const text = await page.locator('main').innerText();
  expect(text).not.toContain(citizen.email);
  expect(text).not.toContain(citizen.name);
});

test('unauthorized: a citizen cannot reach or use admin features', async ({ page }) => {
  await logIn(page, citizen);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/dashboard$/); // bounced back to their own dashboard

  const res = await page.request.patch(`/api/admin/complaints/${complaintId}/status`, { data: { status: 'resolved' } });
  expect(res.status()).toBe(403);
  const still = await (await page.request.get(`/api/complaints/${complaintId}`)).json();
  expect(still.complaint.status).toBe('submitted');

  await page.getByRole('button', { name: 'Log out' }).click();
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(citizen.email);
  await page.getByLabel('Password').fill(citizen.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toContainText('isn’t an administrator');
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test('8–10. an administrator opens the complaint and moves it to In progress', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.screenshot(shots('admin-dashboard'));

  await page.getByRole('link', { name: 'Complaints', exact: true }).click();
  await page.getByLabel('Search').fill(trackingId);
  await page.getByLabel('Search').press('Enter');
  await page.getByRole('link', { name: report.title }).click();
  await expect(page.getByRole('heading', { name: report.title })).toBeVisible();
  await expect(page.getByText(citizen.email)).toBeVisible(); // admins do see the reporter

  await page.getByLabel('New status').selectOption('in_progress');
  await page.getByLabel('Note (optional)').first().fill('Repair crew scheduled for Friday morning.');
  await page.getByRole('button', { name: 'Change to In progress' }).click();
  await expect(page.locator('.toast')).toContainText('Status changed to In progress');
  await expect(page.locator('.badge').first()).toHaveText('In progress');
  await page.screenshot(shots('admin-complaint'));
});

test('11. the citizen logs back in and sees the new status and a notification', async ({ page }) => {
  await logIn(page, citizen);
  await expect(page.getByRole('link', { name: /My reports/ }).locator('.nav-badge')).toHaveText('1');
  const row = page.locator('.row', { hasText: report.title });
  await expect(row.locator('.badge')).toHaveText('In progress');
  await expect(page.locator('.notice-list')).toContainText(`${trackingId}`);
  await expect(page.locator('.notice-list')).toContainText('is now In progress');
  await page.screenshot(shots('dashboard-updated'));

  await row.click();
  await expect(page.locator('.road-stop.current')).toContainText('In progress');
  await expect(page.locator('.history')).toContainText('Repair crew scheduled for Friday morning.');
  await page.screenshot(shots('detail-in-progress'));
});
