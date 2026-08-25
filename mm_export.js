/* Mattermost DOM-Exporter v3 – Console-Snippet
 * Einfügen, nach oben scrollen, "JSONL" klicken.
 * Angepasst an MM mit .Reaction__number--display, postReaction-<id>-<emoji>,
 * aria-label "At H:MM AM Weekday, Month D, Name wrote/replied, ..."
 */
(() => {
'use strict';
const NS = 'MM_EXPORT3';
if (window[NS]?.running) { console.warn('[mm-export] läuft bereits – erst Stop klicken oder Seite neu laden.'); return; }
const S = window[NS] = { running: true, recs: new Map(), seq: 0, timer: null, obs: null, pending: null };

const SEL = {
  post:     '[id^="post_"], [id^="rhsPost_"]',
  body:     '[data-testid="postMessageText"], .post-message__text, .post-message__text-container',
  author:   '[data-testid="postProfileUsername"], .post__header .col__name button.user-popover, button.user-popover',
  reaction: '.post-reaction-list .Reaction, .Reaction',
  edited:   '.post-edited__indicator, .post-edited-indicator, [class*="post-edited"]',
  rootLink: '.post__link, [data-testid="postCommentedOn"]',
  file:     '.post-image__name, [data-testid="fileAttachment"], .file-preview__name',
  dateSep:  '[data-testid="basicSeparator"], .date-separator, .DateSeparator, [class*="date-separator"]',
  rhsScope: '#sidebar-right, #rhsContainer, .sidebar--right'
};

const MONTHS = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11,
                januar:0,februar:1,"märz":2,mai:4,juni:5,juli:6,oktober:9,dezember:11};

/* ---------------- Text inkl. Emoji-Shortcodes ---------------- */
const norm = s => String(s || '').replace(/\r/g,'').replace(/\u00A0/g,' ')
  .replace(/[ \t]+$/gm,'').replace(/\n{3,}/g,'\n\n').trim();

function emojiOf(el) {
  const de = el.getAttribute('data-emoticon');
  if (de) return ':' + de + ':';
  const alt = el.getAttribute('aria-label') || el.getAttribute('alt');
  if (alt && /^:.+:$/.test(alt.trim())) return alt.trim();
  return null;
}

function serialize(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.nodeValue; continue; }
    if (n.nodeType !== 1) continue;
    const emo = emojiOf(n);
    if (emo) { out += emo; continue; }
    const tag = n.tagName;
    if (tag === 'BR')  { out += '\n'; continue; }
    if (tag === 'IMG') { out += n.getAttribute('alt') || ''; continue; }
    if (tag === 'PRE') { out += '\n```\n' + (n.innerText||'').replace(/\n+$/,'') + '\n```\n'; continue; }
    if (tag === 'CODE'){ out += '`' + serialize(n) + '`'; continue; }
    if (tag === 'A') {
      const txt = serialize(n).trim(), href = n.getAttribute('href') || '';
      out += (href && txt && href !== txt && !href.startsWith('#')) ? `[${txt}](${href})` : (txt || href);
      continue;
    }
    const inner = serialize(n);
    if (tag === 'LI') { out += '- ' + inner.trim() + '\n'; continue; }
    if (/^(P|DIV|UL|OL|BLOCKQUOTE|H[1-6]|TABLE|TR)$/.test(tag)) { out += inner + (inner.endsWith('\n')?'':'\n'); continue; }
    out += inner;
  }
  return out;
}

/* ---------------- aria-label des Post-Roots auswerten ---------------- */
function parseAria(label) {
  const o = { h:null, min:null, month:null, day:null, author:'', kind:'' };
  if (!label) return o;
  const t = label.match(/At\s+(\d{1,2})[:.](\d{2})\s*(AM|PM)?/i);
  if (t) {
    let h = +t[1];
    if (t[3]) { const pm = /pm/i.test(t[3]); if (h === 12) h = 0; if (pm) h += 12; }
    o.h = h; o.min = +t[2];
  }
  const d = label.match(/([A-Za-zÄÖÜäöü]+)\s+(\d{1,2})(?:st|nd|rd|th|\.)?,/);
  if (d && MONTHS[d[1].toLowerCase()] !== undefined) { o.month = MONTHS[d[1].toLowerCase()]; o.day = +d[2]; }
  const a = label.match(/,\s*([^,]+?)\s+(wrote|replied|said|schrieb|antwortete)\s*,/i);
  if (a) { o.author = a[1].trim(); o.kind = a[2].toLowerCase(); }
  return o;
}

