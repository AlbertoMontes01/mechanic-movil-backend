import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { serializeInvoice } from '../lib/serialize.js';
import { stripHtml } from '../lib/sanitize.js';

const router = Router();
router.use(requireAuth);

const lineSchema = z.object({
  description: z.string().optional().nullable(),
  quantity: z.number().optional(),
  unit_price: z.number().optional(),
  total: z.number().optional(),
  inventory_item_id: z.string().uuid().optional().nullable(),
});

const invoiceSchema = z.object({
  work_order_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  invoice_number: z.string().optional().nullable(),
  date: z.string().optional().nullable(),
  status: z.enum(['pending', 'paid']).optional(),
  subtotal: z.number().optional(),
  tax: z.number().optional(),
  total: z.number().optional(),
  customer_note: z.string().optional().nullable(),
  lines: z.array(lineSchema).optional(),
});

const include = { lines: true };

function computeLine(l) {
  const quantity = l.quantity ?? 1;
  const unitPrice = l.unit_price ?? 0;
  return {
    description: stripHtml(l.description) || null,
    quantity,
    unitPrice,
    total: quantity * unitPrice,
    inventoryItemId: l.inventory_item_id || null,
  };
}

async function assertInventoryOwnership(lines, mechanicId) {
  const ids = [...new Set((lines || []).map((l) => l.inventory_item_id).filter(Boolean))];
  if (ids.length === 0) return null;
  const count = await prisma.inventoryItem.count({ where: { id: { in: ids }, mechanicId } });
  if (count !== ids.length) return 'One or more lines reference an inventory item you do not own';
  return null;
}

// A standalone invoice (no work_order_id) is the only place its own
// product lines' stock impact is tracked -- an invoice generated FROM a
// work order doesn't touch stock again here, since the work order's own
// parts_used already did when it was logged (see workOrders.routes.js).
// Double-decrementing the same usage is exactly the bug this guards.
function sumQuantitiesByItem(lines) {
  const totals = new Map();
  for (const l of lines) {
    if (!l.inventoryItemId) continue;
    totals.set(l.inventoryItemId, (totals.get(l.inventoryItemId) || 0) + (l.quantity ?? 1));
  }
  return totals;
}

async function adjustStock(tx, quantitiesByItem, sign) {
  for (const [inventoryItemId, qty] of quantitiesByItem) {
    await tx.inventoryItem.update({
      where: { id: inventoryItemId },
      data: { stock: { increment: sign * qty } },
    });
  }
}

router.get('/', async (req, res, next) => {
  try {
    const where = { client: { mechanicId: req.mechanicId } };
    if (req.query.vehicleId) where.vehicleId = req.query.vehicleId;

    const invoices = await prisma.invoice.findMany({ where, include, orderBy: { date: 'desc' } });
    res.json(invoices.map(serializeInvoice));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, client: { mechanicId: req.mechanicId } },
      include,
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(serializeInvoice(invoice));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = invoiceSchema.parse(req.body);

    const client = await prisma.client.findFirst({ where: { id: data.client_id, mechanicId: req.mechanicId } });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const vehicle = await prisma.vehicle.findFirst({ where: { id: data.vehicle_id, clientId: data.client_id } });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found for this client' });

    if (data.work_order_id) {
      const workOrder = await prisma.workOrder.findFirst({
        where: { id: data.work_order_id, client: { mechanicId: req.mechanicId } },
        include: { invoice: true },
      });
      if (!workOrder) return res.status(404).json({ error: 'Work order not found' });
      if (workOrder.invoice) return res.status(409).json({ error: 'This work order already has an invoice' });
    }

    const inventoryError = await assertInventoryOwnership(data.lines || [], req.mechanicId);
    if (inventoryError) return res.status(400).json({ error: inventoryError });

    const lines = (data.lines || []).map(computeLine);
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const tax = data.tax ?? 0;
    const total = subtotal + tax;

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          workOrderId: data.work_order_id || null,
          clientId: data.client_id,
          vehicleId: data.vehicle_id,
          invoiceNumber: stripHtml(data.invoice_number) || null,
          date: data.date ? new Date(data.date) : null,
          status: data.status || 'pending',
          subtotal,
          tax,
          total,
          customerNote: stripHtml(data.customer_note) || null,
          stockAdjustedHere: !data.work_order_id,
          lines: { create: lines.map((l, i) => ({ ...l, position: i })) },
        },
        include,
      });

      if (data.work_order_id) {
        await tx.workOrder.update({ where: { id: data.work_order_id }, data: { status: 'Invoiced' } });
      } else {
        // Only a standalone invoice adjusts stock itself -- one tied to a
        // work order already had its parts consumed when that work order
        // was created/logged.
        await adjustStock(tx, sumQuantitiesByItem(lines), -1);
      }

      return created;
    });

    res.status(201).json(serializeInvoice(invoice));
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid invoice data', details: err.issues });
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const data = invoiceSchema.partial({ client_id: true, vehicle_id: true }).parse(req.body);

    const existing = await prisma.invoice.findFirst({
      where: { id: req.params.id, client: { mechanicId: req.mechanicId } },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    if (data.lines) {
      const inventoryError = await assertInventoryOwnership(data.lines, req.mechanicId);
      if (inventoryError) return res.status(400).json({ error: inventoryError });
    }

    let subtotal, tax, total, linesUpdate;
    if (data.lines) {
      const lines = data.lines.map(computeLine);
      subtotal = lines.reduce((s, l) => s + l.total, 0);
      tax = data.tax ?? Number(existing.tax);
      total = subtotal + tax;
      linesUpdate = lines;
    } else if (data.tax !== undefined) {
      subtotal = Number(existing.subtotal);
      tax = data.tax;
      total = subtotal + tax;
    }

    const invoice = await prisma.$transaction(async (tx) => {
      if (linesUpdate) {
        // Same rule as creating one: a standalone invoice (no
        // work_order_id) owns its own stock impact -- restore what the
        // old lines held before consuming what the new ones do, so
        // editing a quantity doesn't just pile a second decrement on top.
        if (existing.stockAdjustedHere) {
          const oldLines = await tx.invoiceLine.findMany({ where: { invoiceId: existing.id } });
          await adjustStock(tx, sumQuantitiesByItem(oldLines.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity }))), +1);
        }
        await tx.invoiceLine.deleteMany({ where: { invoiceId: existing.id } });
      }
      const updated = await tx.invoice.update({
        where: { id: existing.id },
        data: {
          ...(data.invoice_number !== undefined && { invoiceNumber: stripHtml(data.invoice_number) || null }),
          ...(data.date !== undefined && { date: data.date ? new Date(data.date) : null }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.customer_note !== undefined && { customerNote: stripHtml(data.customer_note) || null }),
          ...(subtotal !== undefined && { subtotal, tax, total }),
          ...(linesUpdate && { lines: { create: linesUpdate.map((l, i) => ({ ...l, position: i })) } }),
        },
        include,
      });

      if (linesUpdate && existing.stockAdjustedHere) {
        await adjustStock(tx, sumQuantitiesByItem(linesUpdate), -1);
      }

      return updated;
    });

    res.json(serializeInvoice(invoice));
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid invoice data', details: err.issues });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.invoice.findFirst({
      where: { id: req.params.id, client: { mechanicId: req.mechanicId } },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    // Deliberately does NOT restore stock, even for a standalone invoice
    // that decremented it (stockAdjustedHere) -- the part was physically
    // used; deleting the invoice record afterward doesn't undo that. Only
    // create/edit adjust stock.
    await prisma.invoice.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
