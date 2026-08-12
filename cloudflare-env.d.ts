declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    X_BEARER_TOKEN?: string;
  };
}
