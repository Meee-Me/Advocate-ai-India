// After `next build`: confirms the files OCR needs at run time are in the OCR route's serverless bundle.
//   node scripts/check-ocr-bundle.mjs
import fs from 'node:fs';
const file = '.next/server/app/api/documents/[id]/ocr/route.js.nft.json';
if (!fs.existsSync(file)) { console.error('Run `npm run build` first.'); process.exit(2); }
const files = JSON.parse(fs.readFileSync(file, 'utf8')).files;
const need = [
  'tesseract.js/src/worker-script/node/index.js', 'tesseract.js-core/tesseract-core-simd.wasm', 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'wasm-feature-detect', '@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', '@tesseract.js-data/hin/4.0.0/hin.traineddata.gz', '@napi-rs/canvas-linux-x64-gnu',
];
let bad = 0;
for (const n of need) {
  const ok = files.some((f) => f.includes(n));
  console.log(`${ok ? 'ok  ' : 'MISSING'} ${n}`);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
