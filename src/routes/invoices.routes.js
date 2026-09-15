import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Replaces base44.entities.Invoice.list/filter/get/create/update/delete.
// Invoice is 1:1 with WorkOrder (unique workOrderId) — creating a second
// invoice for the same work order must be rejected, not silently allowed.

// TODO: GET    /?vehicleId=  -> list invoices, optionally filtered by vehicle (Invoices.jsx, VehicleDetail.jsx)
// TODO: GET    /:id          -> get one invoice + lines (InvoiceDetail.jsx)
// TODO: POST   /             -> create invoice with nested lines; if work_order_id set, also flip that WorkOrder to Invoiced (InvoiceForm.jsx submit)
// TODO: PATCH  /:id          -> update invoice incl. lines replace, and status toggle pending<->paid (InvoiceDetail.jsx togglePaid)
// TODO: DELETE /:id          -> delete invoice (InvoiceDetail.jsx)

export default router;
