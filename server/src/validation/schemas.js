// Every piece of input the API accepts is described here with Zod.
// The limits match the database CHECK constraints in 001_initial_schema.sql, so
// bad data is caught early with a friendly message instead of a DB error.
import { z } from 'zod';

export const STATUSES = ['submitted', 'under_review', 'in_progress', 'resolved', 'rejected'];
export const PRIORITIES = ['low', 'medium', 'high', 'critical'];

const trimmed = (min, max, label) =>
  z
    .string({ message: `${label} is required` })
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

const email = z
  .string({ message: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(255, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

const password = z
  .string({ message: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters') // bcrypt only uses the first 72 bytes
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')
  .optional()
  .or(z.literal('').transform(() => undefined));

const id = z.coerce.number({ message: 'Must be a number' }).int().positive();

// Accepts "42" or the tracking form "CF-000042".
export const complaintIdParam = z.object({
  id: z
    .string()
    .trim()
    .regex(/^(CF-)?\d{1,9}$/i, 'Invalid complaint ID')
    .transform((v) => Number(v.replace(/^CF-/i, ''))),
});

export const idParam = z.object({ id });

// ---------- auth ----------
export const registerSchema = z.object({
  name: trimmed(2, 100, 'Name'),
  email,
  password,
  phone,
});

export const loginSchema = z.object({
  email,
  password: z.string({ message: 'Password is required' }).min(1, 'Password is required').max(200),
});

export const updateProfileSchema = z
  .object({ name: trimmed(2, 100, 'Name').optional(), phone: phone.or(z.null()) })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

// ---------- complaints ----------
const latitude = z.coerce
  .number({ message: 'Latitude is required' })
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');
const longitude = z.coerce
  .number({ message: 'Longitude is required' })
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

export const createComplaintSchema = z.object({
  categoryId: id,
  title: trimmed(5, 120, 'Title'),
  description: trimmed(10, 2000, 'Description'),
  latitude,
  longitude,
  landmark: optionalText(200, 'Landmark'),
});

export const similarCheckSchema = createComplaintSchema.omit({ landmark: true });

export const citizenEditSchema = z
  .object({
    title: trimmed(5, 120, 'Title').optional(),
    description: trimmed(10, 2000, 'Description').optional(),
    landmark: optionalText(200, 'Landmark'),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');

const csvOf = (allowed) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .refine((arr) => !arr || arr.every((s) => allowed.includes(s)), `Allowed values: ${allowed.join(', ')}`);

export const listComplaintsQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: csvOf(STATUSES),
    category: z.string().trim().max(50).optional(), // id or slug
    q: z.string().trim().max(100).optional(),
    lat: latitude.optional(),
    lng: longitude.optional(),
    radius: z.coerce.number().min(10).max(50000).default(2000), // metres
    sort: z.enum(['newest', 'oldest', 'updated', 'priority', 'distance']).default('newest'), // distance needs lat/lng
    // admin-only filters (ignored on public routes)
    priority: csvOf(PRIORITIES),
    departmentId: id.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    hasDuplicates: z.enum(['true', 'false']).optional(),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng must be given together',
    path: ['lat'],
  });

export const mapQuery = z
  .object({
    status: csvOf(STATUSES),
    category: z.string().trim().max(50).optional(),
    lat: latitude.optional(),
    lng: longitude.optional(),
    radius: z.coerce.number().min(10).max(50000).default(5000),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng must be given together',
    path: ['lat'],
  });

// ---------- admin ----------
export const statusUpdateSchema = z
  .object({
    status: z.enum(STATUSES, { message: `Status must be one of: ${STATUSES.join(', ')}` }),
    note: optionalText(1000, 'Note'),
    rejectionReason: optionalText(1000, 'Rejection reason'),
  })
  .refine((v) => v.status !== 'rejected' || (v.rejectionReason && v.rejectionReason.length >= 5), {
    message: 'A rejection reason of at least 5 characters is required',
    path: ['rejectionReason'],
  });

export const adminEditSchema = z
  .object({
    priority: z.enum(PRIORITIES, { message: `Priority must be one of: ${PRIORITIES.join(', ')}` }).optional(),
    categoryId: id.optional(),
  })
  .refine((v) => v.priority !== undefined || v.categoryId !== undefined, 'Nothing to update');

export const assignSchema = z.object({
  departmentId: id,
  note: optionalText(1000, 'Note'),
});

export const duplicateReviewSchema = z.object({
  decision: z.enum(['confirmed', 'dismissed'], { message: 'Decision must be confirmed or dismissed' }),
});

export const duplicateListQuery = z.object({
  status: z.enum(['pending', 'confirmed', 'dismissed']).default('pending'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug may contain only lowercase letters, numbers and hyphens')
  .max(50);

export const createCategorySchema = z.object({
  slug,
  name: trimmed(2, 100, 'Name'),
  description: optionalText(500, 'Description'),
  defaultDepartmentId: id.optional(),
});

export const updateCategorySchema = z
  .object({
    name: trimmed(2, 100, 'Name').optional(),
    description: optionalText(500, 'Description'),
    defaultDepartmentId: id.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread: z.enum(['true', 'false']).optional(),
});
