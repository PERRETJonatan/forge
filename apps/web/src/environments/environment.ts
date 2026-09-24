// apiUrl is set at container start (see apps/web/docker/40-env-js.sh), not at build time,
// so one image works for any deployment. public/env.js is the fallback used by `ng serve`.
const runtime = (window as { __env?: { apiUrl?: string } }).__env;

export const environment = {
  apiUrl: runtime?.apiUrl ?? 'http://localhost:3000',
};