/* ---------------- einen Post auslesen ---------------- */
function read(el, dateSep, prevId) {
  const rawId = el.id || '';
  const id = rawId.replace(/^(rhsPost_|post_)/, '');
  if (!id) return null;
  const pane = (rawId.startsWith('rhsPost_') || el.closest(SEL.rhsScope)) ? 'rhs' : 'center';
  const cls = String(el.className || '');
  const aria = parseAria(el.getAttribute('aria-label') || '');

  const bodyEl = el.querySelector(SEL.body);
  let text = '';
  if (bodyEl) {
    // "Edited"-Indikator steckt im Message-Container -> raus, das Flag reicht
    const clone = bodyEl.cloneNode(true);
    clone.querySelectorAll(SEL.edited).forEach(n => n.remove());
    text = norm(serialize(clone));
  }

  const files = [...el.querySelectorAll(SEL.file)]
    .map(f => (f.textContent || f.getAttribute('aria-label') || '').trim()).filter(Boolean);

  // Reaktionen: Name aus der Button-ID, Zahl nur aus --display
  const reactions = {};
  for (const r of el.querySelectorAll(SEL.reaction)) {
    const rid = r.id || '';
    if (!rid.startsWith('postReaction-') || r.classList.contains('Reaction__add')) continue;
    const m = rid.match(/^postReaction-[a-z0-9]{20,30}-(.+)$/i);
    if (!m) continue;
    const disp = r.querySelector('.Reaction__number--display, [class*="number--display"]');
    const cnt = parseInt((disp?.textContent || '').replace(/\D/g, ''), 10);
    reactions[m[1]] = Number.isFinite(cnt) ? cnt : 1;
  }

  if (!text && !files.length && !Object.keys(reactions).length) return null;

  const dt = el.querySelector('time[datetime]')?.getAttribute('datetime') || '';
  let ts_iso = '';
  if (dt) { const d = new Date(dt); if (!isNaN(d)) ts_iso = d.toISOString(); }

  let author = '';
  for (const s of SEL.author.split(',')) {
    const n = el.querySelector(s.trim());
    // "Commented on <Name>'s message" enthält auch .user-popover -> ausschließen
    if (n && !n.closest(SEL.rootLink) && n.textContent.trim()) { author = n.textContent.trim(); break; }
  }
  if (!author) author = aria.author;

  const link = el.querySelector(SEL.rootLink);
  let reply_to = '';
  if (link) reply_to = norm(link.innerText).replace(/^Commented on\s*/i, '').replace(/\s+/g, ' ').slice(0, 160);

  return {
    id, pane, seq: null, prev_id: prevId || null,
    author, ts_iso, files, text, reactions, reply_to,
    date_sep: dateSep || '',
    _aria: aria, _cls: cls,
    edited: !!el.querySelector(SEL.edited)
  };
}

/* ---------------- Scan ---------------- */
function upsert(rec) {
  const old = S.recs.get(rec.id);
  if (!old) { rec.seq = S.seq++; S.recs.set(rec.id, rec); return; }
  const merged = Object.assign({}, old);
  for (const k of Object.keys(rec)) {
    const v = rec[k];
    const empty = v === '' || v === null || v === undefined
      || (Array.isArray(v) && !v.length)
      || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
    if (!empty) merged[k] = v;
  }
  merged.seq = old.seq;
  S.recs.set(rec.id, merged);
}

function scan() {
  if (!S.running) return;
  const nodes = document.querySelectorAll(SEL.dateSep + ',' + SEL.post);
  let lastDate = '';
  const prevByPane = { center: null, rhs: null };
  for (const el of nodes) {
    if (!/^(rhsPost_|post_)/.test(el.id || '')) { lastDate = (el.innerText || '').trim(); continue; }
    const pane = (el.id.startsWith('rhsPost_') || el.closest(SEL.rhsScope)) ? 'rhs' : 'center';
    const rec = read(el, lastDate, prevByPane[pane]);
    if (rec) { upsert(rec); prevByPane[pane] = rec.id; }
  }
  counter.textContent = S.recs.size + ' Posts';
}

/* ---------------- Auflösen: Zeit, Autor, Threads ---------------- */
function yearFromSep(sep) { const m = String(sep).match(/(20\d{2})/); return m ? +m[1] : null; }

