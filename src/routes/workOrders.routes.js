import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Replaces base44.entities.WorkOrder.list/filter/get/create/update/delete.
//
// IMPORTANT: WorkOrderStatus enum values in schema.prisma (Draft,
// InProgress, ReadyToInvoice, Invoiced) do NOT match the frontend's display
// strings ("In Progress", "Ready to Invoice") — this layer must translate
// between them until the frontend is updated to match.
//
// subjects[].parts_used[] now requires a real inventoryItemId (strict FK
// decision) — creation/update here should reject a part row with no
// inventoryItemId rather than silently accepting free text.

// TODO: GET    /?vehicleId=  -> list work orders, optionally filtered by vehicle (WorkOrders.jsx, VehicleDetail.jsx)
// TODO: GET    /:id          -> get one work order + subjects + partsUsed (WorkOrderDetail.jsx, WorkOrderForm.jsx edit mode)
// TODO: POST   /             -> create work order with nested subjects/partsUsed (WorkOrderForm.jsx)
// TODO: PATCH  /:id          -> update work order incl. subjects/partsUsed replace, and status-only updates (InvoiceForm.jsx sets status: Invoiced)
// TODO: DELETE /:id          -> delete work order (WorkOrderDetail.jsx)

export default router;
