import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, eligible, parseBackup } from '../src/data.ts';
import { anchorStrength, calibrate, chooseReference, estimate, newComparison, recordEstimate, recompute } from '../src/model.ts';
import { getAnchors, loggedInUsername, subjectFromPage } from '../src/api.ts';

const anchors = (count: number) => Array.from({ length: count }, (_, i) => ({ id: i + 1, type: 2 as const, rate: 1 + i % 10, title: `Anime ${i}`, cover: '' }));

test('eligibility counts distinct numeric ratings, including the 49/50 boundary', () => {
  const navigation = (href: string | null) => ({ querySelector: () => href === null ? null : { getAttribute: () => href } }) as unknown as ParentNode;
  assert.equal(loggedInUsername(navigation('https://bgm.tv/user/123')), '123');
  assert.equal(loggedInUsername(navigation('/user/example')), 'example');
  assert.equal(loggedInUsername(navigation('https://example.com/user/123')), null);
  assert.equal(loggedInUsername(navigation(null)), null);
  const page = { querySelector: (selector: string) => selector === 'h1.nameSingle a'
    ? { getAttribute: () => '游戏标题', textContent: 'Game' }
    : selector === '#navMenuNeue a.focus' ? { getAttribute: () => '/game' } : null } as unknown as ParentNode;
  assert.equal(subjectFromPage(1, page)?.type, 4);
  assert.equal(eligible(anchors(49), 2), false);
  assert.equal(eligible([...anchors(49), anchors(1)[0], { ...anchors(1)[0], id: 100, rate: 0 }], 2), false);
  assert.equal(eligible(anchors(50), 2), true);
  const mixed = [...anchors(25), ...anchors(25).map(a => ({ ...a, id: a.id + 50, type: 4 as const }))];
  assert.equal(eligible(mixed, 2), false);
  assert.equal(eligible(mixed, 4), false);
});

test('both models respond to evidence; skips, ties, calibration and selection stay sane', () => {
  for (const model of ['bt', 'elo'] as const) {
    const data = emptyData(1); data.anchors = anchors(50); data.config.model = model;
    const baseline = estimate(data, 100, 2).score;
    data.comparisons = [newComparison(100, 25, 'skip', 2)];
    assert.equal(estimate(data, 100, 2).score, baseline);
    data.comparisons = anchors(8).map(a => newComparison(100, a.id, 'target', 2));
    const win = estimate(data, 100, 2);
    data.comparisons = data.comparisons.map(c => ({ ...c, outcome: 'reference' }));
    assert.ok(win.score > estimate(data, 100, 2).score);
    data.comparisons = [newComparison(100, 25, 'tie', 2)];
    const tie = estimate(data, 100, 2);
    assert.ok(Number.isFinite(tie.score) && tie.score >= 1 && tie.score <= 10);
    assert.equal(tie.useful, 1);
    assert.ok(tie.recommended >= 1 && tie.recommended <= 10);
  }
  const scores = Array.from({ length: 10 }, (_, i) => calibrate(anchorStrength(i + 1)).score);
  assert.ok(scores.every((score, i) => i === 0 || score > scores[i - 1]));
  assert.equal(chooseReference(anchors(50), 25, 0, new Set([26]))?.id === 25, false);
  assert.equal(chooseReference(anchors(50), 100, 0, new Set(anchors(50).map(a => a.id))), undefined);
  const isolated = emptyData(1); isolated.anchors = anchors(50);
  const score = estimate(isolated, 100, 2).score;
  isolated.anchors.push(...anchors(50).map(a => ({ ...a, id: a.id + 200, type: 4 as const, rate: 10 })));
  isolated.comparisons.push(newComparison(100, 201, 'target', 4));
  assert.equal(estimate(isolated, 100, 2).score, score);
});

test('backups isolate accounts, reject damaged values, and preserve raw history on model changes', () => {
  const data = emptyData(1); data.anchors = anchors(50);
  data.comparisons = [newComparison(100, 25, 'target', 2)]; recordEstimate(data, 100, 2);
  const backup = JSON.parse(JSON.stringify(data));
  assert.deepEqual(parseBackup(backup, 1), data);
  assert.throws(() => parseBackup(backup, 2));
  assert.throws(() => parseBackup({ ...backup, comparisons: [{ ...backup.comparisons[0], target: 25 }] }, 1));
  assert.throws(() => parseBackup({ ...backup, records: [{ ...backup.records[0], score: null }] }, 1));
  assert.throws(() => parseBackup({ ...backup, comparisons: [{ ...backup.comparisons[0], subjectType: 4 }] }, 1));
  const old = { ...backup, version: 1, anchors: backup.anchors.map(({ type, ...a }) => a),
    comparisons: backup.comparisons.map(({ subjectType, ...c }) => c),
    records: backup.records.map(({ subjectType, ...r }) => r) };
  assert.deepEqual(parseBackup(old, 1), data);
  data.config.model = 'elo'; recompute(data);
  assert.deepEqual(data.comparisons, backup.comparisons);
  assert.equal(data.records[0].originalRating, backup.records[0].originalRating);
});

