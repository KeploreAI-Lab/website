/**
 * Keplore contact form Worker
 *
 * Receives POST from the site's contact modal, validates, and posts a
 * formatted message to a Slack channel via Incoming Webhook.
 *
 * Env vars required (set via `wrangler secret put`):
 *   SLACK_WEBHOOK_URL  — Slack Incoming Webhook URL for the target channel
 *
 * Optional:
 *   ALLOWED_ORIGINS    — comma-separated list (defaults to keploreai.com + dev)
 */

const DEFAULT_ALLOWED = [
  'https://keploreai.com',
  'https://www.keploreai.com',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const allowlist = allowed.length ? allowed : DEFAULT_ALLOWED;
    const originOK = allowlist.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOK ? origin : allowlist[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405, cors);
    if (!originOK)                     return json({ error: 'origin_not_allowed' }, 403, cors);

    let data;
    try { data = await request.json(); }
    catch { return json({ error: 'bad_json' }, 400, cors); }

    /* Honeypot — silent accept if bot filled hidden field */
    if (data._hp) return json({ ok: true }, 200, cors);

    const name        = str(data.name, 120);
    const email       = str(data.email, 200);
    const company     = str(data.company, 200);
    const lookingFor  = str(data.lookingFor, 80);
    const role        = str(data.role, 80);
    const message     = str(data.message, 4000);

    if (!name || !email || !isEmail(email) || !lookingFor){
      return json({ error: 'missing_fields' }, 400, cors);
    }

    if (!env.SLACK_WEBHOOK_URL){
      console.error('missing_slack_webhook');
      return json({ error: 'server_misconfigured' }, 500, cors);
    }

    const headline = `:inbox_tray: *New contact* — ${lookingFor}`;
    const fallback = `New contact: ${name} (${email}) — ${lookingFor}`;

    const fields = [
      { type: 'mrkdwn', text: `*Name:*\n${escMd(name)}` },
      { type: 'mrkdwn', text: `*Email:*\n<mailto:${escMd(email)}|${escMd(email)}>` },
      { type: 'mrkdwn', text: `*Company:*\n${escMd(company || '—')}` },
      { type: 'mrkdwn', text: `*Role:*\n${escMd(role || '—')}` },
      { type: 'mrkdwn', text: `*Looking for:*\n${escMd(lookingFor)}` },
    ];

    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: headline } },
      { type: 'section', fields },
    ];
    if (message){
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Message:*\n${escMd(message)}` },
      });
    }

    const res = await fetch(env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: fallback, blocks }),
    });

    if (!res.ok){
      const detail = await res.text().catch(() => '');
      console.error('slack_fail', res.status, detail);
      return json({ error: 'send_failed' }, 502, cors);
    }
    return json({ ok: true }, 200, cors);
  },
};

function str(v, max){
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}
function isEmail(s){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function json(body, status, headers){
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}
/* Escape Slack mrkdwn control chars so user input can't break layout */
function escMd(s){
  return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);
}
