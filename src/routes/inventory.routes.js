import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireActiveSubscription } from '../middleware/subscription.js';
import { handleZodError } from '../lib/zodError.js';
import { prisma } from '../lib/prisma.js';
import { serializeInventoryCategory, serializeInventoryItem } from '../lib/serialize.js';
import { sanitizeStrings } from '../lib/sanitize.js';

const router = Router();
router.use(requireAuth);
router.use(requireActiveSubscription);

const itemSchema = z.object({
  part_number: z.string().optional().nullable(),
  name: z.string().min(1),
  stock: z.number().int().optional(),
  cost: z.number().optional(),
  price: z.number().optional(),
  track_stock: z.boolean().optional(),
  category: z.string().optional().nullable(),
});

const categorySchema = z.object({ name: z.string().min(1) });

async function resolveCategoryId(categoryName, mechanicId) {
  if (!categoryName) return null;
  const category = await prisma.inventoryCategory.upsert({
    where: { mechanicId_name: { mechanicId, name: categoryName } },
    create: { mechanicId, name: categoryName },
    update: {},
  });
  return category.id;
}

router.get('/items', async (req, res, next) => {
  try {
    const items = await prisma.inventoryItem.findMany({
      where: { mechanicId: req.mechanicId },
      include: { category: true },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(items.map(serializeInventoryItem));
  } catch (err) {
    next(err);
  }
});

router.post('/items', async (req, res, next) => {
  try {
    const data = sanitizeStrings(itemSchema.parse(req.body));
    const categoryId = await resolveCategoryId(data.category, req.mechanicId);

    const item = await prisma.inventoryItem.create({
      data: {
        mechanicId: req.mechanicId,
        partNumber: data.part_number || null,
        name: data.name,
        stock: data.stock ?? 0,
        cost: data.cost ?? 0,
        price: data.price ?? 0,
        trackStock: data.track_stock ?? true,
        categoryId,
      },
      include: { category: true },
    });
    res.status(201).json(serializeInventoryItem(item));
  } catch (err) {
    if (err.name === 'ZodError') return handleZodError(err, req, res);
    next(err);
  }
});

router.patch('/items/:id', async (req, res, next) => {
  try {
    const data = sanitizeStrings(itemSchema.partial().parse(req.body));
    const existing = await prisma.inventoryItem.findFirst({
      where: { id: req.params.id, mechanicId: req.mechanicId },
    });
    if (!existing) return res.status(404).json({ error: 'Part not found' });

    const categoryId =
      data.category !== undefined ? await resolveCategoryId(data.category, req.mechanicId) : undefined;

    const item = await prisma.inventoryItem.update({
      where: { id: existing.id },
      data: {
        ...(data.part_number !== undefined && { partNumber: data.part_number || null }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.stock !== undefined && { stock: data.stock }),
        ...(data.cost !== undefined && { cost: data.cost }),
        ...(data.price !== undefined && { price: data.price }),
        ...(data.track_stock !== undefined && { trackStock: data.track_stock }),
        ...(categoryId !== undefined && { categoryId }),
      },
      include: { category: true },
    });
    res.json(serializeInventoryItem(item));
  } catch (err) {
    if (err.name === 'ZodError') return handleZodError(err, req, res);
    next(err);
  }
});

router.delete('/items/:id', async (req, res, next) => {
  try {
    const existing = await prisma.inventoryItem.findFirst({
      where: { id: req.params.id, mechanicId: req.mechanicId },
    });
    if (!existing) return res.status(404).json({ error: 'Part not found' });

    await prisma.inventoryItem.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    // onDelete: Restrict on WorkOrderPartUsed.inventoryItemId -- a part
    // that's actually been used on a work order can't be hard-deleted, so
    // surface that as a clear, actionable error instead of a generic 500.
    if (err.code === 'P2003') {
      return res.status(409).json({ error: 'This part is used in a work order and can’t be deleted.' });
    }
    next(err);
  }
});

router.get('/categories', async (req, res, next) => {
  try {
    const categories = await prisma.inventoryCategory.findMany({
      where: { mechanicId: req.mechanicId },
      orderBy: { name: 'asc' },
    });
    res.json(categories.map(serializeInventoryCategory));
  } catch (err) {
    next(err);
  }
});

router.post('/categories', async (req, res, next) => {
  try {
    const data = sanitizeStrings(categorySchema.parse(req.body));
    const category = await prisma.inventoryCategory.create({
      data: { mechanicId: req.mechanicId, name: data.name },
    });
    res.status(201).json(serializeInventoryCategory(category));
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Category already exists' });
    if (err.name === 'ZodError') return handleZodError(err, req, res);
    next(err);
  }
});

router.delete('/categories/:id', async (req, res, next) => {
  try {
    const existing = await prisma.inventoryCategory.findFirst({
      where: { id: req.params.id, mechanicId: req.mechanicId },
    });
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    await prisma.inventoryCategory.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
