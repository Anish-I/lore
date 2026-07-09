// Lore desktop — convert Markdown into the design editor's block-AST.
// Output blocks: {t:'h1'|'h2'|'h3', s} | {t:'p'|'li'|'quote', runs} | {t:'code', s}
// Inline runs: {x} | {code:true,x} | {link, x}  ([[wikilinks]] and [text](url))
(function () {
  function href(token) {
    const a = (token.attrs || []).find((x) => x[0] === 'href');
    return a ? a[1] : '';
  }

  function pushText(runs, text) {
    // split out [[wiki-links]] into link runs
    const parts = String(text).split(/(\[\[[^\]]+\]\])/g);
    for (const p of parts) {
      if (!p) continue;
      const w = p.match(/^\[\[([^\]]+)\]\]$/);
      if (w) runs.push({ link: w[1], x: w[1] });
      else runs.push({ x: p });
    }
  }

  function inlineToRuns(inline) {
    const runs = [];
    let linkHref = null, linkText = '';
    for (const c of inline.children || []) {
      if (c.type === 'link_open') { linkHref = href(c); linkText = ''; continue; }
      if (c.type === 'link_close') { runs.push({ link: linkHref || linkText, x: linkText }); linkHref = null; continue; }
      if (linkHref !== null) { if (c.type === 'text' || c.type === 'code_inline') linkText += c.content; continue; }
      if (c.type === 'code_inline') { runs.push({ code: true, x: c.content }); continue; }
      if (c.type === 'softbreak' || c.type === 'hardbreak') { runs.push({ x: ' ' }); continue; }
      if (c.type === 'image') {
        const src = (c.attrs || []).find((a) => a[0] === 'src');
        runs.push({ img: src ? src[1] : '', x: (c.children || []).map((k) => k.content).join('') });
        continue;
      }
      if (c.type === 'text') { pushText(runs, c.content); continue; }
      // em/strong markers: ignore the marker; text arrives via text children
    }
    return runs.length ? runs : [{ x: inline.content || '' }];
  }

  window.mdToRuns = function mdToRuns(md) {
    if (!window.markdownit) return [{ t: 'p', runs: [{ x: md || '' }] }];
    const mdit = window.markdownit({ html: false, linkify: false, breaks: false });
    const tokens = mdit.parse(md || '', {});
    const blocks = [];
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.type === 'heading_open') {
        const lvl = t.tag === 'h1' ? 'h1' : t.tag === 'h2' ? 'h2' : 'h3';
        blocks.push({ t: lvl, s: (tokens[i + 1] && tokens[i + 1].content) || '' });
        i += 3; continue;
      }
      if (t.type === 'paragraph_open') {
        const inline = tokens[i + 1];
        blocks.push({ t: t.hidden ? 'li' : 'p', runs: inlineToRuns(inline) });
        i += 3; continue;
      }
      if (t.type === 'fence' || t.type === 'code_block') {
        blocks.push({ t: 'code', s: (t.content || '').replace(/\n$/, '') });
        i += 1; continue;
      }
      if (t.type === 'blockquote_open') {
        let j = i + 1, runs = [];
        while (j < tokens.length && tokens[j].type !== 'blockquote_close') {
          if (tokens[j].type === 'inline') runs = runs.concat(inlineToRuns(tokens[j]));
          j += 1;
        }
        blocks.push({ t: 'quote', runs });
        i = j + 1; continue;
      }
      i += 1;
    }
    return blocks.length ? blocks : [{ t: 'p', runs: [{ x: md || '' }] }];
  };
})();
