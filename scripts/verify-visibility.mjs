// Browser-side visibility checks. Keep these functions closure-free for evaluate().
export function inspectVisibility() {
  const issues = [];
  const name = e => `${e.localName}${e.id ? '#' + e.id : '.' + [...e.classList].join('.')} ${JSON.stringify(e.textContent.trim().replace(/\s+/g, ' ').slice(0, 80))}`;
  const visible = e => {
    for (let p = e; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0) return false;
    }
    return e.getClientRects().length > 0;
  };
  const textOwners = new Set();
  const deck = document.querySelector('.ps-deck');
  if (deck) {
    const walker = document.createTreeWalker(deck, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      let box = walker.currentNode.parentElement;
      if (box.closest('script,style')) continue;
      while (box && !box.clientWidth && box !== deck) box = box.parentElement;
      if (box) textOwners.add(box);
    }
  }
  for (const e of document.querySelectorAll('.ps-deck, .ps-deck *')) {
    if (!visible(e)) continue;
    const s = getComputedStyle(e);
    // Only boxes owning text: ancestor scroll widths also include intentional
    // wide descendants (e.g. a plain, horizontally scrollable table).
    const ownsText = textOwners.has(e);
    if (ownsText && e.clientWidth && s.overflowX === 'visible' && e.scrollWidth > e.clientWidth + 1)
      issues.push(`text spills out of its box: ${name(e)} (${e.scrollWidth}px > ${e.clientWidth}px)`);
    if (!e.matches('.ps-hot,.ps-ok,.ps-bad,.ps-live') && !e.closest('.ps-hot,.ps-ok,.ps-bad,.ps-live')) continue;
    // Check the highlighted box and its cells/text, not layout-only descendants.
    if (!ownsText && !e.matches('.ps-hot,.ps-ok,.ps-bad,.ps-live,[role=cell],td,th')) continue;
    const r = e.getBoundingClientRect();
    for (let p = e.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p), pr = p.getBoundingClientRect();
      const left = pr.left + p.clientLeft, top = pr.top + p.clientTop;
      const x = /^(auto|scroll)$/.test(ps.overflowX) && (r.left < left - 1 || r.right > left + p.clientWidth + 1);
      const y = /^(auto|scroll)$/.test(ps.overflowY) && (r.top < top - 1 || r.bottom > top + p.clientHeight + 1);
      if (x || y) { issues.push(`highlighted content clipped by scroll ancestor: ${name(e)} in ${name(p)}`); break; }
    }
  }
  return issues;
}

export function stageSize() {
  const r = document.querySelector('.ps-stage')?.getBoundingClientRect();
  if (!r || (r.height <= innerHeight + 1 && r.bottom <= innerHeight + 1)) return null;
  return `stage ${Math.round(r.height)}px at y=${Math.round(r.top)} extends past viewport ${innerHeight}px (bottom ${Math.round(r.bottom)}px)`;
}

// Installed before navigation so the first autoplay flight is observed too.
// fly has no target metadata: infer the landing node from its measured center
// nearest the token endpoint. Snapshot all candidate centers before the flight,
// allowing a moved target to be identified at its ORIGINAL position.
export function observeFlights() {
  const active = new Map(), issues = [];
  window.__puppetShowFlights = issues;
  const rect = e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  const name = e => `${e.localName}${e.id ? '#' + e.id : '.' + [...e.classList].join('.')}${e.hasAttribute('data-key') ? `[data-key=${JSON.stringify(e.getAttribute('data-key'))}]` : ''} ${JSON.stringify(e.textContent.trim().replace(/\s+/g, ' ').slice(0, 60))}`;
  const context = () => { const d = document.querySelector('.ps-deck'); return `chapter ${Number(d?.dataset.chapter) + 1} step ${Number(d?.dataset.step) + 1} (global step ${Number(d?.dataset.index) + 1})`; };
  const position = (token, origin) => {
    const m = new DOMMatrix(token.style.transform || undefined);
    return { x: origin.left + m.m41, y: origin.top + m.m42 };
  };
  // fly anchors are source/destination centers, not label edges: wide labels
  // may legitimately extend beyond an anchor near the viewport margin.
  const outside = p => p.x < -1 || p.x > innerWidth + 1 || p.y < -1 || p.y > innerHeight + 1;
  const sample = f => {
    f.last = position(f.token, f.origin);
    f.shift = Math.max(f.shift, Math.abs(document.documentElement.scrollHeight - f.height));
    for (const c of f.candidates) {
      if (!c.e.isConnected) continue;
      const r = rect(c.e);
      c.shift = Math.max(c.shift, Math.abs(r.left - c.r.left), Math.abs(r.top - c.r.top), Math.abs(r.right - c.r.right), Math.abs(r.bottom - c.r.bottom));
    }
  };
  const finish = f => {
    // A removal and the author's AFTER-landing changes can share a microtask.
    // Only the token transform is valid now; measuring layout here would
    // falsely attribute a subsequent insert/reveal to the completed flight.
    f.last = position(f.token, f.origin);
    const nearest = f.candidates.reduce((best, c) => {
      const distance = Math.hypot(c.r.x - f.last.x, c.r.y - f.last.y);
      return !best || distance < best.distance - 0.1 || (Math.abs(distance - best.distance) <= 0.1 && c.e.hasAttribute('data-key')) ? { ...c, distance } : best;
    }, null);
    const target = nearest && nearest.distance < 16 ? nearest.label : `endpoint (${Math.round(f.last.x)}, ${Math.round(f.last.y)}); target not identifiable`;
    const prefix = `${f.context}: flight ${JSON.stringify(f.label)} target ${target}`;
    if (outside(f.start)) issues.push(`${prefix}: starts outside viewport at (${Math.round(f.start.x)}, ${Math.round(f.start.y)})`);
    if (outside(f.last)) issues.push(`${prefix}: lands outside viewport at (${Math.round(f.last.x)}, ${Math.round(f.last.y)})`);
    if (f.shift > 4 || (nearest?.distance < 16 && nearest.shift > 4)) issues.push(`${prefix}: layout shifted during flight (document height ${Math.round(f.shift)}px; target ${Math.round(nearest?.shift ?? 0)}px; limit 4px)`);
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element) || !node.matches('.ps-fly') || !record.target.closest('.ps-overlay')) continue;
        const origin = record.target.getBoundingClientRect();
        const f = { token: node, origin, label: node.textContent, context: context(), height: document.documentElement.scrollHeight, shift: 0,
          candidates: [...document.querySelectorAll('.ps-view-content *')].filter(e => e.getClientRects().length).map(e => ({ e, r: rect(e), label: name(e), shift: 0 })) };
        f.start = position(node, origin); f.last = f.start;
        active.set(node, f);
      }
      for (const node of record.removedNodes) {
        const f = active.get(node);
        if (f) { finish(f); active.delete(node); }
      }
    }
    for (const f of active.values()) sample(f);
  });
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  const frame = () => { for (const f of active.values()) sample(f); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}
