import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, eligible, parseBackup } from '../src/data.ts';
import { anchorStrength, calibrate, chooseReference, estimate, newComparison, recordEstimate, recompute, estimateCategory } from '../src/model.ts';
import { getCollections, loggedInUsername, subjectFromPage } from '../src/api.ts';

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
  const legacyScope = parseBackup({ ...backup, completedOnly: undefined }, 1);
  assert.equal(legacyScope.anchors.length, 0);
  assert.deepEqual(legacyScope.comparisons, data.comparisons);
  const old = { ...backup, version: 1, anchors: backup.anchors.map(({ type, ...a }) => a),
    comparisons: backup.comparisons.map(({ subjectType, ...c }) => c),
    records: backup.records.map(({ subjectType, ...r }) => r) };
  assert.deepEqual(parseBackup(old, 1), data);
  data.config.model = 'elo'; recompute(data);
  assert.deepEqual(data.comparisons, backup.comparisons);
  assert.equal(data.records.find(r => r.subjectId === 100)!.originalRating, backup.records.find(r => r.subjectId === 100)!.originalRating);
});

test('public collection pagination filters types, keeps unscored subjects separate from anchors and deduplicates', async () => {
  const originalFetch = globalThis.fetch;
  const pages: number[] = [];
  globalThis.fetch = async (url) => {
    assert.equal(new URL(String(url)).searchParams.get('type'), '2');
    const offset = Number(new URL(String(url)).searchParams.get('offset')); pages.push(offset);
    const rows = offset === 0 ? anchors(50).map(a => ({ subject_id: a.id, subject_type: 2, type: 2, rate: a.rate }))
      : [{ subject_id: 1, subject_type: 2, type: 2, rate: 0 }, { subject_id: 99, subject_type: 5, type: 2, rate: 8 }, { subject_id: 51, subject_type: 2, type: 2, rate: 10 }, ...[1,3,4,5].map(type => ({ subject_id: 60+type, subject_type: 2, type, rate: type === 1 ? 0 : 8 }))];
    return new Response(JSON.stringify({ total: 57, data: rows }));
  };
  try {
    const result = await getCollections('test');
    assert.deepEqual(pages, [0, 50]);
    assert.equal(result.anchors.length, 50);
    assert.equal(result.unrated.length, 1);
    assert.equal(result.unrated[0].id, 1);
    assert.equal(result.anchors.some(a => a.id === 1 || a.id === 99 || a.id > 60), false);
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

test('unscored collections receive first-score suggestions without becoming zero-rated anchors', async () => {
  const { nextPoolPair, ratingChanges } = await import('../src/refinement.ts');
  for (const model of ['bt', 'elo'] as const) {
    const data = emptyData(1); data.config.model = model; data.anchors = anchors(49);
    data.unrated = [{ id: 101, type: 2, title: 'Unscored', cover: '' }];
    assert.equal(nextPoolPair(data, 2), null);
    data.anchors = anchors(50);
    for (let i = 0; i < 300; i++) {
      const pair = nextPoolPair(data, 2); if (!pair) break;
      assert.ok(data.anchors.some(a => a.id === pair[1].id));
      data.comparisons.push(newComparison(pair[0].id, pair[1].id, 'tie', 2));
      pair.forEach(a => recordEstimate(data, a.id, 2));
    }
    const change = ratingChanges(data, 2).find(c => c.subject.id === 101)!;
    assert.ok(change); assert.equal(change.from, null);
    assert.ok(change.to >= 1 && change.to <= 10);
    assert.equal(data.records.find(r => r.subjectId === 101)!.originalRating, null);
    assert.equal(data.anchors.length, 50);
    assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(data)), 1), data);
    assert.throws(() => parseBackup({ ...data, unrated: [data.anchors[0]] }, 1));
    const legacy = { ...data, unrated: undefined };
    assert.deepEqual(parseBackup(legacy, 1).unrated, []);
  }
});

