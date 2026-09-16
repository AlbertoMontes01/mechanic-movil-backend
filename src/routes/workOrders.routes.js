import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { serializeWorkOrder, workOrderStatusFromWire } from '../lib/serialize.js';
import { stripHtml } from '../lib/sanitize.js';

const router = Router();
router.use(requireAuth);

const STATUSES = ['Draft', 'In Progress', 'Ready to Invoice', 'Invoiced'];

const partUsedSchema = z.object({
  inventory_item_id: z.string().uuid({ message: 'Each part used must reference an inventory item' }),
  quantity: z.number().int().min(1).optional(),
});

const subjectSchema = z.object({
  description: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  parts_used: z.array(partUsedSchema).optional(),
});

const workOrderSchema = z.object({
  client_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  technician_name: z.string().optional().nullable(),
  status: z.enum(STATUSES).optional(),
  date: z.string().optional().nullable(),
  general_notes: z.string().optional().nullable(),
  subjects: z.array(subjectSchema).optional(),
});

const include = {
  subjects: { include: { partsUsed: { include: { inventoryItem: true } } } },
};

async function assertOwnership({ clientId, vehicleId, mechanicId }) {
  const client = await prisma.client.findFirst({ where: { id: clientId, mechanicId } });
  if (!client) return 'Client not found';
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, clientId } });
  if (!vehicle) return 'Vehicle not found for this client';
  return null;
}

async function assertInventoryOwnership(subjects, mechanicId) {
  const ids = [...new Set(subjects.flatMap((s) => (s.parts_used || []).map((p) => p.inventory_item_id)))];
  if (ids.length === 0) return null;
  const count = await prisma.inventoryItem.count({ where: { id: { in: ids }, mechanicId } });
  if (count !== ids.length) return 'One or more parts_used reference an inventory item you do not own';
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    const where = { client: { mechanicId: req.mechanicId } };
    if (req.query.vehicleId) where.vehicleId = req.query.vehicleId;

    const workOrders = await prisma.workOrder.findMany({
      where,
      include,
      orderBy: { date: 'desc' },
    });
    res.json(workOrders.map(serializeWorkOrder));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: req.params.id, client: { mechanicId: req.mechanicId } },
      include,
    });
    if (!workOrder) return res.status(404).json({ error: 'Work order not found' });
    res.json(serializeWorkOrder(workOrder));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = workOrderSchema.parse(req.body);

    const ownershipError = await assertOwnership({
      clientId: data.client_id,
      vehicleId: data.vehicle_id,
      mechanicId: req.mechanicId,
    });
    if (ownershipError) return res.status(404).json({ error: ownershipError });

    const subjects = data.subjects || [];
    const inventoryError = await assertInventoryOwnership(subjects, req.mechanicId);
    if (inventoryError) return res.status(400).json({ error: inventoryError });

    const workOrder = await prisma.workOrder.create({
      data: {
        clientId: data.client_id,
        vehicleId: data.vehicle_id,
        technicianName: stripHtml(data.technician_name) || null,
        status: data.status ? workOrderStatusFromWire(data.status) : undefined,
        date: data.date ? new Date(data.date) : null,
        generalNotes: stripHtml(data.general_notes) || null,
        subjects: {
          create: subjects.map((s, i) => ({
            description: stripHtml(s.description) || null,
            note: stripHtml(s.note) || null,
            position: i,
            partsUsed: {
              create: (s.parts_used || []).map((p) => ({
                inventoryItemId: p.inventory_item_id,
                quantity: p.quantity ?? 1,
              })),
            },
          })),
        },
      },
      include,
    });
    res.status(201).json(serializeWorkOrder(workOrder));
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid work order data', details: err.issues });
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const data = workOrderSchema.partial({ client_id: true, vehicle_id: true }).parse(req.body);

    const existing = await prisma.workOrder.findFirst({
      where: { id: req.params.id, client: { mechanicId: req.mechanicId } },
    });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });

    if (data.subjects) {
      const inventoryError = await assertInventoryOwnership(data.subjects, req.mechanicId);
      if (inventoryError) return res.status(400).json({ error: inventoryError });
    }

    const workOrder = await prisma.$transaction(async (tx) => {
      if (data.subjects) {
        await tx.workOrderSubject.deleteMany({ where: { workOrderId: existing.id } });
      }
      return tx.workOrder.update({
        where: { id: existing.id },
        data: {
          ...(data.technician_name !== undefined && { technicianName: stripHtml(data.technician_name) || null }),
          ...(data.status !== undefined && { status: workOrderStatusFromWire(data.status) }),
          ...(data.date !== undefined && { date: data.date ? new Date(data.date) : null }),
          ...(data.general_notes !== undefined && { generalNotes: stripHtml(data.general_notes) || null }),
          ...(data.subjects && {
            subjects: {
              create: data.subjects.map((s, i) => ({
                description: stripHtml(s.description) || null,
                note: stripHtml(s.note) || null,
                position: i,
                partsUsed: {
                  create: (s.parts_used || []).map((p) => ({
                    inventoryItemId: p.inventory_item_id,
                    quantity: p.quantity ?? 1,
                  })),
                },
              })),
            },
          }),
        },
        include,
      });
    });

    res.json(serializeWorkOrder(workOrder));
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid work order data', details: err.issues });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.workOrder.findFirst({
      where: { id: req.params.id, client: { mechanicId: req.mechanicId } },
    });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });

    await prisma.workOrder.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
