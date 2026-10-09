export type SubjectType = 1 | 2 | 3 | 4 | 6;
export const categoryName: { [type in SubjectType]: string } = { 1: '书籍', 2: '动画', 3: '音乐', 4: '游戏', 6: '三次元' };
export const validType = (n: unknown): n is SubjectType => [1, 2, 3, 4, 6].includes(Number(n)) && typeof n === 'number';
export interface Subject { id: number; type: SubjectType; title: string; cover: string }
export interface Anchor extends Subject { rate: number }
export type Outcome = 'target' | 'reference' | 'tie' | 'skip';
export type Model = 'bt' | 'elo';
export interface Comparison {
  id: string; target: number; reference: number; subjectType: SubjectType; outcome: Outcome; at: string;
}
export interface Estimate {
  strength: number; score: number; recommended: number; useful: number;
  range: [number, number] | null; probabilities: number[];
}
export interface Record extends Estimate {
  subjectId: number; subjectType: SubjectType; originalRating: number | null; currentRating: number | null;
  lastPublishedRating: number | null; model: Model; modelVersion: 1;
  calibration: 'fixed-ordinal-v1'; updatedAt: string;
}
export interface Data {
  version: 2; userId: number; revision: number; importedAt: string | null;
  anchors: Anchor[]; unrated: Subject[]; comparisons: Comparison[]; records: Record[];
  config: { model: Model; shrinkage: number };
}

export const validId = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0;
export const validRate = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 10;
export const eligible = (anchors: Anchor[], type: SubjectType) => new Set(anchors.filter(a => a.type === type && validId(a.id) && validRate(a.rate)).map(a => a.id)).size >= 50;
export const emptyData = (userId: number): Data => ({
  version: 2, userId, revision: 0, importedAt: null, anchors: [], unrated: [], comparisons: [], records: [],
  config: { model: 'bt', shrinkage: 1 },
});

export function safeCover(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value, 'https://bgm.tv');
    return url.protocol === 'https:' && (url.hostname === 'lain.bgm.tv' || url.hostname.endsWith('.bgm.tv')) ? url.href : '';
  } catch { return ''; }
}

// Construct fresh objects instead of merging untrusted JSON into live state.
export function parseBackup(value: unknown, userId: number): Data {
  const fail = () => { throw new Error('备份格式无效、版本不支持，或属于其他用户。'); };
  if (!value || typeof value !== 'object') return fail();
  const v = value as Partial<Data>;
  if ((v.version !== 2 && Number(v.version) !== 1) || v.userId !== userId || !Array.isArray(v.anchors) || !Array.isArray(v.comparisons) || !Array.isArray(v.records)) return fail();
  // Version 1 was anime-only. Keep existing local data and exported backups usable.
  if (Number(v.version) === 1) return parseBackup({ ...v, version: 2,
    anchors: v.anchors.map(a => ({ ...a, type: 2 })),
    comparisons: v.comparisons.map(c => ({ ...c, subjectType: 2 })),
    records: v.records.map(r => ({ ...r, subjectType: 2 })) }, userId);
  if (v.anchors.length > 100000 || v.comparisons.length > 100000 || v.records.length > 100000) return fail();
  const date = (s: unknown): s is string => typeof s === 'string' && s.length < 50 && Number.isFinite(Date.parse(s));
  if (v.importedAt !== null && !date(v.importedAt)) return fail();
  if (!v.config || !['bt', 'elo'].includes(v.config.model) || ![0.5, 1, 2].includes(v.config.shrinkage)) return fail();
  const out = emptyData(userId);
  out.importedAt = v.importedAt;
  out.config = { model: v.config.model, shrinkage: v.config.shrinkage };
  out.revision = Number.isSafeInteger(v.revision) && Number(v.revision) >= 0 ? v.revision! : 0;
  const ids = new Set<number>();
  out.anchors = v.anchors.map(a => {
    if (!a || !validId(a.id) || !validType(a.type) || !validRate(a.rate) || typeof a.title !== 'string' || a.title.length > 1000 || ids.has(a.id)) return fail();
    ids.add(a.id);
    return { id: a.id, type: a.type, rate: a.rate, title: a.title, cover: safeCover(a.cover) };
  });
  if (v.unrated !== undefined && (!Array.isArray(v.unrated) || v.unrated.length > 100000)) return fail();
  out.unrated = (v.unrated ?? []).map(a => {
    if (!a || !validId(a.id) || !validType(a.type) || typeof a.title !== 'string' || a.title.length > 1000 || ids.has(a.id)) return fail();
    ids.add(a.id);
    return { id: a.id, type: a.type, title: a.title, cover: safeCover(a.cover) };
  });
  const types = new Map([...out.anchors, ...out.unrated].map(a => [a.id, a.type]));
  const checkType = (id: number, type: SubjectType) => {
    if (types.has(id) && types.get(id) !== type) return fail();
    types.set(id, type);
  };
  const events = new Set<string>();
  out.comparisons = v.comparisons.map(c => {
    if (!c || typeof c.id !== 'string' || c.id.length > 100 || events.has(c.id) || !validId(c.target) || !validId(c.reference) || !validType(c.subjectType) || c.target === c.reference || !['target', 'reference', 'tie', 'skip'].includes(c.outcome) || !date(c.at)) return fail();
    checkType(c.target, c.subjectType); checkType(c.reference, c.subjectType);
    events.add(c.id);
    return { id: c.id, target: c.target, reference: c.reference, subjectType: c.subjectType, outcome: c.outcome, at: c.at };
  });
  ids.clear();
  out.records = v.records.map(r => {
    if (!r || !validId(r.subjectId) || !validType(r.subjectType) || ids.has(r.subjectId) || !date(r.updatedAt) || !['bt', 'elo'].includes(r.model) || r.modelVersion !== 1 || r.calibration !== 'fixed-ordinal-v1') return fail();
    checkType(r.subjectId, r.subjectType);
    if (![r.originalRating, r.currentRating, r.lastPublishedRating].every(n => n === null || validRate(n))) return fail();
    if (!Number.isFinite(r.score) || r.score < 1 || r.score > 10 || !Number.isFinite(r.strength) || Math.abs(r.strength) > 20 || !validRate(r.recommended) || !Number.isSafeInteger(r.useful) || r.useful < 0) return fail();
    if (r.range !== null && (!Array.isArray(r.range) || r.range.length !== 2 || !r.range.every(n => Number.isFinite(n) && n >= 1 && n <= 10) || r.range[0] > r.range[1])) return fail();
    if (!Array.isArray(r.probabilities) || r.probabilities.length !== 10 || !r.probabilities.every(n => Number.isFinite(n) && n >= 0 && n <= 1) || Math.abs(r.probabilities.reduce((a, b) => a + b, 0) - 1) > 0.00001) return fail();
    ids.add(r.subjectId);
    return { subjectId: r.subjectId, subjectType: r.subjectType, originalRating: r.originalRating, currentRating: r.currentRating,
      lastPublishedRating: r.lastPublishedRating, strength: r.strength, score: r.score,
      recommended: r.recommended, useful: r.useful, range: r.range ? [...r.range] as [number, number] : null,
      probabilities: [...r.probabilities], model: r.model, modelVersion: 1,
      calibration: 'fixed-ordinal-v1', updatedAt: r.updatedAt };
  });
  return out;
}
