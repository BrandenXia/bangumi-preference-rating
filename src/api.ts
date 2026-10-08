import { safeCover, validId, validRate } from './data.ts';
import type { Anime, Anchor } from './data.ts';

async function get(path: string): Promise<any> {
  const response = await fetch(`https://api.bgm.tv/v0${path}`, {
    credentials: 'omit', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(response.status === 429 ? '请求过于频繁，请稍后重试。' : `公开 API 请求失败（${response.status}）。原有数据未被替换。`);
  return response.json();
}

export function loggedInUsername(root: ParentNode = document): string | null {
  // Only authenticated navigation, never arbitrary profile/comment links.
  const link = root.querySelector<HTMLAnchorElement>('#dock a[href^="/user/"], #headerNeue2 .idBadger a.avatar[href^="/user/"], #headerNeue2 .idBadger a[href^="/user/"]');
  const match = link?.getAttribute('href')?.match(/^\/user\/([^/?#]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function getUser(username: string): Promise<{ id: number; username: string }> {
  const user = await get(`/users/${encodeURIComponent(username)}`);
  if (!validId(user.id)) throw new Error('无法确认登录用户。');
  return { id: user.id, username };
}

export async function getAnime(id: number): Promise<Anime | null> {
  const subject = await get(`/subjects/${id}`);
  if (subject.type !== 2) return null;
  return { id, title: subject.name_cn || subject.name || `动画 #${id}`, cover: safeCover(subject.images?.common) };
}

export async function getAnchors(username: string, progress: (n: number) => void = () => {}): Promise<Anchor[]> {
  const byId = new Map<number, Anchor>();
  for (let offset = 0; offset < 100000; offset += 50) {
    const page = await get(`/users/${encodeURIComponent(username)}/collections?subject_type=2&limit=50&offset=${offset}`);
    if (!Array.isArray(page.data) || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('公开收藏响应格式无效。');
    if (page.data.length === 0 && offset < page.total) throw new Error('收藏分页不完整，请重新刷新。');
    for (const row of page.data) {
      if (row.subject_type !== 2 || !validId(row.subject_id)) continue;
      // A later duplicate with rate=0 must also remove a stale earlier rating.
      byId.delete(row.subject_id);
      if (validRate(row.rate)) byId.set(row.subject_id, { id: row.subject_id, rate: row.rate,
        title: String(row.subject?.name_cn || row.subject?.name || `动画 #${row.subject_id}`),
        cover: safeCover(row.subject?.images?.common) });
    }
    progress(byId.size);
    if (offset + page.data.length >= page.total) return [...byId.values()];
  }
  throw new Error('收藏数量超出导入上限。');
}
