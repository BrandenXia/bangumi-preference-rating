import { loggedInUsername } from './api.ts';
import { validId, validRate } from './data.ts';

const errorText = (status: number) => status === 429 ? '请求过于频繁，请稍后重试。' : `Bangumi 请求失败（${status}）。`;
async function page(path: string): Promise<Document> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(errorText(response.status));
  if (new URL(response.url || path, location.href).origin !== location.origin) throw new Error('登录状态已改变，请重新登录。');
  return new DOMParser().parseFromString(await response.text(), 'text/html');
}

export async function assertSession(username: string): Promise<void> {
  if (loggedInUsername() !== username || loggedInUsername(await page('/')) !== username) {
    throw new Error('登录用户已改变，请重新加载页面。');
  }
}

async function collectionForm(id: number): Promise<{ action: string; fields: FormData }> {
  const doc = await page(`/update/${id}`);
  const form = doc.querySelector<HTMLFormElement>('#collectBoxForm');
  if (!form) throw new Error('无法读取收藏表单，请确认仍已登录并刷新页面。');
  const action = new URL(form.getAttribute('action') ?? '', location.origin);
  if (action.origin !== location.origin || action.pathname !== `/subject/${id}/interest/update` || !action.searchParams.get('gh')) {
    throw new Error('收藏表单地址已变化，已停止更新。');
  }
  const fields = new FormData(form);
  if (!form.querySelector('[name="rating"]') || (Number(fields.get('rating')) !== 0 && !validRate(Number(fields.get('rating')))) || !['1', '2', '3', '4', '5'].includes(String(fields.get('interest')))) {
    throw new Error('收藏表单格式已变化，已停止更新。');
  }
  return { action: action.href, fields };
}

// Use the existing signed-in form and its CSRF token. Preserve every successful
// field, including status, privacy, tags, comment, and any progress controls.
export async function publishRating(username: string, id: number, expected: number | null, rating: number): Promise<void> {
  if (!validId(id) || (expected !== null && !validRate(expected)) || !validRate(rating)) throw new Error('评分参数无效。');
  await assertSession(username);
  const before = await collectionForm(id);
  const current = Number(before.fields.get('rating'));
  if (current === rating) return; // A previous timed-out attempt may have succeeded.
  if (current !== (expected ?? 0)) throw new Error(`当前评分已从 ${expected ?? '未评分'} 变为 ${current || '未评分'}，请刷新公开评分后重新检查。`);
  const fields = before.fields;
  fields.set('rating', String(rating)); fields.set('referer', 'ajax'); fields.set('update', '保存');
  const response = await fetch(before.action, { method: 'POST', credentials: 'same-origin', body: fields,
    signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(errorText(response.status));
  const after = await collectionForm(id);
  if (Number(after.fields.get('rating')) !== rating) throw new Error('评分更新未得到确认，已停止；请刷新后检查。');
}