function resolve(full) {
  const list = [...S.recs.values()].map(r => Object.assign({}, r));
  const byId = new Map(list.map(r => [r.id, r]));

  for (const r of list) {
    // Autor über prev_id-Kette erben (gruppierte Folgeposts)
    if (!r.author) {
      let cur = r, hops = 0;
      while (cur?.prev_id && hops++ < 60) {
        cur = byId.get(cur.prev_id);
        if (cur?.author) { r.author = cur.author; r.author_inherited = true; break; }
      }
    }
    // Zeit: <time datetime> -> aria-label + Jahr -> Nachbar
    if (!r.ts_iso && r._aria?.h !== null) {
      let year = yearFromSep(r.date_sep);
      if (!year) {
        let cur = r, hops = 0;
        while (cur?.prev_id && hops++ < 200) {
          cur = byId.get(cur.prev_id);
          if (cur?.ts_iso) { year = new Date(cur.ts_iso).getFullYear(); break; }
        }
      }
      if (!year) year = new Date().getFullYear();
      const a = r._aria;
      const d = new Date(year, a.month ?? 0, a.day ?? 1, a.h, a.min, 0, 0);
      if (!isNaN(d)) { r.ts_iso = d.toISOString(); r.ts_estimated = true; }
    }
  }

  // Reihenfolge: DOM-Kette (prev_id) ist die Wahrheit, ts sortiert nur die Ketten
  const nxt = new Map(), hasPrev = new Set();
  for (const r of list) {
    if (r.prev_id && byId.has(r.prev_id)) {
      if (!nxt.has(r.prev_id)) nxt.set(r.prev_id, r);
      hasPrev.add(r.id);
    }
  }
  const used = new Set(), chains = [];
  for (const h of list.filter(r => !hasPrev.has(r.id))) {
    const chain = [];
    let cur = h, guard = 0;
    while (cur && !used.has(cur.id) && guard++ < 1e5) { used.add(cur.id); chain.push(cur); cur = nxt.get(cur.id); }
    if (chain.length) chains.push(chain);
  }
  for (const r of list) if (!used.has(r.id)) { used.add(r.id); chains.push([r]); }

  const chainKey = ch => {
    const anchor = ch.find(r => r.ts_iso && !r.ts_estimated) || ch.find(r => r.ts_iso);
    return anchor ? anchor.ts_iso : '9999';
  };
  chains.sort((a, b) => {
    const ka = chainKey(a), kb = chainKey(b);
    return ka !== kb ? (ka < kb ? -1 : 1) : a[0].seq - b[0].seq;
  });
  const ordered = [].concat(...chains);

  // geschätzte Zeitstempel monoton machen (aria-label liefert keine Sekunden)
  let last = null;
  for (const r of ordered) {
    if (!r.ts_iso) { if (last) { r.ts_iso = last; r.ts_estimated = true; } continue; }
    if (last && r.ts_iso <= last && r.ts_estimated) {
      r.ts_iso = new Date(new Date(last).getTime() + 1000).toISOString();
    }
    last = r.ts_iso;
  }

  // Thread-Blöcke: other--root startet einen Block, same--root setzt ihn fort
  let block = null;
  const size = {};
  for (const r of ordered) {
    if (!block || /other--root/.test(r._cls)) block = r.id;
    r.thread = block;
    size[block] = (size[block] || 0) + 1;
  }

  if (full) return ordered;

  return ordered.map(r => {
    const o = { id: r.id, ts: (r.ts_iso || '').replace(/\.\d{3}Z$/, 'Z'), user: r.author, text: r.text };
    if (size[r.thread] > 1) o.thread = r.thread;
    if (Object.keys(r.reactions).length) o.reactions = r.reactions;
    if (r.reply_to) o.reply_to = r.reply_to;
    if (r.files.length) o.files = r.files;
    if (r.edited) o.edited = true;
    if (r.ts_estimated) o.ts_est = true;
    if (r.pane === 'rhs') o.pane = 'rhs';
    return o;
  });
}
S.dump = resolve;

/* ---------------- Transkript-Format (wie render_transcript.py) ---------------- */
const shortName = u => (String(u || '').split(/\s+/)[0] || String(u || ''));

