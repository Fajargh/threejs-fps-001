// hud.js — DOM heads-up display for RUSTLINE.
// Every lookup is guarded: a missing element is skipped, never thrown.

const WEAPON_PRICES = {
  vk47: 2500,
  hornet: 1500,
  longbow: 3000,
  mauler: 1200,
  grenade: 300,
  kevlar: 650,
};

function el(id) {
  return document.getElementById(id);
}

export class Hud {
  constructor() {
    this._centerTimer = 0;
    this._hitTimer = 0;
    this._flashTimer = 0;
  }

  setHealth(hp, armor) {
    const h = el('hud-health');
    if (h) h.textContent = String(Math.max(0, Math.ceil(hp)));
    const a = el('hud-armor');
    if (a) a.textContent = String(Math.max(0, Math.ceil(armor || 0)));
    if (h) h.classList.toggle('low', hp <= 30);
  }

  setAmmo(mag, reserve, name) {
    const a = el('hud-ammo');
    if (a) a.textContent = `${mag} / ${reserve}`;
    const w = el('hud-weapon');
    if (w) w.textContent = name || '';
  }

  setTimer(seconds, phase) {
    const t = el('hud-timer');
    if (!t) return;
    const s = Math.max(0, Math.ceil(seconds));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    const label = phase === 'freeze' ? 'FREEZE' : phase === 'live' ? 'LIVE' : 'END';
    t.textContent = `${mm}:${ss} ${label}`;
    t.classList.toggle('urgent', phase === 'live' && s <= 15);
  }

  setScore(e, s) {
    const sc = el('hud-score');
    if (sc) sc.textContent = `${e} : ${s}`;
  }

  setMoney(m) {
    const elMoney = el('hud-money');
    if (elMoney) elMoney.textContent = `$${Math.floor(m).toLocaleString('en-US')}`;
  }

  setRound(n) {
    const r = el('hud-round');
    if (r) r.textContent = `ROUND ${n}`;
  }

  feed(text, cls = '') {
    const kf = el('killfeed');
    if (!kf) return;
    const div = document.createElement('div');
    div.className = `feed-line ${cls}`.trim();
    div.textContent = text;
    kf.prepend(div);
    while (kf.children.length > 6) kf.removeChild(kf.lastChild);
  }

  center(text, sub = '') {
    const m = el('center-msg');
    const s = el('center-sub');
    if (m) {
      m.textContent = text;
      m.style.display = 'block';
    }
    if (s) {
      s.textContent = sub;
      s.style.display = sub ? 'block' : 'none';
    }
    window.clearTimeout(this._centerTimer);
    this._centerTimer = window.setTimeout(() => {
      if (m) m.style.display = 'none';
      if (s) s.style.display = 'none';
    }, 2500);
  }

  showBuy(show, money, loadout) {
    const menu = el('buy-menu');
    if (menu) menu.style.display = show ? 'block' : 'none';
    if (!show) return;
    const owned = new Set();
    if (loadout) {
      for (const id of Object.keys(loadout.mag || {})) {
        if ((loadout.mag[id] ?? 0) > 0 || (loadout.reserve[id] ?? 0) > 0) owned.add(id);
      }
      if (loadout.current) owned.add(loadout.current);
    }
    document.querySelectorAll('[data-buy]').forEach((btn) => {
      const id = btn.getAttribute('data-buy');
      const price = Number(btn.getAttribute('data-price') || WEAPON_PRICES[id] || 0);
      const isOwned = owned.has(id);
      const isKevlar = id === 'kevlar';
      const isGrenade = id === 'grenade';
      const canAfford = money >= price;
      const disabled =
        (!isGrenade && !isKevlar && isOwned) ||
        (isKevlar && loadout && loadout.kevlar) ||
        !canAfford;
      btn.disabled = disabled;
      btn.classList.toggle('owned', isOwned || (isKevlar && !!(loadout && loadout.kevlar)));
      const base = btn.getAttribute('data-label') || btn.textContent.replace(/\s*—.*$/, '');
      if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', base);
      const tag = isOwned || (isKevlar && loadout && loadout.kevlar) ? 'OWNED' : `$${price.toLocaleString('en-US')}`;
      btn.textContent = `${base} — ${tag}`;
    });
  }

  crosshairSpread(px) {
    const c = el('crosshair');
    if (c) c.style.setProperty('--gap', `${Math.max(2, px)}px`);
  }

  hitmarker(head, kill) {
    const h = el('hitmarker');
    if (!h) return;
    h.classList.remove('head', 'kill');
    if (head) h.classList.add('head');
    if (kill) h.classList.add('kill');
    h.classList.add('show');
    window.clearTimeout(this._hitTimer);
    this._hitTimer = window.setTimeout(() => h.classList.remove('show'), 120);
  }

  scope(on) {
    const s = el('scope-overlay');
    if (s) s.style.display = on ? 'block' : 'none';
    const c = el('crosshair');
    if (c) c.style.display = on ? 'none' : 'block';
  }

  endScreen(winner, reason, score) {
    const scr = el('end-screen');
    const title = el('end-title');
    const sub = el('end-sub');
    if (title) {
      if (winner === 'draw') title.textContent = 'MATCH DRAW';
      else if (reason && reason.indexOf('Match') === 0) {
        title.textContent = winner === 'ember' ? 'MATCH — EMBER WINS' : 'MATCH — SLATE WINS';
      } else {
        title.textContent = winner === 'ember' ? 'EMBER WINS THE ROUND' : 'SLATE WINS THE ROUND';
      }
      title.className = winner === 'ember' ? 'ember' : winner === 'slate' ? 'slate' : 'draw';
    }
    if (sub) {
      const sc = score ? `  —  ${score.ember} : ${score.slate}` : '';
      sub.textContent = `${reason || ''}${sc}`;
    }
    if (scr) scr.style.display = 'flex';
  }

  hideEnd() {
    const scr = el('end-screen');
    if (scr) scr.style.display = 'none';
  }

  damageFlash() {
    const f = el('damage-flash');
    if (!f) return;
    f.classList.add('show');
    window.clearTimeout(this._flashTimer);
    this._flashTimer = window.setTimeout(() => f.classList.remove('show'), 150);
  }

  help(show) {
    const h = el('help-overlay');
    if (h) h.style.display = show ? 'block' : 'none';
  }
}
