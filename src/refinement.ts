import { eligible } from './data.ts';
import type { Anchor, Data, Subject, SubjectType, Estimate } from './data.ts';
import { estimateCategory, newComparison, recompute } from './model.ts';

export type PoolSubject = Subject & { rate: number | null };
export function refinementSubjects(data: Data, type: SubjectType): PoolSubject[] {
  return [...data.anchors, ...data.unrated.map(a => ({ ...a, rate: null }))].filter(a => a.type === type);
}

export function nextPoolPair(data: Data, type: SubjectType, goal = 3): [PoolSubject, Anchor] | null {
  const pool = refinementSubjects(data, type);
  if (!eligible(data.anchors, type)) return null;
  const evidence = estimateCategory(data, type);
  const attempts = new Map(pool.map(a => [a.id, 0]));
  const seen = new Map<string, number>();
  const pairKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  for (const c of data.comparisons.filter(c => c.subjectType === type)) {
    const key = pairKey(c.target, c.reference); seen.set(key, (seen.get(key) ?? 0) + 1);
    attempts.set(c.target, (attempts.get(c.target) ?? 0) + 1);
    attempts.set(c.reference, (attempts.get(c.reference) ?? 0) + 1);
  }
  // Visit every entry before dwelling on skipped or difficult ones.
  const targets = pool.filter(a => evidence.get(a.id)!.useful < goal).sort((a, b) =>
    attempts.get(a.id)! - attempts.get(b.id)! || evidence.get(a.id)!.useful - evidence.get(b.id)!.useful || a.id - b.id);
  for (const target of targets) {
    const reference = data.anchors.filter(a => a.type === type).filter(a => a.id !== target.id && (seen.get(pairKey(target.id, a.id)) ?? 0) < Math.ceil(goal / 3)).sort((a, b) =>
      Number(evidence.get(a.id)!.useful >= goal) - Number(evidence.get(b.id)!.useful >= goal) ||
      Math.abs(evidence.get(a.id)!.strength - evidence.get(target.id)!.strength) - Math.abs(evidence.get(b.id)!.strength - evidence.get(target.id)!.strength) ||
      attempts.get(a.id)! - attempts.get(b.id)! || a.id - b.id)[0];
    if (reference) return [target, reference];
  }
  return null;
}

