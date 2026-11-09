import { chromium, type Page as BrowserPage } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES } from '../src/lib/data';
import { parseMaybank, type Page } from '../src/lib/parsers';
import { sourceFor } from '../src/lib/schema';
import { renderedPage, sha256 } from './cpf-browser';

export const MAYBANK_URL = sourceFor('maybank').url;
export const browserNetworkError = (message: string) => message.match(/net::ERR_[A-Z0-9_]+/)?.[0];
export const challengeText = (text: string) =>
  /verify (?:that )?you are human|checking your browser|just a moment|access denied|request (?:was )?blocked|security verification|complete the security check/i.test(
    text,
  );

export function parseMaybankBrowser(page: Page, url: string, status: number, at: string) {
  if (url !== MAYBANK_URL || status !== 200) throw Error('Unexpected source URL or HTTP status');
  if (challengeText(page.text)) throw Error('Access challenge; no extraction');
  if (Buffer.byteLength(JSON.stringify(page)) > MAX_BYTES)
    throw Error('Rendered evidence exceeds limit');
  return parseMaybank(page, at, 'browser');
}

// One default browser navigation. Options shorten deadlines in fully mocked browser tests.
// No endpoint discovery, requests replay, session import, login or consent/challenge clicks.
export async function inspectMaybankBrowser(
  page: BrowserPage,
  options: { navigationTimeout?: number; renderTimeout?: number } = {},
) {
  const report: Record<string, unknown> = {
    url: MAYBANK_URL,
    startedAt: new Date().toISOString(),
    status: 'failed',
    policy:
      'Fresh default headless Chromium. One navigation, no retry, custom UA, proxy, credentials, stored session or challenge handling. Research only.',
  };
  const responses: { url: string; status: number; challenge: boolean }[] = [];
  let stop: string | undefined;
  let evidence: Page | undefined;
  let phase = 'navigation';
  const halt = (reason: string) => {
    stop ??= reason;
    void page
      .context()
      .close()
      .catch(() => {});
  };
  const deadline = setTimeout(() => halt('Total browser budget exceeded'), 60000);
  try {
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (stop) return route.abort();
      if (
        /\/cdn-cgi\/challenge-platform\/|^https:\/\/challenges\.cloudflare\.com\//i.test(
          request.url(),
        )
      ) {
        await route.abort();
        halt('Access challenge resource; stopped without interaction');
        return;
      }
      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame() &&
        request.url() !== MAYBANK_URL
      ) {
        await route.abort();
        halt('Unexpected navigation; no extraction');
        return;
      }
      await route.fallback();
    });
    page.on('response', (response) => {
      const request = response.request();
      const challenge = response.headers()['cf-mitigated'] === 'challenge';
      const status = response.status();
      const main = request.isNavigationRequest() && request.frame() === page.mainFrame();
      if (main) report.mainStatus = status;
      if (responses.length < 50 && ['document', 'xhr', 'fetch'].includes(request.resourceType())) {
        const url = new URL(response.url());
        responses.push({ url: url.origin + url.pathname, status, challenge });
      }
      if (challenge || [401, 403, 429].includes(status))
        halt(`Access denial or challenge (${status}); no retry`);
      else if (main && status !== 200) halt(`Main document HTTP ${status}; no extraction`);
    });
    const main = await page.goto(MAYBANK_URL, {
      waitUntil: 'domcontentloaded',
      timeout: options.navigationTimeout ?? 30000,
    });
    if (stop) throw Error(stop);
    if (!main || main.status() !== 200) throw Error('Main document was not HTTP 200');
    phase = 'rendering and validation';
    const until = Date.now() + (options.renderTimeout ?? 10000);
    let validationError: string | undefined;
    do {
      evidence = await renderedPage(page);
      if (stop) throw Error(stop);
      if (challengeText(evidence.text)) {
        evidence = undefined;
        halt('Access challenge text; stopped without interaction');
        throw Error(stop);
      }
      if (Buffer.byteLength(JSON.stringify(evidence)) > MAX_BYTES) {
        evidence = undefined;
        throw Error('Rendered evidence exceeds limit');
      }
      const observedAt = new Date().toISOString();
      try {
        const offers = parseMaybankBrowser(evidence, page.url(), main.status(), observedAt);
        if (stop) throw Error(stop);
        Object.assign(report, { status: 'validated-candidate', observedAt, offers });
        break;
      } catch (error) {
        validationError =
          error instanceof Error ? error.message.slice(0, 300) : 'Validation failed';
      }
      if (Date.now() < until) await page.waitForTimeout(250);
    } while (Date.now() < until);
    if (report.status !== 'validated-candidate') {
      report.validationError = validationError;
      throw Error('Rendered page did not validate as four complete packages');
    }
    if (stop) throw Error(stop);
  } catch (error) {
    report.status = 'failed';
    delete report.offers;
    delete report.observedAt;
    report.phase = phase;
    report.reason =
      stop ??
      (phase === 'navigation'
        ? 'Navigation did not complete'
        : 'Rendered package validation failed');
    if (error instanceof Error) {
      report.errorType = error.name;
      // Do not emit raw browser logs, headers, IPs, cookies or arbitrary URL parameters.
      report.networkError = browserNetworkError(error.message);
    }
    if (stop) evidence = undefined;
  } finally {
    clearTimeout(deadline);
    Object.assign(report, { finishedAt: new Date().toISOString(), responses });
  }
  if (evidence)
    report.renderedSummary = {
      textLength: evidence.text.length,
      tableCount: evidence.tables.length,
    };
  return { report, evidence };
}

export async function probeMaybankBrowser(out = 'research-output/maybank-browser') {
  await mkdir(out, { recursive: true });
  const snapshots = ['public/data/rates.json', 'public/data/rates-jp.json'];
  const before = await Promise.all(snapshots.map(async (path) => sha256(await readFile(path))));
  const startedAt = new Date().toISOString();
  let report: Record<string, unknown> = { status: 'failed', url: MAYBANK_URL, startedAt };
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    const result = await inspectMaybankBrowser(page);
    report = { ...result.report, browserVersion: browser.version() };
    if (result.evidence) {
      const content = JSON.stringify(result.evidence, null, 2) + '\n';
      if (Buffer.byteLength(content) > MAX_BYTES) throw Error('Serialized evidence exceeds limit');
      await writeFile(resolve(out, 'page.json'), content);
      report.evidenceSha256 = sha256(content);
    }
  } catch (error) {
    report.status = 'failed';
    delete report.offers;
    delete report.observedAt;
    report.reason = 'Browser setup or artifact persistence failed';
    report.errorType = error instanceof Error ? error.name : 'Unknown';
  } finally {
    await browser?.close();
    const after = await Promise.all(snapshots.map(async (path) => sha256(await readFile(path))));
    report.snapshotUnchanged = before.every((hash, i) => hash === after[i]);
    report.finishedAt = new Date().toISOString();
    report.note =
      'Research only. No collector/source change or published observation. Missing publication/effective dates remain absent.';
    await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`MAYBANK_BROWSER_REPORT=${JSON.stringify(report)}`);
  }
  if (report.status !== 'validated-candidate' || !report.snapshotUnchanged) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await probeMaybankBrowser();
