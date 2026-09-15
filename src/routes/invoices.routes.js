import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { serializeInvoice } from '../lib/serialize.js';

const router = Router();
router.use(requireAuth);

const lineSchema = z.object({
  description: z.string().optional().nullable(),
  quantity: z.number().optional(),
  unit_price: z.number().optional(),
  total: z.number().optional(),
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
  lines: z.array(lineSchema).optional(),
});

const include = { lines: true };

function computeLine(l) {
  const quantity = l.quantity ?? 1;
  const unitPrice = l.unit_price ?? 0;
  return { description: l.description || null, quantity, unitPrice, total: quantity * unitPrice };
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
          invoiceNumber: data.invoice_number || null,
          date: data.date ? new Date(data.date) : null,
          status: data.status || 'pending',
          subtotal,
          tax,
          total,
          lines: { create: lines.map((l, i) => ({ ...l, position: i })) },
        },
        include,
      });

      if (data.work_order_id) {
        await tx.workOrder.update({ where: { id: data.work_order_id }, data: { status: 'Invoiced' } });
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
        await tx.invoiceLine.deleteMany({ where: { invoiceId: existing.id } });
      }
      return tx.invoice.update({
        where: { id: existing.id },
        data: {
          ...(data.invoice_number !== undefined && { invoiceNumber: data.invoice_number || null }),
          ...(data.date !== undefined && { date: data.date ? new Date(data.date) : null }),
          ...(data.status !== undefined && { status: data.status }),
          ...(subtotal !== undefined && { subtotal, tax, total }),
          ...(linesUpdate && { lines: { create: linesUpdate.map((l, i) => ({ ...l, position: i })) } }),
        },
        include,
      });
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

    await prisma.invoice.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
