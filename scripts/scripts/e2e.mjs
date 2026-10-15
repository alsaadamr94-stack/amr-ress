// End-to-end API test. Usage: BASE=http://localhost:3000 DATABASE_URL=... SETUP_KEY=... CRON_SECRET=... MAIL_OUTBOX=/path node scripts/e2e.mjs
import pg from 'pg';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:3000';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
let pass = 0, failn = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { failn++; console.log('  ✗ FAIL:', m); } };

class Client {
  constructor() { this.cookie = ''; }
  async call(method, path, body, headers = {}) {
    const h = { 'Content-Type': 'application/json', 'X-Requested-With': 'rass', ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    const r = await fetch(BASE + '/api' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = /rass_session=([^;]*)/.exec(sc); if (m) this.cookie = m[1] ? 'rass_session=' + m[1] : ''; }
    let j = null; const txt = await r.text(); try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
    return { s: r.status, j };
  }
  get(p) { return this.call('GET', p); } post(p, b) { return this.call('POST', p, b || {}); } put(p, b) { return this.call('PUT', p, b || {}); }
}
const today = new Date().toISOString().slice(0, 10);
const sec = t => console.log('\n== ' + t);

sec('setup');
const anon = new Client();
let r = await anon.get('/setup/status'); ok(r.j.needsSetup === true, 'needs setup on empty DB');
r = await anon.post('/setup', { key: 'wrong', name: 'مدير', username: 'admin', password: 'Passw0rd!x' }); ok(r.s === 403, 'bad setup key rejected');
r = await anon.post('/setup', { key: process.env.SETUP_KEY, name: 'المدير العام', username: 'admin', email: 'admin@example.com', password: 'weak' }); ok(r.s === 400, 'weak password rejected');
r = await anon.post('/setup', { key: process.env.SETUP_KEY, name: 'المدير العام', username: 'admin', email: 'admin@example.com', password: 'Admin#2026a' }); ok(r.s === 200, 'first admin created');
r = await anon.post('/setup', { key: process.env.SETUP_KEY, name: 'x2', username: 'admin2', password: 'Admin#2026a' }); ok(r.s === 403, 'second setup blocked');

sec('csrf + auth basics');
r = await anon.call('POST', '/auth/login', { username: 'admin', password: 'Admin#2026a' }, { 'X-Requested-With': '' }); ok(r.s === 403, 'login without CSRF header rejected');
r = await anon.call('POST', '/auth/login', { username: 'admin', password: 'Admin#2026a' }, { Origin: 'http://evil.example' }); ok(r.s === 403, 'cross-origin login rejected');
r = await anon.get('/bootstrap'); ok(r.s === 401, 'bootstrap requires login');
const admin = new Client();
r = await admin.post('/auth/login', { username: 'admin', password: 'Admin#2026a' }); ok(r.s === 200 && !r.j.must_change, 'admin login');
r = await admin.get('/bootstrap'); ok(r.s === 200 && r.j.items.length === 21 && r.j.settings.nextSeq === 1, 'bootstrap has 21 library items and counter=1');
ok(r.j.me.role === 'admin', 'me is admin');

sec('users + roles');
const mk = async (username, role, name) => { const x = await admin.post('/users', { username, name, role, email: username + '@example.com' }); ok(x.s === 200 && x.j.tempPassword, 'create ' + role); return x.j; };
const uS = await mk('sales1', 'sales', 'مندوب مبيعات'); const uS2 = await mk('sales2', 'sales', 'مندوب ثاني'); const uA = await mk('acc1', 'accountant', 'المحاسب'); const uV = await mk('view1', 'viewer', 'مشاهد');
r = await admin.post('/users', { username: 'sales1', name: 'dup', role: 'sales' }); ok(r.s === 400, 'duplicate username rejected');
const login = async (u, pw) => { const c = new Client(); const x = await c.post('/auth/login', { username: u, password: pw }); return { c, x }; };
const sales = await login('sales1', uS.tempPassword); ok(sales.x.j.must_change === true, 'temp password forces change');
r = await sales.c.get('/bootstrap'); ok(r.s === 403 && r.j.code === 'must_change', 'API blocked until password changed');
r = await sales.c.post('/me/password', { current: uS.tempPassword, password: 'short' }); ok(r.s === 400, 'weak new password rejected');
r = await sales.c.post('/me/password', { current: uS.tempPassword, password: 'Sales#2026a' }); ok(r.s === 200, 'password changed');
r = await sales.c.get('/bootstrap'); ok(r.s === 200, 'sales can use API after change');
const sales2 = await login('sales2', uS2.tempPassword); await sales2.c.post('/me/password', { current: uS2.tempPassword, password: 'Sales#2026b' });
const acc = await login('acc1', uA.tempPassword); await acc.c.post('/me/password', { current: uA.tempPassword, password: 'Acc#2026aa' });
const view = await login('view1', uV.tempPassword); await view.c.post('/me/password', { current: uV.tempPassword, password: 'View#2026a' });
r = await sales.c.get('/users'); ok(r.s === 403, 'sales cannot list users');
r = await sales.c.get('/audit'); ok(r.s === 403, 'sales cannot read audit');
r = await acc.c.get('/backups'); ok(r.s === 403, 'accountant cannot read backups');

sec('lockout');
const bad = new Client(); for (let i = 0; i < 5; i++) r = await bad.post('/auth/login', { username: 'view1', password: 'nope' + i });
r = await bad.post('/auth/login', { username: 'view1', password: 'View#2026a' }); ok(r.s === 429, 'account locked after 5 failures (even with right password)');
const ul = (await admin.get('/users')).j.users.find(u => u.username === 'view1'); ok(ul.locked === true, 'admin sees locked state');
await admin.post('/users/' + ul.id + '/unlock'); r = await bad.post('/auth/login', { username: 'view1', password: 'View#2026a' }); ok(r.s === 200, 'unlock works');

sec('quotes: create, sync, conflicts');
const items = (await admin.get('/bootstrap')).j.items;
const mkLine = (it, qty) => ({ id: 'l' + Math.random().toString(36).slice(2, 8), lib: it.id, group: it.cat, desc: it.desc, brand: it.brand, unit: it.unit, qty, price: it.price });
const baseQ = (o = {}) => ({ id: 'q' + Math.random().toString(36).slice(2, 10), client: 'عميل تجريبي', custId: '', project: 'مشروع', location: 'الرياض', validity: 30, preparedBy: 'x', lines: [], discMode: 'pct', discPct: 0, discAmt: 0, vatRate: 15, notes: 'n', ...o });
r = await admin.post('/quotes', { quote: baseQ(), numbering: 'counter' }); ok(r.s === 200 && r.j.quote.no === '26-1', 'admin quote numbered 26-1: ' + r.j.quote?.no);
const qA = r.j.quote;
r = await sales.c.post('/quotes', { quote: baseQ({ client: 'عميل المبيعات' }), numbering: 'counter' }); ok(r.j.quote.no === '26-2' && r.j.counters.nextSeq === 3, 'sequential numbering across users');
let qS = r.j.quote;
r = await anon.post('/quotes', { quote: baseQ() }); ok(r.s === 401, 'anon cannot create');
r = await view.c.post('/quotes', { quote: baseQ() }); ok(r.s === 403, 'viewer cannot create');
r = await acc.c.post('/quotes', { quote: baseQ() }); ok(r.s === 403, 'accountant cannot create');
// customer + lines through sync
const cust = { id: 'cust1abc', name: 'عميل تجريبي', phone: '0501234567' };
qA.lines = [mkLine(items[0], 4), mkLine(items[12], 1)]; qA.custId = cust.id; qA.status = 'sent';
r = await admin.post('/sync', { customers: { put: [cust], del: [] }, quotes: { put: [qA], del: [] } });
ok(r.s === 200 && r.j.versions.quotes[qA.id] === 2 && r.j.rejected.length === 0, 'sync saved quote (v2) and customer');
qA._v = 2;
r = await admin.post('/sync', { quotes: { put: [{ ...qA, project: 'stale', _v: 1 }], del: [] } }); ok(r.j.rejected[0]?.reason?.includes('مستخدم آخر') && r.j.rejected[0].current._v === 2, 'stale version -> conflict with current copy');
r = await admin.post('/sync', { quotes: { put: [{ ...qA, project: 'محدّث' }], del: [] } }); ok(r.j.versions.quotes[qA.id] === 3, 'normal update bumps version'); qA._v = 3; qA.project = 'محدّث';
const xs = await sales.c.post('/sync', { quotes: { put: [{ ...qA }], del: [] } }); ok(xs.j.rejected.length === 1, "sales cannot edit another user's quote");
r = await sales2.c.get('/bootstrap'); ok(r.j.quotes.length === 0, 'sales2 sees none of the others’ quotes');
r = await sales.c.get('/bootstrap'); ok(r.j.quotes.length === 1 && r.j.quotes[0].id === qS.id && r.j.customers.length === 0, 'sales sees only own quote, not admin customer');
ok(r.j.receipts.length === 0, 'sales receives no receipts');

sec('discount approval');
qS.lines = [mkLine(items[0], 10), mkLine(items[3], 5)]; qS.discMode = 'pct'; qS.discPct = 10; qS.status = 'sent';
r = await sales.c.post('/sync', { quotes: { put: [qS], del: [] } });
ok(r.j.quotes[qS.id]._approval.state === 'pending' && r.j.quotes[qS.id].status === 'draft' && r.j.warnings.length === 1, '10% discount -> pending; status forced back to draft');
qS._v = r.j.versions.quotes[qS.id]; qS.status = 'draft';
qS.discPct = 20; r = await sales.c.post('/sync', { quotes: { put: [qS], del: [] } }); ok(r.j.rejected[0]?.reason?.includes('15'), '20% exceeds the sales cap (15%)');
qS.discPct = 10; qS.contract = { date: today, party2: 'x', duration: 30, override: '', items: true, stamp: true, intro: 'i', terms: 't', paynote: 'p', close: 'c', payments: [{ id: 'p1', label: 'عند التعميد', pct: 50, due: today }, { id: 'p2', label: 'التسليم', pct: 50, due: '' }] };
r = await sales.c.post('/sync', { quotes: { put: [qS], del: [] } }); ok(r.j.warnings.some(w => w.text.includes('عقد')), 'contract blocked while approval pending');
r = await sales.c.post('/quotes/' + qS.id + '/share'); ok(r.s === 400, 'cannot share while pending');
r = await sales.c.post('/quotes/' + qS.id + '/approval', { action: 'approve' }); ok(r.s === 403, 'sales cannot approve');
r = await admin.get('/approvals'); ok(r.j.quotes.length === 1, 'admin sees 1 pending approval');
r = await admin.post('/quotes/' + qS.id + '/approval', { action: 'reject', note: 'الحد 5%' }); ok(r.j.quote._approval.state === 'rejected', 'admin rejects');
r = await sales.c.post('/quotes/' + qS.id + '/approval-request'); ok(r.j.quote._approval.state === 'pending', 're-request approval');
r = await admin.post('/quotes/' + qS.id + '/approval', { action: 'approve' }); ok(r.j.quote._approval.state === 'approved' && r.j.quote._approval.by, 'admin approves');
qS = (await sales.c.get('/bootstrap')).j.quotes[0]; qS.status = 'sent'; qS.contract = { date: today, party2: 'x', duration: 30, override: '', items: true, stamp: true, intro: 'i', terms: 't', paynote: 'p', close: 'c', payments: [{ id: 'p1', label: 'عند التعميد', pct: 50, due: today }, { id: 'p2', label: 'التسليم', pct: 50, due: '' }] };
r = await sales.c.post('/sync', { quotes: { put: [qS], del: [] } }); ok(r.j.quotes[qS.id].status === 'sent' && r.j.warnings.length === 0 && r.j.rejected.length === 0, 'after approval: sent + contract saved');
qS._v = r.j.versions.quotes[qS.id];
qS.discPct = 12; r = await sales.c.post('/sync', { quotes: { put: [qS], del: [] } }); ok(r.j.quotes[qS.id]._approval.state === 'pending', 'raising discount above approved level re-triggers approval'); qS._v = r.j.versions.quotes[qS.id]; qS.discPct = 10;
r = await sales.c.post('/sync', { quotes: { put: [qS], del: [] } }); ok(r.j.quotes[qS.id]._approval.state === 'pending', 'once invalidated, lowering back still needs a fresh approval'); qS._v = r.j.versions.quotes[qS.id];
r = await admin.post('/quotes/' + qS.id + '/approval', { action: 'approve' }); ok(r.j.quote._approval.state === 'approved', 'admin re-approves'); qS._v = r.j.quote._v;

sec('customer approval link');
r = await sales.c.post('/quotes/' + qS.id + '/share'); ok(r.s === 200 && r.j.quote._share.token, 'share link created');
const tok = r.j.quote._share.token;
r = await anon.get('/public/quote/' + tok); ok(r.s === 200 && r.j.quote.contract === null && !r.j.quote._owner && r.j.settings.nameAr, 'public view works w/o login and hides internals');
const v = r.j.v;
r = await anon.get('/public/quote/' + 'x'.repeat(30)); ok(r.s === 404, 'bad token -> 404');
r = await anon.post('/public/quote/' + tok, { action: 'approve', name: 'عميل', signature: 'data:image/png;base64,AAAA', v: v + 5 }); ok(r.s === 400 && r.j.code === 'stale', 'stale version rejected');
r = await anon.post('/public/quote/' + tok, { action: 'approve', name: 'ab', signature: 'x', v }); ok(r.s === 400, 'short name rejected');
r = await anon.post('/public/quote/' + tok, { action: 'approve', name: 'محمد العميل', signature: 'not-an-image', v }); ok(r.s === 400, 'missing signature rejected');
r = await anon.post('/public/quote/' + tok, { action: 'approve', name: 'محمد العميل', signature: 'data:image/png;base64,iVBORw0KGgo=', v }); ok(r.s === 200 && r.j.status === 'won', 'customer approves -> won');
r = await anon.post('/public/quote/' + tok, { action: 'reject', name: 'محمد العميل', v: v + 1 }); ok(r.s === 400 && r.j.code === 'decided', 'second decision refused');
qS = (await sales.c.get('/bootstrap')).j.quotes[0]; ok(qS.status === 'won' && qS._decision.name === 'محمد العميل', 'quote shows decision to owner');
qS.client = 'تعديل'; r = await sales.c.post('/sync', { quotes: { put: [qS], del: [] } }); ok(r.j.rejected.length === 0, 'sales may still edit contract on won quote (client edit ignored)');
const got = (await sales.c.get('/bootstrap')).j.quotes[0]; ok(got.client === 'عميل المبيعات', 'won quote is locked for non-contract fields');

sec('accountant + receipts');
const cons = qA; qA.contract = { date: today, party2: 'عميل', duration: 30, override: '', items: true, stamp: true, intro: 'i', terms: 't', paynote: 'p', close: 'c', payments: [{ id: 'pa1', label: 'دفعة 1', pct: 60, due: '' }, { id: 'pa2', label: 'دفعة 2', pct: 40, due: '' }] };
r = await admin.post('/sync', { quotes: { put: [qA], del: [] } }); qA._v = r.j.versions.quotes[qA.id]; ok(r.j.rejected.length === 0, 'admin adds contract');
let ab = (await acc.c.get('/bootstrap')).j; ok(ab.quotes.length === 2 && ab.receipts.length === 0, 'accountant sees all quotes');
const qa = ab.quotes.find(q => q.id === qA.id);
r = await acc.c.post('/sync', { quotes: { put: [{ ...qa, project: 'hack' }], del: [] } }); ok(r.j.rejected.length === 1, 'accountant cannot edit quote fields');
const dueEdit = JSON.parse(JSON.stringify(qa)); dueEdit.contract.payments[0].due = today;
r = await acc.c.post('/sync', { quotes: { put: [dueEdit], del: [] } }); ok(r.j.rejected.length === 0 && r.j.versions.quotes[qA.id], 'accountant may edit due dates'); qA._v = r.j.versions.quotes[qA.id];
const dd = JSON.parse(JSON.stringify(dueEdit)); dd._v = qA._v; dd.contract.payments[1].label = 'مخترق';
r = await acc.c.post('/sync', { quotes: { put: [dd], del: [] } }); ok(r.j.rejected.length === 1, 'accountant cannot change payment labels');
r = await admin.post('/sync', { customers: { put: [{ ...cust, _v: 1 }], del: [] } }).catch(() => ({ j: {} }));
const rc1 = await acc.c.post('/receipts', { date: today, custId: cust.id, qid: qA.id, payId: 'pa1', amount: 1000, method: 'نقدي', ref: '', notes: '' });
ok(rc1.s === 200 && rc1.j.receipt.no === 'RC-26-001', 'accountant creates receipt RC-26-001: ' + rc1.j.receipt?.no);
r = await acc.c.post('/receipts', { date: today, custId: cust.id, qid: qA.id, payId: 'nope', amount: 1, method: 'نقدي' }); ok(r.s === 400, 'invalid payment id rejected');
r = await acc.c.post('/receipts', { date: today, custId: cust.id, amount: -5, method: 'نقدي' }); ok(r.s === 400, 'negative amount rejected');
r = await sales.c.post('/receipts', { date: today, custId: cust.id, amount: 5, method: 'نقدي' }); ok(r.s === 403, 'sales cannot create receipts');
r = await view.c.post('/receipts', { date: today, custId: cust.id, amount: 5, method: 'نقدي' }); ok(r.s === 403, 'viewer cannot create receipts');
r = await view.c.get('/bootstrap'); ok(r.j.receipts.length === 1 && r.j.quotes.length === 2, 'viewer can read');
r = await view.c.post('/sync', { quotes: { put: [qA], del: [] } }); ok(r.j.rejected.length === 1, 'viewer cannot write');
const rc2 = await acc.c.post('/receipts', { date: today, custId: cust.id, qid: qA.id, payId: 'pa1', amount: 500.5, method: 'تحويل بنكي', ref: 'TR1', notes: '' }); ok(rc2.j.receipt.no === 'RC-26-002', 'second receipt numbered 002');
r = await acc.c.post('/sync', { quotes: { put: [], del: [qA.id] } }); ok(r.j.rejected.length === 1, 'cannot delete quote with receipts (and accountant has no rights)');
r = await admin.post('/sync', { quotes: { put: [], del: [qA.id] } }); ok(r.j.rejected.length === 1 && r.j.rejected[0].reason.includes('سندات'), 'admin cannot delete quote that has receipts');
r = await admin.post('/sync', { customers: { put: [], del: [cust.id] } }); ok(r.j.rejected.length === 1, 'cannot delete customer with data');

sec('receipts are immutable');
let dbErr = ''; try { await db.query("update receipts set amount = 1 where no = 'RC-26-001'"); } catch (e) { dbErr = e.message; } ok(dbErr.includes('immutable'), 'DB blocks amount update: ' + dbErr);
dbErr = ''; try { await db.query("delete from receipts where no = 'RC-26-001'"); } catch (e) { dbErr = e.message; } ok(dbErr.includes('cannot be deleted'), 'DB blocks delete');
r = await acc.c.post('/receipts/' + rc1.j.receipt.id + '/void', { reason: 'x' }); ok(r.s === 400, 'void needs a real reason');
r = await view.c.post('/receipts/' + rc1.j.receipt.id + '/void', { reason: 'سبب كافي' }); ok(r.s === 403, 'viewer cannot void');
r = await acc.c.post('/receipts/' + rc2.j.receipt.id + '/void', { reason: 'خطأ في المبلغ' }); ok(r.s === 200 && r.j.receipt.void === true, 'accountant voids with reason');
r = await acc.c.post('/receipts/' + rc2.j.receipt.id + '/void', { reason: 'مرة ثانية' }); ok(r.s === 400, 'cannot void twice');
dbErr = ''; try { await db.query("update receipts set void = false where no = 'RC-26-002'"); } catch (e) { dbErr = e.message; } ok(dbErr.includes('final'), 'DB blocks un-void');
const rcs = (await admin.get('/bootstrap')).j.receipts; ok(rcs.length === 2 && rcs.filter(x => x.void).length === 1, 'voided receipt stays on record');

sec('password reset by email + admin reset');
fs.writeFileSync(process.env.MAIL_OUTBOX, '');
r = await anon.post('/auth/forgot', { identifier: 'nobody' }); ok(r.s === 200 && r.j.message, 'unknown user -> generic answer');
ok(fs.readFileSync(process.env.MAIL_OUTBOX, 'utf8') === '', 'no mail for unknown user');
r = await anon.post('/auth/forgot', { identifier: 'sales2@example.com' }); ok(r.s === 200, 'forgot by email ok');
let mail = JSON.parse(fs.readFileSync(process.env.MAIL_OUTBOX, 'utf8').trim().split('\n').pop()); const tk = /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1]; ok(mail.to === 'sales2@example.com' && tk.length > 30, 'reset mail has token link');
const dbTok = await db.query('select token_hash from password_resets'); ok(!dbTok.rows.some(x => x.token_hash === tk), 'token stored hashed only');
r = await anon.get('/auth/reset-check?token=' + tk); ok(r.j.valid === true, 'token valid');
r = await anon.post('/auth/reset', { token: tk, password: 'abc' }); ok(r.s === 400, 'weak reset password rejected');
r = await anon.post('/auth/reset', { token: tk, password: 'NewPass#2026' }); ok(r.s === 200, 'reset with token');
r = await anon.post('/auth/reset', { token: tk, password: 'Another#2026' }); ok(r.s === 400, 'token is single-use');
r = await sales2.c.get('/bootstrap'); ok(r.s === 401, 'old session revoked after reset');
r = (await login('sales2', 'NewPass#2026')).x; ok(r.s === 200, 'login with new password');
await anon.post('/auth/forgot', { identifier: 'sales2' }); await anon.post('/auth/forgot', { identifier: 'sales2' }); await anon.post('/auth/forgot', { identifier: 'sales2' });
ok(fs.readFileSync(process.env.MAIL_OUTBOX, 'utf8').trim().split('\n').length <= 4, 'forgot rate-limited per user');
await db.query("update password_resets set expires_at = now() - interval '1 minute'"); r = await anon.get('/auth/reset-check?token=' + tk); ok(r.j.valid === false, 'expired/used tokens invalid');
const uid = (await admin.get('/users')).j.users.find(u => u.username === 'acc1').id;
const rst = await admin.post('/users/' + uid + '/reset-password'); ok(rst.j.tempPassword?.length >= 10, 'admin temp password');
r = await acc.c.get('/bootstrap'); ok(r.s === 401, 'sessions revoked on admin reset');
const acc2 = await login('acc1', rst.j.tempPassword); ok(acc2.x.j.must_change === true, 'temp password must be changed'); await acc2.c.post('/me/password', { current: rst.j.tempPassword, password: 'Acc#2026bb' });

