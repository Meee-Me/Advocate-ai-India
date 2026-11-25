// Browser end-to-end test: this app in dev mode (embedded Postgres, mock AI, local file storage) with a small
// stand-in for Supabase Auth, driven by Playwright. No Supabase project, accounts or API keys are needed.
//   node scripts/e2e.mjs            (needs `playwright` resolvable)
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'adv-shots-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-e2e-'));
const AUTH = 'http://localhost:8791'; // the Supabase Auth stand-in
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

// A tiny stand-in for the parts of Supabase Auth (GoTrue) this app calls: sign-up, password sign-in, "who am I",
// sign-out and password-reset email. It is NOT the real service: it only lets the browser flows run offline.
// `GET /__confirm?email=` plays the part of clicking the confirmation link in the email.
function startFakeSupabaseAuth(port) {
  const users = new Map(); // email -> { id, email, password, name, confirmed }
  const seen = { signups: 0, logins: 0, logouts: 0 };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const toUser = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.confirmed ? new Date().toISOString() : null,
    phone: '', app_metadata: { provider: 'email' }, user_metadata: { full_name: u.name, username: u.username }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  const sessionFor = (u) => {
    const iat = Math.floor(Date.now() / 1000), exp = iat + 3600;
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', iat, exp })}.e2e`;
    return { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: randomBytes(8).toString('hex'), user: toUser(u) };
  };
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === '/__confirm') { const u = users.get(url.searchParams.get('email')); if (u) u.confirmed = true; return send(res, u ? 200 : 404, { ok: !!u }); }
      if (url.pathname === '/auth/v1/signup') {
        seen.signups++;
        if (users.has(body.email)) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
        const nu = { id: randomUUID(), email: body.email, password: body.password, name: body.data?.full_name ?? '', username: body.data?.username, confirmed: true };
        users.set(body.email, nu);
        return send(res, 200, sessionFor(nu)); // "Confirm email" is off: sign-up returns a session
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        const u = users.get(body.email);
        if (!u || u.password !== body.password) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        if (!u.confirmed) return send(res, 400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
        seen.logins++;
        return send(res, 200, sessionFor(u));
      }
      if (url.pathname === '/auth/v1/user') {
        const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        let sub; try { sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub; } catch {}
        const u = [...users.values()].find((x) => x.id === sub);
        return u ? send(res, 200, toUser(u)) : send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
      }
      if (url.pathname === '/auth/v1/logout') { seen.logouts++; return send(res, 204); }
      return send(res, 404, { msg: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, users, seen })));
}

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

// A PDF with no text layer (a picture of a page), like a scan.
async function makeScannedPdf(lines) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const { deflateSync } = await import('node:zlib');
  const W = 1240, H = 1754;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#000'; ctx.font = '44px sans-serif';
  lines.forEach((l, i) => ctx.fillText(l, 100, 160 + i * 80));
  const rgba = ctx.getImageData(0, 0, W, H).data;
  const rgb = Buffer.alloc(W * H * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2]; }
  const img = deflateSync(rgb);
  const content = 'q 595 0 0 842 0 0 cm /Im0 Do Q';
  const objs = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [5 0 R] /Count 1 >>'), Buffer.from('<< >>'),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.length} >>\nstream\n`), img, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 6 0 R >>'), Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)];
  const parts = [Buffer.from('%PDF-1.4\n')]; const off = []; let pos = parts[0].length;
  objs.forEach((o, i) => { off.push(pos); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]); parts.push(b); pos += b.length; });
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return Buffer.concat(parts);
}

let failures = 0;
let page;
const check = (cond, msg) => { if (cond) log(`ok: ${msg}`); else { failures++; console.error(`✗ FAIL: ${msg}`); } };

