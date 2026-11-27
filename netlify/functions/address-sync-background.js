/**
 * address-sync-background.js — Netlify background function (up to 15 minutes)
 *
 * Members' home addresses, from TeamUp onto their GHL contact. Ash, 27 Nov 2026: the welcome card
 * and the 1-year anniversary card need an address and GHL had none (the Ontraport import brought
 * none, and Ontraport only had a street for 25 of 147). TeamUp's own "Address" customer field
 * has one for almost everybody, so this copies it across.
 *
 *   WHO   everyone on the tracker's TeamUp member list (row 'attendance-teamup': GHL `member`
 *         contacts matched to their TeamUp customer).
 *   WHAT  only fills a GHL contact that has NO street address yet. An address someone typed into
 *         GHL is never overwritten. GHL gets address1 (TeamUp line 1, plus line 2), city, state
 *         (county), postalCode and country.
 *   DONE  ids already filled, or already holding an address, are remembered in row
 *         'address-sync' {done:{ghlId:'filled'|'had'|'none'}} so the daily run only looks at new
 *         people. 'none' (TeamUp has no address either) is tried again after 30 days.
 *
 * Started by address-sync-daily.js every morning (netlify.toml), or by hand:
 *   POST with header x-webhook-secret        body {"only":"<ghl id>"} for one, {"dry":true} to look only
 *
 * ENV: TEAMUP_TOKEN, GHL_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY, WEBHOOK_SECRET
 */
const TU = 'https://goteamup.com/api/v2';
const TU_PROVIDER = process.env.TEAMUP_PROVIDER_ID || '1653275';
const GHL = 'https://services.leadconnectorhq.com';
const ROW = 'address-sync';
const RETRY_NONE_DAYS = 30;
const env = (k) => String(process.env[k] || '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, opts) {
  const res = await fetch(url, opts); const text = await res.text();
  if (!res.ok) { const e = new Error(`${url.split('?')[0]} ${res.status}: ${text.slice(0, 200)}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : {};
}
async function readRow(key) {
  const k = env('SUPABASE_SERVICE_KEY');
  const rows = await json(`${env('SUPABASE_URL')}/rest/v1/bodysculpt?key=eq.${key}&select=value`, { headers: { apikey: k, Authorization: 'Bearer ' + k } });
  return rows[0] && rows[0].value;
}
async function writeRow(key, value) {
  const k = env('SUPABASE_SERVICE_KEY');
  await json(`${env('SUPABASE_URL')}/rest/v1/bodysculpt`, { method: 'POST',
    headers: { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
}
let tuPrefix = 'Bearer';
async function tu(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(260);
    try {
      return await json(`${TU}/${path}`, { headers: { Accept: 'application/json', Authorization: `${tuPrefix} ${env('TEAMUP_TOKEN')}`,
        'Teamup-Provider-ID': TU_PROVIDER, 'Teamup-Request-Mode': 'provider' } });
    } catch (e) {
      if (e.status === 401 && tuPrefix === 'Bearer') { tuPrefix = 'Token'; continue; }
      if (e.status === 429 || e.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      throw e;
    }
  }
  throw new Error('TeamUp kept refusing: ' + path.split('?')[0]);
}
const ghlHeaders = () => ({ Authorization: 'Bearer ' + env('GHL_TOKEN'), Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' });

/* ---------- pure ---------- */
/* TeamUp's address field value -> GHL contact fields, or null if there is no street. */
function toGhl(v) {
  if (!v || typeof v !== 'object') return null;
  const t = (x) => String(x == null ? '' : x).trim();
  const line1 = t(v.address_line1), line2 = t(v.address_line2);
  if (!line1) return null;
  const country = t(v.country);
  const gb = !country || /^(gb|uk|united kingdom|great britain|england|wales|scotland|northern ireland)$/i.test(country);
  const out = { address1: [line1, line2].filter(Boolean).join(', '), city: t(v.city), state: t(v.region), postalCode: t(v.postcode).toUpperCase(), country: gb ? 'GB' : country };
  Object.keys(out).forEach((k) => { if (!out[k]) delete out[k]; });
  return out;
}
const hasStreet = (c) => !!String((c && c.address1) || '').trim();
/* Who to look at this run. Pure. */
function toCheck(members, done, now = Date.now()) {
  return (members || []).filter((m) => m && m.id && m.tid).filter((m) => {
    const d = done[m.id];
    if (!d) return true;
    if (d.state === 'none') return now - Date.parse(d.at || 0) > RETRY_NONE_DAYS * 86400000;
    return false;
  });
}

async function teamupAddress(tid, fieldId) {
  const c = await tu(`customers/${tid}?expand=field_values`);
  const fv = (c.field_values || []).find((x) => x && (x.field === fieldId || (x.field && x.field.id === fieldId)));
  return fv ? fv.value : null;
}
async function addressFieldId() {
  const f = await tu('customer_fields?page_size=100');
  const a = (f.results || []).find((x) => x && x.type === 'address') || (f.results || []).find((x) => /^address$/i.test(String(x.label || '').trim()));
  if (!a) throw new Error('TeamUp has no Address customer field');
  return a.id;
}

async function run({ only = null, dry = false, now = Date.now() } = {}) {
  const att = await readRow('attendance-teamup');
  const state = (await readRow(ROW)) || { done: {} };
  const done = state.done || {};
  let list = toCheck(att && att.members, only ? {} : done, now);
  if (only) list = list.filter((m) => m.id === only);
  const fieldId = await addressFieldId();
  const out = { checked: list.length, filled: [], had: 0, none: [], errors: [] };
  for (const m of list) {
    try {
      const c = (await json(`${GHL}/contacts/${m.id}`, { headers: ghlHeaders() })).contact || {};
      if (hasStreet(c)) { out.had++; done[m.id] = { state: 'had', at: new Date(now).toISOString() }; continue; }
      const a = toGhl(await teamupAddress(m.tid, fieldId));
      if (!a) { out.none.push(m.name); done[m.id] = { state: 'none', at: new Date(now).toISOString() }; continue; }
      if (!dry) await json(`${GHL}/contacts/${m.id}`, { method: 'PUT', headers: ghlHeaders(), body: JSON.stringify(a) });
      out.filled.push(m.name);
      if (!dry) done[m.id] = { state: 'filled', at: new Date(now).toISOString() };
    } catch (e) { out.errors.push(m.name + ': ' + e.message.slice(0, 160)); }
  }
  if (!dry) await writeRow(ROW, { done, last: { at: new Date(now).toISOString(), checked: out.checked, filled: out.filled.length, had: out.had, none: out.none, errors: out.errors } });
  console.log('ADDRESS-SYNC: ' + JSON.stringify({ ...out, filled: out.filled.length }));
  return out;
}

exports.handler = async (event) => {
  const h = event.headers || {};
  if (!env('WEBHOOK_SECRET') || h['x-webhook-secret'] !== env('WEBHOOK_SECRET')) return { statusCode: 401, body: 'Unauthorized' };
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (e) { /* empty */ }
  try { await run({ only: body.only || null, dry: !!body.dry }); } catch (e) { console.error('ADDRESS-SYNC failed: ' + e.message); }
  return { statusCode: 202 };
};
exports.run = run;
exports._test = { toGhl, hasStreet, toCheck };
