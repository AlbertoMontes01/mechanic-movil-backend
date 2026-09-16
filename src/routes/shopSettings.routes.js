import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { serializeShopSettings } from '../lib/serialize.js';

const router = Router();
router.use(requireAuth);

const settingsSchema = z.object({
  shop_name: z.string().min(1),
  logo_url: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  tax_rate: z.number().optional(),
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
        shopName: data.shop_name,
        logoUrl: data.logo_url || null,
        phone: data.phone || null,
        address: data.address || null,
        taxRate: data.tax_rate ?? 0,
      },
      update: {
        shopName: data.shop_name,
        logoUrl: data.logo_url || null,
        phone: data.phone || null,
        address: data.address || null,
        taxRate: data.tax_rate ?? 0,
      },
    });
    res.json(serializeShopSettings(settings));
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid settings data', details: err.issues });
    next(err);
  }
});

export default router;
