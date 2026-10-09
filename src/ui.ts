import { categoryName, eligible, parseBackup } from './data.ts';
import type { Subject, Data, Model, Outcome } from './data.ts';
import { getAnchors, loggedInUsername } from './api.ts';
import { chooseReference, estimate, newComparison, recompute, recordEstimate } from './model.ts';
import { load, save } from './storage.ts';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}

export async function openPanel(user: { id: number; username: string }, subject: Subject | null, changed: () => void = () => {}, requestedModel?: Model): Promise<void> {
  if (document.querySelector('#bpr-dialog')) return;
  const opener = document.activeElement as HTMLElement | null;
  const dialog = el('dialog'); dialog.id = 'bpr-dialog';
  const header = el('header');
  const heading = el('h2', subject ? '偏好评分' : '偏好评分 · 设置');
  heading.id = 'bpr-heading'; dialog.setAttribute('aria-labelledby', heading.id);
  const close = el('button', '关闭', 'bpr-quiet'); close.type = 'button'; close.onclick = () => dialog.close();
  header.append(heading, close);
  const content = el('div', '正在读取本地数据…'); content.className = 'bpr-content';
  const status = el('p', '', 'bpr-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  dialog.append(header, content, status); document.body.append(dialog); dialog.showModal();
  dialog.addEventListener('close', () => { dialog.remove(); opener?.focus(); });
  let data: Data;
  let busy = false;
  let settings = !subject;
  let budget = 8;
  let currentReference: number | null = null;
  let seen = new Set<number>();
  let backupView: 'export' | 'import' | null = null;

  async function action(task: () => Promise<void>): Promise<void> {
    if (busy) return;
    const focused = document.activeElement;
    const focusLabel = focused instanceof HTMLButtonElement ? focused.textContent : null;
    busy = true; status.textContent = '处理中…';
    for (const control of dialog.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('button, select, input')) control.disabled = true;
    try {
      if (loggedInUsername() !== user.username) throw new Error('登录用户已改变，请重新加载页面。');
      await task(); status.textContent = '';
    } catch (error) { status.textContent = error instanceof Error ? error.message : '操作失败，请重试。'; }
    finally {
      busy = false; render();
      if (focusLabel) [...dialog.querySelectorAll('button')].find(b => !b.disabled && b.textContent === focusLabel)?.focus();
    }
  }

  async function update(next: Data): Promise<void> {
    if (!dialog.isConnected || loggedInUsername() !== user.username) throw new Error('窗口已关闭或登录用户已改变，操作已取消。');
    await save(next); data = next; changed();
  }

  const button = (label: string, task: () => Promise<void>, style = '') => {
    const b = el('button', label, style); b.type = 'button'; b.onclick = () => void action(task); return b;
  };

  // Keep confirmations inside the floating window, including browsers without native alerts.
  function confirmLocal(message: string): Promise<boolean> {
    return new Promise(resolve => {
      content.replaceChildren(el('p', message)); status.textContent = '';
      const cancel = el('button', '取消'); const accept = el('button', '确认', 'bpr-primary');
      const closed = () => resolve(false);
      dialog.addEventListener('close', closed, { once: true });
      const finish = (answer: boolean) => { dialog.removeEventListener('close', closed); resolve(answer); };
      cancel.onclick = () => finish(false); accept.onclick = () => finish(true);
      const actions = el('div', '', 'bpr-actions'); actions.append(cancel, accept); content.append(actions);
      close.disabled = false; cancel.focus();
    });
  }

  async function refresh(): Promise<void> {
    const anchors = await getAnchors(user.username, n => { status.textContent = `正在读取公开评分：${n} 个条目`; });
    const next = structuredClone(data); next.anchors = anchors; next.importedAt = new Date().toISOString();
    recompute(next); await update(next); currentReference = null;
  }

  async function restore(text: string): Promise<void> {
    if (text.length > 20 * 1024 * 1024) throw new Error('备份不能超过 20 MB。');
    const next = parseBackup(JSON.parse(text), user.id); recompute(next);
    if (!await confirmLocal(`用备份替换当前本地数据？备份包含 ${next.anchors.length} 个评分、${next.comparisons.length} 次比较。建议先导出当前数据。`)) return;
    next.revision = data.revision; await update(next); seen = new Set(); currentReference = null; backupView = null;
  }

  function renderBackup(): void {
    const exporting = backupView === 'export';
    content.append(el('p', exporting ? '复制下面的 JSON 作为备份，或下载文件。' : '粘贴备份 JSON，或选择备份文件。导入前会确认替换。'));
    const label = el('label', exporting ? '备份 JSON' : '待导入 JSON');
    const text = el('textarea'); text.rows = 8; text.spellcheck = false; text.readOnly = exporting;
    text.value = exporting ? JSON.stringify(data, null, 2) : ''; label.append(text); content.append(label);
    const tools = el('div', '', 'bpr-actions');
    if (exporting) {
      const select = el('button', '选中全部'); select.onclick = () => { text.focus(); text.select(); };
      tools.append(select, button('下载 JSON', async () => {
        const url = URL.createObjectURL(new Blob([text.value], { type: 'application/json' }));
        const link = el('a'); link.href = url; link.download = `bangumi-preferences-${user.id}.json`; link.hidden = true;
        dialog.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      }));
    } else {
      tools.append(button('导入粘贴内容', () => restore(text.value), 'bpr-primary'));
      const input = el('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
      input.onchange = () => void action(async () => {
        const file = input.files?.[0]; if (!file) return;
        if (file.size > 20 * 1024 * 1024) throw new Error('备份不能超过 20 MB。');
        await restore(await file.text());
      });
      const choose = el('button', '选择 JSON 文件'); choose.onclick = () => input.click(); tools.append(choose, input);
    }
    tools.append(button('返回设置', async () => { backupView = null; })); content.append(tools);
  }

  async function changeConfig(model: Model, shrinkage: number): Promise<void> {
    if (model === data.config.model && shrinkage === data.config.shrinkage) return;
    const next = structuredClone(data); next.config = { model, shrinkage }; recompute(next);
    const preview = subject ? next.records.find(r => r.subjectId === subject.id)?.score : undefined;
    if (!await confirmLocal(`重新计算 ${next.records.length} 个本地评分${preview === undefined ? '' : `，当前条目预览：${preview.toFixed(2)}`}？比较历史保留，Bangumi 评分不变。`)) return;
    await update(next); currentReference = null;
  }

  function renderSettings(): void {
    content.append(el('p', `用户 ${user.username} · ${data.anchors.length} 个公开评分`, 'bpr-muted'));
    content.append(el('p', Object.entries(categoryName).map(([type, label]) => `${label} ${data.anchors.filter(a => a.type === Number(type)).length}/50`).join(' · '), 'bpr-muted'));
    content.append(el('p', data.importedAt ? `最近刷新：${new Date(data.importedAt).toLocaleString()}。只包含公开收藏。` : '先导入公开评分，作为比较的参考。'));
    content.append(button('刷新公开评分', refresh, 'bpr-primary'));
    const modelLabel = el('label', '评分算法'); const model = el('select');
    for (const [value, title] of [['bt', 'Bradley–Terry（MAP 近似）'], ['elo', 'Elo（顺序更新）']]) {
      const option = el('option', title); option.value = value; model.append(option);
    }
    model.value = data.config.model; model.onchange = () => void action(() => changeConfig(model.value as Model, data.config.shrinkage));
    modelLabel.append(model); content.append(modelLabel);
    const shrinkLabel = el('label', '保守程度'); const shrink = el('select');
    for (const [value, title] of [['0.5', '较灵敏'], ['1', '默认'], ['2', '较保守']]) {
      const option = el('option', title); option.value = value; shrink.append(option);
    }
    shrink.value = String(data.config.shrinkage); shrink.onchange = () => void action(() => changeConfig(data.config.model, Number(shrink.value)));
    shrinkLabel.append(shrink); content.append(shrinkLabel);
    const tools = el('div', '', 'bpr-actions');
    tools.append(button('导出 JSON', async () => { backupView = 'export'; }), button('导入 JSON', async () => { backupView = 'import'; }));
    tools.append(button('清除本地数据', async () => {
      if (!await confirmLocal('清除当前用户在此域名的全部偏好数据？建议先导出备份。')) return;
      const next: Data = { ...data, anchors: [], comparisons: [], records: [], importedAt: null };
      await update(next); seen.clear(); currentReference = null;
    }, 'bpr-quiet'));
    content.append(tools, el('p', '比较数据保存在当前浏览器和域名下。个人主页可逐项细化并选择批量更新评分；私密收藏不导入。', 'bpr-muted'));
    if (subject) content.append(button('返回比较', async () => { settings = false; }));
  }

  function render(): void {
    close.disabled = false;
    if (!data) return;
    const focus = document.activeElement;
    const restoreFocus = focus instanceof HTMLElement && content.contains(focus) ? focus.textContent : null;
    content.replaceChildren();
    if (backupView) { renderBackup(); return; }
    if (settings) { renderSettings(); return; }
    if (!subject) return;
    const pool = data.anchors.filter(a => a.type === subject.type);
    content.append(el('p', `${subject.title} · ${categoryName[subject.type]}`, 'bpr-subtitle'));
    if (!eligible(data.anchors, subject.type)) {
      content.append(el('h3', `${pool.length}/50 个已评分${categoryName[subject.type]}条目`),
        el('p', '每个类别需要至少 50 个有 1–10 分评分的不同条目。其他类别不计入此池；当前只读取公开收藏。'),
        button('导入 / 刷新公开评分', refresh, 'bpr-primary'),
        button('设置与备份', async () => { settings = true; }));
      return;
    }
    const result = estimate(data, subject.id, subject.type);
    const old = data.records.find(r => r.subjectId === subject.id)?.originalRating;
    const current = data.anchors.find(a => a.id === subject.id)?.rate;
    const score = el('div', '', 'bpr-score');
    score.append(el('strong', result.useful >= 3 ? result.score.toFixed(2) : '—'), el('span', result.useful >= 3 ? '初步建议 · 本地评分' : `再比较 ${3 - result.useful} 次查看初步建议`));
    content.append(score);
    content.append(el('p', `${result.useful >= 3 ? `建议整数 ${result.recommended} · ` : ''}${result.useful} 次有效比较 · 公开评分 ${current ?? '未评分'}${old != null && old !== current ? `（最初 ${old}）` : ''}`, 'bpr-muted'));
    if (result.useful >= 3 && result.range) content.append(el('p', `模型敏感性范围 ${result.range[0].toFixed(2)}–${result.range[1].toFixed(2)}，不是校准后的置信区间。`, 'bpr-muted'));
    else if (result.useful >= 3) content.append(el('p', 'Elo 不提供不确定性区间；分数仍为初步建议。', 'bpr-muted'));
    if (new Set(pool.map(a => a.rate)).size < 3) content.append(el('p', '原评分较集中，绝对分数参考价值有限。', 'bpr-muted'));
    const candidate = currentReference ? pool.find(a => a.id === currentReference) : chooseReference(pool, subject.id, result.strength, seen);
    if (result.useful < budget && candidate) {
      currentReference = candidate.id;
      content.append(el('h3', '你更喜欢哪一部？'));
      const pair = el('div', '', 'bpr-pair');
      for (const item of [subject, candidate]) {
        const card = el('article');
        if (item.cover) { const image = el('img'); image.src = item.cover; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.onerror = () => image.remove(); card.append(image); }
        card.append(el('h4', item.title), el('p', categoryName[item.type], 'bpr-muted')); pair.append(card);
      }
      content.append(pair);
      const choices = el('div', '', 'bpr-choices');
      for (const [label, outcome] of [['更喜欢当前条目', 'target'], ['更喜欢参考条目', 'reference'], ['差不多', 'tie'], ['无法判断 / 跳过', 'skip']] as [string, Outcome][]) {
        choices.append(button(label, async () => {
          const next = structuredClone(data);
          const comparison = newComparison(subject.id, candidate.id, outcome, subject.type);
          next.comparisons.push(comparison); recordEstimate(next, subject.id, subject.type);
          recordEstimate(next, candidate.id, subject.type); await update(next);
          seen.add(candidate.id); currentReference = null;
        }, outcome === 'target' || outcome === 'reference' ? 'bpr-primary' : ''));
      }
      content.append(choices);
    } else {
      content.append(el('p', candidate ? '本轮比较已完成，评分与比较历史已保存。你可以继续细化。' : '已比较完可用参考，刷新收藏后可继续。'));
      if (candidate) content.append(button('再比较 8 次', async () => { budget = result.useful + 8; }, 'bpr-primary'));
    }
    if (result.useful >= 3) {
      const used = [...new Set(data.comparisons.filter(c => (c.target === subject.id || c.reference === subject.id) && c.outcome !== 'skip')
        .map(c => c.target === subject.id ? c.reference : c.target))];
      const details = el('details'); details.append(el('summary', `使用的参考（${used.length}）`));
      const list = el('ul');
      for (const id of used) list.append(el('li', data.anchors.find(a => a.id === id)?.title ?? `条目 #${id}（已不在公开评分中）`));
      details.append(list); content.append(details);
    }
    const actions = el('div', '', 'bpr-actions');
    const last = data.comparisons.filter(c => c.target === subject.id || c.reference === subject.id).at(-1);
    const undo = button('撤销上次比较', async () => {
      if (!last) return;
      const next = structuredClone(data); next.comparisons = next.comparisons.filter(c => c.id !== last.id);
      recordEstimate(next, last.target, subject.type); recordEstimate(next, last.reference, subject.type); await update(next);
      const peer = last.target === subject.id ? last.reference : last.target;
      seen.delete(peer); currentReference = peer;
    }); undo.disabled = !last;
    actions.append(undo, button('设置与备份', async () => { settings = true; }));
    actions.append(button('删除此条目偏好数据', async () => {
      if (!await confirmLocal('删除此条目的本地比较历史和偏好评分？Bangumi 评分不变。')) return;
      const next = structuredClone(data); next.comparisons = next.comparisons.filter(c => c.target !== subject.id && c.reference !== subject.id);
      next.records = next.records.filter(r => r.subjectId !== subject.id); recompute(next); await update(next);
      seen.clear(); currentReference = null; budget = 8;
    }, 'bpr-quiet'));
    content.append(actions);
    content.append(el('p', '每次比较立即保存。保留原评分可直接关闭；整数建议请手动填写到 Bangumi 原有评分控件。', 'bpr-muted'));
    if (restoreFocus) [...content.querySelectorAll('button')].find(b => b.textContent === restoreFocus)?.focus();
  }

  try {
    data = await load(user.id);
    if (!dialog.isConnected) return;
    seen = new Set(data.comparisons.filter(c => c.target === subject?.id || c.reference === subject?.id)
      .map(c => c.target === subject?.id ? c.reference : c.target));
    render();
    if (requestedModel) void action(() => changeConfig(requestedModel, data.config.shrinkage));
  } catch (error) { content.textContent = error instanceof Error ? error.message : '本地数据无法读取。'; }
}
