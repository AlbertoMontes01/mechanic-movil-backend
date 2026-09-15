import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Replaces base44.entities.ShopSettings.list/create/update.
// One row per mechanic (unique mechanicId), not a global singleton — get-or-
// create semantics on read, matching ShopSettingsContext.jsx's load().
//
// taxRate is a PERCENTAGE (e.g. 8.5), not a fraction — confirmed decision.
//
// logoUrl upload (Settings.jsx onLogo, was base44.integrations.Core.
// UploadPublicFile) still needs a storage decision (local disk vs S3/
// Cloudinary) — not resolved yet, flagging rather than assuming.

// TODO: GET   /   -> get-or-null the settings row for req.mechanicId (ShopSettingsContext.jsx load)
// TODO: PUT   /   -> upsert settings for req.mechanicId (Settings.jsx submit)
// TODO: POST  /logo -> upload shop logo, return a URL (Settings.jsx onLogo) — needs storage decision

export default router;
