// Browser end-to-end test: the real Deluxe Main server code + this app in dev mode
// (embedded Postgres, mock AI, local file storage), driven by Playwright.
//   node scripts/e2e.mjs            (needs `playwright` resolvable and ../Deluxe-Main checked out)
import { spawn } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const MAIN_DIR = process.env.DELUXE_MAIN_DIR ?? path.resolve('..', 'Deluxe-Main');
const SHOTS = process.env.SHOTS_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'adv-shots-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-e2e-'));
const MAIN = 'http://localhost:8790';
const APP = 'http://localhost:3000';
const procs = [];
const log = (m) => console.log(`• ${m}`);

function start(cmd, args, opts, ready) {
  const p = spawn(cmd, args, { ...opts, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); // own process group, so cleanup kills children too
  procs.push(p);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${cmd} ${args.join(' ')} did not become ready`)), 90000);
    const on = (d) => { if (ready.test(String(d))) { clearTimeout(t); resolve(p); } };
    p.stdout.on('data', on); p.stderr.on('data', on);
    if (process.env.E2E_VERBOSE) { p.stdout.on('data', (d) => process.stdout.write(String(d))); p.stderr.on('data', (d) => process.stderr.write(String(d))); }
    p.on('exit', (c) => reject(new Error(`${cmd} exited early (${c})`)));
  });
}
const stop = () => procs.forEach((p) => { try { process.kill(-p.pid, 'SIGKILL'); } catch {} });
process.on('exit', stop);

function makePdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, '\\$&');
  const stream = 'BT /F1 11 Tf 40 780 Td 14 TL ' + lines.map((l) => `(${esc(l)}) Tj T*`).join(' ') + ' ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R] /Count 1 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out);
}

let failures = 0;
let page;
const check = (cond, msg) => { if (cond) log(`ok: ${msg}`); else { failures++; console.error(`✗ FAIL: ${msg}`); } };

try {
  await start('node', ['tests/dev-server.mjs', '8790'], { cwd: MAIN_DIR, env: { ...process.env, ALLOW_LOCALHOST: '1' } }, /dev server/);
  log('Deluxe Main (real server code) is up');
  // Someone creates a Deluxe account.
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync('hunter22hunter', Buffer.from(salt, 'hex'), 120000, 32, 'sha256').toString('hex');
  const acct = await fetch(`${MAIN}/api/accounts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Meera Nair', salt, hash }) });
  check(acct.status === 201, 'Deluxe account created');

  await start('npx', ['next', 'dev', '-p', '3000'], {
    env: { ...process.env, NODE_ENV: 'development', APP_URL: APP, SESSION_SECRET: 'e2e-secret-'.padEnd(48, 'x'), AUTH_PROVIDER: 'deluxe', DELUXE_MAIN_URL: MAIN, DELUXE_APP_ID: 'advocate',
      DATABASE_DRIVER: 'pglite', PGLITE_DIR: path.join(tmp, 'db'), AI_PROVIDER: 'mock', STORAGE_DRIVER: 'local', LOCAL_STORAGE_DIR: path.join(tmp, 'files'), CRON_SECRET: 'cron-secret-0123456789' } }, /Ready in/);
  log('Advocate AI India (next dev) is up');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(401|404)/.test(m.text())) problems.push(`console: ${m.text()}`); });
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  // Typing right after a page change can land before React hydrates and be wiped by it, so
  // retry until the value has actually stuck (and fail if it never does).
  const fillStable = async (loc, value) => {
    for (let i = 0; i < 10; i++) {
      await loc.fill(value);
      await page.waitForTimeout(250);
      if ((await loc.inputValue()) === value) return;
    }
    throw new Error(`the field never kept its value: ${value.slice(0, 40)}`);
  };
  const nav = async (name) => { await page.getByRole('link', { name, exact: true }).first().click(); };

  // 1. Signed-out visitors are sent to sign in.
  await page.goto(`${APP}/cases`, { timeout: 120000 });
  await page.waitForURL(/\/login\?next=%2Fcases/);
  check(true, 'signed-out visit to /cases redirects to /login');
  await shot('01-login');

  // 2. Sign in through the real Deluxe Main page.
  await page.getByRole('link', { name: 'Sign in with Deluxe Main' }).click();
  await page.waitForURL(`${MAIN}/connect**`);
  await page.fill('#auth-name', 'Meera Nair');
  await page.fill('#auth-password', 'hunter22hunter');
  await page.click('#auth-submit');
  await page.waitForSelector('#connect-go:visible', { timeout: 30000 });
  await shot('02-deluxe-main-continue');
  await page.click('#connect-go');
  await page.waitForURL(`${APP}/cases`, { timeout: 60000 });
  check(true, 'came back from Deluxe Main signed in, and landed on the page originally requested (/cases)');
  check(!page.url().includes('deluxe_code'), 'one-use code is not left in the address bar');
  await page.waitForSelector('text=Meera Nair');
  check(true, 'advocate name from Deluxe Main shown');
  const cookies = await ctx.cookies(APP);
  const sess = cookies.find((c) => c.name.includes('advocate_session'));
  check(sess?.httpOnly === true && sess.sameSite === 'Lax', 'session cookie is httpOnly + SameSite=Lax');
  check(!(await page.evaluate(() => document.cookie)).includes('advocate_session'), 'session cookie is invisible to page JavaScript');

  // 3. Clients and cases.
  await nav('Clients');
  await page.getByRole('button', { name: '+ New client' }).click();
  await page.getByLabel('Name').fill('Ravi Kumar');
  await page.getByLabel('Phone').fill('9876543210');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('text=Ravi Kumar');
  check(true, 'client created');
  await nav('Cases');
  await page.getByRole('button', { name: '+ New case' }).click();
  await page.getByLabel('Title').fill('Ravi Kumar v. State of Maharashtra');
  await page.getByLabel('Client').selectOption({ label: 'Ravi Kumar' });
  await page.getByLabel('Court', { exact: true }).fill('Pune District Court');
  await page.getByRole('button', { name: 'Create case' }).click();
  await page.waitForURL(/\/cases\/[0-9a-f-]{36}/);
  await page.waitForSelector('text=Client: Ravi Kumar');
  check(true, 'case created and linked to the client');
  const caseUrl = page.url();
  await page.getByPlaceholder('Add a note…').fill('Client called about the next date.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.waitForSelector('text=Client called about the next date.');
  // Hearing in 2 days.
  await page.getByRole('button', { name: '+ Add' }).click();
  await page.getByLabel('Purpose').fill('Final arguments');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('text=Final arguments');
  check(true, 'hearing added to the case');
  await shot('03-case');

  // 4. Calendar + reminders.
  await nav('Hearings');
  await page.waitForSelector('text=Next hearings');
  await page.waitForSelector('a:has-text("Ravi Kumar v. State of Maharashtra")');
  check(true, 'hearing appears on the hearing calendar');
  await shot('04-calendar');
  const cron = await fetch(`${APP}/api/cron/reminders`, { headers: { authorization: 'Bearer cron-secret-0123456789' } }).then((r) => r.json());
  check(cron.created === 1, 'reminder job created one reminder');
  await page.reload();
  await page.getByRole('button', { name: /Notifications, 1 unread/ }).click();
  await page.waitForSelector('text=Hearing');
  check(true, 'reminder shown under the bell');
  await shot('05-reminder');
  await page.keyboard.press('Escape');

  // 5. Chat.
  await nav('Legal chat');
  await fillStable(page.getByLabel('Your question'), 'What is the basic structure doctrine?');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForSelector('text=unverified', { timeout: 30000 });
  await page.waitForSelector('text=authority to verify, text=authorities to verify', { timeout: 30000 }).catch(() => {});
  check(await page.locator('text=/authorit(y|ies) to verify/').count() > 0, 'chat answer streams and unverified authorities are flagged');
  await shot('06-chat');

  // 6. Documents: upload a PDF through the browser, then summarise.
  await nav('Documents');
  const pdf = makePdf(Array.from({ length: 25 }, (_, i) => `Paragraph ${i + 1}. The petitioner submits that the impugned order dated 5 March 2024 is arbitrary.`));
  await page.setInputFiles('input[type=file]', { name: 'order.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForSelector('text=Uploaded (1 pages)', { timeout: 30000 });
  check(true, 'PDF uploaded and read');
  await page.getByRole('link', { name: /order/ }).first().click();
  await page.getByRole('button', { name: 'Summarise' }).click();
  await page.waitForSelector('text=Mock summary text.', { timeout: 30000 });
  check(true, 'PDF summarised');
  await shot('07-document');
  await page.getByRole('button', { name: 'Analyse as judgment' }).click();
  await page.waitForSelector('text=NOT found in document', { timeout: 30000 });
  check(true, 'a quote that is not in the PDF is marked NOT found');
  await shot('08-judgment-verification');

  // 7. Drafting.
  await nav('Drafting');
  await fillStable(page.getByLabel('Facts and instructions'), 'Client Ravi Kumar wants to send a legal notice to his tenant for three months of unpaid rent.');
  await page.getByRole('button', { name: 'Generate draft' }).click();
  await page.waitForURL(/\/drafting\/[0-9a-f-]{36}/, { timeout: 30000 });
  await page.waitForSelector('textarea[aria-label="Draft text"]');
  check((await page.inputValue('textarea[aria-label="Draft text"]')).includes('[●]'), 'draft has [●] placeholders for unknown facts');
  await page.getByRole('button', { name: 'Make the language more formal' }).click();
  await page.waitForSelector('text=Edited. The previous text is saved');
  check((await page.inputValue('textarea[aria-label="Draft text"]')).includes('revised by mock'), 'AI edit applied');
  // Restore the version saved before the AI edit (the oldest one listed): the edit must disappear.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Restore' }).last().click();
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Draft text"]').value.includes('revised by mock'), null, { timeout: 15000 });
  check(true, 'restoring an earlier version removes the AI edit');
  await shot('09-drafting');

  // 8. Translate, research, analysis.
  await nav('Translate');
  await fillStable(page.getByLabel('Text'), 'The petition is dismissed.');
  await page.getByRole('button', { name: 'Translate' }).last().click();
  await page.waitForSelector('text=Working translation, not certified', { timeout: 30000 });
  check(true, 'translation with the "not certified" notice');
  await nav('Research');
  await fillStable(page.getByLabel('Legal question or issue'), 'Is the basic structure doctrine part of Indian law?');
  await page.getByRole('button', { name: 'Research', exact: true }).click();
  await page.waitForSelector('text=Short answer', { timeout: 30000 });
  await page.waitForSelector('text=AI memory: verify');
  check(true, 'research memo shows authorities from AI memory as "verify"');
  await shot('10-research');
  await nav('Contract & judgment');
  await fillStable(page.getByLabel('Paste the full text'), 'ARTICLE 7. The Seller shall indemnify without limit the Buyer against all losses. Governing law: India.');
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await page.waitForSelector('text=Unlimited indemnity', { timeout: 30000 });
  check((await page.locator('text=found in document').count()) > 0, 'contract risk quotes are verified against the text');
  await shot('11-contract');

  // 9. Profile and dashboard.
  await nav('Profile');
  await fillStable(page.getByLabel('City'), 'Pune');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.waitForSelector('text=Profile saved.');
  check(true, 'profile saved');
  await nav('Dashboard');
  await page.waitForSelector('text=Upcoming hearings');
  await shot('12-dashboard');

  // 10. Mobile layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForSelector('text=Upcoming hearings');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 1, `no horizontal scrolling on a 390px phone (overflow ${overflow}px)`);
  await shot('13-mobile-dashboard');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.waitForSelector('nav[aria-label="Main"]:visible');
  await shot('14-mobile-menu');
  await page.getByRole('button', { name: 'Close menu' }).click();
  for (const p of ['/chat', '/cases', '/calendar', '/drafting']) {
    await page.goto(APP + p);
    await page.waitForLoadState('networkidle');
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(o <= 1, `no horizontal scrolling on ${p} at 390px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // 11. Another person cannot read this advocate's data; sign out locks everything.
  const other = await browser.newContext();
  const anon = await other.request.get(`${APP}${new URL(caseUrl).pathname.replace('/cases/', '/api/cases/')}`);
  check(anon.status() === 401, 'an unauthenticated client cannot read a case (401)');
  await page.goto(`${APP}/dashboard`);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login/);
  await page.goto(`${APP}/dashboard`);
  await page.waitForURL(/\/login/);
  check(true, 'after sign out, the dashboard is locked again');

  check(problems.length === 0, `no browser console errors${problems.length ? ': ' + problems.slice(0, 5).join(' | ') : ''}`);
  await browser.close();
} catch (e) {
  failures++;
  console.error('✗ E2E crashed:', e);
  try { console.error('PAGE:', page.url(), (await page.locator('body').innerText()).slice(0, 400)); await page.screenshot({ path: path.join(SHOTS, 'crash.png') }); } catch {}
} finally {
  stop();
}
console.log(`\nScreenshots: ${SHOTS}`);
console.log(failures ? `FAILED (${failures})` : 'ALL E2E CHECKS PASSED');
process.exit(failures ? 1 : 0);
