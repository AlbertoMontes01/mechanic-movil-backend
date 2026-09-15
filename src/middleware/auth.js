import jwt from 'jsonwebtoken';

// Verifies the Bearer JWT and attaches the tenant id as req.mechanicId.
// Every resource route (clients, vehicles, inventory, work orders, invoices,
// shop settings) should sit behind this and scope its Prisma queries by
// req.mechanicId — that's how multi-tenant isolation is enforced.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.mechanicId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
