/**
 * MULTI-CO-1 in the browser (the owner, 15 November 2026): EJE and WD Hearn JHB as real companies.
 *
 *  - New Job: "Job for Which Company?" offers EJE (selected) and WD Hearn JHB; choosing WD Hearn JHB offers only
 *    the customers linked to it and clears one that is not; a WD Hearn job is numbered WDJ-0001 and an EJE job
 *    EJE-… — both checked on the SERVER, never only on the screen.
 *  - Customers: the "EJE Customers" and "WD Hearn Customers" tabs; a new customer has WD Hearn JHB ticked by
 *    default, and one company at least is required.
 *  - Administration → System → Company details: WD Hearn JHB's details, prefix and start saved, an overlapping
 *    prefix refused (in the form and by the server), its rates saved on Rates & VAT without touching EJE's.
 *  - No page error; no page scrolls sideways.
 *
 * At one viewport per run (`EJE_FORMS_VIEWPORT=1440x900`, `768x1024:touch`, `390x844:touch`). It resets the
 * DEMONSTRATION data first, so it refuses any target but a local one (`assertLocalTarget`).
 *
 *   EJE_E2E_URL=http://127.0.0.1:3210 node scripts/multi-company-check.mjs
 */
import { chromium } from 'playwright';
import { resetDemonstration, signInAs } from './sign-in.mjs';
import { assertLocalTarget } from './local-target.mjs';

const BASE = assertLocalTarget(process.env.EJE_E2E_URL ?? process.env.EJE_SMOKE_BASE_URL ?? 'http://localhost:3210');
const [shape, mode] = (process.env.EJE_FORMS_VIEWPORT ?? '1440x900').split(':');
const [width, height] = shape.split('x').map(Number);
const touch = mode === 'touch';
const label = `${width}x${height}${touch ? ' touch' : ''}`;
const EJE = 'eje';
const WD = 'wd-hearn-jhb';
const NEW_CUSTOMER = `Multi-company check customer ${width}`;

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
/** What the SERVER holds — never what the screen says. */
const serverJob = async (jobNumber) => (await call('GET', `/api/jobs/${jobNumber}`)).json?.data?.view?.job;
const serverCustomers = async (company) => (await call('GET', `/api/customers?company=${company}`)).json?.data ?? [];
const serverCompany = async (id) => ((await call('GET', '/api/admin/companies')).json?.data ?? []).find((company) => company.id === id);

const customerSelect = () => page.getByTestId('job-customer');
const offeredCustomers = async () =>
  (await customerSelect().locator('option').evaluateAll((options) => options.map((option) => option.value))).filter(Boolean);
const chooseFirst = async (locator) => {
  const values = (await locator.locator('option').evaluateAll((options) => options.map((option) => option.value))).filter(Boolean);
  if (values.length === 0) fail('nothing to choose');
  await locator.selectOption(values[0]);
};

/** Raises a breakdown for `customerId` under whichever company is selected; answers the job number. */
const raiseJob = async (customerId, fault) => {
  await customerSelect().selectOption(customerId);
  const site = page.getByLabel('Site', { exact: true });
  if ((await site.count()) > 0 && (await site.first().evaluate((element) => element.tagName === 'SELECT'))) await chooseFirst(site.first());
  await chooseFirst(page.getByLabel('Customer email recipient'));
  const priority = page.getByLabel(/^Priority/);
  if ((await priority.count()) > 0) await priority.first().selectOption('normal');
  await page.getByLabel(/^Fault description/).fill(fault);
  await press(page.getByRole('button', { name: 'Create job' }));
  await page.waitForURL(/\/jobs\/[A-Z0-9]+-\d+/u, { timeout: 30000 });
  return decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
};

console.log(`MULTI-CO-1 check at ${label} against ${BASE}`);
await resetDemonstration(page, BASE);
await signInAs(page, 'Elmarie Coetzee', { base: BASE });

