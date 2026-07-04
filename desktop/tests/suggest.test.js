// suggestPrompts: repeat-mining, cold start, activity fallback — deterministic chips.
import { describe, it, expect } from 'vitest';
import suggest from '../lib/suggest';

const { suggestPrompts, normalizePrompt, COLD_START } = suggest;

const user = (text) => ({ role: 'user', text });
const bot = (text) => ({ role: 'assistant', text });

describe('suggestPrompts — repeat mining', () => {
  it('surfaces questions asked 2+ times, most frequent first', () => {
    const history = [
      user('kalshi status?'), bot('...'),
      user('what changed in wingman?'), bot('...'),
      user('kalshi status?'), bot('...'),
      user('kalshi status?'), bot('...'),
      user('what changed in wingman?'), bot('...'),
    ];
    const out = suggestPrompts(history, {});
    expect(out[0]).toBe('kalshi status?');
    expect(out[1]).toBe('what changed in wingman?');
    expect(out.length).toBe(4); // filled with cold-start defaults
  });

  it('normalizes case/whitespace/punctuation when counting, keeps latest wording', () => {
    const history = [
      user('Kalshi   Status'), user('kalshi status?'), user('one-off question'),
    ];
    const out = suggestPrompts(history, {});
    expect(out[0]).toBe('kalshi status?');            // repeated (normalized), latest form
    expect(out).not.toContain('one-off question');    // min 2 occurrences
    expect(out.filter((p) => normalizePrompt(p) === 'kalshi status').length).toBe(1);
  });

  it('breaks frequency ties by recency', () => {
    const history = [
      user('older repeat'), user('newer repeat'),
      user('older repeat'), user('newer repeat'),
    ];
    const out = suggestPrompts(history, {});
    expect(out[0]).toBe('newer repeat');
    expect(out[1]).toBe('older repeat');
  });

  it('caps learned repeats at 2 and total at 4', () => {
    const history = ['a?', 'b?', 'c?'].flatMap((q) => [user(q), user(q), user(q)]);
    const out = suggestPrompts(history, { recentSection: 'Kalshi' });
    expect(out.length).toBe(4);
    expect(out.slice(0, 2)).toEqual(['c?', 'b?']);    // only 2 mined (recency tiebreak)
    expect(out[2]).toBe("What's new in Kalshi?");
  });
});

describe('suggestPrompts — cold start', () => {
  it('returns the defaults with no history at all', () => {
    expect(suggestPrompts([], {})).toEqual(COLD_START);
    expect(suggestPrompts(null, undefined)).toEqual(COLD_START);
  });

  it('ignores assistant turns and one-off questions', () => {
    const out = suggestPrompts([bot('hello'), user('asked once')], {});
    expect(out).toEqual(COLD_START);
  });
});

describe('suggestPrompts — activity fallback', () => {
  it('adds a "What\'s new in <section>?" chip from recent activity', () => {
    const out = suggestPrompts([], { recentSection: 'Wingman' });
    expect(out[0]).toBe("What's new in Wingman?");
    expect(out.length).toBe(4);
  });

  it('dedupes the activity chip against a mined repeat', () => {
    const history = [user("What's new in Wingman?"), user("what's new in wingman")];
    const out = suggestPrompts(history, { recentSection: 'Wingman' });
    expect(out.filter((p) => normalizePrompt(p) === "what's new in wingman").length).toBe(1);
  });
});
