import test from 'node:test';
import assert from 'node:assert/strict';
import { publishRating } from '../src/publish.ts';

test('recovery writes original low/10/unscored ratings through guarded native forms', async () => {
  const realFetch = globalThis.fetch;
  const realFormData = globalThis.FormData;
  const values = { rating: '8', interest: '2', tags: 'keep', comment: 'keep comment', privacy: '1', ep_status: '12' };
  let writes = 0, saves = true;
  const doc = {
    querySelector(selector: string) {
      if (selector.startsWith('#dock a')) return { getAttribute: () => '/user/owner' };
      if (selector === '#collectBoxForm') return {
        getAttribute: () => '/subject/1/interest/update?gh=fixture',
        querySelector: () => ({}), values: { ...values },
      };
      return null;
    },
  };
  // These minimal DOM shims exercise the real publisher with native form fields.
  class Parser { parseFromString() { return doc; } }
  class Fields extends realFormData {
    constructor(form: { values: typeof values }) { super(); for (const [key, value] of Object.entries(form.values)) this.set(key, value); }
  }
  const globals = ['document', 'location', 'DOMParser'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: doc },
    location: { configurable: true, value: { origin: 'https://bgm.tv', href: 'https://bgm.tv/user/owner' } },
    DOMParser: { configurable: true, value: Parser },
  });
  globalThis.FormData = Fields as unknown as typeof FormData;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      const fields = init.body as FormData;
      for (const key of ['interest', 'tags', 'comment', 'privacy', 'ep_status'] as const) assert.equal(fields.get(key), values[key]);
      if (saves) values.rating = String(fields.get('rating'));
      writes++;
    }
    return new Response('fixture');
  };
  try {
    await publishRating('owner', 1, 8, 1); assert.equal(values.rating, '1');
    await publishRating('owner', 1, 1, 10); assert.equal(values.rating, '10');
    await publishRating('owner', 1, 10, null); assert.equal(values.rating, '0');
    await publishRating('owner', 1, 10, null); assert.equal(writes, 3); // Retry after success.
    await assert.rejects(publishRating('owner', 1, 8, 6), /当前评分/); assert.equal(writes, 3);
    values.interest = '3'; await assert.rejects(publishRating('owner', 1, null, 6), /完成状态/); assert.equal(writes, 3);
    values.interest = '2'; saves = false;
    await assert.rejects(publishRating('owner', 1, null, 6), /未得到确认/);
  } finally {
    globalThis.fetch = realFetch; globalThis.FormData = realFormData;
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