// Continuous refinement has no collection-wide quota. Prefer close scores,
// discount well-observed pairs, and avoid the last 20 combinations on resume.
export function nextContinuousPair(data: Data, type: SubjectType): [PoolSubject, Anchor] | null {
  if (!eligible(data.anchors, type)) return null;
  const pool = refinementSubjects(data, type);
  const references = data.anchors.filter(a => a.type === type);
  const evidence = estimateCategory(data, type);
  const density = new Map(pool.map(a => [a.id, pool.filter(b => Math.abs(evidence.get(a.id)!.score - evidence.get(b.id)!.score) <= 0.75).length]));
  const key = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const history = data.comparisons.filter(c => c.subjectType === type);
  const counts = new Map<string, number>();
  for (const c of history) { const k = key(c.target, c.reference); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const recent = new Set(history.slice(-20).map(c => key(c.target, c.reference)));
  let best: [PoolSubject, Anchor] | null = null;
  let priority = -1;
  for (const target of pool) for (const reference of references) {
    if (target.id === reference.id || (target.rate !== null && target.id > reference.id)) continue;
    const k = key(target.id, reference.id); if (recent.has(k)) continue;
    const left = evidence.get(target.id)!; const right = evidence.get(reference.id)!;
    const gap = Math.abs(left.score - right.score);
    const cluster = 1 + Math.min(density.get(target.id)!, density.get(reference.id)!) / pool.length;
    const weight = cluster * Math.exp(-0.5 * (gap / 0.75) ** 2) / (1 + (counts.get(k) ?? 0));
    if (weight > priority) { priority = weight; best = [target, reference]; }
  }
  return best;
}

// An on-demand cell of the category's n×n probability matrix. Keep conflicting
// and cyclic choices as observations, never turn them into ordering constraints.
// Symmetric Dirichlet smoothing leaves unseen pairs uncertain. Skip is a fourth
// outcome here, but it contributes no preference evidence to score estimation.
export function pairProbabilities(data: Data, type: SubjectType, left: number, right: number): {
  target: number; reference: number; tie: number; skip: number; observed: number;
} {
  const counts = { target: 1, reference: 1, tie: 1, skip: 1 };
  let observed = 0;
  for (const c of data.comparisons) {
    if (c.subjectType !== type || !((c.target === left && c.reference === right) || (c.target === right && c.reference === left))) continue;
    const outcome = c.target === left ? c.outcome : c.outcome === 'target' ? 'reference' : c.outcome === 'reference' ? 'target' : c.outcome;
    counts[outcome]++; observed++;
  }
  const total = observed + 4;
  return { target: counts.target / total, reference: counts.reference / total, tie: counts.tie / total, skip: counts.skip / total, observed };
}

export interface RatingChange { subject: PoolSubject; score: number; from: number | null; to: number }
export function ratingChanges(data: Data, type: SubjectType): RatingChange[] {
  if (!eligible(data.anchors, type)) return [];
  // Keep this review snapshot stable while a batch updates reference ratings.
  return refinementSubjects(data, type).flatMap(subject => {
    const record = data.records.find(r => r.subjectId === subject.id && r.subjectType === type);
    return record && record.useful >= 3 && record.recommended !== subject.rate
      ? [{ subject, score: record.score, from: subject.rate, to: record.recommended }] : [];
  });
}

export function rankedSubjects(data: Data, type: SubjectType, useManual = true): { subject: PoolSubject; result: Estimate | null; rank: number | null }[] {
  const ready = eligible(data.anchors, type);
  const estimates = estimateCategory(data, type);
  const rows = refinementSubjects(data, type).map(subject => {
    const result = estimates.get(subject.id)!;
    return { subject, result: ready && result.useful >= 3 ? result : null, rank: null as number | null };
  }).sort((a, b) => Number(b.result !== null) - Number(a.result !== null) ||
    (b.result?.score ?? 0) - (a.result?.score ?? 0) || a.subject.id - b.subject.id);
  let rank = 0;
  rows.forEach((row, i) => {
    if (!row.result) return;
    if (i === 0 || Math.abs(row.result.score - rows[i - 1].result!.score) > 1e-9) rank = i + 1;
    row.rank = rank;
  });
  const order = useManual ? data.manualOrders.find(order => order.subjectType === type)?.subjects : undefined;
  if (order) {
    const positions = new Map(order.map((id, i) => [id, i]));
    rows.sort((a, b) => (positions.get(a.subject.id) ?? Infinity) - (positions.get(b.subject.id) ?? Infinity));
    rows.forEach((row, i) => { row.rank = i + 1; });
  }
  return rows;
}


export function setManualOrder(data: Data, type: SubjectType, subjects: number[], before = rankedSubjects(data, type).map(row => row.subject.id)): void {
  const pool = refinementSubjects(data, type);
  const ids = new Set(pool.map(a => a.id));
  if (!eligible(data.anchors, type) || subjects.length !== ids.size || new Set(subjects).size !== ids.size || subjects.some(id => !ids.has(id)) || before.length !== ids.size || new Set(before).size !== ids.size || before.some(id => !ids.has(id))) {
    throw new Error('只能排列此类别全部已完成的公开收藏，请刷新后重试。');
  }
  const positions = new Map(subjects.map((id, i) => [id, i]));
  // Only crossed pairs express new preferences; unchanged relations add no evidence.
  // Keep old and contradictory choices instead of imposing ordering constraints.
  const additions = [];
  for (let i = 0; i < before.length; i++) for (let j = i + 1; j < before.length; j++) {
    if (positions.get(before[i])! > positions.get(before[j])!) additions.push(newComparison(before[j], before[i], 'target', type));
  }
  if (data.comparisons.length + additions.length > 100000) throw new Error('比较历史已达到上限，请减少本次调整的条目数量。');
  data.comparisons.push(...additions);
  data.manualOrders = [...data.manualOrders.filter(order => order.subjectType !== type), { subjectType: type, subjects: [...subjects] }];
  recompute(data);
}