try {
  const auth = await startFakeSupabaseAuth(8791);
  log('Supabase Auth stand-in is up');

  await start('npx', ['next', 'dev', '-p', '3000'], {
    env: { ...process.env, NODE_ENV: 'development', APP_URL: APP, SUPABASE_URL: AUTH, SUPABASE_ANON_KEY: 'anon-e2e-key',
      DATABASE_DRIVER: 'pglite', PGLITE_DIR: path.join(tmp, 'db'), AI_PROVIDER: 'mock', STORAGE_DRIVER: 'local', LOCAL_STORAGE_DIR: path.join(tmp, 'files'), CRON_SECRET: 'cron-secret-0123456789' } }, /Ready in/);
  log('Advocate AI India (next dev) is up');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(401|403|404)/.test(m.text())) problems.push(`console: ${m.text()}`); });
  const t0 = Date.now();
  const navLog = [];
  page.on('load', () => navLog.push(`${Date.now() - t0}ms load ${page.url()}`));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navLog.push(`${Date.now() - t0}ms navigated ${f.url()}`); });
  // caret: 'initial' stops Playwright injecting a caret-color style, which React would report as a hydration mismatch if the shot is taken before the page finishes loading.
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), caret: 'initial' });
  // Typing right after a page change can be wiped if the page re-renders from scratch, so require the
  // real precondition (the form's submit button is enabled, i.e. the app accepted the text), retry the
  // typing if not, count the retries, and fail if it keeps happening.
  let typingRetries = 0;
  const fillStable = async (loc, value, submit) => {
    for (let i = 0; i < 6; i++) {
      await loc.fill(value);
      await page.waitForTimeout(400);
      const kept = (await loc.inputValue()) === value;
      const ready = submit ? await submit.isEnabled() : true;
      if (kept && ready) return;
      typingRetries++;
      console.log(`  (typing retry ${typingRetries}: ${kept ? 'button still disabled' : 'text was cleared'}; navigation log: ${navLog.slice(-4).join(' | ')})`);
    }
    throw new Error(`the field never kept its value: ${value.slice(0, 40)}\nnavigation log:\n${navLog.join('\n')}`);
  };
  const nav = async (name) => { await page.getByRole('link', { name, exact: true }).first().click(); };
  // Every AI request first asks the person to confirm what will be sent; the server refuses AI requests without it.
  const consentDialog = () => page.getByRole('dialog', { name: 'Send this to the AI service?' });
  const sendToAi = async () => { await consentDialog().getByRole('button', { name: 'Send to AI' }).click(); };

  // 1. Signed-out visitors are sent to sign in.
  await page.goto(`${APP}/cases`, { timeout: 120000 });
  await page.waitForURL(/\/login\?next=%2Fcases/);
  check(true, 'signed-out visit to /cases redirects to /login');
  await shot('01-login');

  // 2. Create an account with a username: the warning must be ticked, then the person is signed in at once.
  await page.goto(`${APP}/register`);
  check(await page.getByText('without extra encryption by the app').isVisible(), 'sign-up shows the storage notice');
  await page.fill('input[name=fullName]', 'Meera Nair');
  await page.fill('input[name=username]', '@Meera.Nair');
  await page.fill('input[name=password]', 'hunter22hunter');
  await page.fill('input[name=confirmPassword]', 'hunter22hunter');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForSelector('text=Please tick the box to confirm you understand.');
  check(auth.seen.signups === 0, 'sign-up without the acknowledgement is stopped by the form (nothing was sent)');
  await shot('01b-signup-warning');
  await page.check('input[name=acknowledged]');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(`${APP}/dashboard`, { timeout: 60000 });
  check(auth.seen.signups === 1, 'sign-up is sent once and signs the person in (no email step)');
  await ctx.clearCookies(); // stands in for coming back later on a fresh browser

  // 3. Sign in with the username (any capitals): a wrong password is refused without saying which part was wrong.
  await page.goto(`${APP}/login?next=%2Fcases`);
  await page.fill('input[name=username]', '@MEERA.nair');
  await page.fill('input[name=password]', 'wrong-password-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForSelector('text=Username or password is incorrect.');
  check(auth.seen.logins === 0, 'a wrong password is refused with a message that does not say which part was wrong');

  // 4. Sign in with "keep me signed in".
  await page.fill('input[name=password]', 'hunter22hunter');
  await page.check('input[name=remember]');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(`${APP}/cases`, { timeout: 60000 });
  check(true, 'signed in, and landed on the page originally requested (/cases)');
  await page.waitForSelector('text=Meera Nair');
  check(true, 'advocate name from sign-up shown');
  const cookies = await ctx.cookies(APP);
  const sess = cookies.find((c) => c.name === 'advocate-auth' || c.name.startsWith('advocate-auth.'));
  check(sess?.httpOnly === true && sess.sameSite === 'Lax', 'session cookie is httpOnly + SameSite=Lax');
  check(!(await page.evaluate(() => document.cookie)).includes('advocate-auth'), 'session cookie is invisible to page JavaScript');
  check(sess?.expires > Date.now() / 1000 + 20 * 86400, '"keep me signed in" makes the session cookie last about 30 days');

  // 5. Clients and cases.
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
  await page.getByLabel('Case number').fill('WP(C) 1234/2024');
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
  // Tell the client: a drafted message and a WhatsApp link, nothing sent by this site.
  await page.getByRole('button', { name: 'Tell client' }).first().click();
  const tellBox = page.getByRole('dialog', { name: 'Update Ravi Kumar' });
  await tellBox.waitFor();
  check((await tellBox.getByLabel('Message').inputValue()).includes('Dear Ravi Kumar'), 'client update: a first draft is written for the advocate to edit');
  const wa = await tellBox.getByRole('link', { name: 'Open in WhatsApp' }).getAttribute('href');
  check(wa?.startsWith('https://wa.me/919876543210?text='), 'client update: the WhatsApp link uses the client\'s number');
  await shot('03b-tell-client');
  await page.keyboard.press('Escape');
  await shot('03-case');

  // 6. Calendar + reminders.
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

  // 6b. Cause list: paste, match to my case, confirm, see it as today's item on the dashboard.
  await nav('Cause list');
  await page.getByLabel('Cause list text').fill('Court Hall 3. Item 12: WP(C) No. 1234/2024 Asha Menon v. State for arguments. Item 27: CRL.M.C. 55/2023. Item 31: OP(C) 999/2022.');
  await page.getByRole('button', { name: 'Find my cases' }).click();
  await sendToAi();
  await page.waitForSelector('text=Your case: Ravi Kumar v. State of Maharashtra');
  check((await page.getByText('Not one of your cases').count()) === 2, 'cause list: rows that are not my cases are marked and left out');
  await shot('06b-causelist-review');
  await page.getByRole('button', { name: /^Add 1 to/ }).click();
  await page.waitForSelector('text=1 added');
  await page.getByRole('link', { name: "See today's list" }).click();
  await page.waitForSelector('text=Today in court');
  await page.waitForSelector('a:has-text("Ravi Kumar v. State of Maharashtra") >> text=12');
  check(true, 'cause list: the matched case shows on today\'s list with its item number');
  await shot('06c-today');

  // 6c. Billing: add a fee, see what the client owes, make a numbered invoice.
  await nav('Billing');
  await page.getByRole('button', { name: '+ Add entry' }).click();
  const entryBox = page.getByRole('dialog', { name: 'Add entry' });
  await entryBox.getByLabel('Client').selectOption({ label: 'Ravi Kumar' });
  await entryBox.getByLabel('Amount (₹)').fill('25,000');
  await entryBox.getByLabel('Note (optional)').fill('Drafting the reply notice');
  await entryBox.getByRole('button', { name: 'Save entry' }).click();
  await page.waitForSelector('text=₹25,000 due');
  check(true, 'billing: a fee is recorded and the client shows as owing it');
  await shot('06d-billing');
  await page.getByRole('button', { name: 'Create invoice' }).click();
  await page.getByRole('dialog', { name: 'Create invoice' }).getByRole('button', { name: 'Create invoice' }).click();
  await page.waitForURL(/\/billing\/invoices\/[0-9a-f-]{36}/);
  await page.waitForSelector('text=Invoice INV-');
  check((await page.getByText('₹25,000').count()) >= 1, 'billing: the invoice is numbered and shows the total');
  await shot('06e-invoice');

  // 7. Chat.
  await nav('Legal chat');
  await fillStable(page.getByLabel('Your question'), 'What is the basic structure doctrine?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await consentDialog().waitFor();
  check((await consentDialog().innerText()).includes('outside AI service'), 'the AI consent box names the provider and says what will be sent');
  await shot('06a-consent');
  await consentDialog().getByRole('button', { name: 'Cancel' }).click();
  check((await consentDialog().count()) === 0 && (await page.getByLabel('Your question').inputValue()) !== '', 'cancelling sends nothing and keeps the question');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await sendToAi();
  await page.waitForSelector('text=citation withheld', { timeout: 30000 });
  check(await page.locator('text=/AIR 1973/').count() === 0, 'chat answer streams, and the invented citation was removed (never shown)');
  check(await page.locator('text=/authorit(y|ies) to verify/').count() > 0, 'the case name from AI memory is flagged for verification');
  await shot('06-chat');

  // 8. Documents: upload a PDF through the browser, then summarise.
  await nav('Documents');
  const pdf = makePdf(Array.from({ length: 25 }, (_, i) => `Paragraph ${i + 1}. The petitioner submits that the impugned order dated 5 March 2024 is arbitrary.`));
  await page.setInputFiles('input[type=file]', { name: 'order.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForSelector('text=Uploaded (1 pages)', { timeout: 30000 });
  check(true, 'PDF uploaded and read');
  await page.getByRole('link', { name: /order/ }).first().click();
  await page.getByRole('button', { name: 'Summarise' }).click();
  await sendToAi();
  await page.waitForSelector('text=Mock summary text.', { timeout: 30000 });
  check(true, 'PDF summarised');
  await shot('07-document');
  await page.getByRole('button', { name: 'Analyse as judgment' }).click();
  await sendToAi();
  await page.waitForSelector('text=NOT found in document', { timeout: 30000 });
  check(true, 'a quote that is not in the PDF is marked NOT found');
  await shot('08-judgment-verification');

  // 8b. Scanned PDF: no text layer, so it is read with OCR (progress shown), then analysed.
  await nav('Documents');
  const scan = await makeScannedPdf(['IN THE HIGH COURT OF DELHI', 'The petition is dismissed with costs.']);
  await page.setInputFiles('input[type=file]', { name: 'scanned-order.pdf', mimeType: 'application/pdf', buffer: scan });
  await page.waitForSelector('text=read 1 scanned pages with OCR', { timeout: 90000 });
  check(true, 'scanned PDF uploaded and read with OCR');
  await page.getByRole('link', { name: /scanned-order/ }).first().click();
  await page.waitForSelector('text=read with OCR');
  await page.getByRole('button', { name: 'Summarise' }).click();
  await sendToAi();
  await page.waitForSelector('text=Mock summary text.', { timeout: 30000 });
  await page.waitForSelector('text=Read from a scan using OCR');
  check(true, 'scanned PDF analysed from the OCR text, with an OCR accuracy warning');
  await shot('07b-scanned-document');

  // 9. Drafting.
  await nav('Drafting');
  await fillStable(page.getByLabel('Facts and instructions'), 'Client Ravi Kumar wants to send a legal notice to his tenant for three months of unpaid rent.');
  await page.getByRole('button', { name: 'Generate draft' }).click();
  await sendToAi();
  await page.waitForURL(/\/drafting\/[0-9a-f-]{36}/, { timeout: 30000 });
  await page.waitForSelector('textarea[aria-label="Draft text"]');
  check((await page.inputValue('textarea[aria-label="Draft text"]')).includes('[●]'), 'draft has [●] placeholders for unknown facts');
  await page.getByRole('button', { name: 'Make the language more formal' }).click();
  await sendToAi();
  await page.waitForSelector('text=Edited. The previous text is saved');
  check((await page.inputValue('textarea[aria-label="Draft text"]')).includes('revised by mock'), 'AI edit applied');
  // Restore the version saved before the AI edit (the oldest one listed): the edit must disappear.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Restore' }).last().click();
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Draft text"]').value.includes('revised by mock'), null, { timeout: 15000 });
  check(true, 'restoring an earlier version removes the AI edit');
  await shot('09-drafting');

  // 10. Translate, research, analysis.
  await nav('Translate');
  const translateBtn = page.getByRole('button', { name: 'Translate' }).last();
  await fillStable(page.getByLabel('Text'), 'The petition is dismissed.', translateBtn);
  await translateBtn.click();
  await sendToAi();
  await page.waitForSelector('text=Working translation, not certified', { timeout: 30000 });
  check(true, 'translation with the "not certified" notice');
  await nav('Research');
  await fillStable(page.getByLabel('Legal question or issue'), 'Is the basic structure doctrine part of Indian law?');
  await page.getByRole('button', { name: 'Research', exact: true }).click();
  await sendToAi();
  await page.waitForSelector('text=Short answer', { timeout: 30000 });
  await page.waitForSelector('text=AI memory: verify');
  check(true, 'research memo shows authorities from AI memory as "verify"');
  await shot('10-research');
  await nav('Contract & judgment');
  await fillStable(page.getByLabel('Paste the full text'), 'ARTICLE 7. The Seller shall indemnify without limit the Buyer against all losses. Governing law: India.');
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await sendToAi();
  await page.waitForSelector('text=Unlimited indemnity', { timeout: 30000 });
  check((await page.locator('text=found in document').count()) > 0, 'contract risk quotes are verified against the text');
  await shot('11-contract');

  // 11. Profile and dashboard.
  await nav('Profile');
  await fillStable(page.getByLabel('City'), 'Pune');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.waitForSelector('text=Profile saved.');
  check(true, 'profile saved');
  await page.getByRole('button', { name: 'Test AI connection' }).click();
  await page.waitForSelector('text=This is the mock, not a real AI');
  check((await consentDialog().count()) === 0, '"Test AI connection" needs no consent box (it sends none of your data)');
  check(true, '"Test AI connection" honestly reports the mock as not a real AI');
  await nav('Dashboard');
  await page.waitForSelector('text=Upcoming hearings');
  await shot('12-dashboard');

  // 12. Mobile layout.
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

  // 13. Another person cannot read this advocate's data; sign out locks everything.
  const other = await browser.newContext();
  const anon = await other.request.get(`${APP}${new URL(caseUrl).pathname.replace('/cases/', '/api/cases/')}`);
  check(anon.status() === 401, 'an unauthenticated client cannot read a case (401)');
  await page.goto(`${APP}/dashboard`);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login/);
  await page.goto(`${APP}/dashboard`);
  await page.waitForURL(/\/login/);
  check(true, 'after sign out, the dashboard is locked again');
  check(auth.seen.logouts === 1, 'sign-out ended the session with Supabase Auth');

  check(typingRetries <= 2, `typing needed ${typingRetries} retries (more than 2 would mean the pages reset themselves)`);
  check(problems.length === 0, `no browser console errors${problems.length ? ': ' + problems.slice(0, 5).join(' | ') : ''}`);
  await browser.close();
  auth.server.close();
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
