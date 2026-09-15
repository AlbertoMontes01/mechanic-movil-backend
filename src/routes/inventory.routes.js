import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Replaces base44.entities.InventoryItem.* and InventoryCategory.*
// (Inventory.jsx, VehicleDetail.jsx common-parts picker, and the future
// WorkOrderForm parts_used picker all read from here.)

// TODO: GET    /items              -> list items for req.mechanicId (Inventory.jsx, VehicleDetail.jsx, InvoiceForm.jsx)
// TODO: POST   /items              -> create item (Inventory.jsx ItemForm, and the WorkOrderForm "+ Add new part" quick-create)
// TODO: PATCH  /items/:id          -> update item (Inventory.jsx ItemForm)
// TODO: GET    /categories         -> list categories for req.mechanicId (Inventory.jsx)
// TODO: POST   /categories         -> create category (Inventory.jsx CategoryManager)
// TODO: DELETE /categories/:id     -> delete category, scoped to req.mechanicId (Inventory.jsx CategoryManager)

export default router;