test('category rankings sort refined scores, preserve ties and show imported baselines immediately; spread widens scores', async () => {
  const { rankedSubjects } = await import('../src/refinement.ts');
  for (const model of ['bt', 'elo'] as const) {
    const data = emptyData(1); data.config.model = model;
    data.anchors = anchors(50).map(a => ({ ...a, rate: 7 }));
    data.unrated = [{ id: 101, type: 2, title: 'Pending', cover: '' }];
    for (const id of [1,2,3,4]) for (const reference of [11,12,13]) {
      data.comparisons.push(newComparison(id, reference, id === 1 ? 'target' : id === 2 ? 'reference' : 'tie', 2));
    }
    const history = structuredClone(data.comparisons);
    data.config.spread = 1;
    const narrow = estimate(data, 1, 2).score - estimate(data, 2, 2).score;
    const oldOrder = rankedSubjects(data, 2).filter(r => r.result).map(r => r.subject.id);
    data.config.spread = 3; recompute(data);
    const rows = rankedSubjects(data, 2); const supported = rows.filter(r => r.result);
    assert.ok(estimate(data, 1, 2).score - estimate(data, 2, 2).score > narrow * 1.8);
    assert.deepEqual(supported.map(r => r.subject.id), oldOrder);
    assert.equal(rows.find(r => r.subject.id === 3)!.rank, rows.find(r => r.subject.id === 4)!.rank);
    assert.equal(rows.find(r => r.subject.id === 101)!.rank, null);
    assert.equal(rows.find(r => r.subject.id === 50)!.result!.score, 7);
    assert.equal(rankedSubjects(data, 4).length, 0);
    assert.deepEqual(data.comparisons, history);
    for (const row of supported) {
      const r = row.result!;
      assert.ok(r.score >= 1 && r.score <= 10);
      assert.ok(Math.abs(r.probabilities.reduce((s, p, i) => s + p * (i + 1), 0) - r.score) < 1e-9);
      if (r.range) assert.ok(r.range[0] <= r.score && r.range[1] >= r.score);
    }
    assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(data)), 1), data);
    assert.equal(parseBackup({ ...data, config: { model, shrinkage: 1 } }, 1).config.spread, 2);
    assert.throws(() => parseBackup({ ...data, config: { ...data.config, spread: 99 } }, 1));
  }
});

test('continuous refinement prefers clustered scores, resumes and revisits without a whole-pool quota', async () => {
  const { nextContinuousPair } = await import('../src/refinement.ts');
  const data = emptyData(1); data.anchors = anchors(300);
  const pair = nextContinuousPair(data, 2)!;
  assert.ok(pair); assert.equal(pair[0].rate, pair[1].rate);
  const clustered = emptyData(1); clustered.anchors = anchors(50).map(a => ({ ...a, rate: a.id <= 2 ? 1 : 7 }));
  assert.equal(nextContinuousPair(clustered, 2)![0].rate, 7);
  const before = structuredClone(data);
  data.comparisons.push(newComparison(pair[0].id, pair[1].id, 'skip', 2));
  const resumed = nextContinuousPair(parseBackup(JSON.parse(JSON.stringify(data)), 1), 2)!;
  assert.notDeepEqual(resumed.map(a => a.id), pair.map(a => a.id));
  assert.equal(nextContinuousPair(data, 4), null);
  assert.equal(nextContinuousPair({ ...data, anchors: data.anchors.slice(0,49) }, 2), null);
  const tied = emptyData(1); tied.anchors = anchors(300).map(a => ({ ...a, rate: 7 }));
  for (let i = 0; i < 20; i++) {
    const p = nextContinuousPair(tied, 2)!;
    tied.comparisons.push(newComparison(p[0].id, p[1].id, 'tie', 2));
    p.forEach(a => recordEstimate(tied, a.id, 2));
  }
  assert.ok(tied.records.some(r => r.useful >= 3));
  assert.ok(tied.records.length < 300); // Useful suggestions can start before collection-wide coverage.
  assert.ok(nextContinuousPair(tied, 2));
  const completed = emptyData(1); completed.anchors = anchors(50);
  for (let a = 1; a <= 50; a++) for (let b = a + 1; b <= 50; b++) completed.comparisons.push(newComparison(a,b,'tie',2));
  assert.ok(nextContinuousPair(completed,2)); // Never requires increasing everyone's evidence quota.
  assert.deepEqual(before.comparisons, []);
});


test('category scale floors at 4, reserves about 1/40 for 9, never assigns 10 and preserves ties', () => {
  for (const model of ['bt', 'elo'] as const) {
    const data = emptyData(1); data.config.model = model;
    data.anchors = anchors(300).map(a => ({ ...a, rate: 7 }));
    // Distinct noisy preferences across a dense prior cluster, without inventing an order constraint.
    data.comparisons = data.anchors.flatMap((a, i) => Array.from({ length: i % 150 }, () =>
      newComparison(a.id, a.id <= 150 ? 300 : 1, a.id <= 150 ? 'target' : 'reference', 2)));
    for (const spread of [1, 1.5, 2, 3] as const) {
      data.config.spread = spread;
      const scores = [...estimateCategory(data, 2).values()];
      assert.ok(scores.every(r => r.score >= 4 && r.score <= 9 && r.recommended >= 4));
      assert.ok(scores.filter(r => r.recommended === 9).length >= 6);
      assert.ok(scores.filter(r => r.recommended === 9).length <= 9);
      assert.equal(scores.filter(r => r.recommended === 10).length, 0);
      assert.ok(scores.every(r => r.probabilities.slice(0, 3).every(p => p === 0)));
    }
    data.comparisons = []; data.anchors.forEach(a => { a.rate = 10; });
    assert.ok([...estimateCategory(data, 2).values()].every(r => r.score === 10));
    // A large tied top block remains tied; it is not arbitrarily awarded scarce 9s.
    data.anchors.slice(0, 30).forEach(a => { a.rate = 1; });
    const tiedTop = [...estimateCategory(data, 2).values()].slice(30);
    assert.equal(new Set(tiedTop.map(r => r.score)).size, 1);
    assert.ok(tiedTop.every(r => r.recommended === 10));
  }
});

