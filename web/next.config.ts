import type { NextConfig } from 'next';

// Statischer Export: läuft auf GitHub Pages, Vercel oder jedem Webspace.
// Unterordner (z. B. GitHub Pages /eag-foerderungen/dashboard): NEXT_BASE_PATH=/eag-foerderungen/dashboard npm run build
const basePath = process.env.NEXT_BASE_PATH || '';

const config: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default config;
