(() => {
  if (window.MM_EXPORT?.running) { console.warn('Läuft schon – Stop oder reload.'); return; }

  window.MM_EXPORT = { running:true, seen:new Set(), seenFP:new Set(), items:[], observer:null };

  const SEL = ['[data-testid="postMessageText"]','[data-testid="message-body"]','.post-message__text','.post__body'].join(',');
  const norm = s => String(s||'').replace(/\r/g,'').replace(/\u00A0/g,' ')
    .replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();

  const getUser = el => {
    for (const sel of ['[data-testid="postProfileUsername"]','[data-testid="UserProfilePopover"]','[data-testid="user-profile-popover"]','header [role="button"][aria-haspopup]','[class*="username"]']) {
      const n = el.querySelector(sel); if (n?.textContent) return n.textContent.trim();
    }
    const alt = el.querySelector('img[alt]')?.getAttribute('alt')||''; return alt.replace(/\s*\(.*\)\s*$/,'').trim();
  };
  const getISO = el => {
    const t = el.querySelector('time[datetime]')?.getAttribute('datetime') ||
              el.querySelector('[data-testid="postViewTimestamp"]')?.getAttribute('datetime');
    return t ? new Date(t).toISOString() : '';
  };
  const getText = el => {
    const c = Array.from(el.querySelectorAll(SEL)).map(n=>n.innerText.trim()).filter(Boolean);
    const longest = (c.sort((a,b)=>b.length-a.length)[0]||'').split('\n');
    const seen = new Set(), out=[]; for (const line of longest){ const k=line.trim(); if(!k||!seen.has(k)){ out.push(line); if(k) seen.add(k); } }
    return norm(out.join('\n'));
  };

  const handle = el => {
    const root = el.id?.startsWith('post_') ? el : el.closest?.('[id^="post_"]'); if (!root) return;
    const pid = root.id; if (!pid) return;
    if (window.MM_EXPORT.seen.has(pid)) return;

    const user=getUser(root), iso=getISO(root), text=getText(root); if(!text) return;
    const fp = `${iso}|${user}|${text}`;
    if (window.MM_EXPORT.seenFP.has(fp)) return;

    window.MM_EXPORT.seen.add(pid);
    window.MM_EXPORT.seenFP.add(fp);
    window.MM_EXPORT.items.push({ pid, iso, user, text });
    counter.textContent = `${window.MM_EXPORT.items.length} Posts`;
  };

  // UI
  const panel=document.createElement('div'); panel.id='mm-scroll-exporter';
  Object.assign(panel.style,{position:'fixed',top:'10px',right:'10px',zIndex:2147483647,background:'rgba(0,0,0,0.72)',color:'#fff',padding:'8px 10px',font:'12px system-ui',borderRadius:'8px'});
  const counter=document.createElement('span'); counter.textContent='0 Posts';
  const saveBtn=document.createElement('button'); saveBtn.textContent='Speichern';
  const stopBtn=document.createElement('button'); stopBtn.textContent='Stop';
  for (const b of [saveBtn,stopBtn]) Object.assign(b.style,{marginLeft:'8px',cursor:'pointer'});
  panel.append(counter,saveBtn,stopBtn); document.body.appendChild(panel);

  const buildText = () => {
    const it=[...window.MM_EXPORT.items].sort((a,b)=>String(a.iso).localeCompare(String(b.iso)));
    return it.map(x=>`${x.iso?x.iso.replace('T',' ').replace('Z',' UTC'):''} ${x.user||''}\n${x.text}\n\n---\n`).join('');
  };
  const download = txt => {
    const blob=new Blob([txt],{type:'text/plain;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`mattermost_scroll_export_${location.hostname}_${Date.now()}.txt`;
    document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},0);
  };
  saveBtn.onclick=()=>download(buildText());
  stopBtn.onclick=()=>{ window.MM_EXPORT.running=false; window.MM_EXPORT.observer?.disconnect();
    panel.style.background='rgba(200,0,0,0.8)'; counter.textContent=`${window.MM_EXPORT.items.length} Posts (gestoppt)`; };

  const obs=new MutationObserver(ms=>{
    for (const m of ms) for (const n of m.addedNodes) if (n.nodeType===1){
      if (n.id?.startsWith('post_')) handle(n);
      n.querySelectorAll?.('[id^="post_"]').forEach(handle);
    }
  });
  obs.observe(document.body,{childList:true,subtree:true});
  window.MM_EXPORT.observer=obs;

  // Seed
  document.querySelectorAll('[id^="post_"]').forEach(handle);
  console.log('Exporter aktiv – bitte nach oben scrollen.');
})();