test('manual display order persists while both models keep learning from moves and comparisons', async () => {
  const { setManualOrder, rankedSubjects, ratingChanges } = await import('../src/refinement.ts');
  for (const model of ['bt', 'elo'] as const) {
    const data = emptyData(1); data.config.model = model; data.anchors = anchors(50).map(a => ({ ...a, rate: 7 }));
    data.unrated = [{ id: 999, type: 2, title: 'Completed unscored', cover: '' }];
    data.anchors.push(...anchors(50).map(a => ({ ...a, id: a.id + 1000, type: 4 as const })));
    const ids = [999, ...anchors(50).map(a => a.id)];
    const history = newComparison(1, 2, 'tie', 2); data.comparisons.push(history);
    const baseline = rankedSubjects(data, 2).map(r => r.subject.id);
    setManualOrder(data, 2, ids, baseline);
    assert.deepEqual(rankedSubjects(data, 2).map(r => r.subject.id), ids);
    assert.equal(data.comparisons.length, 51); // Only moving 999 across 50 rated entries.
    assert.deepEqual(data.comparisons[0], history);
    assert.equal(estimate(data, 999, 2).useful, 50);
    assert.ok(ratingChanges(data, 2).some(r => r.subject.id === 999 && r.from === null));
    assert.equal(ratingChanges(data, 4).length, 0);
    assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(data)), 1), data);
    const previous = estimate(data, 1, 2);
    data.comparisons.push(...Array.from({ length: 10 }, () => newComparison(1, 50, 'target', 2))); recompute(data);
    const updated = estimate(data, 1, 2);
    assert.ok(updated.strength > previous.strength);
    assert.ok(updated.score > previous.score);
    assert.equal(updated.useful, previous.useful + 10);
    assert.deepEqual(rankedSubjects(data, 2).map(r => r.subject.id), ids);
    const modelRows = rankedSubjects(data, 2, false);
    assert.ok(modelRows.filter(r => r.result).every((row, i, rows) => i === 0 || rows[i-1].result!.score >= row.result!.score));
    assert.equal(modelRows.length, ids.length);
    assert.deepEqual(data.manualOrders[0].subjects, ids); // Viewing the model never erases the order.
    assert.equal(updated.range !== null, model === 'bt');
    const count = data.comparisons.length; setManualOrder(data, 2, ids);
    assert.equal(data.comparisons.length, count); // Re-saving unchanged order adds no evidence.
    assert.throws(() => setManualOrder(data, 2, ids.slice(1)));
    assert.throws(() => setManualOrder(data, 2, [1001, ...ids.slice(1)]));
    assert.throws(() => setManualOrder(data, 2, [ids[1], ...ids.slice(1)]));
    assert.throws(() => parseBackup({ ...data, manualOrders: [{ subjectType: 4, subjects: ids }] }, 1));
    assert.throws(() => parseBackup({ ...data, manualOrders: [{ subjectType: 2, subjects: [1,1] }] }, 1));
    assert.deepEqual(parseBackup({ ...data, manualOrders: undefined }, 1).manualOrders, []);
    assert.ok(data.records.every(r => !r.manual));
  }
});


test('imported ratings initialize exact scores and gradually refine only subjects with evidence', async () => {
  const { rankedSubjects, ratingChanges } = await import('../src/refinement.ts');
  for (const model of ['bt', 'elo'] as const) for (const spread of [1, 1.5, 2, 3] as const) {
    const data = emptyData(1); data.config.model = model; data.config.spread = spread; data.anchors = anchors(50);
    const original = structuredClone(data.anchors); recompute(data);
    assert.ok(data.anchors.every(a => estimate(data, a.id, 2).score === a.rate));
    assert.ok(data.records.every(r => r.score === r.currentRating && r.recommended === r.currentRating && r.useful === 0));
    assert.equal(ratingChanges(data, 2).length, 0);
    assert.equal(rankedSubjects(data, 2).filter(r => r.result).length, 50);
    data.comparisons.push(newComparison(5, 6, 'skip', 2)); recompute(data);
    assert.ok(data.records.every(r => r.score === r.currentRating));
    data.comparisons.push(newComparison(5, 6, 'target', 2)); recompute(data);
    assert.ok(estimate(data, 5, 2).score > 5 && estimate(data, 5, 2).score < 5.5);
    assert.ok(data.anchors.filter(a => a.id !== 5 && a.id !== 6).every(a => estimate(data, a.id, 2).score === a.rate));
    assert.equal(ratingChanges(data, 2).length, 0);
    assert.deepEqual(data.anchors, original);
    assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(data)), 1), data);
    data.comparisons.pop(); recompute(data);
    assert.equal(estimate(data, 5, 2).score, 5);
    const small = emptyData(1); small.anchors = anchors(10); recompute(small);
    assert.equal(rankedSubjects(small, 2).filter(r => r.result).length, 10);
  }
});
