// npm run db:seed — departments, categories, admin account, and (outside production)
// demo citizens + sample complaints. Run `npm run db:migrate` first.
//
// In production the admin password must come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD;
// the demo password is refused so a public deployment never has a known admin login.
// (For a college demo deployment you can set SEED_DEMO=true to load sample data too.)
import { pool } from '../src/db/pool.js';
import { config } from '../src/config.js';
import { DEMO_ACCOUNTS, seedDemo, seedReference } from '../src/db/seedData.js';
import { detectAndStore } from '../src/services/duplicateService.js';

try {
  const admin = {
    name: process.env.SEED_ADMIN_NAME ?? DEMO_ACCOUNTS.admin.name,
    email: process.env.SEED_ADMIN_EMAIL ?? DEMO_ACCOUNTS.admin.email,
    password: process.env.SEED_ADMIN_PASSWORD ?? DEMO_ACCOUNTS.admin.password,
  };
  if (config.isProd && admin.password === DEMO_ACCOUNTS.admin.password) {
    throw new Error('Set SEED_ADMIN_PASSWORD (and SEED_ADMIN_EMAIL) before seeding a production database.');
  }
  const { adminId } = await seedReference(pool, { admin });
  console.log(`departments, categories and admin (${admin.email}) ready`);

  if (!config.isProd || process.env.SEED_DEMO === 'true') {
    const { created } = await seedDemo(pool, { adminId });
    if (created.length) {
      let suggestions = 0;
      for (const id of created) suggestions += await detectAndStore(id);
      console.log(`added ${created.length} sample complaints; duplicate detector made ${suggestions} suggestion(s)`);
    } else {
      console.log('complaints already exist — sample complaints skipped');
    }
    console.log(`demo citizen: ${DEMO_ACCOUNTS.citizen.email} / ${DEMO_ACCOUNTS.citizen.password}`);
    if (!process.env.SEED_ADMIN_PASSWORD) console.log(`demo admin:   ${admin.email} / ${admin.password}`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