await check('New Job asks "Job for Which Company?" with EJE selected and WD Hearn JHB offered, between where and what', async () => {
  await go('/jobs/new');
  const card = page.getByTestId('job-company-card');
  await card.waitFor({ timeout: 20000 });
  if (!(await card.getByText('Job for Which Company?', { exact: true }).isVisible())) fail('the question is not shown');
  if (!(await page.getByTestId(`job-company-${EJE}`).isChecked())) fail('EJE is not selected by default');
  if (await page.getByTestId(`job-company-${WD}`).isChecked()) fail('WD Hearn JHB is selected by default');
  if ((await card.getByText('WD Hearn JHB').count()) === 0) fail('the WD Hearn option is not labelled with its name');
  // Between "Where is the work?" and "What is the job?", as the owner placed it.
  const order = await page.evaluate(() => {
    const top = (text) => [...document.querySelectorAll('h2, legend')].find((element) => element.textContent?.trim() === text)?.getBoundingClientRect().top ?? Number.NaN;
    return [top('Where is the work?'), top('Job for Which Company?'), top('What is the job?')];
  });
  if (!(order[0] < order[1] && order[1] < order[2])) fail(`the cards are out of order: ${order.join(', ')}`);
  if (!/EJE-/u.test(await page.getByTestId('job-company-prefix').innerText())) fail('the EJE prefix is not shown');
  await noPageOverflow('New Job');
});

await check('choosing WD Hearn JHB offers only its customers and clears one that is not its', async () => {
  const ejeOffered = await offeredCustomers();
  if (!ejeOffered.includes('cust-abc')) fail(`EJE does not offer ABC Engineering: ${ejeOffered.join(', ')}`);
  await customerSelect().selectOption('cust-abc');
  await press(page.getByTestId(`job-company-${WD}`));
  if (!(await page.getByTestId(`job-company-${WD}`).isChecked())) fail('WD Hearn JHB did not become selected');
  if ((await customerSelect().inputValue()) !== '') fail('the EJE-only customer was kept');
  const offered = (await offeredCustomers()).sort();
  const linked = (await serverCustomers(WD)).map((row) => row.id).sort();
  if (JSON.stringify(offered) !== JSON.stringify(linked)) fail(`offered ${offered.join(', ')}; the server links ${linked.join(', ')}`);
  if (offered.includes('cust-abc')) fail('ABC Engineering is offered for WD Hearn JHB');
  if (!/WDJ-/u.test(await page.getByTestId('job-company-prefix').innerText())) fail('the WDJ- prefix is not shown');
  return offered.join(', ');
});

await check('a WD Hearn JHB job is WDJ-0001 — on the server — and its page names the company', async () => {
  const number = await raiseJob('cust-midrand', 'Multi-company check: a WD Hearn JHB breakdown.');
  if (number !== 'WDJ-0001') fail(`the job was numbered ${number}`);
  const job = await serverJob(number);
  if (job?.companyId !== WD) fail(`the server holds company ${job?.companyId}`);
  await page.getByTestId('job-company-badge').waitFor({ timeout: 15000 });
  if ((await page.getByTestId('job-company-badge').innerText()).trim() !== 'WD Hearn JHB') fail('the job page does not name WD Hearn JHB');
  await noPageOverflow('the WD Hearn job page');
  return number;
});

await check('an EJE job keeps the EJE numbering — on the server', async () => {
  await go('/jobs/new');
  await page.getByTestId('job-company-card').waitFor({ timeout: 20000 });
  // Midrand is a customer of both, so it stays when the company changes back.
  await press(page.getByTestId(`job-company-${WD}`));
  await customerSelect().selectOption('cust-midrand');
  await press(page.getByTestId(`job-company-${EJE}`));
  if ((await customerSelect().inputValue()) !== 'cust-midrand') fail('a customer of both was cleared');
  const number = await raiseJob('cust-midrand', 'Multi-company check: an EJE breakdown.');
  if (!/^EJE-\d{4,}$/u.test(number)) fail(`the job was numbered ${number}`);
  const job = await serverJob(number);
  if (job?.companyId !== EJE) fail(`the server holds company ${job?.companyId}`);
  return number;
});

