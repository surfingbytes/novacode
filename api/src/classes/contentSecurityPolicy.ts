/**
 * Content-Security-Policy directives for @fastify/helmet (API + served dashboard).
 */
export const contentSecurityPolicyDirectives = {
  defaultSrc: ["'self'"],
  // No 'unsafe-inline' / 'unsafe-eval': the built dashboard, Monaco workers and Mermaid need neither.
  scriptSrc: ["'self'", 'blob:'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'blob:', 'data:'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:', 'blob:'],
  imgSrc: ["'self'", 'data:', 'blob:'],
  mediaSrc: ["'self'", 'blob:', 'data:'],
  connectSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
  workerSrc: ["'self'", 'blob:'],
  childSrc: ["'self'", 'blob:'],
  // blob: needed for workspace HTML file preview (sandboxed iframe).
  frameSrc: ['blob:'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"]
};
