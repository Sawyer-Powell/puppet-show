// Runs in the page; no axe/network dependency. Endpoint captures are settled:
// low opacity is composited, never exempted as if an endpoint were a reveal.
export function inspectA11y() {
  const issues = [], deck = document.querySelector('.ps-deck') ?? document.body;
  const interactive = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=tab], [role=slider], [contenteditable=true]';
  const identify = e => e.id ? `${e.localName}#${e.id}` : `${e.localName}${[...e.classList].map(c => `.${c}`).join('')} ${JSON.stringify((e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60))}`;
  const ignored = e => e.closest('[data-verify-ignore]');
  const visible = e => {
    if (ignored(e) || !e.getClientRects().length) return false;
    for (let p = e; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const rgba = v => {
    // Computed colours normally serialize to rgb()/rgba(); canvas normalizes
    // modern colour syntax as well, without fetching any resources.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = v; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
  };
  const over = (a, b) => {
    const alpha = a[3] + b[3] * (1 - a[3]);
    return [...a.slice(0, 3).map((v, i) => alpha ? (v * a[3] + b[i] * b[3] * (1 - a[3])) / alpha : 0), alpha];
  };
  const luminance = c => c.slice(0, 3).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  const contentName = (e, referenced = false) => [...e.childNodes].map(n => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent;
    if (n.nodeType !== Node.ELEMENT_NODE) return '';
    if (!referenced && (n.matches('[aria-hidden=true],script,style') || getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility !== 'visible')) return '';
    return n.getAttribute('aria-label') || n.getAttribute('alt') || contentName(n, referenced);
  }).join(' ').trim();
  const name = (e, seen = new Set(), referenced = false) => {
    if (seen.has(e)) return '';
    seen.add(e);
    const refs = (e.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)).filter(Boolean);
    if (refs.length) return refs.map(n => name(n, seen, true)).join(' ').trim();
    return (e.getAttribute('aria-label')?.trim() || [...(e.labels ?? [])].map(l => contentName(l)).join(' ').trim() || e.getAttribute('alt') ||
      (e.matches('input[type=button],input[type=submit],input[type=reset]') ? e.value : '') ||
      (e.matches('input[type=submit]') ? 'Submit' : e.matches('input[type=reset]') ? 'Reset' : '') ||
      (e.matches('input,select,textarea,[role=slider]') ? '' : contentName(e, referenced)) || e.getAttribute('title') || '').trim();
  };
  const ids = new Map();
  for (const e of document.querySelectorAll('[id]')) {
    if (ignored(e)) continue;
    if (ids.has(e.id)) issues.push(`a11y duplicate-id: ${identify(e)} duplicates ${identify(ids.get(e.id))}; assign unique ids and update label references`);
    ids.set(e.id, e);
  }
  for (const e of deck.querySelectorAll(interactive)) {
    if (!visible(e)) continue;
    if (e.matches('button,input,[role=button],[role=radio],[role=tab],[role=slider]') && !name(e)) issues.push(`a11y name: ${identify(e)}; add a visible label, associated <label>, aria-label or aria-labelledby`);
    const parent = e.parentElement?.closest(interactive);
    // A tabindex on a group container is not itself an interactive widget.
    if (parent && !parent.matches('[role=radiogroup],[role=group],[role=tablist]')) issues.push(`a11y nested-control: ${identify(e)} inside ${identify(parent)}; make interactive controls siblings`);
    if (e.matches('[role=radio]')) {
      if (!e.closest('[role=radiogroup]')) issues.push(`a11y radio-group: ${identify(e)}; wrap radios in role=radiogroup`);
      if (!['true', 'false'].includes(e.getAttribute('aria-checked'))) issues.push(`a11y radio-state: ${identify(e)}; set aria-checked to true or false`);
    }
  }
  for (const g of deck.querySelectorAll('[role=radiogroup]')) {
    if (!visible(g)) continue;
    const radios = [...g.querySelectorAll('[role=radio]')].filter(e => e.closest('[role=radiogroup]') === g && visible(e));
    if (radios.length && (radios.filter(e => e.getAttribute('tabindex') === '0').length !== 1 || radios.some(e => !['0', '-1'].includes(e.getAttribute('tabindex'))))) issues.push(`a11y roving-tabindex: ${identify(g)}; set exactly one radio tabindex=0 and all other radios tabindex=-1`);
  }
  const walker = document.createTreeWalker(deck, NodeFilter.SHOW_TEXT);
  const reported = new Set();
  while (walker.nextNode()) {
    const node = walker.currentNode, e = node.parentElement;
    if (!node.textContent.trim() || !visible(e) || reported.has(e) || e.closest('script,style,option')) continue;
    // WCAG 1.4.3 exempts inactive controls. Only native :disabled qualifies:
    // aria-disabled content (e.g. revealed ask() options) is still read.
    if (e.closest(':disabled')) continue;
    // Declared-decorative duplicates (ghost() copies: aria-hidden + inert) and
    // demos whose subject is low opacity (data-contrast-exempt="<reason>").
    if (e.closest('[aria-hidden=true][inert]')) continue;
    const exempt = e.closest('[data-contrast-exempt]');
    if (exempt) {
      if (!exempt.getAttribute('data-contrast-exempt').trim()) issues.push(`a11y contrast-exempt: ${identify(exempt)} has no reason; set data-contrast-exempt="<why low contrast is the subject>"`);
      continue;
    }
    const range = document.createRange(); range.selectNodeContents(node);
    if (![...range.getClientRects()].some(r => r.width && r.height)) continue;
    const style = getComputedStyle(e), chain = [];
    for (let p = e; p; p = p.parentElement) chain.push(p);
    // Composite the text and the no-text sample through each ancestor's
    // background and group opacity, then onto the browser's white canvas.
    let fg = rgba(style.color), bg = [0, 0, 0, 0];
    for (const p of chain) {
      const s = getComputedStyle(p), background = rgba(s.backgroundColor), opacity = Number(s.opacity);
      fg = over(fg, background); bg = over(bg, background);
      fg[3] *= opacity; bg[3] *= opacity;
    }
    fg = over(fg, [1, 1, 1, 1]); bg = over(bg, [1, 1, 1, 1]);
    const a = luminance(fg), b = luminance(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700), required = large ? 3 : 4.5;
    if (ratio + .001 < required) {
      reported.add(e);
      issues.push(`a11y contrast: ${identify(e)} text ${JSON.stringify(node.textContent.trim().slice(0, 70))}: ${ratio.toFixed(2)}:1 < ${required}:1 (${style.color}, effective background rgb(${bg.slice(0, 3).map(v => Math.round(v * 255)).join(',')})); use an AA text/background token pair or increase settled opacity`);
    }
  }
  return issues;
}

