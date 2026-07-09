/* global window, document */
// Lore desktop — HTML → Markdown serializer for the WYSIWYG editor.
//
// The WYSIWYG surface is a contentEditable whose HTML we must write back to the
// note's .md file WITHOUT corrupting it — wikilinks [[x]], #tags, frontmatter,
// and code all have to survive a load→edit→save round-trip. Strategy:
//   * markdown-it renders MD → HTML on load (window.markdownToHtmlBody).
//   * this walks the edited DOM back to Markdown, covering exactly the block/
//     inline constructs the toolbar can produce; anything it doesn't recognize
//     degrades to its text content (never dropped, never HTML-injected).
//   * wikilinks/tags are plain text nodes, so they pass through verbatim.
// A "source" toggle in the editor always exposes the raw markdown as a safety
// valve, so nothing is ever locked behind a lossy conversion.

(function () {
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE']);

  // Collapse insignificant whitespace in an inline run (contentEditable emits a
  // lot of it) but keep single spaces between words.
  function normText(t) {
    return String(t).replace(/ /g, ' ').replace(/[ \t\r\n]+/g, ' ');
  }

  function escapeInline(t) {
    // Escape markdown-active characters that appear literally in text so they
    // don't re-parse as formatting on the next load. Keep it conservative —
    // over-escaping is ugly; under-escaping corrupts. We deliberately DON'T
    // escape [ ] so [[wikilinks]] survive.
    return t.replace(/([\\`*_])/g, '\\$1');
  }

  // Serialize inline children of a node to a markdown string.
  function inline(node) {
    let out = '';
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) { out += escapeInline(normText(c.nodeValue)); return; }
      if (c.nodeType !== 1) return;
      const tag = c.tagName;
      if (tag === 'BR') { out += '  \n'; return; }
      if (tag === 'STRONG' || tag === 'B') { out += `**${inline(c).trim()}**`; return; }
      if (tag === 'EM' || tag === 'I') { out += `*${inline(c).trim()}*`; return; }
      if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') { out += `~~${inline(c).trim()}~~`; return; }
      if (tag === 'CODE') { out += `\`${normText(c.textContent)}\``; return; }
      if (tag === 'A') {
        const href = c.getAttribute('href') || '';
        const txt = inline(c).trim() || href;
        out += href ? `[${txt}](${href})` : txt;
        return;
      }
      if (tag === 'IMG') {
        const src = c.getAttribute('src') || '';
        const alt = c.getAttribute('alt') || '';
        out += `![${alt}](${src})`;
        return;
      }
      // Unknown inline wrapper (span, font, mark…) — keep its inner content.
      out += inline(c);
    });
    return out;
  }

  function listItems(listNode, ordered, depth) {
    const pad = '  '.repeat(depth);
    let out = '';
    let n = 1;
    Array.from(listNode.children).forEach((li) => {
      if (li.tagName !== 'LI') return;
      const marker = ordered ? `${n}. ` : '- ';
      // Split the LI into its own inline text and any nested lists.
      let text = '';
      const nested = [];
      li.childNodes.forEach((c) => {
        if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) nested.push(c);
        else text += c.nodeType === 3 ? escapeInline(normText(c.nodeValue)) : (c.nodeType === 1 ? inline(c) : '');
      });
      out += `${pad}${marker}${text.trim()}\n`;
      nested.forEach((nl) => { out += listItems(nl, nl.tagName === 'OL', depth + 1); });
      n += 1;
    });
    return out;
  }

  // Serialize a block-level node (or a container of blocks) to markdown.
  function block(node) {
    const tag = node.tagName;
    if (tag === 'H1') return `# ${inline(node).trim()}\n\n`;
    if (tag === 'H2') return `## ${inline(node).trim()}\n\n`;
    if (tag === 'H3') return `### ${inline(node).trim()}\n\n`;
    if (tag === 'H4') return `#### ${inline(node).trim()}\n\n`;
    if (tag === 'H5') return `##### ${inline(node).trim()}\n\n`;
    if (tag === 'H6') return `###### ${inline(node).trim()}\n\n`;
    if (tag === 'HR') return `---\n\n`;
    if (tag === 'PRE') {
      const codeEl = node.querySelector('code') || node;
      const lang = (codeEl.className.match(/language-(\w+)/) || [])[1] || '';
      return '```' + lang + '\n' + codeEl.textContent.replace(/\n$/, '') + '\n```\n\n';
    }
    if (tag === 'BLOCKQUOTE') {
      const inner = serializeChildren(node).trim();
      return inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n') + '\n\n';
    }
    if (tag === 'UL') return listItems(node, false, 0) + '\n';
    if (tag === 'OL') return listItems(node, true, 0) + '\n';
    if (tag === 'P' || tag === 'DIV') {
      const t = inline(node).trim();
      return t ? t + '\n\n' : '';
    }
    // Fallback: recurse into unknown block containers.
    return serializeChildren(node);
  }

  // Walk a container's children, emitting block markdown for block-level nodes
  // and wrapping stray inline runs in paragraphs.
  function serializeChildren(root) {
    let out = '';
    let inlineBuf = '';
    const flush = () => { const t = inlineBuf.trim(); if (t) out += t + '\n\n'; inlineBuf = ''; };
    root.childNodes.forEach((c) => {
      if (c.nodeType === 3) { inlineBuf += escapeInline(normText(c.nodeValue)); return; }
      if (c.nodeType !== 1) return;
      if (BLOCK.has(c.tagName)) { flush(); out += block(c); }
      else inlineBuf += inline(c);
    });
    flush();
    return out;
  }

  // Public: convert a contentEditable element (or its innerHTML) to markdown.
  function htmlToMarkdown(elOrHtml) {
    let el = elOrHtml;
    if (typeof elOrHtml === 'string') {
      el = document.createElement('div');
      el.innerHTML = elOrHtml;
    }
    return serializeChildren(el)
      .replace(/\n{3,}/g, '\n\n')   // collapse runs of blank lines
      .replace(/[ \t]+\n/g, '\n')    // trim trailing spaces (keep the 2-space <br>)
      .replace(/\\\n/g, '\n')
      .trimEnd() + '\n';
  }

  // MD → HTML for loading into the editor (frontmatter stripped by caller).
  function markdownToHtmlBody(md) {
    const MD = window.markdownit ? window.markdownit({ html: false, linkify: true, breaks: false }) : null;
    return MD ? MD.render(String(md || '')) : String(md || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  window.htmlToMarkdown = htmlToMarkdown;
  window.markdownToHtmlBody = markdownToHtmlBody;
})();
