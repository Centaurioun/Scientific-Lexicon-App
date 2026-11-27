import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
  // Development server only. Preserve the working Google AI Studio preview origins.
  allowedDevOrigins: [
    '127.0.0.1',
    '*.run.app',
    '**.run.app',
    '*.scf.usercontent.goog',
    '**.scf.usercontent.goog',
  ],
};

export default config;
