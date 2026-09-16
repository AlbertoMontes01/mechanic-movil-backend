import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { serializeVehicle } from '../lib/serialize.js';

const router = Router();
router.use(requireAuth);

const VEHICLE_TYPES = ['Truck', 'Car', 'SUV', 'Van', 'Motorcycle', 'Other'];

const vehicleSchema = z.object({
  client_id: z.string().uuid(),
  vehicle_type: z.enum(VEHICLE_TYPES).optional(),
  vin: z.string().optional().nullable(),
  year: z.number().int().optional().nullable(),
  make: z.string().min(1),
  model: z.string().min(1),
  unit_number: z.string().optional().nullable(),
  plate: z.string().optional().nullable(),
  odometer: z.number().optional().nullable(),
  engine_hours: z.number().optional().nullable(),
  common_parts: z
    .array(
      z.object({
        name: z.string().optional().nullable(),
        value: z.string().optional().nullable(),
        inventory_item_id: z.string().uuid().optional().nullable(),
      })
    )
    .optional(),
});

async function assertClientOwned(clientId, mechanicId) {
  const client = await prisma.client.findFirst({ where: { id: clientId, mechanicId } });
  return Boolean(client);
}

// Same check workOrders.routes.js does for parts_used — a common_parts row
// linking to an inventory item must only ever reference the requesting
// mechanic's own inventory, never another tenant's.
async function assertInventoryOwnership(commonParts, mechanicId) {
  const ids = [...new Set((commonParts || []).map((p) => p.inventory_item_id).filter(Boolean))];
  if (ids.length === 0) return null;
  const count = await prisma.inventoryItem.count({ where: { id: { in: ids }, mechanicId } });
  if (count !== ids.length) return 'One or more common_parts reference an inventory item you do not own';
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    const where = { client: { mechanicId: req.mechanicId } };
    if (req.query.clientId) where.clientId = req.query.clientId;

    const vehicles = await prisma.vehicle.findMany({
      where,
      include: { commonParts: true },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(vehicles.map(serializeVehicle));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: req.params.id, client: { mechanicId: req.mechanicId } },
      include: { commonParts: true },
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(serializeVehicle(vehicle));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = vehicleSchema.parse(req.body);
    if (!(await assertClientOwned(data.client_id, req.mechanicId))) {
      return res.status(404).json({ error: 'Client not found' });
    }
    const inventoryError = await assertInventoryOwnership(data.common_parts, req.mechanicId);
    if (inventoryError) return res.status(400).json({ error: inventoryError });

    const vehicle = await prisma.vehicle.create({
      data: {
        clientId: data.client_id,
        vehicleType: data.vehicle_type,
        vin: data.vin || null,
        year: data.year ?? null,
        make: data.make,
        model: data.model,
        unitNumber: data.unit_number || null,
        plate: data.plate || null,
        odometer: data.odometer ?? null,
        engineHours: data.engine_hours ?? null,
        commonParts: data.common_parts?.length
          ? {
              create: data.common_parts.map((p, i) => ({
                name: p.name || '',
                value: p.value || null,
                inventoryItemId: p.inventory_item_id || null,
                position: i,
              })),
            }
          : undefined,
      },
      include: { commonParts: true },
    });
    res.status(201).json(serializeVehicle(vehicle));
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid vehicle data', details: err.issues });
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const data = vehicleSchema.partial({ client_id: true, make: true, model: true }).parse(req.body);

    const existing = await prisma.vehicle.findFirst({
      where: { id: req.params.id, client: { mechanicId: req.mechanicId } },
    });
    if (!existing) return res.status(404).json({ error: 'Vehicle not found' });

    if (data.common_parts) {
      const inventoryError = await assertInventoryOwnership(data.common_parts, req.mechanicId);
      if (inventoryError) return res.status(400).json({ error: inventoryError });
    }

    const vehicle = await prisma.$transaction(async (tx) => {
      if (data.common_parts) {
        await tx.vehicleCommonPart.deleteMany({ where: { vehicleId: existing.id } });
      }
      return tx.vehicle.update({
        where: { id: existing.id },
        data: {
          ...(data.vehicle_type !== undefined && { vehicleType: data.vehicle_type }),
          ...(data.vin !== undefined && { vin: data.vin || null }),
          ...(data.year !== undefined && { year: data.year }),
          ...(data.make !== undefined && { make: data.make }),
          ...(data.model !== undefined && { model: data.model }),
          ...(data.unit_number !== undefined && { unitNumber: data.unit_number || null }),
          ...(data.plate !== undefined && { plate: data.plate || null }),
          ...(data.odometer !== undefined && { odometer: data.odometer }),
          ...(data.engine_hours !== undefined && { engineHours: data.engine_hours }),
          ...(data.common_parts && {
            commonParts: {
              create: data.common_parts.map((p, i) => ({
                name: p.name || '',
                value: p.value || null,
                inventoryItemId: p.inventory_item_id || null,
                position: i,
              })),
            },
          }),
        },
        include: { commonParts: true },
      });
    });

    res.json(serializeVehicle(vehicle));
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid vehicle data', details: err.issues });
    next(err);
  }
});

export default router;