test('public collection pagination filters types, removes zero ratings and deduplicates', async () => {
  const originalFetch = globalThis.fetch;
  const pages: number[] = [];
  globalThis.fetch = async (url) => {
    const offset = Number(new URL(String(url)).searchParams.get('offset')); pages.push(offset);
    const rows = offset === 0 ? anchors(50).map(a => ({ subject_id: a.id, subject_type: 2, rate: a.rate }))
      : [{ subject_id: 1, subject_type: 2, rate: 0 }, { subject_id: 99, subject_type: 5, rate: 8 }, { subject_id: 51, subject_type: 2, rate: 10 }];
    return new Response(JSON.stringify({ total: 53, data: rows }));
  };
  try {
    const result = await getAnchors('test');
    assert.deepEqual(pages, [0, 50]);
    assert.equal(result.length, 50);
    assert.equal(result.some(a => a.id === 1 || a.id === 99), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('category refinement covers both sides, resumes without repeated pairs, and reviews only supported integer changes', async () => {
  const { nextPoolPair, ratingChanges } = await import('../src/refinement.ts');
  const data = emptyData(1); data.anchors = anchors(50);
  const visited = new Set<number>(); const pairs = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const pair = nextPoolPair(data, 2);
    if (!pair) break;
    const key = pair.map(a => a.id).sort((a, b) => a - b).join(':');
    assert.equal(pairs.has(key), false); pairs.add(key);
    visited.add(pair[0].id); visited.add(pair[1].id);
    data.comparisons.push(newComparison(pair[0].id, pair[1].id, i === 0 ? 'skip' : 'target', 2));
    for (const subject of pair) recordEstimate(data, subject.id, 2);
  }
  assert.equal(visited.size, 50);
  assert.ok(data.anchors.every(a => estimate(data, a.id, 2).useful >= 3));
  assert.equal(nextPoolPair(data, 2), null);
  assert.equal(nextPoolPair(data, 4), null);
  const changes = ratingChanges(data, 2);
  assert.ok(changes.length > 0);
  assert.ok(changes.every(c => c.to !== c.from && c.to === Math.round(c.score)));
  const change = changes[0];
  data.anchors.find(a => a.id === change.subject.id)!.rate = change.to;
  assert.equal(ratingChanges(data, 2).some(c => c.subject.id === change.subject.id), false);
  const bilateral = emptyData(1); bilateral.anchors = anchors(50).map(a => ({ ...a, rate: 6 }));
  const original = estimate(bilateral, 1, 2).score;
  bilateral.comparisons.push(newComparison(1, 2, 'target', 2));
  assert.ok(estimate(bilateral, 1, 2).score > original);
  assert.ok(estimate(bilateral, 2, 2).score < original);
  assert.equal(ratingChanges(bilateral, 2).length, 0);
});

test('pair probabilities preserve contradictions, ties, skips and cyclic preferences', async () => {
  const { pairProbabilities, nextPoolPair } = await import('../src/refinement.ts');
  const data = emptyData(1); data.anchors = anchors(50);
  data.comparisons = [newComparison(1, 2, 'target', 2), newComparison(2, 3, 'target', 2), newComparison(3, 1, 'target', 2),
    newComparison(1, 2, 'reference', 2), newComparison(2, 1, 'tie', 2), newComparison(1, 2, 'skip', 2)];
  const cell = pairProbabilities(data, 2, 1, 2);
  assert.equal(cell.observed, 4);
  assert.equal(cell.target + cell.reference + cell.tie + cell.skip, 1);
  assert.equal(cell.target, cell.reference);
  const reverse = pairProbabilities(data, 2, 2, 1);
  assert.equal(reverse.target, cell.reference); assert.equal(reverse.reference, cell.target);
  assert.equal(pairProbabilities(data, 4, 1, 2).observed, 0);
  assert.ok(pairProbabilities(data, 2, 2, 3).target > pairProbabilities(data, 2, 2, 3).reference);
  assert.ok(pairProbabilities(data, 2, 3, 1).target > pairProbabilities(data, 2, 3, 1).reference);
  assert.equal(estimate(data, 1, 2).useful, 4);
  // A later refinement round can reconsider previously observed pairs.
  const full = emptyData(1); full.anchors = anchors(50);
  for (let a = 1; a <= 50; a++) for (let b = a + 1; b <= 50; b++) full.comparisons.push(newComparison(a, b, 'skip', 2));
  assert.equal(nextPoolPair(full, 2, 3), null);
  assert.ok(nextPoolPair(full, 2, 6));
});