await check('the Jobs list shows each job’s company', async () => {
  await go('/jobs');
  await page.getByText('WDJ-0001').first().waitFor({ timeout: 20000 });
  await noPageOverflow('the Jobs list');
});

await check('Customers has "EJE Customers" and "WD Hearn Customers" tabs; a customer of both is in both', async () => {
  await go('/customers');
  const ejeTab = page.getByRole('tab', { name: /EJE Customers/u });
  const wdTab = page.getByRole('tab', { name: /WD Hearn Customers/u });
  await ejeTab.waitFor({ timeout: 20000 });
  if ((await ejeTab.getAttribute('aria-selected')) !== 'true') fail('EJE Customers is not the first tab shown');
  await page.getByText('ABC Engineering (Pty) Ltd').first().waitFor({ timeout: 15000 });
  await press(wdTab);
  await page.getByText('Midrand Automation Group').first().waitFor({ timeout: 15000 });
  if ((await page.getByText('ABC Engineering (Pty) Ltd').count()) !== 0) fail('an EJE-only customer is on the WD Hearn tab');
  await press(ejeTab);
  await page.getByText('Midrand Automation Group').first().waitFor({ timeout: 15000 });
  await noPageOverflow('Customers');
});

await check('a new customer has WD Hearn JHB ticked by default, needs one company, and is saved as WD Hearn JHB’s', async () => {
  await go('/customers');
  await press(page.getByRole('button', { name: 'Add customer' }));
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 10000 });
  if (!(await dialog.getByTestId(`customer-company-${WD}`).isChecked())) fail('WD Hearn JHB is not ticked by default');
  if (await dialog.getByTestId(`customer-company-${EJE}`).isChecked()) fail('EJE is ticked by default');
  await dialog.getByLabel('Company name').fill(NEW_CUSTOMER);
  await dialog.getByLabel('City / town').fill('Johannesburg');
  await dialog.getByLabel('Street address').fill('1 Check Street');
  await dialog.getByLabel('Add a contact person for this site').setChecked(false);
  // None ticked: refused in the form, nothing sent.
  await dialog.getByTestId(`customer-company-${WD}`).setChecked(false);
  await press(dialog.getByRole('button', { name: 'Create customer' }));
  await dialog.getByTestId('customer-companies-error').waitFor({ timeout: 5000 });
  await dialog.getByTestId(`customer-company-${WD}`).setChecked(true);
  await noPageOverflow('the Add customer dialog');
  await press(dialog.getByRole('button', { name: 'Create customer' }));
  await page.waitForURL(/\/customers\/[^/]+$/u, { timeout: 20000 });
  const wd = (await serverCustomers(WD)).map((row) => row.name);
  const eje = (await serverCustomers(EJE)).map((row) => row.name);
  if (!wd.includes(NEW_CUSTOMER)) fail('the server does not list the new customer as WD Hearn JHB’s');
  if (eje.includes(NEW_CUSTOMER)) fail('the server lists the new customer as EJE’s');
});

