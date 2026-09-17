import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { serializeShopSettings } from '../lib/serialize.js';
import { stripHtml } from '../lib/sanitize.js';
import { detectImageType } from '../lib/imageValidation.js';

const router = Router();
router.use(requireAuth);

const LOGO_DIR = path.join(process.cwd(), 'uploads', 'logos');
fs.mkdirSync(LOGO_DIR, { recursive: true });

const settingsSchema = z.object({
  shop_name: z.string().min(1),
  logo_url: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  tax_rate: z.number().optional(),
  invoice_terms: z.string().optional().nullable(),
});

router.get('/', async (req, res, next) => {
  try {
    const settings = await prisma.shopSettings.findUnique({ where: { mechanicId: req.mechanicId } });
    res.json(serializeShopSettings(settings));
  } catch (err) {
    next(err);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const data = settingsSchema.parse(req.body);
    const settings = await prisma.shopSettings.upsert({
      where: { mechanicId: req.mechanicId },
      create: {
        mechanicId: req.mechanicId,
        shopName: stripHtml(data.shop_name),
        logoUrl: data.logo_url || null,
        phone: stripHtml(data.phone) || null,
        address: stripHtml(data.address) || null,
        taxRate: data.tax_rate ?? 0,
        invoiceTerms: stripHtml(data.invoice_terms) || null,
      },
      update: {
        shopName: stripHtml(data.shop_name),
        logoUrl: data.logo_url || null,
        phone: stripHtml(data.phone) || null,
        address: stripHtml(data.address) || null,
        taxRate: data.tax_rate ?? 0,
        invoiceTerms: stripHtml(data.invoice_terms) || null,
      },
    });
    res.json(serializeShopSettings(settings));
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid settings data', details: err.issues });
    next(err);
  }
});

// In-memory only -- nothing touches disk until the content itself has been
// verified to actually be an image (see detectImageType), so a malicious
// upload never gets written under a trusted-looking name.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

router.post('/logo', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const detected = detectImageType(req.file.buffer);
    if (!detected) {
      return res.status(400).json({ error: 'That file isn’t a recognized image (PNG, JPEG, GIF, or WEBP).' });
    }

    const filename = `${randomUUID()}.${detected.ext}`;
    fs.writeFileSync(path.join(LOGO_DIR, filename), req.file.buffer);

    // Best-effort cleanup of the previous logo so uploads/logos doesn't
    // grow unbounded -- never lets a failure here fail the request, the
    // new logo is already saved and the old file is harmless if it lingers.
    try {
      const existing = await prisma.shopSettings.findUnique({ where: { mechanicId: req.mechanicId } });
      const oldFilename = existing?.logoUrl?.split('/uploads/logos/')[1];
      if (oldFilename && /^[a-f0-9-]+\.(png|jpg|gif|webp)$/i.test(oldFilename)) {
        fs.unlink(path.join(LOGO_DIR, oldFilename), () => {});
      }
    } catch {
      // non-fatal
    }

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/logos/${filename}`;
    res.json({ file_url: fileUrl });
  } catch (err) {
    next(err);
  }
});

export default router;
