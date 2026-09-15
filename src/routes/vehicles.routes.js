import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Replaces base44.entities.Vehicle.list/filter/get/create/update.
// Isolation here is indirect: join through Client.mechanicId (Vehicle has no
// mechanicId of its own — see the schema decision).

// TODO: GET    /?clientId=  -> list vehicles, optionally filtered by client (ClientDetail.jsx, WorkOrders.jsx, Invoices.jsx)
// TODO: GET    /:id         -> get one vehicle + owning client scoped to req.mechanicId (VehicleDetail.jsx)
// TODO: POST   /            -> create vehicle under a client owned by req.mechanicId (VehicleForm.jsx)
// TODO: PATCH  /:id         -> update vehicle, incl. commonParts replace (VehicleForm.jsx, VehicleDetail.jsx saveParts)

export default router;
