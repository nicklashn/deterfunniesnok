import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import vercel from './vercel.json';

// `vite preview` serves the same security headers as Vercel, so the CSP can be tested locally
const headers = Object.fromEntries(
  vercel.headers[0].headers.map((h) => [h.key, h.value]),
);

export default defineConfig(({ mode }) => {
  // Absolute site URL for the link preview (LinkedIn and Slack need an absolute og:image URL).
  // On Vercel the production domain is known at build time; elsewhere set SITE_URL.
  const env = loadEnv(mode, '.', '');
  const siteUrl = env.SITE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  return {
    plugins: [
      react(),
      { name: 'site-url', transformIndexHtml: (html: string) => html.replaceAll('%SITE_URL%', siteUrl) },
    ],
    preview: { headers },
  };
});
