/**
 * JOB-CARD-3, CHK-RACE-1, MOBILE-TABLES-1 — the follow-up of 17 November 2026, in a real browser.
 *
 *   - the checklist: answers tapped in quick succession — several items, and one item changed twice —
 *     are all saved, one request at a time, the last answer to an item winning, with "Saving…" then
 *     "All answers saved" on screen and never a "Something went wrong";
 *   - the Jobs list on a phone: a card per job, nothing to swipe sideways for;
 *   - the job card on screen: the EJE letterhead across the document, its name and number in the
 *     top-right corner (from sm up), or set under the letterhead on a phone.
 *
 * At one viewport per run (`EJE_FORMS_VIEWPORT=1440x900`, `768x1024:touch`, `390x844:touch`). It resets
 * the demonstration data, so it runs only against a local server.
 */
import { chromium } from 'playwright';
import { resetDemonstration, signInAs } from './sign-in.mjs';
import { assertLocalTarget } from './local-target.mjs';

const BASE = assertLocalTarget(process.env.EJE_E2E_URL ?? process.env.EJE_SMOKE_BASE_URL ?? 'http://localhost:3210');
const [size, mode] = (process.env.EJE_FORMS_VIEWPORT ?? '1440x900').split(':');
const [width, height] = size.split('x').map(Number);
const touch = mode === 'touch';
const phone = width < 640;

const results = [];
const check = async (name, fn) => {
  try {
    const note = await fn();
    results.push(['PASS', name]);
    console.log(`PASS  ${name}${typeof note === 'string' ? `  — ${note}` : ''}`);
  } catch (error) {
    results.push(['FAIL', name]);
    console.log(`FAIL  ${name} :: ${String(error?.message ?? error).split('\n')[0]}`);
  }
};
const fail = (message) => {
  throw new Error(message);
};

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch && width < 700 });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
const serverErrors = [];
page.on('response', (response) => {
  if (response.status() >= 500) serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
});

