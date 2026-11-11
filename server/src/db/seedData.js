// Seed data. Safe to run repeatedly: reference rows use ON CONFLICT DO NOTHING
// and sample complaints are only added when the complaints table is empty.
import bcrypt from 'bcryptjs';

export const DEPARTMENTS = [
  ['Public Works', 'Roads, footpaths, bridges and public buildings'],
  ['Sanitation', 'Garbage collection, street cleaning and public toilets'],
  ['Electrical', 'Streetlights and public electrical fittings'],
  ['Water Supply', 'Water pipelines, leaks and supply interruptions'],
  ['Drainage & Sewerage', 'Storm drains, sewers and waterlogging'],
  ['General Administration', 'Anything that needs triage before routing'],
];

// [slug, name, description, default department]
export const CATEGORIES = [
  ['roads', 'Roads & Potholes', 'Potholes, damaged roads, broken footpaths', 'Public Works'],
  ['garbage', 'Garbage & Sanitation', 'Overflowing bins, dumped waste, dirty public areas', 'Sanitation'],
  ['streetlights', 'Streetlights', 'Dead, flickering or damaged streetlights', 'Electrical'],
  ['water', 'Water Leakage', 'Leaking or burst pipes, wasted water', 'Water Supply'],
  ['drainage', 'Drainage', 'Blocked or overflowing drains, waterlogging', 'Drainage & Sewerage'],
  ['infrastructure', 'Public Infrastructure', 'Damaged benches, signs, bus stops, railings', 'Public Works'],
  ['other', 'Other', 'Anything else', 'General Administration'],
];

export const DEMO_ACCOUNTS = {
  admin: { name: 'Demo Admin', email: 'admin@civicfix.demo', password: 'Admin@12345' },
  citizen: { name: 'Asha Verma', email: 'citizen@civicfix.demo', password: 'Citizen@12345' },
  citizen2: { name: 'Rohan Mehta', email: 'rohan@civicfix.demo', password: 'Citizen@12345' },
};

