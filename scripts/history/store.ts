import { mkdir, readFile, readdir, appendFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { HistoryRecordSchema, type HistoryRecord } from '../../src/lib/history';
import { canonical, recordId } from './normalize';

export async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  return (
    await Promise.all(
      entries.map((e) => (e.isDirectory() ? files(join(root, e.name)) : [join(root, e.name)])),
    )
  )
    .flat()
    .sort();
}
export async function readRecords(root: string): Promise<HistoryRecord[]> {
  const records: HistoryRecord[] = [];
  const ids = new Set<string>();
  for (const path of await files(root)) {
    if (!path.endsWith('.jsonl')) continue;
    for (const line of (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean)) {
      const r = HistoryRecordSchema.parse(JSON.parse(line));
      if (recordId(r) !== r.id) throw Error(`Ledger checksum mismatch: ${r.id}`);
      if (ids.has(r.id)) throw Error(`Duplicate ledger ID: ${r.id}`);
      if (!path.includes(`/${r.market}/`)) throw Error(`Market/path mismatch: ${path}`);
      ids.add(r.id);
      records.push(r);
    }
  }
  return records;
}
export class Ledger {
  private existing: Map<string, HistoryRecord>;
  constructor(
    readonly root: string,
    records: HistoryRecord[],
  ) {
    this.existing = new Map(records.map((r) => [r.id, r]));
  }
  static async open(root: string) {
    return new Ledger(root, await readRecords(root));
  }
  records() {
    return [...this.existing.values()];
  }
  async append(records: HistoryRecord[]) {
    let added = 0;
    const groups = new Map<string, HistoryRecord[]>();
    for (const input of records) {
      const r = HistoryRecordSchema.parse(input);
      if (recordId(r) !== r.id) throw Error(`Ledger checksum mismatch: ${r.id}`);
      if (this.existing.has(r.id)) continue;
      const at =
        r.type === 'observation'
          ? r.observedAt
          : r.type === 'attempt'
            ? r.attemptedAt
            : r.type === 'catalog'
              ? r.generatedAt
              : null;
      const partition = at ? new Date(at).toISOString().slice(0, 10) : r.id;
      const path = join(this.root, r.market, r.type, partition + '.jsonl');
      groups.set(path, [...(groups.get(path) ?? []), r]);
      this.existing.set(r.id, r);
      added++;
    }
    for (const [path, rows] of groups) {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, rows.map(canonical).join('\n') + '\n');
    }
    return added;
  }
}
export async function writeJson(path: string, value: unknown) {
  const text = JSON.stringify(value) + '\n';
  if ((await readFile(path, 'utf8').catch(() => null)) === text) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + '.tmp', text);
  await rename(path + '.tmp', path);
}
