import { readFileSync } from 'node:fs';
import path from 'node:path';

export { SourceModelIndex } from '../public/source-model-index.js';

export function readSourceMetadata(resourcePath) {
  try { return JSON.parse(readFileSync(path.join(resourcePath, 'AECModelData.json'), 'utf8')); }
  catch { return null; } // A missing/broken optional file must not disable the viewer.
}
