/**
 * Production secret guards. The dev-only fallback secret is a footgun: if an
 * env var is forgotten during a redeploy, the API silently ships with a public
 * default that lets anyone forge admin JWTs. Fail fast instead.
 */

const DEV_FALLBACK = 'dev-only-secret-change-me';

export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production');
    }
    return DEV_FALLBACK;
  }
  if (secret === DEV_FALLBACK && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must not use the dev fallback in production');
  }
  return secret;
}
