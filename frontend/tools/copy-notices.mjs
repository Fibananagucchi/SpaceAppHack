import { copyFile } from 'node:fs/promises';

await copyFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), new URL('../dist/THIRD_PARTY_NOTICES.txt', import.meta.url));

await copyFile(new URL('../third_party/ScientificColourMaps-LICENCE.pdf',import.meta.url),new URL('../dist/ScientificColourMaps-LICENCE.pdf',import.meta.url));