function renderTranscript(rows) {
  const out = [];
  const users = {}, perYear = {};
  for (const r of rows) {
    users[r.user] = (users[r.user] || 0) + 1;
    const y = (r.ts || '').slice(0, 4);
    perYear[y] = (perYear[y] || 0) + 1;
  }
  out.push('messages: ' + rows.length);
  if (rows.length) out.push('range: ' + rows[0].ts + ' .. ' + rows[rows.length - 1].ts);
  out.push('participants: ' + Object.entries(users).sort((a, b) => b[1] - a[1])
    .map(([u, n]) => `${u} (${n})`).join(', '));
  out.push('per year: ' + Object.keys(perYear).sort()
    .map(y => `${y}: ${perYear[y]}`).join(', '));

  const threadNo = {};
  let day = null;
  for (const r of rows) {
    const stamp = r.ts || '';
    if (stamp.slice(0, 10) !== day) {
      day = stamp.slice(0, 10);
      out.push('\n---------- ' + day + ' ----------');
    }
    const marks = [];
    if (r.thread) {
      if (!(r.thread in threadNo)) threadNo[r.thread] = Object.keys(threadNo).length + 1;
      marks.push('T' + threadNo[r.thread]);
    }
    if (r.reply_to) marks.push('reply');
    if (r.edited)   marks.push('edited');
    if (r.ts_est)   marks.push('ts~');
    if (r.files?.length)  marks.push('file:' + r.files.join(',').slice(0, 60));
    if (r.reactions && Object.keys(r.reactions).length) {
      marks.push('reactions:' + Object.entries(r.reactions).map(([k, v]) => `${k}x${v}`).join(','));
    }
    const flag = marks.length ? ` [${marks.join(' ')}]` : '';
    const name = shortName(r.user).padEnd(8);
    const text = String(r.text || '').replace(/\n/g, '\n      ');
    out.push(`${stamp.slice(11, 16)} ${name}${flag}: ${text}`);
  }
  return out.join('\n') + '\n';
}

/* ---------------- Download ---------------- */
function download(content, ext, name) {
  const type = ext === 'txt' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8';
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (name || `mm_export_${location.hostname}_${Date.now()}`) + '.' + ext;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

/* ---------------- UI ---------------- */
const panel = document.createElement('div');
Object.assign(panel.style, {
  position:'fixed', top:'10px', right:'10px', zIndex:2147483647,
  background:'rgba(0,0,0,.78)', color:'#fff', padding:'8px 10px',
  font:'12px system-ui, sans-serif', borderRadius:'8px', display:'flex', gap:'6px', alignItems:'center'
});
const counter = document.createElement('span');
counter.textContent = '0 Posts'; counter.style.minWidth = '70px';
const mk = (label, fn) => {
  const b = document.createElement('button');
  b.textContent = label; b.onclick = fn;
  Object.assign(b.style, {
    cursor:'pointer', font:'inherit', padding:'3px 8px',
    background:'#f5f5f5', color:'#111', border:'1px solid #999',
    borderRadius:'4px', lineHeight:'1.4'
  });
  return b;
};
panel.append(
  counter,
  mk('JSONL', () => { scan(); download(resolve(false).map(r => JSON.stringify(r)).join('\n'), 'jsonl'); }),
  mk('TXT', () => {
    scan();
    const rows = resolve(false);
    const who = [...new Set(rows.map(r => shortName(r.user).toLowerCase()))].sort().join('-');
    download(renderTranscript(rows), 'txt', who || 'transcript');
  }),
  mk('Debug', () => { scan(); download(JSON.stringify(resolve(true), null, 2), 'json'); }),
  mk('Clear', () => {
    if (!confirm(`${S.recs.size} erfasste Posts verwerfen?`)) return;
    S.recs.clear(); S.seq = 0;
    counter.textContent = '0 Posts';
  }),
  mk('Stop', () => {
    S.running = false; clearInterval(S.timer); S.obs?.disconnect();
    panel.style.background = 'rgba(170,0,0,.85)';
    counter.textContent = S.recs.size + ' Posts (gestoppt)';
  })
);
document.body.appendChild(panel);

const schedule = () => { if (S.pending) return; S.pending = setTimeout(() => { S.pending = null; scan(); }, 120); };
S.obs = new MutationObserver(schedule);
S.obs.observe(document.body, { childList:true, subtree:true });
S.timer = setInterval(scan, 1500);
scan();
console.log('[mm-export] v3 aktiv – langsam nach oben scrollen, dann JSONL klicken.');
})();
