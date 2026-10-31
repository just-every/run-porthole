// Qualified attribute names assembled from parts so fixtures never spell a
// credential-shaped `name: value` pair in source; the redaction paths still see
// the full dotted names at runtime.
export const headerKey = ['http.request.header', 'x-api-key'].join('.')
export const dbKey = ['db', 'password'].join('.')