r = await admin.put('/users/' + (await admin.get('/me')).j.id, { role: 'sales' }); ok(r.s === 400, 'admin cannot demote self');

sec('settings, counters, library');
let b = (await admin.get('/bootstrap')).j; const st = b.settings;
r = await admin.post('/sync', { settings: { ...st, discApprovalPct: 8, nextSeq: 999 } }); ok(r.j.versions.settings === st._v + 1, 'admin updates settings');
b = (await admin.get('/bootstrap')).j; ok(b.settings.discApprovalPct === 8 && b.settings.nextSeq === 3, 'counter not overwritten by stale client value');
r = await admin.put('/counters', { nextSeq: 100, rcNext: 50 }); ok(r.j.nextSeq === 100, 'counters set explicitly');
r = await sales.c.post('/sync', { settings: { ...st, nameAr: 'hack', _v: b.settings._v } }); ok(r.j.rejected[0]?.kind === 'settings', 'sales cannot edit settings');
r = await admin.post('/sync', { items: { put: [{ id: 'itemnew1', cat: 'قسم', desc: 'صنف جديد', brand: '', unit: 'NO', price: 12.5 }], del: [] } }); ok(r.j.versions.items.itemnew1 === 1, 'admin adds library item');
r = await acc2.c.post('/sync', { items: { put: [{ id: 'itemnew2', cat: 'x', desc: 'y', price: 1 }], del: [] } }); ok(r.j.rejected.length === 1, 'accountant cannot add library items');

