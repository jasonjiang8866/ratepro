import { chromium, type Page as BrowserPage } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHdbQuarter } from './hdb-askgov';
import type { Page } from '../src/lib/parsers';
import { MAX_BYTES } from '../src/lib/data';
import { CPF_BOARD, OfferSchema } from '../src/lib/schema';

export const CPF_URL = CPF_BOARD.url;
export const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

export function parseCpfBoard(page: Page, url: string, at: string) {
  if (
    url !== CPF_URL ||
    !page.text.includes('How are CPF interest rates determined?') ||
    !/\bCPF Board\b/.test(page.text) ||
    !page.text.includes('A Singapore Government Agency Website')
  )
    throw Error('CPF Board publication identity missing');
  return OfferSchema.parse({
    ...parseHdbQuarter(page, at),
    evidenceSourceId: CPF_BOARD.id,
    method: 'browser',
  });
}

// Open shadow DOM is part of the rendered page. Ignore hidden templates and scripts.
// No network endpoints, internal state, credentials or closed roots are inspected.
export async function renderedPage(page: BrowserPage): Promise<Page> {
  // A fixed JavaScript expression avoids TS runners injecting closure helpers
  // (for example __name) that do not exist in the browser execution context.
  return page.evaluate<Page>(String.raw`(() => {
    const tables = [];
    function text(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      if (node instanceof Element) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(node.tagName)) return '';
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return '';
        if (node instanceof HTMLSlotElement)
          return node.assignedNodes({ flatten: true }).map(text).join(' ');
        if (node.tagName === 'TABLE') {
          tables.push(Array.from(node.querySelectorAll('tr'), row =>
            Array.from(row.querySelectorAll('th,td'), cell => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '')));
        }
        if (node.shadowRoot) return text(node.shadowRoot);
      }
      return Array.from(node.childNodes, text).join(' ');
    }
    const content = text(document.body).replace(/\s+/g, ' ').trim();
    return { text: content, tables };
  })()`);
}

export async function probeCpf(out = 'research-output/cpf') {
  await mkdir(out, { recursive: true });
  const before = sha256(await readFile('public/data/rates.json'));
  const report: Record<string, unknown> = {
    url: CPF_URL,
    startedAt: new Date().toISOString(),
    status: 'failed',
    policy:
      'Fresh default headless Chromium; no custom UA, proxy, credentials, stored cookies, retries or challenge handling. No production write.',
  };
  const responses: { url: string; status: number; challenge: boolean }[] = [];
  let stop: string | undefined;
  let phase = 'navigation';
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const deadline = setTimeout(() => {
    stop ??= 'Total browser budget exceeded';
    void context.close();
  }, 60000);
  try {
    // Main-document redirects are not followed. Page-owned assets/data load normally.
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (
        stop ||
        (request.isNavigationRequest() &&
          request.frame() === page.mainFrame() &&
          request.url() !== CPF_URL)
      ) {
        stop ??= 'Unexpected navigation rejected';
        await route.abort();
        return;
      }
      await route.continue();
    });
    page.on('response', (response) => {
      const challenge = response.headers()['cf-mitigated'] === 'challenge';
      const relevant = ['document', 'xhr', 'fetch'].includes(response.request().resourceType());
      if (relevant && responses.length < 50) {
        const url = new URL(response.url());
        responses.push({ url: url.origin + url.pathname, status: response.status(), challenge });
      }
      if (challenge || (relevant && [401, 403, 429].includes(response.status()))) {
        stop ??= `Access denial or challenge (${response.status()}); no retry`;
        void context.close();
      }
    });
    const main = await page.goto(CPF_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!main || main.status() !== 200) throw Error('Main document was not HTTP 200');
    phase = 'waiting for rendered table';
    await page
      .getByText(/^HDB mortgage rate for /)
      .first()
      .waitFor({ state: 'visible', timeout: 20000 });
    phase = 'reading rendered DOM';
    const evidence = await renderedPage(page);
    if (stop) throw Error(stop);
    const content = JSON.stringify(evidence, null, 2) + '\n';
    if (Buffer.byteLength(content) > MAX_BYTES) throw Error('Rendered evidence exceeds size limit');
    const observedAt = new Date().toISOString();
    await writeFile(resolve(out, 'page.json'), content);
    phase = 'strict publication validation';
    const offer = parseCpfBoard(evidence, page.url(), observedAt);
    phase = 'screenshot';
    await page.screenshot({ path: resolve(out, 'page.png'), fullPage: false, timeout: 5000 });
    if (stop) throw Error(stop);
    Object.assign(report, {
      status: 'validated-candidate',
      observedAt,
      evidenceSha256: sha256(content),
      offer,
      note: 'Research candidate only. Not an enabled collector or published observation.',
    });
  } catch (error) {
    report.error = stop ?? 'Navigation, rendering or strict publication validation failed';
    report.phase = phase;
    if (error instanceof Error) report.errorType = error.name;
    if (phase === 'reading rendered DOM' && error instanceof Error)
      report.domError = error.message.split('\n')[0].slice(0, 300);
    if (phase === 'strict publication validation' && error instanceof Error)
      report.validationError = error.message.slice(0, 300);
    if (!page.isClosed()) {
      const evidence = await renderedPage(page).catch(() => undefined);
      if (evidence && Buffer.byteLength(JSON.stringify(evidence)) <= MAX_BYTES) {
        await writeFile(resolve(out, 'page.json'), JSON.stringify(evidence, null, 2) + '\n');
        report.renderedSummary = {
          textLength: evidence.text.length,
          tableCount: evidence.tables.length,
        };
      }
    }
  } finally {
    clearTimeout(deadline);
    await browser.close();
    Object.assign(report, {
      finishedAt: new Date().toISOString(),
      responses,
      snapshotUnchanged: before === sha256(await readFile('public/data/rates.json')),
    });
    await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`CPF_BROWSER_REPORT=${JSON.stringify(report)}`);
  }
  if (report.status !== 'validated-candidate' || !report.snapshotUnchanged) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await probeCpf();
