import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMaybankCandidate } from './capture-maybank';
import { requestMaybank } from './maybank-transport';

export const REPO = 'jasonjiang8866/ratepro';
const PREFIX = 'data/maybank-';
const OUT = 'research-output/maybank-job';
export type Api = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;
const sha = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw Error('Invalid GitHub SHA');
  return value;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid GitHub response');
  return value as Record<string, unknown>;
};

export function githubApi(token?: string, fetcher: typeof fetch = fetch): Api {
  return async (method, path, body) => {
    if (!path.startsWith('/') || path.includes('://') || path.includes('..'))
      throw Error('Invalid API path');
    if (method !== 'GET' && !token)
      throw Error('Submission requires a repository-scoped GitHub token');
    let response: Response;
    try {
      response = await fetcher(`https://api.github.com/repos/${REPO}${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw Error(`GitHub ${method} request did not complete; no automatic retry`);
    }
    if (!response.ok)
      throw Error(`GitHub ${method} returned HTTP ${response.status}; no automatic retry`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 3_000_000) throw Error('GitHub response too large');
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw Error('GitHub response was not valid JSON');
    }
  };
}

async function mainHead(api: Api) {
  return sha(record(record(await api('GET', '/git/ref/heads/main')).object).sha);
}

export async function prepareMaybankJob(api: Api, capture = requestMaybank) {
  const prs = await api('GET', '/pulls?state=open&per_page=100');
  if (!Array.isArray(prs) || prs.length >= 100)
    throw Error('Cannot establish complete open-PR state');
  const pending = prs.map(record).find((pr) => {
    const head = record(pr.head);
    return String(head.ref).startsWith(PREFIX) && record(head.repo).full_name === REPO;
  });
  if (pending) return { kind: 'pending' as const, number: Number(pending.number) };
  const baseSha = await mainHead(api);
  const commit = record(await api('GET', `/git/commits/${baseSha}`));
  const baseTree = sha(record(commit.tree).sha);
  const file = record(await api('GET', `/contents/public/data/rates.json?ref=${baseSha}`));
  if (file.encoding !== 'base64' || typeof file.content !== 'string')
    throw Error('Invalid base snapshot');
  const base = Buffer.from(file.content, 'base64');
  const result = await capture('default');
  const prepared = buildMaybankCandidate(base, result);
  if ((await mainHead(api)) !== baseSha) throw Error('Main changed during capture; no submission');
  const stamp = result.report.finishedAt.replace(/[-:.]/g, '');
  const branch = `${PREFIX}${stamp}-${prepared.evidence.bodySha256.slice(0, 8)}`;
  const evidencePath = `docs/captures/maybank/${stamp}`;
  const evidence = { ...prepared.evidence, baseCommit: baseSha };
  return {
    kind: 'prepared' as const,
    baseSha,
    baseTree,
    branch,
    observedAt: result.report.finishedAt,
    files: [
      { path: 'public/data/rates.json', mode: '100644', type: 'blob', content: prepared.candidate },
      {
        path: `${evidencePath}/evidence.json`,
        mode: '100644',
        type: 'blob',
        content: JSON.stringify(evidence, null, 2) + '\n',
      },
      {
        path: `${evidencePath}/official.html`,
        mode: '100644',
        type: 'blob',
        content: result.body!.toString('utf8'),
      },
    ],
    evidence,
    transport: result.report,
  };
}
export type PreparedJob = Extract<
  Awaited<ReturnType<typeof prepareMaybankJob>>,
  { kind: 'prepared' }
>;

export async function submitMaybankJob(api: Api, plan: PreparedJob, beforeWrites = async () => {}) {
  if (!plan.branch.startsWith(PREFIX)) throw Error('Invalid data branch');
  if ((await mainHead(api)) !== plan.baseSha)
    throw Error('Main changed before submission; no writes');
  if (Date.now() - Date.parse(plan.observedAt) > 10 * 60_000)
    throw Error('Prepared capture is stale');
  await beforeWrites();
  const tree = record(
    await api('POST', '/git/trees', { base_tree: plan.baseTree, tree: plan.files }),
  );
  const commit = record(
    await api('POST', '/git/commits', {
      message: `data: refresh Maybank observations (${plan.observedAt})`,
      tree: sha(tree.sha),
      parents: [plan.baseSha],
    }),
  );
  const commitSha = sha(commit.sha);
  await api('POST', '/git/refs', { ref: `refs/heads/${plan.branch}`, sha: commitSha });
  const pr = record(
    await api('POST', '/pulls', {
      title: 'data: refresh four Maybank public observations',
      head: plan.branch,
      base: 'main',
      draft: true,
      body: `Fresh ordinary HTTP/1.1 read of the official Maybank package page at ${plan.observedAt}. All four complete schedules were reparsed from the original response. Other products and scheduled collection health are preserved.\n\nOriginal HTML and before/after evidence are included under docs/captures/maybank/. Base commit: ${plan.baseSha}. Body SHA-256: ${plan.evidence.bodySha256}.\n\nThis external capture does not establish GitHub collector recovery. Review the complete evidence and CI before merging. No automatic merge or deployment is requested.`,
    }),
  );
  if (!Number.isSafeInteger(pr.number) || Number(pr.number) <= 0)
    throw Error('Invalid PR response; inspect the created data branch');
  return { number: Number(pr.number), branch: plan.branch, commitSha };
}

export async function runMaybankJob(
  submit: boolean,
  options: { api?: Api; capture?: typeof requestMaybank; out?: string } = {},
) {
  const outRoot = options.out ?? OUT;
  const token = process.env.MAYBANK_GITHUB_TOKEN_FILE
    ? (await readFile(process.env.MAYBANK_GITHUB_TOKEN_FILE, 'utf8')).trim()
    : process.env.GH_TOKEN;
  if (submit && !token) throw Error('Set GH_TOKEN or MAYBANK_GITHUB_TOKEN_FILE for --submit');
  await mkdir(outRoot, { recursive: true });
  // An exclusive file protects overlapping schedulers. Interrupted publication stays blocked.
  const lock = join(outRoot, 'publishing.json');
  if (submit) {
    try {
      await writeFile(
        lock,
        JSON.stringify({ phase: 'preparing', startedAt: new Date().toISOString() }),
        { flag: 'wx' },
      );
    } catch {
      throw Error(
        'A prior submission is active or interrupted; inspect publishing.json before retrying',
      );
    }
  }
  let writesStarted = false;
  try {
    const api = options.api ?? githubApi(token);
    const plan = await prepareMaybankJob(api, options.capture);
    if (plan.kind === 'pending') {
      console.log(
        `Pending Maybank data PR: https://github.com/${REPO}/pull/${plan.number}; no new capture or writes`,
      );
      return;
    }
    const out = await mkdtemp(join(outRoot, 'capture-'));
    for (const file of plan.files) {
      const name =
        file.path === 'public/data/rates.json' ? 'rates.json' : file.path.split('/').at(-1)!;
      await writeFile(join(out, name), file.content);
    }
    await writeFile(join(out, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
    if (!submit) {
      console.log(
        `Prepared ${out}; no GitHub writes. Use --submit for a new live capture and draft data PR.`,
      );
      return;
    }
    const result = await submitMaybankJob(api, plan, async () => {
      await writeFile(
        lock,
        JSON.stringify({ phase: 'publishing', branch: plan.branch, baseSha: plan.baseSha, out }),
      );
      writesStarted = true;
    });
    await writeFile(join(out, 'submission.json'), JSON.stringify(result, null, 2) + '\n');
    writesStarted = false;
    console.log(`Created draft data PR: https://github.com/${REPO}/pull/${result.number}`);
  } finally {
    if (submit && !writesStarted) {
      const { unlink } = await import('node:fs/promises');
      await unlink(lock);
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Maybank job: no args = fresh capture + local evidence; --submit = fresh capture + draft GitHub data PR. No merge/deploy. Token required only for submission.',
    );
  } else {
    if (args.length && (args.length !== 1 || args[0] !== '--submit'))
      throw Error('Only --submit or --help is supported');
    try {
      await runMaybankJob(args[0] === '--submit');
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Maybank job failed');
      process.exitCode = 1;
    }
  }
}