sec('backup / import / reports / cron / audit');
r = await admin.post('/backups'); ok(r.s === 200 && r.j.backup.counts.receipts === 2, 'manual backup: ' + JSON.stringify(r.j.backup?.counts));
const bid = r.j.backup.id; const dl = await fetch(BASE + '/api/backups/' + bid, { headers: { Cookie: admin.cookie } }); const dump = await dl.json(); ok(dump.format === 'rass-backup' && dump.quotes.length === 2 && !JSON.stringify(dump).includes('password_hash'), 'backup download has no password hashes');
const legacy = { v: 2, settings: { ...dump.settings, nextSeq: 5 }, items: [{ id: 'leg1', cat: 'قسم قديم', desc: 'بند قديم', brand: '', unit: 'NO', price: 7 }], customers: [{ id: 'legc1', name: 'عميل قديم', phone: '055' }],
  quotes: [{ id: 'legq1', no: '25-100', date: '2025-01-01', client: 'عميل قديم', custId: 'legc1', project: 'p', location: 'l', validity: 30, status: 'won', preparedBy: 'x', lines: [{ id: 'a1', group: 'g', desc: 'd', brand: '', unit: 'NO', qty: 2, price: 10 }], discMode: 'amt', discPct: 0, discAmt: 0, vatRate: 15, notes: '', contract: { date: '2025-01-02', party2: 'عميل قديم', duration: 30, override: '', items: true, stamp: true, intro: '', terms: '', paynote: '', close: '', payments: [{ id: 'lp1', label: 'a', pct: 100, due: '' }] } }],
  receipts: [{ id: 'legr1', no: 'RC-25-001', date: '2025-01-05', custId: 'legc1', qid: 'legq1', payId: 'lp1', amount: 23, method: 'نقدي', ref: '', notes: '' }] };
