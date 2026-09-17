// A validation failure (bad request body) is deliberately handled inline
// by each route -- caught, turned into a 400, never passed to the global
// errorHandler -- so it never hit console.error either. That's correct for
// an actual bug (nobody needs a stack trace for "the client sent the
// wrong shape"), but it also meant a genuine 400 left NOTHING in the
// server logs and NOTHING useful in the response: every route just said
// "Invalid work order data" (etc.) with no hint of which field or why,
// so neither the user nor whoever's debugging it could tell what to fix.
//
// zodErrorMessage turns the first issue into a human-readable
// "field.path: message" string; handleZodError sends that as `error`
// (with the full issue list still in `details` for anything that wants
// it) AND logs one line so `pm2 logs`/local dev output actually shows
// something the next time this happens.
export function zodErrorMessage(err) {
  const issue = err.issues?.[0];
  if (!issue) return 'Invalid request.';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function handleZodError(err, req, res) {
  const message = zodErrorMessage(err);
  // eslint-disable-next-line no-console
  console.warn(`[400] ${req.method} ${req.originalUrl} -> ${message}`);
  res.status(400).json({ error: message, details: err.issues });
}
