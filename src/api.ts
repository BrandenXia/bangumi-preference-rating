import { safeCover, validId, validRate, validType } from './data.ts';
import type { Subject, Anchor } from './data.ts';

async function get(path: string): Promise<any> {
  const response = await fetch(`https://api.bgm.tv/v0${path}`, {
    credentials: 'omit', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(response.status === 429 ? '请求过于频繁，请稍后重试。' : `公开 API 请求失败（${response.status}）。原有数据未被替换。`);
  return response.json();
}

export function loggedInUsername(root: ParentNode = document): string | null {
  // Only authenticated navigation, never arbitrary profile/comment links.
  const link = root.querySelector<HTMLAnchorElement>('#dock a[href*="/user/"], #headerNeue2 .idBadgerNeue a[href*="/user/"], #headerNeue2 .idBadger a.avatar[href*="/user/"]');
  const href = link?.getAttribute('href');
  if (!href) return null;
  try {
    const url = new URL(href, 'https://bgm.tv');
    if (!['bgm.tv', 'bangumi.tv', 'chii.in'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/user\/([^/?#]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}

export async function getUser(username: string): Promise<{ id: number; username: string }> {
  const user = await get(`/users/${encodeURIComponent(username)}`);
  if (!validId(user.id)) throw new Error('无法确认登录用户。');
  return { id: user.id, username };
}

export async function getSubject(id: number): Promise<Subject | null> {
  const subject = await get(`/subjects/${id}`);
  if (!validType(subject.type)) return null;
  return { id, type: subject.type, title: subject.name_cn || subject.name || `条目 #${id}`, cover: safeCover(subject.images?.common) };
}

export function subjectFromPage(id: number, root: ParentNode = document): Subject | null {
  const heading = root.querySelector('h1.nameSingle a');
  const category = root.querySelector('#navMenuNeue a.focus')?.getAttribute('href');
  if (!heading || !category) return null;
  const types: { [path: string]: Subject['type'] } = { '/book': 1, '/anime': 2, '/music': 3, '/game': 4, '/real': 6 };
  const type = types[new URL(category, 'https://bgm.tv').pathname];
  if (!type) return null;
  return { id, type, title: heading.getAttribute('title') || heading.textContent?.trim() || `条目 #${id}`,
    cover: safeCover(root.querySelector('#bangumiInfo img.cover')?.getAttribute('src')) };
}

export async function getCollections(username: string, progress: (n: number) => void = () => {}): Promise<{ anchors: Anchor[]; unrated: Subject[] }> {
  const byId = new Map<number, Anchor | Subject>();
  for (let offset = 0; offset < 100000; offset += 50) {
    const page = await get(`/users/${encodeURIComponent(username)}/collections?type=2&limit=50&offset=${offset}`);
    if (!Array.isArray(page.data) || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('公开收藏响应格式无效。');
    if (page.data.length === 0 && offset < page.total) throw new Error('收藏分页不完整，请重新刷新。');
    for (const row of page.data) {
      if (!validType(row.subject_type) || !validId(row.subject_id)) continue;
      // A later duplicate with rate=0 must also remove a stale earlier rating.
      byId.delete(row.subject_id);
      if (row.type === 2 && (validRate(row.rate) || row.rate === 0)) byId.set(row.subject_id, { id: row.subject_id, type: row.subject_type, ...(validRate(row.rate) ? { rate: row.rate } : {}),
        title: String(row.subject?.name_cn || row.subject?.name || `条目 #${row.subject_id}`),
        cover: safeCover(row.subject?.images?.common) });
    }
    progress(byId.size);
    if (offset + page.data.length >= page.total) return {
      anchors: [...byId.values()].filter((a): a is Anchor => 'rate' in a),
      unrated: [...byId.values()].filter(a => !('rate' in a)),
    };
  }
  throw new Error('收藏数量超出导入上限。');
}