await check('Company details: WD Hearn JHB’s details, prefix and start saved; an overlapping prefix refused', async () => {
  await go('/admin');
  await press(page.getByRole('tab', { name: 'System', exact: true }));
  await page.getByTestId('company-admin-details').waitFor({ timeout: 20000 });
  await press(page.getByRole('tab', { name: 'WD Hearn JHB', exact: true }));
  await page.getByTestId('company-next-number').filter({ hasText: 'WDJ-' }).waitFor({ timeout: 10000 });
  if ((await page.getByTestId('company-letterhead').innerText()).trim() !== 'No letterhead uploaded.') fail('no letterhead placeholder');

  // The overlap: refused in the form, beside the field…
  await page.getByTestId('company-jobNumberPrefix').fill('EJE-');
  await press(page.getByTestId('save-company-details'));
  await page.getByText(/EJE- cannot be used/u).first().waitFor({ timeout: 10000 });
  // …and by the server, whatever a client sends.
  const overlap = await call('PATCH', `/api/admin/companies/${WD}`, { numbering: { jobNumberPrefix: 'EJE-' } });
  const code = overlap.json?.error?.violations?.[0]?.code;
  if (overlap.status !== 422 || code !== 'job_number_prefix_conflict') fail(`the server answered ${overlap.status} ${code}`);

  await page.getByTestId('company-jobNumberPrefix').fill('WDH-');
  await page.getByTestId('company-jobNumberStart').fill('50');
  await page.getByTestId('company-phone').fill('+27 11 555 0101');
  await page.getByTestId('company-registration').fill('2026/000001/07');
  await page.getByTestId('company-senderName').fill('WD Hearn JHB Service');
  await page.getByTestId('company-replyTo').fill('service@wdhearn.example');
  await press(page.getByTestId('save-company-details'));
  await page.getByText('Saved', { exact: true }).first().waitFor({ timeout: 15000 });
  const held = await serverCompany(WD);
  if (held?.phone !== '+27 11 555 0101' || held?.jobNumberPrefix !== 'WDH-' || held?.nextJobSequence !== 50) {
    fail(`the server holds ${held?.phone} ${held?.jobNumberPrefix} next ${held?.nextJobSequence}`);
  }
  if (held?.notificationReplyTo !== 'service@wdhearn.example') fail('the reply-to was not saved');
  await page.getByTestId('company-next-number').filter({ hasText: 'WDH-0050' }).waitFor({ timeout: 10000 });

  // Numbers are issued, so the start cannot rewind the active sequence: refused in the form and by the server.
  await page.getByTestId('company-jobNumberStart').fill('10');
  await press(page.getByTestId('save-company-details'));
  await page.getByText(/only move forward/u).first().waitFor({ timeout: 10000 });
  const rewind = await call('PATCH', `/api/admin/companies/${WD}`, { numbering: { jobNumberStart: 10 } });
  if (rewind.status !== 422 || rewind.json?.error?.violations?.[0]?.code !== 'job_number_start_invalid') {
    fail(`the server answered a rewinding start with ${rewind.status}`);
  }
  if ((await serverCompany(WD))?.nextJobSequence !== 50) fail('the refused start moved the numbering');
  await noPageOverflow('Company details');
  return `next ${held.jobNumberPrefix}${held.nextJobSequence}`;
});

await check('WD Hearn JHB’s rates are saved on Rates & VAT, and EJE’s do not move', async () => {
  const ejeBefore = (await serverCompany(EJE))?.rates?.labourRates?.normal;
  await press(page.getByTestId('company-open-rates'));
  await page.getByTestId('company-admin-rates').waitFor({ timeout: 15000 });
  if ((await page.getByRole('tab', { name: 'WD Hearn JHB', exact: true }).getAttribute('aria-selected')) !== 'true') {
    fail('Rates & VAT did not open on WD Hearn JHB');
  }
  await page.getByLabel('Normal Time').fill('1111.00');
  await press(page.getByRole('button', { name: 'Save rates' }));
  await page.getByRole('dialog').waitFor({ timeout: 10000 });
  await press(page.getByRole('button', { name: 'Update rates' }));
  await page.getByText('Saved', { exact: true }).first().waitFor({ timeout: 15000 });
  const wd = (await serverCompany(WD))?.rates?.labourRates?.normal;
  const ejeAfter = (await serverCompany(EJE))?.rates?.labourRates?.normal;
  if (wd !== 111_100) fail(`WD Hearn JHB's normal rate is ${wd}`);
  if (ejeAfter !== ejeBefore) fail(`EJE's normal rate moved from ${ejeBefore} to ${ejeAfter}`);
  await noPageOverflow('Rates & VAT');
});

await check('no page error; no page scrolls sideways', async () => {
  await noPageOverflow('the last page');
  if (pageErrors.length > 0) fail(pageErrors.slice(0, 3).join(' | '));
});

await browser.close();
const failed = results.filter(([verdict]) => verdict === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed at ${label}`);
process.exit(failed.length === 0 ? 0 : 1);
