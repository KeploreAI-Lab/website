/**
 * Keplore contact form — self-injecting modal.
 *
 * How it works:
 *   1. On DOMContentLoaded, injects a hidden modal + styles into the page.
 *   2. Intercepts clicks on any element matching TRIGGER_SELECTOR and opens the modal.
 *      The trigger's existing href/mailto is overridden.
 *   3. On submit, POSTs JSON to CONFIG.endpoint (Cloudflare Worker) → Slack webhook.
 *
 * To use on a page, just add before </body>:
 *   <script src="contact-form.js" defer></script>
 *
 * To point at a different Worker, edit CONFIG.endpoint below.
 */

(function(){
  'use strict';

  const CONFIG = {
    /* Cloudflare Worker endpoint — replace with your deployed worker URL */
    endpoint: 'https://keplore-contact.marvin-gao-cs.workers.dev',
  };

  /* Any link whose text mentions "talk to" or whose href is a mailto:
     will be intercepted. Also picks up explicit data-contact triggers. */
  const TRIGGER_SELECTOR = [
    '[data-contact]',
    'a[href^="mailto:hello@keplore"]',
    'a[href^="mailto:support@keplore"]',
    'a[href="#contact"]',
  ].join(',');

  const OPTIONS_LOOKING_FOR = [
    'Industrial AI Solutions',
    'Self-Service Agent',
    'Partnership',
    'General Question',
  ];
  const OPTIONS_ROLE = [
    'Integrator',
    'OEM',
    'Manufacturer',
    'Engineer',
    'Other',
  ];

  /* ─────────────  CSS  ───────────── */
  const CSS = `
.kc-backdrop{position:fixed;inset:0;background:rgba(12,12,10,.48);backdrop-filter:blur(6px);z-index:9998;opacity:0;pointer-events:none;transition:opacity .22s ease;}
.kc-backdrop.open{opacity:1;pointer-events:auto;}
.kc-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:60px 20px;overflow:auto;opacity:0;pointer-events:none;transition:opacity .22s ease;}
.kc-modal.open{opacity:1;pointer-events:auto;}
.kc-dialog{background:#fff;border-radius:18px;box-shadow:0 40px 90px -20px rgba(0,0,0,.25),0 0 0 1px rgba(0,0,0,.04);max-width:560px;width:100%;padding:40px 44px 36px;position:relative;transform:translateY(16px);transition:transform .28s cubic-bezier(.2,.8,.2,1);font-family:'DM Sans',sans-serif;color:#111110;}
.kc-modal.open .kc-dialog{transform:translateY(0);}
.kc-close{position:absolute;top:18px;right:18px;width:30px;height:30px;border:none;background:none;cursor:pointer;color:#6b6b64;font-size:22px;line-height:1;border-radius:6px;transition:color .15s,background .15s;}
.kc-close:hover{color:#111;background:#f2f1ed;}
.kc-eyebrow{font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#1a6b5a;display:inline-flex;align-items:center;gap:8px;margin-bottom:16px;}
.kc-eyebrow::before{content:'';width:16px;height:1px;background:#1a6b5a;}
.kc-title{font-family:'Instrument Serif',Georgia,serif;font-size:34px;line-height:1.1;letter-spacing:-.02em;margin:0 0 10px;color:#111110;font-weight:400;}
.kc-title em{font-style:italic;color:#1a6b5a;}
.kc-sub{font-size:14.5px;color:#6b6b64;line-height:1.6;margin:0 0 26px;}
.kc-form{display:flex;flex-direction:column;gap:18px;}
.kc-field{display:flex;flex-direction:column;gap:7px;}
.kc-field-label{font-family:'DM Mono',monospace;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#2c2c28;}
.kc-field-label .kc-req{color:#b85c38;margin-left:4px;}
.kc-chips{display:flex;flex-wrap:wrap;gap:7px;}
.kc-chip{display:inline-flex;align-items:center;padding:8px 14px;border:1px solid #d2d1ca;border-radius:999px;font-family:inherit;font-size:13px;color:#2c2c28;cursor:pointer;background:#fff;transition:all .12s;user-select:none;line-height:1.2;}
.kc-chip:hover{border-color:#6b6b64;color:#111;}
.kc-chip.on{background:#1a6b5a;border-color:#1a6b5a;color:#fff;}
.kc-chip input{position:absolute;opacity:0;pointer-events:none;}
.kc-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.kc-input,.kc-textarea{font-family:inherit;font-size:14.5px;color:#111110;background:#fff;border:1px solid #d2d1ca;border-radius:8px;padding:11px 13px;width:100%;transition:border-color .12s,box-shadow .12s;}
.kc-input:focus,.kc-textarea:focus{outline:none;border-color:#1a6b5a;box-shadow:0 0 0 3px rgba(26,107,90,.12);}
.kc-textarea{resize:vertical;min-height:90px;}
.kc-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0;}
.kc-submit{background:#1a6b5a;color:#fff;border:none;padding:13px 24px;border-radius:8px;font-family:inherit;font-size:14.5px;font-weight:500;cursor:pointer;align-self:flex-start;transition:background .15s,transform .12s,box-shadow .15s;display:inline-flex;align-items:center;gap:8px;}
.kc-submit:hover:not(:disabled){background:#14573f;transform:translateY(-1px);box-shadow:0 6px 22px rgba(26,107,90,.22);}
.kc-submit:disabled{opacity:.6;cursor:wait;}
.kc-submit .kc-spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:kcSpin .7s linear infinite;display:none;}
.kc-submit.loading .kc-spinner{display:inline-block;}
.kc-submit.loading .kc-arrow{display:none;}
@keyframes kcSpin{to{transform:rotate(360deg);}}
.kc-foot{font-size:12.5px;color:#9b9b93;margin-top:4px;}
.kc-status{display:none;padding:14px 16px;border-radius:8px;font-size:14px;line-height:1.5;margin-top:6px;}
.kc-status.ok{display:block;background:#e8f3f0;color:#14573f;border:1px solid #c8e8e0;}
.kc-status.err{display:block;background:#fbeee9;color:#8a3a20;border:1px solid #e8c5b5;}
@media (max-width:600px){
  .kc-dialog{padding:30px 24px 28px;border-radius:14px;}
  .kc-title{font-size:28px;}
  .kc-row{grid-template-columns:1fr;}
  .kc-modal{padding:20px 12px;}
}
`;

  /* ─────────────  DOM  ───────────── */
  function buildChipGroup(name, values){
    return `<div class="kc-chips" data-group="${name}">` +
      values.map(v => `<button type="button" class="kc-chip" data-value="${escapeAttr(v)}">${escapeHtml(v)}</button>`).join('') +
      `</div>`;
  }

  function injectModal(){
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const host = document.createElement('div');
    host.innerHTML = `
<div class="kc-backdrop" id="kcBackdrop"></div>
<div class="kc-modal" id="kcModal" role="dialog" aria-modal="true" aria-labelledby="kcTitle">
  <div class="kc-dialog">
    <button class="kc-close" id="kcClose" aria-label="Close">×</button>
    <div class="kc-eyebrow">Let's Talk</div>
    <h2 class="kc-title" id="kcTitle">Tell us what you're <em>building</em>.</h2>
    <p class="kc-sub">Takes 30 seconds. A real engineer replies within one business day.</p>
    <form class="kc-form" id="kcForm" novalidate>
      <div class="kc-field">
        <span class="kc-field-label">I'm looking for<span class="kc-req">*</span></span>
        ${buildChipGroup('lookingFor', OPTIONS_LOOKING_FOR)}
      </div>
      <div class="kc-field">
        <span class="kc-field-label">My role</span>
        ${buildChipGroup('role', OPTIONS_ROLE)}
      </div>
      <label class="kc-field">
        <span class="kc-field-label">What are you building?</span>
        <textarea class="kc-textarea" name="message" rows="3" placeholder="Brief description of the problem — we'll reply with concrete questions."></textarea>
      </label>
      <div class="kc-row">
        <label class="kc-field">
          <span class="kc-field-label">Name<span class="kc-req">*</span></span>
          <input class="kc-input" type="text" name="name" required autocomplete="name">
        </label>
        <label class="kc-field">
          <span class="kc-field-label">Email<span class="kc-req">*</span></span>
          <input class="kc-input" type="email" name="email" required autocomplete="email">
        </label>
      </div>
      <label class="kc-field">
        <span class="kc-field-label">Company <span style="color:#9b9b93">(optional)</span></span>
        <input class="kc-input" type="text" name="company" autocomplete="organization">
      </label>
      <input class="kc-hp" type="text" name="_hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button type="submit" class="kc-submit" id="kcSubmit">
        <span class="kc-arrow">Send inquiry →</span>
        <span class="kc-spinner"></span>
      </button>
      <div class="kc-foot">No commitment. We reply within one business day. support@keploreai.com</div>
      <div class="kc-status" id="kcStatus"></div>
    </form>
  </div>
</div>`;
    document.body.appendChild(host);

    /* Chip behavior — click toggles single-select state via data attrs */
    host.querySelectorAll('.kc-chips').forEach(group => {
      const required = group.getAttribute('data-group') === 'lookingFor';
      group.addEventListener('click', e => {
        const chip = e.target.closest('.kc-chip');
        if (!chip || !group.contains(chip)) return;
        const wasOn = chip.classList.contains('on');
        group.querySelectorAll('.kc-chip').forEach(c => c.classList.remove('on'));
        /* Required group: can't toggle off — always stays selected. Optional: toggle off. */
        if (!(wasOn && !required)) chip.classList.add('on');
      });
    });

    /* Close handlers */
    host.querySelector('#kcClose').addEventListener('click', close);
    host.querySelector('#kcBackdrop').addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('kcModal').classList.contains('open')) close();
    });

    /* Submit */
    host.querySelector('#kcForm').addEventListener('submit', onSubmit);
  }

  function open(){
    document.getElementById('kcBackdrop').classList.add('open');
    document.getElementById('kcModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    const firstInput = document.querySelector('#kcForm .kc-chip input');
    setTimeout(() => { firstInput && firstInput.closest('.kc-chip').focus(); }, 50);
  }

  function close(){
    document.getElementById('kcBackdrop').classList.remove('open');
    document.getElementById('kcModal').classList.remove('open');
    document.body.style.overflow = '';
  }

  async function onSubmit(e){
    e.preventDefault();
    const form = e.currentTarget;
    const btn = document.getElementById('kcSubmit');
    const status = document.getElementById('kcStatus');

    const fd = new FormData(form);
    const chipValue = name => {
      const sel = form.querySelector(`.kc-chips[data-group="${name}"] .kc-chip.on`);
      return sel ? sel.getAttribute('data-value') : '';
    };
    const data = {
      lookingFor: chipValue('lookingFor'),
      role:       chipValue('role'),
      message:    (fd.get('message') || '').trim(),
      name:       (fd.get('name') || '').trim(),
      email:      (fd.get('email') || '').trim(),
      company:    (fd.get('company') || '').trim(),
      _hp:        (fd.get('_hp') || '').trim(),
    };

    status.className = 'kc-status';
    status.textContent = '';

    if (!data.lookingFor){ showErr('Please pick what you’re looking for.'); return; }
    if (!data.name)      { showErr('Please enter your name.'); return; }
    if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)){
      showErr('Please enter a valid email.'); return;
    }

    btn.disabled = true;
    btn.classList.add('loading');

    try {
      const res = await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('http_' + res.status);
      const body = await res.json().catch(() => ({}));
      if (!body.ok) throw new Error('server_not_ok');

      /* Success: show message + close after a beat */
      status.className = 'kc-status ok';
      status.textContent = 'Thanks — we got it. A real engineer will reply within one business day.';
      form.reset();
      form.querySelectorAll('.kc-chip.on').forEach(c => c.classList.remove('on'));
      setTimeout(close, 2800);
    } catch (err){
      console.error('contact send failed', err);
      showErr('Something went wrong. Please email support@keploreai.com directly.');
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }

    function showErr(msg){ status.className = 'kc-status err'; status.textContent = msg; }
  }

  /* ─────────────  Attach triggers  ───────────── */
  function attachTriggers(){
    document.querySelectorAll(TRIGGER_SELECTOR).forEach(el => {
      if (el.__kcBound) return;
      el.__kcBound = true;
      el.addEventListener('click', e => {
        e.preventDefault();
        open();
      });
    });
  }

  /* ─────────────  Helpers  ───────────── */
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }
  function escapeAttr(s){ return escapeHtml(s); }

  /* ─────────────  Boot  ───────────── */
  function boot(){
    injectModal();
    attachTriggers();
    /* Re-attach in case new triggers are added dynamically */
    new MutationObserver(attachTriggers).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