const press = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  if (touch) await locator.tap();
  else await locator.click();
};
const go = (path) => page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
const noPageOverflow = async (where) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 1) fail(`${where}: the page scrolls sideways by ${over}px`);
};
const call = (method, path, body) =>
  page.evaluate(
    async ([verb, url, payload]) => {
      const response = await fetch(url, {
        method: verb,
        headers: verb === 'GET' ? {} : { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: verb === 'GET' ? undefined : JSON.stringify(payload ?? {}),
      });
      return { status: response.status, json: await response.json().catch(() => null) };
    },
    [method, path, body],
  );

await resetDemonstration(page, BASE);
await signInAs(page, 'Elmarie Coetzee', { base: BASE });
const users = (await call('GET', '/api/admin')).json?.data?.users ?? [];
const sipho = users.find((user) => user.email === 'sipho.mahlangu@eje-demo.co.za')?.id;
const created = await call('POST', '/api/jobs', {
  customerId: 'cust-abc',
  siteId: 'site-abc-jhb',
  contactId: 'contact-abc-jhb',
  machineId: 'machine-abc-lv40',
  jobType: 'service',
  priority: 'normal',
  scheduledDate: null,
  scheduledEndDate: null,
  orderNumber: 'PO-FOLLOWUP-1',
  referenceNumber: '',
  faultDescription: 'Annual preventative maintenance.',
  primaryTechnicianId: sipho,
  courierCollection: false,
  deliveryNote: '',
});
if (created.status !== 200) fail(`raising the service job answered ${created.status}`);
const job = created.json.data;

await check('the job card on screen: the letterhead across the document, the name and number in its top-right corner', async () => {
  await go(`/jobs/${job.jobNumber}/review`);
  const header = page.locator('[data-header="full-width"]').first();
  await header.waitFor({ timeout: 20000 });
  const box = await header.boundingBox();
  const article = await page.locator('article.eje-document').first().boundingBox();
  if (box.width < article.width * 0.8) fail(`the header is ${Math.round(box.width)}px of a ${Math.round(article.width)}px document`);
  const overlay = page.getByTestId('letterhead-title-overlay');
  const title = page.getByTestId('document-title');
  if (phone) {
    if (await overlay.isVisible()) fail('on a phone the title is drawn tiny inside the letterhead');
    const text = await title.innerText();
    if (!text.includes(job.jobNumber)) fail(`the title under the letterhead reads "${text}"`);
  } else {
    if (!(await overlay.isVisible())) fail('the name and number are not drawn in the letterhead');
    const number = overlay.locator('text').nth(1);
    const numberBox = await number.boundingBox();
    if (numberBox.x + numberBox.width < box.x + box.width * 0.85) fail('the number is not in the top-right corner');
    if (numberBox.y > box.y + box.height * 0.35) fail('the number is not at the top');
  }
  await noPageOverflow('the job card');
  return `${Math.round(box.width)}px wide`;
});

await check('the Jobs list: on a phone a card per job, never a table to swipe', async () => {
  await go('/jobs');
  await page.getByTestId('jobs-count').waitFor({ timeout: 20000 });
  const cards = await page.getByTestId('data-card').count();
  const tables = await page.locator('main table').count();
  if (phone) {
    if (cards === 0) fail('no job cards on a phone');
    if (tables !== 0) fail('a table is still drawn on a phone');
    const overflowing = await page.getByTestId('data-card').evaluateAll((all) => all.filter((card) => card.getBoundingClientRect().right > window.innerWidth + 1).length);
    if (overflowing > 0) fail(`${overflowing} cards run off the screen`);
  } else if (tables === 0) {
    fail('the table is gone on a wide screen');
  }
  await noPageOverflow('the Jobs list');
  return phone ? `${cards} cards` : 'table';
});

await check('checklist answers tapped in quick succession are all saved, one at a time, the last one winning', async () => {
  await signInAs(page, 'Sipho Mahlangu', { base: BASE });
  const accepted = await call('POST', `/api/jobs/${job.id}/accept`, {});
  if (accepted.status !== 200) fail(`accept answered ${accepted.status}`);
  let inFlight = 0;
  let most = 0;
  let sent = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/answer_checklist')) {
      inFlight += 1;
      sent += 1;
      most = Math.max(most, inFlight);
    }
  });
  page.on('requestfinished', (request) => {
    if (request.url().endsWith('/answer_checklist')) inFlight -= 1;
  });
  page.on('requestfailed', (request) => {
    if (request.url().endsWith('/answer_checklist')) inFlight -= 1;
  });
  await go(`/jobs/${job.jobNumber}`);
  await press(page.getByRole('tab', { name: /^Checklist/u }).first());
  // The Service checklist is chosen first, as the technician chooses it.
  await press(page.getByTestId('checklist-choice-service_milling'));
  await press(page.getByTestId('checklist-choice-continue'));
  const pass = page.getByRole('button', { name: 'Pass', exact: true });
  await pass.first().waitFor({ timeout: 20000 });
  // Eight items, tapped as fast as a finger can — no waiting for a save between them.
  for (let index = 0; index < 8; index += 1) await press(pass.nth(index));
  // The first item changed twice: Fail, then N/A.
  await press(page.getByRole('button', { name: 'Fail', exact: true }).first());
  await press(page.getByRole('button', { name: 'N/A', exact: true }).first());
  await page.locator('[data-testid="checklist-save-state"][data-state="saved"]').first().waitFor({ timeout: 30000 });
  if (await page.locator('[data-testid="checklist-save-state"][data-state="failed"]').count()) fail('an answer was not saved');
  const stored = (await call('GET', `/api/jobs/${job.jobNumber}`)).json.data.view.job.checklist.responses;
  const template = (await call('GET', `/api/jobs/${job.jobNumber}`)).json.data.view.checklistTemplate;
  const items = template.sections.flatMap((section) => section.items).slice(0, 8);
  const choice = (itemId) => stored.find((response) => response.itemId === itemId)?.choice ?? null;
  if (choice(items[0].id) !== 'na') fail(`the first item kept "${choice(items[0].id)}", not the last answer (N/A)`);
  for (const item of items.slice(1)) if (choice(item.id) !== 'pass') fail(`an item was lost: ${item.text}`);
  if (most > 1) fail(`${most} answers were on the wire at once`);
  // What the screen shows is what the server holds.
  const pressed = await page.getByRole('button', { name: 'N/A', exact: true }).first().getAttribute('aria-pressed');
  if (pressed !== 'true') fail('the screen does not show the last answer');
  await noPageOverflow('the checklist');
  return `${sent} requests for 10 taps, never more than ${most} at once`;
});

await check('no page error and no server error', async () => {
  if (pageErrors.length > 0) fail(pageErrors[0]);
  if (serverErrors.length > 0) fail(serverErrors.join(', '));
});

await browser.close();
const failed = results.filter(([state]) => state === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed at ${width}x${height}${touch ? ' touch' : ''}`);
process.exit(failed === 0 ? 0 : 1);
