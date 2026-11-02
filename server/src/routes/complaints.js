// /api/complaints — public browsing + citizen reporting.
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uploadPhoto } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import {
  citizenEditSchema,
  complaintIdParam,
  createComplaintSchema,
  listComplaintsQuery,
  mapQuery,
  similarCheckSchema,
} from '../validation/schemas.js';
import { asyncHandler, badRequest, notFound } from '../utils/errors.js';
import { getComplaintRow, getStatusHistory, listComplaints, mapMarkers, serialize } from '../services/complaintQueries.js';
import { createComplaint, editOwnComplaint } from '../services/complaintService.js';
import { scoreAgainstExisting } from '../services/duplicateService.js';
import { processImage, storage } from '../services/imageStorage.js';

export function complaintsRouter(limiters) {
  const router = Router();

  // Public list with filters: status, category, q, near (lat/lng/radius), pagination.
  router.get(
    '/',
    validate({ query: listComplaintsQuery }),
    asyncHandler(async (req, res) => {
      res.json(await listComplaints(req.valid.query, { view: 'public', currentUserId: req.user?.id }));
    })
  );

  // Lightweight markers for the map page.
  router.get(
    '/map',
    validate({ query: mapQuery }),
    asyncHandler(async (req, res) => {
      res.json({ items: await mapMarkers(req.valid.query) });
    })
  );

  // FR6: before submitting, show the citizen similar reports already filed nearby.
  router.post(
    '/similar',
    requireAuth,
    validate({ body: similarCheckSchema }),
    asyncHandler(async (req, res) => {
      const b = req.valid.body;
      const target = { ...b, createdAt: new Date().toISOString() };
      const { matches } = await scoreAgainstExisting(target);
      const items = [];
      for (const m of matches) {
        // At most 5 matches (detector's maxSuggestions), so one query each is fine.
        const row = await getComplaintRow(m.id);
        if (row) items.push({ ...serialize(row, 'public'), score: m.score, distanceM: m.components.distanceM });
      }
      res.json({ items });
    })
  );

  // Create a complaint (citizens only). multipart/form-data with fields + "photo".
  router.post(
    '/',
    requireRole('citizen'),
    limiters.createComplaint,
    uploadPhoto,
    validate({ body: createComplaintSchema }),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw badRequest('Some fields are invalid', [{ field: 'photo', message: 'Please attach a photo of the problem' }]);
      }
      const processed = await processImage(req.file.buffer);
      const image = await storage.save(processed);
      let id;
      try {
        id = await createComplaint(req.user.id, req.valid.body, image);
      } catch (err) {
        await storage.remove(image.key); // don't leave orphaned files when the DB insert fails
        throw err;
      }
      const row = await getComplaintRow(id);
      res.status(201).json({
        complaint: { ...serialize(row, 'public', req.user.id), statusHistory: await getStatusHistory(id, 'public') },
      });
    })
  );

  // Public details + status timeline. Accepts 42 or CF-000042.
  router.get(
    '/:id',
    validate({ params: complaintIdParam }),
    asyncHandler(async (req, res) => {
      const { id } = req.valid.params;
      const row = await getComplaintRow(id);
      if (!row) throw notFound('Complaint not found');
      res.json({
        complaint: { ...serialize(row, 'public', req.user?.id), statusHistory: await getStatusHistory(id, 'public') },
      });
    })
  );

  // Reporter edits their own complaint while it is still 'submitted'.
  router.patch(
    '/:id',
    requireRole('citizen'),
    validate({ params: complaintIdParam, body: citizenEditSchema }),
    asyncHandler(async (req, res) => {
      const row = await editOwnComplaint(req.valid.params.id, req.user.id, req.valid.body);
      res.json({ complaint: serialize(row, 'public', req.user.id) });
    })
  );

  return router;
}
