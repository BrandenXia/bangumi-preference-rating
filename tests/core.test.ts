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
