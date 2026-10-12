import type { Data } from './data.ts';

// Ignore years, formats and studio names: only recognizable genre tags form lanes.
const genres: [string, string[]][] = [
  ['恋爱', ['恋爱', '爱情', '恋愛', 'romance']], ['战斗', ['战斗', '动作', '格斗', 'action']],
  ['日常', ['日常', 'slice of life']], ['喜剧', ['搞笑', '喜剧', 'comedy']],
  ['科幻', ['科幻', 'science fiction', 'sci-fi']], ['奇幻', ['奇幻', '魔幻', 'fantasy']],
  ['悬疑', ['悬疑', '推理', 'mystery']], ['恐怖', ['恐怖', '惊悚', 'horror']],
  ['运动', ['运动', '体育', 'sports']], ['音乐', ['音乐', '偶像', 'music']],
  ['百合', ['百合', 'yuri']], ['耽美', ['耽美', 'bl', 'boys love']],
  ['冒险', ['冒险', 'adventure']], ['历史', ['历史', 'historical']],
];
export function genreTags(tags: string[]): string[] {
  const normalized = new Set(tags.map(t => t.trim().toLowerCase()));
  return genres.filter(([, aliases]) => aliases.some(t => normalized.has(t))).map(([name]) => name);
}
export function adultTag(tags: string[]): boolean {
  return tags.some(t => ['里番', '裏番', '成人', 'r18', 'r-18', '18禁', 'hentai', 'nsfw'].includes(t.trim().toLowerCase()));
}
export function similarPair(data: Data, left: number, right: number): boolean {
  if (!data.config.similarGenres) return true;
  const a = data.lanes.find(l => l.subjectId === left), b = data.lanes.find(l => l.subjectId === right);
  // Unknown adult status is not a non-adult classification. Do not silently
  // cross the boundary or pair unclassified entries when filtering is enabled.
  if (!a || !b || a.adult === null || b.adult === null || a.adult !== b.adult) return false;
  return a.adult || a.tags.some(tag => b.tags.includes(tag));
}
export function laneLabel(data: Data, id: number): string {
  const lane = data.lanes.find(l => l.subjectId === id);
  return lane ? `${lane.adult === true ? '成人 · ' : lane.adult === null ? '成人属性未知 · ' : ''}${lane.tags.join(' / ') || '题材未识别'}` : '尚未读取题材';
}
