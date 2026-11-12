export interface Env {
  WALL: DurableObjectNamespace;
  /** Comma-separated list of origins allowed to call the API with the editor cookie. */
  ALLOWED_ORIGINS: string;
  EDITOR_PASSWORD: string;
  SESSION_SECRET: string;
  /** Initial display key; can be rotated from the editor afterwards. */
  DISPLAY_KEY?: string;
  COMMAND_TOKEN?: string;
}

export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