// Tab checks operate on the real page, not programmatic focus. Roving widgets
// expose one Tab stop; their other radios are reached by arrows (APG).
export async function keyboardIssues(page) {
  const setup = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('.ps-deck :is(button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=radio],[role=tab],[role=slider],[contenteditable=true])')].filter(e => {
      if (e.closest('[data-verify-ignore]') || e.matches(':disabled,[aria-disabled=true]') || !e.getClientRects().length) return false;
      for (let p = e; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.visibility !== 'visible' || s.display === 'none' || Number(s.opacity) === 0) return false; }
      // Non-selected composite members are deliberately not Tab stops.
      return !(e.matches('[role=radio],[role=tab]') && e.tabIndex === -1);
    });
    const snapshot = e => { const s = getComputedStyle(e); return { outline: s.outline, width: parseFloat(s.outlineWidth), style: s.outlineStyle, color: s.outlineColor, shadow: s.boxShadow }; };
    // Blur before baseline capture (autofocus can otherwise hide the change).
    document.activeElement?.blur();
    window.__puppetShowKeyboardControls = controls;
    return controls.map(e => ({ label: `${e.localName}${e.id ? '#' + e.id : '.' + [...e.classList].join('.')} ${JSON.stringify((e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 50))}`, before: snapshot(e) }));
  });
  // Reset sequential focus starting point without clicking a control.
  await page.evaluate(() => { document.body.setAttribute('tabindex', '-1'); document.body.focus(); document.body.removeAttribute('tabindex'); });
  const reached = new Set(), issues = [];
  for (let i = 0; i < setup.length * 2 + 8; i++) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => {
      const e = document.activeElement, s = getComputedStyle(e);
      const transparent = colour => colour === 'transparent' || /rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(colour);
      const shadowVisible = s.boxShadow.split(/,(?![^()]*\))/).some(part => {
        const colour = part.match(/rgba?\([^)]*\)/)?.[0];
        const lengths = part.replace(/rgba?\([^)]*\)/g, '').match(/-?[\d.]+px/g) ?? [];
        return colour && !transparent(colour) && lengths.some(v => parseFloat(v) !== 0);
      });
      return { index: window.__puppetShowKeyboardControls.indexOf(e), visible: e.matches(':focus-visible'), outline: s.outline, width: parseFloat(s.outlineWidth), style: s.outlineStyle, outlineVisible: !transparent(s.outlineColor), shadow: s.boxShadow, shadowVisible };
    });
    if (state.index < 0 || reached.has(state.index)) continue;
    reached.add(state.index);
    const original = setup[state.index];
    const outline = state.width > 0 && !['none', 'hidden'].includes(state.style) && state.outlineVisible && state.outline !== original.before.outline;
    const shadow = state.shadowVisible && state.shadow !== original.before.shadow;
    if (!state.visible || (!outline && !shadow)) issues.push(`a11y focus-visible: ${original.label}; add a :focus-visible outline or box-shadow that visibly changes from the unfocused style`);
  }
  setup.forEach((c, i) => { if (!reached.has(i)) issues.push(`a11y keyboard-reach: ${c.label}; make this control reachable by Tab (remove negative tabindex or repair the focus trap)`); });
  await page.evaluate(() => { document.activeElement?.blur(); delete window.__puppetShowKeyboardControls; });
  return issues;
}