async function upsertUser(db, { name, email, password }, role, rounds) {
  // The seed runs on every deploy; skip the slow bcrypt hash when the account exists.
  const found = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (found.rows.length) return found.rows[0].id;
  const hash = await bcrypt.hash(password, rounds);
  await db.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
     ON CONFLICT (LOWER(email)) DO NOTHING`,
    [name, email, hash, role]
  );
  return (await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email])).rows[0].id;
}

/** Departments, categories and the admin account. Needed in every environment. */
export async function seedReference(db, { admin = DEMO_ACCOUNTS.admin, bcryptRounds = 12 } = {}) {
  for (const [name, description] of DEPARTMENTS) {
    await db.query('INSERT INTO departments (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [
      name,
      description,
    ]);
  }
  for (const [slug, name, description, dept] of CATEGORIES) {
    await db.query(
      `INSERT INTO categories (slug, name, description, default_department_id)
       VALUES ($1, $2, $3, (SELECT id FROM departments WHERE name = $4))
       ON CONFLICT (slug) DO NOTHING`,
      [slug, name, description, dept]
    );
  }
  const adminId = await upsertUser(db, admin, 'admin', bcryptRounds);
  return { adminId };
}

// Sample reports around Connaught Place, New Delhi.
// [citizen, category slug, title, description, lat, lng, landmark, days ago, status, priority]
const SAMPLES = [
  ['citizen', 'roads', 'Deep pothole on Outer Circle near E Block', 'A deep pothole has formed in the left lane of Outer Circle near E Block. Two-wheelers are swerving suddenly to avoid it.', 28.63195, 77.22055, 'Near E Block, Outer Circle', 6, 'in_progress', 'high'],
  ['citizen2', 'roads', 'Big crater in road in front of E Block', 'There is a big crater in the road right in front of E Block on Outer Circle. A scooter rider fell here yesterday evening.', 28.63205, 77.22063, 'E Block, Connaught Place', 4, 'submitted', 'medium'],
  ['citizen', 'garbage', 'Overflowing dustbin at Janpath market entrance', 'The large dustbin at the Janpath market entrance has not been emptied for three days and garbage is spilling onto the footpath.', 28.62650, 77.21890, 'Janpath market entrance', 3, 'under_review', 'medium'],
  ['citizen2', 'streetlights', 'Streetlights dead on Barakhamba Road', 'Four streetlights in a row are not working on Barakhamba Road between the metro station and Modern School. The stretch is completely dark at night.', 28.62960, 77.22490, 'Barakhamba Road metro', 9, 'resolved', 'high'],
  ['citizen', 'water', 'Water pipe leaking near Shivaji Stadium bus stop', 'Clean water has been leaking from a pipe joint next to the Shivaji Stadium bus stop since morning. The road is getting slippery.', 28.63080, 77.21270, 'Shivaji Stadium bus stop', 2, 'submitted', 'medium'],
  ['citizen2', 'drainage', 'Blocked drain causing waterlogging on Baba Kharak Singh Marg', 'The storm drain near the Hanuman Mandir crossing is blocked with plastic. After yesterday’s rain the road is waterlogged.', 28.62840, 77.21420, 'Hanuman Mandir crossing', 12, 'resolved', 'medium'],
  ['citizen', 'infrastructure', 'Broken bench in Central Park', 'One of the stone benches near the fountain in Central Park is cracked and the seat has collapsed. Children play around it.', 28.63280, 77.21960, 'Central Park fountain', 15, 'rejected', 'low'],
  ['citizen2', 'garbage', 'Construction debris dumped on Panchkuian Road', 'A large pile of construction debris and broken tiles has been dumped on the side of Panchkuian Road, blocking half the footpath.', 28.63420, 77.21050, 'Panchkuian Road', 1, 'submitted', 'medium'],
  ['citizen', 'streetlights', 'Flickering streetlight outside Regal Building', 'The streetlight outside the Regal Building keeps flickering on and off throughout the night.', 28.62890, 77.21700, 'Regal Building', 5, 'under_review', 'low'],
  ['citizen2', 'roads', 'Damaged footpath tiles on Kasturba Gandhi Marg', 'Several footpath tiles are broken and raised on Kasturba Gandhi Marg near the British Council, causing people to trip.', 28.62560, 77.22300, 'Near British Council', 8, 'in_progress', 'medium'],
];

const REJECT_REASON = 'Central Park is maintained by a separate authority; please report it through their helpline.';

/** Demo citizens + sample complaints with realistic status histories. */
export async function seedDemo(db, { adminId, bcryptRounds = 12 }) {
  const ids = {
    citizen: await upsertUser(db, DEMO_ACCOUNTS.citizen, 'citizen', bcryptRounds),
    citizen2: await upsertUser(db, DEMO_ACCOUNTS.citizen2, 'citizen', bcryptRounds),
  };
  const existing = (await db.query('SELECT COUNT(*) AS n FROM complaints')).rows[0].n;
  if (Number(existing) > 0) return { created: [] };

  const path = {
    submitted: [],
    under_review: ['under_review'],
    in_progress: ['under_review', 'in_progress'],
    resolved: ['under_review', 'in_progress', 'resolved'],
    rejected: ['under_review', 'rejected'],
  };
  const created = [];
  for (const [who, slug, title, description, lat, lng, landmark, daysAgo, status, priority] of SAMPLES) {
    const cat = (await db.query('SELECT id, default_department_id FROM categories WHERE slug = $1', [slug])).rows[0];
    const filedAt = new Date(Date.now() - daysAgo * 86400000);
    const steps = path[status];
    const stepAt = (i) => new Date(filedAt.getTime() + (i + 1) * Math.max(1, daysAgo / (steps.length + 1)) * 86400000 * 0.9);
    const { rows } = await db.query(
      `INSERT INTO complaints (user_id, category_id, title, description, latitude, longitude, landmark,
         status, priority, rejection_reason, created_at, updated_at, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        ids[who], cat.id, title, description, lat, lng, landmark, status, priority,
        status === 'rejected' ? REJECT_REASON : null,
        filedAt,
        steps.length ? stepAt(steps.length - 1) : filedAt,
        status === 'resolved' ? stepAt(steps.length - 1) : null,
      ]
    );
    const id = rows[0].id;
    await db.query(
      `INSERT INTO status_history (complaint_id, old_status, new_status, note, changed_by, created_at)
       VALUES ($1, NULL, 'submitted', 'Complaint submitted', $2, $3)`,
      [id, ids[who], filedAt]
    );
    let prev = 'submitted';
    for (const [i, s] of steps.entries()) {
      const note = s === 'rejected' ? `Reason: ${REJECT_REASON}` : s === 'resolved' ? 'Fixed by field team; verified on site.' : null;
      await db.query(
        `INSERT INTO status_history (complaint_id, old_status, new_status, note, changed_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, prev, s, note, adminId, stepAt(i)]
      );
      prev = s;
    }
    if (cat.default_department_id) {
      await db.query(
        `INSERT INTO assignments (complaint_id, department_id, note, created_at) VALUES ($1, $2, 'Auto-assigned from category', $3)`,
        [id, cat.default_department_id, filedAt]
      );
    }
    created.push(id);
  }
  return { created };
}