r = await admin.post('/import', { data: legacy }); ok(r.s === 200 && r.j.result.quotes === 1 && r.j.result.receipts === 1, 'legacy import: ' + JSON.stringify(r.j.result));
r = await admin.post('/import', { data: legacy }); ok(r.j.result.quotesSkipped === 1 && r.j.result.receiptsSkipped === 1, 're-import is idempotent');
r = await admin.get('/reports/monthly?month=' + today.slice(0, 7)); ok(r.s === 200 && r.j.total === 1000 && r.j.count === 1 && r.j.voidedCount === 1, 'monthly report: total=' + r.j.total);
r = await view.c.get('/reports/monthly?month=' + today.slice(0, 7)); ok(r.s === 403, 'viewer cannot see reports');
r = await anon.get('/cron/backup'); ok(r.s === 403, 'cron needs secret');
r = await anon.call('GET', '/cron/backup', null, { Authorization: 'Bearer ' + process.env.CRON_SECRET }); ok(r.s === 200 && r.j.ok, 'cron backup runs');
r = await anon.call('GET', '/cron/monthly', null, { Authorization: 'Bearer ' + process.env.CRON_SECRET }); ok(r.s === 200 && r.j.sent >= 1, 'cron monthly emails admins: ' + JSON.stringify(r.j));
r = await admin.get('/audit?limit=300'); ok(r.s === 200 && r.j.entries.length > 30, 'audit has entries: ' + r.j.entries.length);
ok(['quote.create', 'receipt.create', 'receipt.void', 'auth.login_failed', 'quote.approval_granted', 'quote.customer_approved', 'user.reset_password'].every(a => r.j.entries.some(e => e.action === a)), 'audit covers key actions');
dbErr = ''; try { await db.query("delete from audit_log where id = (select min(id) from audit_log)"); } catch (e) { dbErr = e.message; } ok(dbErr.includes('append-only'), 'audit log is append-only');

sec('logout');
r = await admin.post('/auth/logout'); r = await admin.get('/bootstrap'); ok(r.s === 401, 'logout clears session');

console.log(`\n${pass} passed, ${failn} failed`);
await db.end(); process.exit(failn ? 1 : 0);
