/**
 * Feature flags (set in Frontend/.env).
 *
 * VITE_ENABLE_DEMO=true  -> shows the one-click "Demo User / Pharmacy / Admin"
 *                           buttons (fake, browser-only sessions) for project demos.
 * Anything else / not set -> demo access is completely OFF (production default).
 */
export const DEMO_ENABLED = import.meta.env.VITE_ENABLE_DEMO === 'true'