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

  // A session prompt is chip-worthy when it reads like a reusable question, not
  // a one-off imperative ("fix the graph date slider") or pasted noise.
  function sessionPromptOk(text) {
    const t = String(text || '').trim();
    if (t.length < 18 || t.length > 140) return false;
    if (/[{}<>`]|https?:\/\//.test(t)) return false;   // code/markup/links
    if (/^\s*(\/|!|git |npm |cd |ls )/.test(t)) return false; // commands
    return true;
  }

  // history: chat turns [{role, text, ...}] oldest first (only user turns are mined).
  // ctx: { recentSection?: string, sessionPrompts?: string[] } — activity signal
  //      from /digest, plus the user's past Claude/Codex session prompts
  //      (/recent-prompts, newest first) for cross-tool personalization.
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

    // 1) Learned repeats across BOTH signal sources: in-app ask history and the
    //    user's past Claude/Codex prompts. Same normalized question 2+ times.
    const counts = new Map(); // key -> {count, lastIdx, text}
    const mine = (text, i) => {
      const key = normalizePrompt(text);
      if (!key) return;
      const e = counts.get(key) || { count: 0, lastIdx: -1, text };
      e.count += 1;
      e.lastIdx = Math.max(e.lastIdx, i);
      e.text = String(text).trim();
      counts.set(key, e);
    };
    (Array.isArray(history) ? history : [])
      .filter((m) => m && m.role === 'user' && m.text)
      .forEach((m, i) => mine(m.text, i));
    const sess = (Array.isArray(c.sessionPrompts) ? c.sessionPrompts : []).filter(sessionPromptOk);
    // newest first from the API — index so newer prompts win recency ties
    sess.forEach((t, i) => mine(t, sess.length - i));
    [...counts.values()]
      .filter((e) => e.count >= 2)
      .sort((a, b) => (b.count - a.count) || (b.lastIdx - a.lastIdx))
      .slice(0, 2)
      .forEach((e) => push(e.text));

    // 2) No repeats yet (fresh install): the most recent chip-worthy session
    //    prompt still personalizes day one — it's something they actually asked.
    if (out.length === 0 && sess.length) push(sess[0]);

    // 3) Activity: the most recently active section, when known.
    if (c.recentSection) push(`What's new in ${c.recentSection}?`);

    // 4) Cold-start defaults fill the rest.
    COLD_START.forEach(push);

    return out.slice(0, MAX_PROMPTS);
  }

  return { suggestPrompts, normalizePrompt, sessionPromptOk, COLD_START, MAX_PROMPTS };
});
