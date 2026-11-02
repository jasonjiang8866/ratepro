import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateArticles } from '../src/lib/editorial';
const root = fileURLToPath(new URL('../content/', import.meta.url));
const raw: unknown[] = [];
for (const folder of ['insights', 'promotions']) {
  for (const name of readdirSync(`${root}${folder}`)) {
    if (!name.endsWith('.json')) throw new Error(`Unexpected content file: ${folder}/${name}`);
    const article = JSON.parse(readFileSync(`${root}${folder}/${name}`, 'utf8'));
    if (`${article.slug}.json` !== name) throw new Error(`Filename/slug mismatch: ${name}`);
    if ((article.category === 'package') !== (folder === 'promotions'))
      throw new Error(`Wrong content folder: ${name}`);
    raw.push(article);
  }
}
console.log(
  `Validated ${validateArticles(raw).length} editorial records. Rate observations are separate.`,
);
