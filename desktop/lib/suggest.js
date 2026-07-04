// suggestPrompts — the Home tab / empty-chat "personalized prompt chips".
// Deterministic, no LLM: learned repeats from the ask history (normalized text,
// min 2 occurrences, frequency then recency), one activity-derived chip
// ("What's new in <most recently active section>?"), then cold-start defaults
// to fill up to 4. Single source of truth: vitest imports this file directly and
// scripts/build-renderer.cjs copies it into renderer/compiled/ where it registers
// window.LoreSuggestPrompts for the renderer.
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.LoreSuggestPrompts = api.suggestPrompts;
})(typeof globalThis !== 'undefined' && globalThis.window ? globalThis.window : null, function () {
  'use strict';

  const MAX_PROMPTS = 4;

  const COLD_START = [
    'What did I work on this week?',
    'Summarize my most recent notes',
    'What decisions did I make recently?',
    "What's still open or unfinished?",
  ];

  // Normalized comparison key: case/whitespace/trailing-punctuation insensitive,
  // so "Kalshi status?" and "kalshi status" count as the same repeated question.
  function normalizePrompt(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[?.!…]+$/, '');
  }

  // history: chat turns [{role, text, ...}] oldest first (only user turns are mined).
  // ctx: { recentSection?: string, noteCount?: number } — activity signal from
  //      /digest (most recently active section) and /stats.
  // Returns 3-4 prompt strings, repeats first, deduplicated by normalized text.
  function suggestPrompts(history, ctx) {
    const c = ctx || {};
    const out = [];
    const seen = new Set();
    const push = (text) => {
      const key = normalizePrompt(text);
      if (!key || seen.has(key) || out.length >= MAX_PROMPTS) return;
      seen.add(key);
      out.push(text);
    };

    // 1) Learned repeats: same (normalized) question asked 2+ times.
    const counts = new Map(); // key -> {count, lastIdx, text}
    (Array.isArray(history) ? history : [])
      .filter((m) => m && m.role === 'user' && m.text)
      .forEach((m, i) => {
        const key = normalizePrompt(m.text);
        if (!key) return;
        const e = counts.get(key) || { count: 0, lastIdx: -1, text: m.text };
        e.count += 1;
        e.lastIdx = i;
        e.text = String(m.text).trim(); // keep the most recent original wording
        counts.set(key, e);
      });
    [...counts.values()]
      .filter((e) => e.count >= 2)
      .sort((a, b) => (b.count - a.count) || (b.lastIdx - a.lastIdx))
      .slice(0, 2)
      .forEach((e) => push(e.text));

    // 2) Activity: the most recently active section, when known.
    if (c.recentSection) push(`What's new in ${c.recentSection}?`);

    // 3) Cold-start defaults fill the rest.
    COLD_START.forEach(push);

    return out.slice(0, MAX_PROMPTS);
  }

  return { suggestPrompts, normalizePrompt, COLD_START, MAX_PROMPTS };
});
