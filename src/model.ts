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

function latentEstimate(data: Data, subjectId: number, type: SubjectType, anchors: Map<number, number>, center: number): Pick<Estimate, 'strength' | 'useful' | 'range'> {
  const prior = anchors.get(subjectId) ?? center;
  // A choice refines both rated entries; store the event once and reverse its outcome
  // when this entry appeared on the right. Unrated references remain unusable priors.
  const observations = data.comparisons.filter(c => c.subjectType === type && c.outcome !== 'skip').flatMap(c => {
    if (c.target === subjectId && anchors.has(c.reference)) return [c];
    if (c.reference === subjectId && anchors.has(c.target)) return [{ ...c, reference: c.target,
      outcome: c.outcome === 'target' ? 'reference' as const : c.outcome === 'reference' ? 'target' as const : c.outcome }];
    return [];
  });
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
  // Conditional curvature with a noise floor, expressed on the latent scale.
  const spread = Math.sqrt(1 / precision + 0.5);
  return { strength: theta, useful: observations.length,
    range: data.config.model === 'bt' ? [theta - 1.96 * spread, theta + 1.96 * spread] : null };
}

// A category-relative suggestion scale: 9 starts at the top 2.5%.
// Automatic suggestions stop at 9; only the user can choose 10 on Bangumi.
// Spread changes the middle of the scale, never these rare-score thresholds.
export function scoreAtPercentile(percentile: number, spread: Data['config']['spread']): number {
  const knots = [[0, 4], [0.1, 6 - spread / 2], [0.5, 6], [0.9, 6 + spread / 2], [0.975, 8.5], [1, 9]];
  const p = clamp(percentile, 0, 1);
  for (let i = 1; i < knots.length; i++) {
    const [right, high] = knots[i], [left, low] = knots[i - 1];
    if (p <= right) return low + (high - low) * (p - left) / (right - left);
  }
  return 9;
}

export function estimateCategory(data: Data, type: SubjectType, extraIds: number[] = []): Map<number, Estimate> {
  const anchors = new Map(data.anchors.filter(a => a.type === type).map(a => [a.id, anchorStrength(a.rate)]));
  const center = anchors.size ? [...anchors.values()].reduce((a, b) => a + b, 0) / anchors.size : 0;
  const pool = [...anchors.keys(), ...data.unrated.filter(a => a.type === type).map(a => a.id)];
  const raw = new Map([...new Set([...pool, ...extraIds])].map(id => [id, latentEstimate(data, id, type, anchors, center)]));
  const strengths = pool.map(id => raw.get(id)!.strength).sort((a, b) => a - b);
  const points: { strength: number; percentile: number }[] = [];
  for (let i = 0; i < strengths.length;) {
    let end = i + 1;
    while (end < strengths.length && Math.abs(strengths[end] - strengths[i]) < 1e-9) end++;
    // Ties share their midpoint percentile; no arbitrary splitting into 9s/10s.
    points.push({ strength: strengths[i], percentile: (i + end) / (2 * strengths.length) });
    i = end;
  }
  const percentile = (strength: number): number => {
    if (!points.length) return 0.5;
    for (let i = 0; i < points.length; i++) {
      const right = points[i];
      if (Math.abs(strength - right.strength) < 1e-9) return right.percentile;
      if (strength < right.strength) {
        if (i === 0) return 0;
        const left = points[i - 1];
        return left.percentile + (right.percentile - left.percentile) * (strength - left.strength) / (right.strength - left.strength);
      }
    }
    return 1;
  };
  const scoreFor = (strength: number) => scoreAtPercentile(percentile(strength), data.config.spread);
  return new Map([...raw].map(([id, result]) => {
    const score = scoreFor(result.strength);
    // Rounding weights for the displayed suggestion, not posterior confidence.
    const probabilities = Array(10).fill(0) as number[];
    const lower = Math.floor(score);
    probabilities[lower - 1] = 1 - (score - lower);
    if (lower < 10) probabilities[lower] = score - lower;
    return [id, { ...result, score, probabilities, recommended: Math.round(score),
      range: result.range ? [scoreFor(result.range[0]), scoreFor(result.range[1])] as [number, number] : null }];
  }));
}

export function estimate(data: Data, subjectId: number, type: SubjectType): Estimate {
  return estimateCategory(data, type, [subjectId]).get(subjectId)!;
}

export function chooseReference(anchors: Anchor[], target: number, strength: number, seen: Set<number>): Anchor | undefined {
  // A cheap information proxy p(1-p); distinct references within each session.
  return anchors.filter(a => a.id !== target && !seen.has(a.id)).sort((a, b) =>
    Math.abs(anchorStrength(a.rate) - strength) - Math.abs(anchorStrength(b.rate) - strength) || a.id - b.id)[0];
}

export function recordEstimate(data: Data, subjectId: number, type: SubjectType, estimated?: Estimate): void {
  const previous = data.records.find(r => r.subjectId === subjectId);
  const current = data.anchors.find(a => a.id === subjectId)?.rate ?? null;
  const result = { ...(estimated ?? estimate(data, subjectId, type)), subjectId, subjectType: type,
    originalRating: previous ? previous.originalRating : current, currentRating: current,
    lastPublishedRating: previous?.lastPublishedRating ?? null,
    model: data.config.model, modelVersion: 1 as const, calibration: 'category-tail-v3' as const,
    updatedAt: new Date().toISOString() };
  data.records = [...data.records.filter(r => r.subjectId !== subjectId), result];
}

export function recompute(data: Data): void {
  const targets = new Map([...data.records.map(r => [r.subjectId, r.subjectType] as const),
    ...data.comparisons.flatMap(c => [[c.target, c.subjectType] as const, [c.reference, c.subjectType] as const])]);
  for (const type of new Set(targets.values())) {
    const ids = [...targets].filter(([, category]) => category === type).map(([id]) => id);
    const estimates = estimateCategory(data, type, ids);
    for (const id of ids) recordEstimate(data, id, type, estimates.get(id));
  }
}

export function newComparison(target: number, reference: number, outcome: Comparison['outcome'], subjectType: SubjectType): Comparison {
  return { id: crypto.randomUUID(), target, reference, subjectType, outcome, at: new Date().toISOString() };
}
