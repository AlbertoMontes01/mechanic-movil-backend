// Defense-in-depth for free-text fields (notes, descriptions) that a user
// types and another user (or the mechanic themself, later) reads back.
// React already escapes everything on render and jsPDF only ever draws
// plain text, so there's no known live XSS path today — this strips any
// HTML tags server-side anyway so stored values can never carry markup,
// regardless of how they end up being displayed by something else later.
export function stripHtml(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/<[^>]*>/g, '');
}

// Applies stripHtml to every string value in a flat object — convenient for
// route handlers that spread a whole validated payload straight into a
// Prisma create/update call.
export function sanitizeStrings(obj) {
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (typeof out[key] === 'string') out[key] = stripHtml(out[key]);
  }
  return out;
}
