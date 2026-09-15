import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Replaces base44.entities.Client.list/get/create/update/delete.
// Every query below MUST filter by req.mechanicId — that's the tenant
// isolation boundary for this resource.

// TODO: GET    /            -> list clients for req.mechanicId (Clients.jsx)
// TODO: GET    /:id         -> get one client, scoped to req.mechanicId (ClientDetail.jsx)
// TODO: POST   /            -> create client under req.mechanicId (ClientForm.jsx)
// TODO: PATCH  /:id         -> update client, scoped to req.mechanicId (ClientForm.jsx)
// TODO: DELETE /:id         -> delete client, scoped to req.mechanicId (ClientDetail.jsx)

export default router;
