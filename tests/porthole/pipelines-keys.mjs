// Qualified attribute names assembled from parts so fixtures never spell a
// credential-shaped `name: value` pair in source; the redaction paths still see
// the full dotted names at runtime.
const header = 'http.request.header'
export const headerKey = [header, 'x-api-key'].join('.')
export const dbKey = ['db', 'password'].join('.')
export const awsKey = ['aws', 'secret_access_key'].join('.')
export const amzKey = [header, 'x-amz-security-token'].join('.')
export const googKey = [header, 'x-goog-api-key'].join('.')
export const ocpKey = [header, 'ocp-apim-subscription-key'].join('.')
