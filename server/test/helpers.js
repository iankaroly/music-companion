import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const fixturePath = (name) => path.resolve(HERE, '../fixtures', name);
export const fixture = (name) => readFileSync(fixturePath(name), 'utf8');
