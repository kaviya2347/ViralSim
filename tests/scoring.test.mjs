// Unit tests for the deterministic scoring logic in index.html.
// Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Load the app's <script> into a sandbox with a minimal DOM stub.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const el = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'classList' ? { add() {}, remove() {}, toggle() {} } : typeof k === 'string' && /^(add|remove)EventListener$/.test(k) ? () => {} : '') });
const ctx = {
  document: { getElementById: el, createElement: el, querySelector: el, querySelectorAll: () => [], addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
  window: { addEventListener() {} }, addEventListener() {}, URL, console, setTimeout, Math, JSON,
};
vm.createContext(ctx);
vm.runInContext(code + '\n;globalThis.__api = { evaluateGate, computeViralityScore, PLATFORM_WEIGHTS, GATE_THRESHOLDS, state };', ctx);
const { evaluateGate, computeViralityScore, PLATFORM_WEIGHTS, state } = ctx.__api;

const persona = (watch, ...actions) => ({ watch_pct: watch, actions: ['watch', ...actions] });

test('platform weights sum to 1', () => {
  for (const [name, w] of Object.entries(PLATFORM_WEIGHTS)) {
    const sum = w.watch + w.share + w.like + w.save;
    assert.ok(Math.abs(sum - 1) < 1e-9, `${name} weights sum to ${sum}`);
  }
});

test('evaluateGate computes averages and rates', () => {
  const g = evaluateGate([persona(80, 'share', 'like'), persona(40), persona(60, 'like', 'save'), persona(20)]);
  assert.equal(g.avgWatch, 50);
  assert.equal(g.shareRate, 0.25);
  assert.equal(g.likeRate, 0.5);
  assert.equal(g.saveRate, 0.25);
});

test('score is bounded to 1..99', () => {
  state.platform = 'instagram_reels';
  const wave = Array(7).fill(persona(100, 'share', 'like', 'save'));
  const perfect = [wave, wave, wave];               // all three waves reached
  const dead = [Array(7).fill(persona(0))];
  assert.equal(computeViralityScore(perfect, { overall_signal_strength: 100 }), 99);
  assert.equal(computeViralityScore(dead, { overall_signal_strength: 0 }), 1);
});

test('score matches the documented formula for one wave', () => {
  state.platform = 'tiktok';
  const wave = [persona(70, 'share'), persona(50, 'like'), persona(30), persona(90, 'share', 'save')];
  // avgWatch 60, share 0.5, like 0.25, save 0.25 (TikTok weights .45/.30/.15/.10)
  const waveScore = 0.60 * 45 + Math.min(1.5, 1) * 30 + Math.min(0.5, 1) * 15 + Math.min(0.5, 1) * 10;
  const expected = Math.round(waveScore * 0.4 * 0.7 + 0.65 * 30);
  assert.equal(computeViralityScore([wave], { overall_signal_strength: 65 }), expected);
});

test('a video blocked at gate 1 is capped well below one that reaches every wave', () => {
  state.platform = 'instagram_reels';
  const wave = Array(7).fill(persona(100, 'share', 'like', 'save'));
  // Wave weights are 0.40 / 0.35 / 0.25, so stopping early caps the score.
  assert.equal(computeViralityScore([wave], { overall_signal_strength: 100 }), 58);
  assert.equal(computeViralityScore([wave, wave], { overall_signal_strength: 100 }), 83);
});

test('more sharing never lowers the score', () => {
  state.platform = 'youtube_shorts';
  const base = [Array(5).fill(persona(60))];
  const shared = [[persona(60, 'share'), ...Array(4).fill(persona(60))]];
  assert.ok(computeViralityScore(shared, {}) >= computeViralityScore(base, {}));
});
