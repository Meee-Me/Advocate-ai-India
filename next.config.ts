import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

// Content-Security-Policy. Next.js needs inline scripts/styles for hydration;
// everything else (frames, objects, third-party scripts) is blocked.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Browser uploads PDFs straight to Supabase Storage with a signed URL.
  "connect-src 'self' https://*.supabase.co" + (isDev ? ' ws: http://localhost:*' : ''),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Only used for local development and tests; never loaded in production.
  // pglite is only for local development and tests. The OCR engine (Tesseract in WebAssembly + a native canvas)
  // must be loaded from node_modules at run time, so it is kept out of the bundle and traced explicitly below.
  serverExternalPackages: ['@electric-sql/pglite', 'tesseract.js', 'tesseract.js-core', '@napi-rs/canvas', '@tesseract.js-data/eng', '@tesseract.js-data/hin'],
  outputFileTracingIncludes: {
    // Tesseract loads its core and helpers inside a worker thread, which the file tracer cannot follow,
    // so every package it needs is listed here (scripts/check-ocr-bundle.mjs verifies this after a build).
    '/api/documents/\\[id\\]/ocr': [
      './node_modules/tesseract.js/**/*',
      './node_modules/tesseract.js-core/**/*',
      './node_modules/wasm-feature-detect/**/*',
      './node_modules/bmp-js/**/*',
      './node_modules/idb-keyval/**/*',
      './node_modules/is-url/**/*',
      './node_modules/node-fetch/**/*',
      './node_modules/opencollective-postinstall/**/*',
      './node_modules/regenerator-runtime/**/*',
      './node_modules/zlibjs/**/*',
      './node_modules/whatwg-url/**/*',
      './node_modules/tr46/**/*',
      './node_modules/webidl-conversions/**/*',
      './node_modules/@tesseract.js-data/**/*',
      './node_modules/@napi-rs/**/*',
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
      // Legal data must never be cached by browsers or CDNs.
      { source: '/api/(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
