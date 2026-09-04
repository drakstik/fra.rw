/**
 * Fails fast at boot (not at request time) if a required environment
 * variable is missing — shared by data-source.ts and auth.config.ts so
 * there's exactly one definition of "what happens when config is missing."
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}