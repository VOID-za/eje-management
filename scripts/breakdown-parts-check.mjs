/**
 * BD-PARTS-1 in the browser (the owner, 15 November 2026): a technician finishing a BREAKDOWN adds, changes and
 * removes parts in the Job Complete wizard without cancelling completion; they are saved (a reload brings them
 * back), and lock once the customer is shown the job card — on the screen and on the server.
 *
 * At one viewport per run (`EJE_FORMS_VIEWPORT=1440x900`, `768x1024:touch`, `390x844:touch`). It resets the
 * DEMONSTRATION data first, so it refuses any target but a local one (`assertLocalTarget`).
 *
 *   EJE_E2E_URL=http://127.0.0.1:3210 node scripts/breakdown-parts-check.mjs
 */
import { chromium } from 'playwright';
import { resetDemonstration, signInAs } from './sign-in.mjs';
import { assertLocalTarget } from './local-target.mjs';

const BASE = assertLocalTarget(process.env.EJE_E2E_URL ?? process.env.EJE_SMOKE_BASE_URL ?? 'http://localhost:3210');
const [shape, mode] = (process.env.EJE_FORMS_VIEWPORT ?? '1440x900').split(':');
const [width, height] = shape.split('x').map(Number);
const touch = mode === 'touch';
const label = `${width}x${height}${touch ? ' touch' : ''}`;
const JOB = 'EJE-1048';

