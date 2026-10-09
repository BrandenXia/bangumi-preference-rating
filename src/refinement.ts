import { eligible } from './data.ts';
import type { Anchor, Data, Subject, SubjectType } from './data.ts';
import { estimate } from './model.ts';

export type PoolSubject = Subject & { rate: number | null };
export function refinementSubjects(data: Data, type: SubjectType): PoolSubject[] {
  return [...data.anchors, ...data.unrated.map(a => ({ ...a, rate: null }))].filter(a => a.type === type);
}

export function nextPoolPair(data: Data, type: SubjectType, goal = 3): [PoolSubject, Anchor] | null {
  const pool = refinementSubjects(data, type);
  if (!eligible(data.anchors, type)) return null;
  const evidence = new Map(pool.map(a => [a.id, estimate(data, a.id, type)]));
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
