export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// This only ever runs for *unexpected* errors (next(err) from a bug, a
// Prisma internal failure, etc.) — every intentional 4xx in the route
// handlers already sends its own safe, specific response directly and
// never reaches here. So what lands here is exactly the class of error
// that could leak internal detail (stack-adjacent messages, raw Prisma
// error text) to the client — full detail always goes to the server log,
// but the client only gets that detail back outside of production.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message || 'Internal server error';
  res.status(status).json({ error: message });
}
