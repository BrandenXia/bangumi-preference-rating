import type { Anchor, Comparison, Data, Estimate, SubjectType } from './data.ts';

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x));
// Fixed, ordered cutpoints fix location and scale; ratings remain noisy ordinal observations.
const cutpoints = Array.from({ length: 9 }, (_, i) => (i - 4) * 0.8);
export function calibrate(strength: number): { score: number; probabilities: number[] } {
  const cdf = [0, ...cutpoints.map(t => sigmoid(t - strength)), 1];
  const probabilities = cdf.slice(1).map((p, i) => p - cdf[i]);
  return { probabilities, score: probabilities.reduce((sum, p, i) => sum + (i + 1) * p, 0) };
}

// Ordinal observation + weak centered Gaussian prior; no invented pairwise wins.
export function anchorStrength(rate: number): number {
  const low = rate === 1 ? -Infinity : cutpoints[rate - 2];
  const high = rate === 10 ? Infinity : cutpoints[rate - 1];
  let theta = (rate - 5.5) * 0.8;
  for (let n = 0; n < 30; n++) {
    const upper = sigmoid(high - theta), lower = sigmoid(low - theta);
    const gradient = 1 - upper - lower + theta / 16;
    const hessian = upper * (1 - upper) + lower * (1 - lower) + 1 / 16;
    const step = clamp(gradient / hessian, -1, 1);
    theta -= step;
    if (Math.abs(step) < 1e-7) break;
  }
  return theta;
}

export function estimate(data: Data, subjectId: number, type: SubjectType): Estimate {
  const anchors = new Map(data.anchors.filter(a => a.type === type).map(a => [a.id, anchorStrength(a.rate)]));
  const prior = anchors.get(subjectId) ?? (anchors.size ? [...anchors.values()].reduce((a, b) => a + b, 0) / anchors.size : 0);
  const observations = data.comparisons.filter(c => c.target === subjectId && c.subjectType === type && c.outcome !== 'skip' && anchors.has(c.reference));
  let theta = prior;
  let precision = data.config.shrinkage;
  if (data.config.model === 'elo') {
    for (const c of observations) {
      const outcome = c.outcome === 'target' ? 1 : c.outcome === 'reference' ? 0 : 0.5;
      theta += 0.6 / data.config.shrinkage * (outcome - sigmoid(theta - anchors.get(c.reference)!));
    }
  } else {
    for (let n = 0; n < 40; n++) {
      let gradient = data.config.shrinkage * (theta - prior);
      precision = data.config.shrinkage;
      for (const c of observations) {
        const difference = theta - anchors.get(c.reference)!;
        if (c.outcome === 'tie') {
          gradient += difference * 0.5; precision += 0.5; // Soft equality, not two wins.
        } else {
          const p = sigmoid(difference);
          gradient += p - (c.outcome === 'target' ? 1 : 0);
          precision += p * (1 - p);
        }
      }
      const step = clamp(gradient / precision, -1, 1);
      theta = clamp(theta - step, -12, 12);
      if (Math.abs(step) < 1e-7) break;
    }
  }
  const calibrated = calibrate(theta);
  // Conditional Laplace curvature with a noise floor, explicitly a sensitivity range.
  const spread = Math.sqrt(1 / precision + 0.5);
  return { strength: theta, ...calibrated, useful: observations.length,
    recommended: clamp(Math.round(calibrated.score), 1, 10),
    range: data.config.model === 'bt' ? [calibrate(theta - 1.96 * spread).score, calibrate(theta + 1.96 * spread).score] : null };
}

export function chooseReference(anchors: Anchor[], target: number, strength: number, seen: Set<number>): Anchor | undefined {
  // A cheap information proxy p(1-p); distinct references within each session.
  return anchors.filter(a => a.id !== target && !seen.has(a.id)).sort((a, b) =>
    Math.abs(anchorStrength(a.rate) - strength) - Math.abs(anchorStrength(b.rate) - strength) || a.id - b.id)[0];
}

export function recordEstimate(data: Data, subjectId: number, type: SubjectType): void {
  const previous = data.records.find(r => r.subjectId === subjectId);
  const current = data.anchors.find(a => a.id === subjectId)?.rate ?? null;
  const result = { ...estimate(data, subjectId, type), subjectId, subjectType: type,
    originalRating: previous ? previous.originalRating : current, currentRating: current,
    lastPublishedRating: previous?.lastPublishedRating ?? null,
    model: data.config.model, modelVersion: 1 as const, calibration: 'fixed-ordinal-v1' as const,
    updatedAt: new Date().toISOString() };
  data.records = [...data.records.filter(r => r.subjectId !== subjectId), result];
}

export function recompute(data: Data): void {
  const targets = new Map([...data.records.map(r => [r.subjectId, r.subjectType] as const), ...data.comparisons.map(c => [c.target, c.subjectType] as const)]);
  for (const [id, type] of targets) recordEstimate(data, id, type);
}

export function newComparison(target: number, reference: number, outcome: Comparison['outcome'], subjectType: SubjectType): Comparison {
  return { id: crypto.randomUUID(), target, reference, subjectType, outcome, at: new Date().toISOString() };
}
