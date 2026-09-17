import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { handleZodError } from '../lib/zodError.js';
import { prisma } from '../lib/prisma.js';
import { serializeClient } from '../lib/serialize.js';
import { sanitizeStrings } from '../lib/sanitize.js';

const router = Router();
router.use(requireAuth);

const clientSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  phone: z.string().min(1),
  email: z.string().email().optional().nullable().or(z.literal('')),
});

router.get('/', async (req, res, next) => {
  try {
    const clients = await prisma.client.findMany({
      where: { mechanicId: req.mechanicId },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(clients.map(serializeClient));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id, mechanicId: req.mechanicId },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(serializeClient(client));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = sanitizeStrings(clientSchema.parse(req.body));
    const client = await prisma.client.create({
      data: { ...data, mechanicId: req.mechanicId },
    });
    res.status(201).json(serializeClient(client));
  } catch (err) {
    if (err.name === 'ZodError') return handleZodError(err, req, res);
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const data = sanitizeStrings(clientSchema.partial().parse(req.body));
    const existing = await prisma.client.findFirst({
      where: { id: req.params.id, mechanicId: req.mechanicId },
    });
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    const client = await prisma.client.update({ where: { id: existing.id }, data });
    res.json(serializeClient(client));
  } catch (err) {
    if (err.name === 'ZodError') return handleZodError(err, req, res);
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.client.findFirst({
      where: { id: req.params.id, mechanicId: req.mechanicId },
    });
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    // Cascades away this client's vehicles, work orders, and invoices
    // (onDelete: Cascade). Deliberately does NOT restore any stock those
    // work orders/invoices had consumed -- see workOrders.routes.js and
    // invoices.routes.js for why deleting never restores stock.
    await prisma.client.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