const results = [];
const check = async (name, fn) => {
  try {
    const note = await fn();
    results.push(['PASS', name]);
    console.log(`PASS  ${name}${typeof note === 'string' ? `  — ${note}` : ''}`);
  } catch (error) {
    const message = String(error?.message ?? error).split('\n')[0];
    results.push(['FAIL', `${name} :: ${message}`]);
    console.log(`FAIL  ${name} :: ${message}`);
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
/** The job as the SERVER holds it — never what the screen says. */
const server = async () => (await call('GET', `/api/jobs/${JOB}`)).json?.data?.view?.job;
const partsOnServer = async () => (await server())?.parts.map((part) => `${part.partNumber}×${part.quantity}`) ?? [];
const partRow = (partNumber) => page.locator('tr', { hasText: partNumber }).first();
const dialog = () => page.getByRole('dialog');

console.log(`BD-PARTS-1 check at ${label} against ${BASE} — ${JOB}`);
await resetDemonstration(page, BASE);

await check('a breakdown enters the Job Complete wizard with its parts card OPEN (no "cancel completion" notice)', async () => {
  await signInAs(page, 'Sipho Mahlangu', { base: BASE });
  await go(`/jobs/${JOB}`);
  // The rule under test is the BREAKDOWN one: a changed seed must fail here, not pass as another job type.
  const type = (await server())?.jobType;
  if (type !== 'breakdown') fail(`${JOB} is a ${type}, not a breakdown`);
  await press(page.getByRole('button', { name: 'Accept job' }));
  await press(page.getByRole('button', { name: 'Accept and start' }));
  await page.getByRole('button', { name: 'No, Thanks' }).click({ timeout: 15000 }).catch(() => undefined);
  await press(page.getByRole('button', { name: 'Complete job' }));
  await page.getByText('Step 1 of', { exact: false }).waitFor({ timeout: 20000 });
  await page.waitForFunction(async (job) => {
    const response = await fetch(`/api/jobs/${job}`);
    return (await response.json())?.data?.view?.job?.status === 'completion';
  }, JOB, { timeout: 20000 });
  await page.getByLabel(/Work performed/).fill('Replaced the spindle bearing and the drive fuse.');
  await page.getByText(/^Saved /).first().waitFor({ timeout: 20000 });
  // The labour the signature needs, as a technician records it in the wizard.
  await press(page.getByRole('button', { name: 'Add labour' }).first());
  await press(page.getByRole('button', { name: '2', exact: true }));
  await press(page.getByRole('button', { name: 'Add labour' }).last());
  await page.getByText('Normal Time').first().waitFor({ timeout: 15000 });
  if ((await page.getByTestId('parts-locked-notice').count()) !== 0) fail('the parts are said to be locked in completion');
  if ((await page.getByRole('button', { name: 'Add part' }).count()) === 0) fail('no Add part in the wizard');
  await noPageOverflow('the completion step');
  return `server status ${(await server()).status}`;
});

await check('adds two parts at once in completion — saved on the server, the job still in completion', async () => {
  await press(page.getByRole('button', { name: 'Add part' }).first());
  await dialog().waitFor({ timeout: 10000 });
  const rows = page.getByTestId('part-line');
  const fill = async (index, partNumber, description, quantity, price) => {
    const row = rows.nth(index);
    await row.getByLabel('Part number').fill(partNumber);
    await row.getByLabel('Description').fill(description);
    await row.getByLabel('Quantity').fill(String(quantity));
    await row.getByLabel(/Unit price/).fill(price);
  };
  await fill(0, 'BRG-6205', 'Bearing 6205', 1, '95.00');
  await press(page.getByTestId('add-part-line'));
  await fill(1, 'FUSE-10A', 'Fuse 10A', 2, '12.00');
  await press(page.getByTestId('save-parts'));
  await dialog().waitFor({ state: 'detached', timeout: 20000 });
  await partRow('FUSE-10A').waitFor({ timeout: 20000 });
  const held = await partsOnServer();
  if (JSON.stringify(held) !== JSON.stringify(['BRG-6205×1', 'FUSE-10A×2'])) fail(`the server holds ${held.join(', ')}`);
  if ((await server()).status !== 'completion') fail('completion was cancelled');
  return held.join(', ');
});

await check('changes a quantity in completion — saved', async () => {
  await press(partRow('BRG-6205').getByRole('button', { name: 'Edit line' }));
  await dialog().waitFor({ timeout: 10000 });
  await dialog().getByLabel('Quantity').fill('3');
  await press(dialog().getByRole('button', { name: 'Save changes' }));
  await dialog().waitFor({ state: 'detached', timeout: 20000 });
  await page.waitForFunction(async (job) => {
    const parts = (await (await fetch(`/api/jobs/${job}`)).json())?.data?.view?.job?.parts ?? [];
    return parts.some((part) => part.partNumber === 'BRG-6205' && part.quantity === 3);
  }, JOB, { timeout: 20000 });
  return (await partsOnServer()).join(', ');
});

await check('removes a part in completion — gone on the server', async () => {
  await press(partRow('FUSE-10A').getByRole('button', { name: 'Remove line' }));
  const confirm = dialog().getByRole('button', { name: /^Remove/ });
  if ((await confirm.count()) > 0) await press(confirm.first());
  await page.waitForFunction(async (job) => {
    const parts = (await (await fetch(`/api/jobs/${job}`)).json())?.data?.view?.job?.parts ?? [];
    return !parts.some((part) => part.partNumber === 'FUSE-10A');
  }, JOB, { timeout: 20000 });
  const held = await partsOnServer();
  if (JSON.stringify(held) !== JSON.stringify(['BRG-6205×3'])) fail(`the server holds ${held.join(', ')}`);
  return held.join(', ');
});

await check('a reload and reopening bring the parts back exactly', async () => {
  await go(`/jobs/${JOB}?continue=1`);
  await partRow('BRG-6205').waitFor({ timeout: 20000 });
  if ((await page.locator('tr', { hasText: 'FUSE-10A' }).count()) !== 0) fail('the removed part came back');
  if (!/3/u.test(await partRow('BRG-6205').innerText())) fail('the changed quantity did not come back');
  if ((await server()).status !== 'completion') fail('the job is no longer in completion');
});

await check('once the customer is shown the job card, parts lock — the server refuses, and nothing changes', async () => {
  const held = await partsOnServer();
  const toSignature = await call('POST', `/api/jobs/${(await server()).id}/start_signature`);
  if (toSignature.status !== 200) fail(`start_signature answered ${toSignature.status}: ${JSON.stringify(toSignature.json?.error?.violations ?? toSignature.json?.error)}`);
  const id = (await server()).id;
  const lineId = (await server()).parts[0].id;
  for (const [route, body] of [
    ['add_part', { partNumber: 'LATE', description: 'late', quantity: 1, unitPrice: 1 }],
    ['update_part', { lineId, partNumber: 'BRG-6205', description: 'Bearing 6205', quantity: 9, unitPrice: 9500 }],
    ['remove_line', { kind: 'part', lineId }],
  ]) {
    const answer = await call('POST', `/api/jobs/${id}/${route}`, body);
    const codes = (answer.json?.error?.violations ?? []).map((violation) => violation.code);
    if (answer.status !== 422 || !codes.includes('parts_locked_after_completion')) fail(`${route} answered ${answer.status} ${codes.join(',')}`);
  }
  if (JSON.stringify(await partsOnServer()) !== JSON.stringify(held)) fail('the parts changed');
  await go(`/jobs/${JOB}`);
  await page.waitForLoadState('networkidle');
  if ((await page.getByRole('button', { name: 'Add part' }).count()) !== 0) fail('Add part is offered at the signature');
});

await check('no page error; no page scrolls sideways', async () => {
  await noPageOverflow('the job page');
  if (pageErrors.length > 0) fail(pageErrors.slice(0, 3).join(' | '));
});

await browser.close();
const failed = results.filter(([verdict]) => verdict === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed at ${label}`);
process.exit(failed.length === 0 ? 0 : 1);
