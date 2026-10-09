import { categoryName, eligible } from './data.ts';
import type { Data, Outcome, SubjectType } from './data.ts';
import { getCollections, loggedInUsername } from './api.ts';
import { estimateCategory, newComparison, recompute } from './model.ts';
import { nextPoolPair, nextContinuousPair, pairProbabilities, ratingChanges, refinementSubjects, rankedSubjects, setManualOrder } from './refinement.ts';
import { publishRating } from './publish.ts';
import { load, save } from './storage.ts';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}

export async function openRefinement(user: { id: number; username: string }, initialView: 'category' | 'ranking' = 'category'): Promise<void> {
  if (document.querySelector('#bpr-dialog')) return;
  const opener = document.activeElement as HTMLElement | null;
  const dialog = el('dialog'); dialog.id = 'bpr-dialog';
  const header = el('header'); const heading = el('h2', '逐项细化评分'); heading.id = 'bpr-heading';
  dialog.setAttribute('aria-labelledby', heading.id);
  const close = el('button', '关闭', 'bpr-quiet'); close.type = 'button';
  close.onclick = () => { if (publishing) stop = true; else dialog.close(); };
  header.append(heading, close);
  const content = el('div', '正在读取本地数据…', 'bpr-content');
  const status = el('p', '', 'bpr-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  dialog.append(header, content, status); document.body.append(dialog); dialog.showModal();
  dialog.addEventListener('close', () => { dialog.remove(); opener?.focus(); });
  dialog.addEventListener('cancel', event => { if (publishing) { event.preventDefault(); stop = true; } });
  let data: Data;
  let type: SubjectType = 2;
  let view: 'category' | 'compare' | 'review' | 'ranking' = initialView;
  let goal = 3;
  let mode: 'continuous' | 'coverage' = 'continuous';
  const sessionChoices = new Set<string>();
  const sessionLimit = 20;
  let busy = false;
  let publishing = false;
  let stop = false;
  const selected = new Set<number>();
  let notice = '';
  let draftOrder: { subjectType: SubjectType; subjects: number[] } | null = null;

  function alive(): void {
    if (!dialog.isConnected || loggedInUsername() !== user.username) throw new Error('窗口已关闭或登录用户已改变，请重新加载页面。');
  }
  async function persist(next: Data): Promise<void> { alive(); await save(next); data = next; }
  async function action(task: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true; status.textContent = '处理中…';
    for (const control of dialog.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('button, select, input')) control.disabled = true;
    try { alive(); await task(); status.textContent = ''; }
    catch (error) { status.textContent = error instanceof Error ? error.message : '操作失败，请重试。'; }
    finally { busy = false; if (dialog.isConnected) render(); }
  }
  function button(label: string, task: () => Promise<void>, primary = false): HTMLButtonElement {
    const b = el('button', label, primary ? 'bpr-primary' : ''); b.type = 'button'; b.onclick = () => void action(task); return b;
  }
  function confirmBatch(count: number): Promise<boolean> {
    return new Promise(resolve => {
      content.replaceChildren(el('h3', `更新 ${count} 个 Bangumi 评分？`),
        el('p', '将写入已选条目的建议整数评分，保留收藏状态、标签、吐槽、隐私和进度。已完成的更新会逐条保存；遇到失败会停止。'));
      const cancel = el('button', '返回检查'); const confirm = el('button', '确认批量更新', 'bpr-primary');
      const finish = (answer: boolean) => { dialog.removeEventListener('close', closed); resolve(answer); };
      const closed = () => resolve(false); dialog.addEventListener('close', closed, { once: true });
      cancel.onclick = () => finish(false); confirm.onclick = () => finish(true);
      const actions = el('div', '', 'bpr-actions'); actions.append(cancel, confirm); content.append(actions);
      close.disabled = false; cancel.focus();
    });
  }
  async function refresh(): Promise<void> {
    const collections = await getCollections(user.username, count => { status.textContent = `正在读取公开收藏：${count} 个条目`; });
    const next = structuredClone(data); next.anchors = collections.anchors; next.unrated = collections.unrated; next.importedAt = new Date().toISOString();
    recompute(next); await persist(next); selected.clear(); draftOrder = null; notice = '';
  }
  function begin(nextMode: 'continuous' | 'coverage' = 'continuous'): void {
    mode = nextMode; sessionChoices.clear();
    const counts = [...estimateCategory(data, type).values()].map(a => a.useful);
    const minimum = Math.min(...counts);
    goal = minimum < 3 ? 3 : minimum + 3;
    view = 'compare'; notice = '';
  }
  async function publishSelected(): Promise<void> {
    const changes = ratingChanges(data, type).filter(change => selected.has(change.subject.id));
    if (!changes.length || !await confirmBatch(changes.length)) return;
    alive(); publishing = true; stop = false; close.disabled = false; close.textContent = '停止更新';
    content.replaceChildren(el('p', `正在逐条更新 ${changes.length} 个评分…`));
    const stopButton = el('button', '停止更新'); stopButton.onclick = () => { stop = true; stopButton.disabled = true; };
    content.append(stopButton);
    let completed = 0;
    try {
      for (const change of changes) {
        if (stop) break;
        alive();
        const latest = await load(user.id);
        if (latest.revision !== data.revision) throw new Error('另一个标签页已更新本地数据，请重新加载后检查。');
        status.textContent = `${completed + 1}/${changes.length} · ${change.subject.title} · ${change.from ?? '未评分'} → ${change.to}`;
        await publishRating(user.username, change.subject.id, change.from, change.to);
        completed++;
        // Once the server confirms success, save it even if the dialog was closed.
        const next = structuredClone(data);
        const anchor = next.anchors.find(a => a.id === change.subject.id);
        if (anchor) anchor.rate = change.to;
        else {
          next.anchors.push({ ...change.subject, rate: change.to });
          next.unrated = next.unrated.filter(a => a.id !== change.subject.id);
        }
        const record = next.records.find(r => r.subjectId === change.subject.id)!;
        record.currentRating = change.to; record.lastPublishedRating = change.to;
        await save(next); data = next; selected.delete(change.subject.id);
        if (completed < changes.length && !stop) await new Promise(resolve => setTimeout(resolve, 1000));
      }
      notice = `已更新 ${completed}/${changes.length} 个评分${stop ? '，其余条目尚未更新。' : '。'}`;
    } catch (error) {
      notice = `已确认 ${completed}/${changes.length} 个评分；已停止。${error instanceof Error ? error.message : '更新失败。'} 可刷新评分后重新检查未完成条目。`;
    } finally { publishing = false; close.textContent = '关闭'; }
  }

  function spreadControl(container: HTMLElement = content, compact = false): void {
    const label = el('label', '评分展开程度'); const select = el('select');
    for (const [value, name] of [[1, '较集中'], [1.5, '适度展开'], [2, '展开（默认）'], [3, '更大幅度']] as const) {
      const option = el('option', name); option.value = String(value); select.append(option);
    }
    select.value = String(data.config.spread);
    select.onchange = () => void action(async () => {
      const next = structuredClone(data); next.config.spread = Number(select.value);
      recompute(next); await persist(next); selected.clear(); notice = '';
    });
    label.append(select);
    const explanation = el('p', '按类别分布展开中段分差，最低 4 分；9 分约占 1/40；10 分仅由你在 Bangumi 手动决定。并列条目同分，比例为目标而非硬配额。只调整本地建议，确认批量更新后才写入 Bangumi。', 'bpr-muted');
    if (compact) { const details = el('details'); details.append(el('summary', '评分规则（4–9 分）'), explanation); container.append(label, details); }
    else container.append(label, explanation);
  }
  function renderRanking(): void {
    heading.textContent = '偏好排名';
    const label = el('label', '排名类别'); const select = el('select');
    for (const [id, name] of Object.entries(categoryName)) { const option = el('option', name); option.value = id; select.append(option); }
    select.value = String(type); select.onchange = () => { type = Number(select.value) as SubjectType; selected.clear(); draftOrder = null; render(); };
    label.append(select); const filters = el('div', '', 'bpr-ranking-filters'); const spread = el('div');
    filters.append(label, spread); content.append(filters); spreadControl(spread, true);
    const display = draftOrder?.subjectType === type
      ? { ...data, manualOrders: [...data.manualOrders.filter(order => order.subjectType !== type), draftOrder] } : data;
    const rows = rankedSubjects(display, type);
    const manual = display.manualOrders.some(order => order.subjectType === type);
    const canArrange = eligible(data.anchors, type);
    content.append(el('p', '拖动 ↕ 或用方向键调整顺序（Home / End 到首尾）。保存后为整个列表生成 4–9 分建议，包括待比较条目；可恢复模型排序。', 'bpr-muted'));
    const orderActions = el('div', '', 'bpr-actions');
    const saveOrder = button('保存手动顺序', async () => {
      if (!draftOrder || draftOrder.subjectType !== type) return;
      const next = structuredClone(data); setManualOrder(next, type, draftOrder.subjects);
      await persist(next); draftOrder = null; selected.clear(); notice = '已保存手动顺序；Bangumi 评分尚未更新。';
    }, true); saveOrder.disabled = !draftOrder || !canArrange;
    const cancelOrder = button('取消排列', async () => { draftOrder = null; }); cancelOrder.disabled = !draftOrder;
    const modelOrder = button('恢复模型排序', async () => {
      const next = structuredClone(data); next.manualOrders = next.manualOrders.filter(order => order.subjectType !== type);
      recompute(next); await persist(next); draftOrder = null; selected.clear(); notice = '已恢复模型排序，比较历史保留。';
    }); modelOrder.disabled = !data.manualOrders.some(order => order.subjectType === type);
    orderActions.append(saveOrder, cancelOrder, modelOrder); content.append(orderActions);
    if (draftOrder) content.append(el('p', '手动排列预览 · 尚未保存', 'bpr-subtitle'));

    const ranked = rows.filter(row => row.result);
    content.append(el('p', `${categoryName[type]} · ${ranked.length}/${rows.length} 个已完成条目已有偏好评分，${manual ? '手动排序' : '模型排序'}，按未四舍五入的分数从高到低排列。模型同分同名次；未手动排序且不足 3 次有效比较的条目列在末尾。`, 'bpr-muted'));
    if (!eligible(data.anchors, type)) content.append(el('p', '此类别不足 50 个已评分且已完成的公开收藏，暂不能生成偏好排名。', 'bpr-muted'));
    if (ranked.length) content.append(el('p', `当前分布：${ranked.at(-1)!.result!.score.toFixed(2)}–${ranked[0].result!.score.toFixed(2)}`, 'bpr-subtitle'));
    if (rows.length) {
      const table = el('table', '', 'bpr-review'); const head = el('tr');
      for (const title of ['排列', '名次', '条目', '当前', '偏好评分', '有效比较']) head.append(el('th', title));
      const thead = el('thead'); thead.append(head); table.append(thead); const body = el('tbody');
      const scroll = el('div', '', 'bpr-table-scroll bpr-ranking-table');
      function move(id: number, destination: number, reveal = false): void {
        if (busy || !canArrange) return;
        const order = rows.map(row => row.subject.id); const from = order.indexOf(id);
        const to = Math.max(0, Math.min(order.length - 1, destination));
        if (from === to || from < 0) return;
        order.splice(from, 1); order.splice(to, 0, id);
        draftOrder = { subjectType: type, subjects: order };
        const scrollTop = scroll.scrollTop; const dialogTop = dialog.scrollTop;
        render();
        const nextScroll = content.querySelector<HTMLElement>('.bpr-ranking-table');
        if (nextScroll) nextScroll.scrollTop = scrollTop;
        dialog.scrollTop = dialogTop;
        const moved = content.querySelector<HTMLButtonElement>(`[data-move-id="${id}"]`);
        moved?.focus({ preventScroll: true });
        if (reveal) moved?.scrollIntoView({ block: 'nearest' });
      }
      for (const [index, row] of rows.entries()) {
        const tr = el('tr'); const title = el('td'); const link = el('a', row.subject.title);
        link.href = `/subject/${row.subject.id}`; link.target = '_blank'; link.rel = 'noopener'; title.append(link);
        tr.dataset.subjectId = String(row.subject.id);
        const gripCell = el('td'); const grip = el('button', '↕', 'bpr-grip'); grip.type = 'button';
        grip.dataset.moveId = String(row.subject.id); grip.disabled = !canArrange;
        grip.setAttribute('aria-label', `调整 ${row.subject.title} 的顺序`);
        grip.title = '拖动排列；方向键移动，Home / End 移到首尾';
        grip.onkeydown = event => {
          const destination = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null;
          if (destination !== null) { event.preventDefault(); move(row.subject.id, destination, true); }
        };
        let startY: number | null = null; let destination = index; let dragging = false;
        let scrollFrame = 0; let pointerX = 0; let pointerY = 0;
        const clearDrag = () => {
          cancelAnimationFrame(scrollFrame); scrollFrame = 0;
          startY = null; dragging = false; tr.classList.remove('bpr-dragging');
          for (const marked of body.querySelectorAll('.bpr-drop-before, .bpr-drop-after')) marked.classList.remove('bpr-drop-before', 'bpr-drop-after');
        };
        grip.onpointerdown = event => {
          if (busy || !canArrange || event.button !== 0) return;
          startY = event.clientY; destination = index; grip.setPointerCapture(event.pointerId); event.preventDefault();
        };
        const dragPosition = () => {
          const bounds = scroll.getBoundingClientRect();
          if (pointerY < Math.max(bounds.top, dialog.getBoundingClientRect().top) + 30) scroll.scrollTop -= 10;
          if (pointerY > Math.min(bounds.bottom, dialog.getBoundingClientRect().bottom) - 30) scroll.scrollTop += 10;
          for (const marked of body.querySelectorAll('.bpr-drop-before, .bpr-drop-after')) marked.classList.remove('bpr-drop-before', 'bpr-drop-after');
          const target = document.elementFromPoint(pointerX, pointerY)?.closest<HTMLTableRowElement>('tr[data-subject-id]');
          if (!target || !body.contains(target)) return;
          const targetIndex = rows.findIndex(r => String(r.subject.id) === target.dataset.subjectId);
          const rect = target.getBoundingClientRect(); const after = pointerY > rect.top + rect.height / 2;
          const insertion = targetIndex + Number(after);
          destination = insertion > index ? insertion - 1 : insertion;
          target.classList.add(after ? 'bpr-drop-after' : 'bpr-drop-before');
        };
        const autoScroll = () => {
          if (!dragging || !grip.isConnected) { clearDrag(); return; }
          dragPosition(); scrollFrame = requestAnimationFrame(autoScroll);
        };
        grip.onpointermove = event => {
          if (startY === null || Math.abs(event.clientY - startY) < 4 && !dragging) return;
          pointerX = event.clientX; pointerY = event.clientY;
          dragging = true; tr.classList.add('bpr-dragging'); dragPosition();
          if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
        };
        grip.onpointerup = event => {
          const shouldMove = dragging; const to = destination; clearDrag();
          if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
          if (shouldMove) move(row.subject.id, to);
        };
        grip.onpointercancel = clearDrag; grip.onlostpointercapture = clearDrag;
        gripCell.append(grip);
        tr.append(gripCell, el('td', row.rank === null ? '—' : String(row.rank)), title,
          el('td', row.subject.rate === null ? '未评分' : String(row.subject.rate)),
          el('td', row.result ? row.result.score.toFixed(2) : '待比较'),
          el('td', String(data.records.find(r => r.subjectId === row.subject.id)?.useful ?? 0))); body.append(tr);
      }
      table.append(body); scroll.append(table); content.append(scroll);
    } else content.append(el('p', '先导入已完成的公开收藏，再开始比较。'));
    const actions = el('div', '', 'bpr-actions');
    const compare = button('连续细化（20 次一轮）', async () => { begin(); }, true); compare.disabled = !eligible(data.anchors, type) || draftOrder !== null;
    const review = button('检查评分变化', async () => { view = 'review'; }); review.disabled = !eligible(data.anchors, type) || draftOrder !== null;
    actions.append(compare, review, button('刷新当前评分', refresh), button('返回类别', async () => { view = 'category'; })); content.append(actions);
  }
  function renderCategory(): void {
    content.append(el('p', '连续细化每轮最多 20 次选择，优先比较当前分数接近的已完成条目。随时关闭、查看排名或检查建议；下次从保存的历史继续，不要求比较完整个收藏。逐项覆盖比较适合首次全面整理。'));
    const label = el('label', '类别'); const select = el('select');
    for (const [id, name] of Object.entries(categoryName)) {
      const count = data.anchors.filter(a => a.type === Number(id)).length;
      const unscored = data.unrated.filter(a => a.type === Number(id)).length;
      const option = el('option', `${name} · ${count} 个已评分 / ${unscored} 个未评分`); option.value = id; select.append(option);
    }
    select.value = String(type); select.onchange = () => { type = Number(select.value) as SubjectType; selected.clear(); draftOrder = null; render(); };
    label.append(select); content.append(label); spreadControl();
    const pool = refinementSubjects(data, type);
    const ready = [...estimateCategory(data, type).values()].filter(a => a.useful >= 3).length;
    content.append(el('p', `${ready}/${pool.length} 个条目已有至少 3 次有效比较。各类别独立，需要至少 50 个已评分且已完成的公开收藏。`, 'bpr-muted'));
    const actions = el('div', '', 'bpr-actions');
    const start = button('连续细化（20 次一轮）', async () => { begin(); }, true); start.disabled = !eligible(data.anchors, type);
    const review = button('查看评分变化', async () => { view = 'review'; }); review.disabled = !eligible(data.anchors, type);
    const coverage = button('逐项覆盖比较', async () => { begin('coverage'); }); coverage.disabled = !eligible(data.anchors, type);
    actions.append(start, coverage, review, button('查看偏好排名', async () => { view = 'ranking'; }), button('导入 / 刷新公开评分', refresh)); content.append(actions);
  }
  function renderCompare(): void {
    const pool = refinementSubjects(data, type);
    const done = [...estimateCategory(data, type).values()].filter(a => a.useful >= goal).length;
    if (data.manualOrders.some(order => order.subjectType === type)) content.append(el('p', '当前使用手动顺序。新的比较仍会保存；在排名面板恢复模型排序后，它们才会改变排名与建议。', 'bpr-muted'));
    const paused = mode === 'continuous' && sessionChoices.size >= sessionLimit;
    content.append(el('p', mode === 'continuous'
      ? `${categoryName[type]} · 连续细化 · 本轮 ${sessionChoices.size}/${sessionLimit} 次选择`
      : `${categoryName[type]} · 逐项覆盖 · ${done}/${pool.length} 个条目达到本轮 ${goal} 次有效比较`, 'bpr-subtitle'));
    const pair = paused ? null : mode === 'continuous' ? nextContinuousPair(data, type) : nextPoolPair(data, type, goal);
    if (!pair) {
      content.append(el('p', paused ? '本轮已完成，可以检查评分变化或再进行 20 次选择。每次选择已经保存，无需比较完整个收藏。' : done === pool.length ? '本轮逐项比较已完成。检查建议评分，再选择需要更新的条目。' : '可用的新组合已比较完。跳过的选择不计入有效次数，可检查已有建议。'));
      const actions = el('div', '', 'bpr-actions');
      if (mode === 'continuous') actions.append(button('再细化 20 次', async () => { begin(); }, true));
      actions.append(button('检查评分变化', async () => { view = 'review'; }, true)); content.append(actions);
    } else {
      const cards = el('div', '', 'bpr-pair');
      for (const subject of pair) {
        const card = el('article');
        if (subject.cover) {
          const image = el('img'); image.src = subject.cover; image.alt = ''; image.referrerPolicy = 'no-referrer';
          image.onerror = () => image.remove(); card.append(image);
        }
        card.append(el('h4', subject.title), el('p', subject.rate === null ? '当前未评分' : `当前 ${subject.rate} 分`, 'bpr-muted')); cards.append(card);
      }
      content.append(el('h3', '你更喜欢哪一部？'), cards);
      const probabilities = pairProbabilities(data, type, pair[0].id, pair[1].id);
      if (probabilities.observed) content.append(el('p', `本组合 ${probabilities.observed} 次历史选择 · 平滑概率：左 ${(probabilities.target * 100).toFixed(0)}% / 右 ${(probabilities.reference * 100).toFixed(0)}% / 差不多 ${(probabilities.tie * 100).toFixed(0)}% / 跳过 ${(probabilities.skip * 100).toFixed(0)}%`, 'bpr-muted'));
      const choices = el('div', '', 'bpr-choices');
      for (const [label, outcome] of [['更喜欢左边', 'target'], ['更喜欢右边', 'reference'], ['差不多', 'tie'], ['无法判断 / 跳过', 'skip']] as [string, Outcome][]) {
        choices.append(button(label, async () => {
          const next = structuredClone(data); const comparison = newComparison(pair[0].id, pair[1].id, outcome, type); next.comparisons.push(comparison);
          recompute(next);
          await persist(next); sessionChoices.add(comparison.id);
        }, outcome === 'target' || outcome === 'reference'));
      }
      content.append(choices);
    }
    const last = data.comparisons.filter(c => c.subjectType === type).at(-1);
    const undo = button('撤销上次比较', async () => {
      if (!last) return;
      const next = structuredClone(data); next.comparisons = next.comparisons.filter(c => c.id !== last.id);
      recompute(next); await persist(next); sessionChoices.delete(last.id);
    }); undo.disabled = !last;
    const actions = el('div', '', 'bpr-actions');
    actions.append(undo, button('查看偏好排名', async () => { view = 'ranking'; }), button('先检查已有变化', async () => { view = 'review'; }), button('返回类别', async () => { view = 'category'; }));
    if (mode === 'continuous') content.append(el('p', '优先澄清分数接近的组合，避免立即重复，之后可重新比较矛盾或尚不明确的偏好。每轮仅是休息点，可以随时停止或继续。', 'bpr-muted'));
    content.append(actions, el('p', '选择可以矛盾或形成循环；保留全部历史，不要求严格排序。差不多计入比较，跳过不计入。检查并确认后才修改 Bangumi 评分。', 'bpr-muted'));
  }
  function renderReview(): void {
    if (!eligible(data.anchors, type)) {
      selected.clear();
      content.append(el('p', `当前${categoryName[type]}公开评分不足 50 个，暂不能细化或批量更新。`),
        button('刷新当前评分', refresh), button('返回类别', async () => { view = 'category'; }));
      return;
    }
    const changes = ratingChanges(data, type);
    const ids = new Set(changes.map(c => c.subject.id));
    for (const id of selected) if (!ids.has(id)) selected.delete(id);
    content.append(el('h3', `${categoryName[type]} · ${changes.length} 个评分建议`));
    content.append(el('p', '仅列出已保存手动顺序或至少有 3 次有效比较、且未评分或建议整数与当前公开评分不同的条目。两位小数是本地建议。'));
    if (notice) content.append(el('p', notice, 'bpr-result'));
    const actions = el('div', '', 'bpr-actions');
    const publish = button(`更新已选 ${selected.size} 个评分`, publishSelected, true); publish.disabled = selected.size === 0;
    function selectionChanged(): void { publish.textContent = `更新已选 ${selected.size} 个评分`; publish.disabled = selected.size === 0; }
    actions.append(button('全选', async () => { changes.forEach(c => selected.add(c.subject.id)); }),
      button('取消全选', async () => { selected.clear(); }), publish); content.append(actions);
    if (changes.length) {
      const table = el('table', '', 'bpr-review'); const head = el('thead'); const row = el('tr');
      for (const title of ['选择', '条目', '当前', '偏好评分', '建议']) row.append(el('th', title));
      head.append(row); table.append(head); const body = el('tbody');
      for (const change of changes) {
        const row = el('tr'); const cell = el('td'); const check = el('input'); check.type = 'checkbox';
        check.checked = selected.has(change.subject.id); check.setAttribute('aria-label', `选择 ${change.subject.title}`);
        check.onchange = () => { if (check.checked) selected.add(change.subject.id); else selected.delete(change.subject.id); selectionChanged(); };
        cell.append(check); const title = el('td'); const link = el('a', change.subject.title);
        link.href = `/subject/${change.subject.id}`; link.target = '_blank'; link.rel = 'noopener'; title.append(link);
        row.append(cell, title, el('td', change.from === null ? '未评分' : String(change.from)), el('td', change.score.toFixed(2)), el('td', String(change.to))); body.append(row);
      }
      table.append(body); const scroll = el('div', '', 'bpr-table-scroll'); scroll.append(table); content.append(scroll);
    } else content.append(el('p', '目前没有可更新的整数评分变化。继续比较可细化尚未达到 3 次有效比较的条目。'));
    const navigation = el('div', '', 'bpr-actions');
    navigation.append(button('查看偏好排名', async () => { view = 'ranking'; }), button('继续连续细化', async () => { if (sessionChoices.size >= sessionLimit || mode !== 'continuous') begin(); else view = 'compare'; }),
      button('刷新当前评分', refresh), button('返回类别', async () => { view = 'category'; })); content.append(navigation);
  }
  function render(): void {
    close.disabled = false;
    if (!data) return;
    content.replaceChildren();
    heading.textContent = '逐项细化评分';
    if (view === 'ranking') renderRanking(); else if (view === 'category') renderCategory(); else if (view === 'compare') renderCompare(); else renderReview();
    dialog.scrollTop = 0;
  }
  try { data = await load(user.id); recompute(data); alive(); render(); }
  catch (error) { content.textContent = error instanceof Error ? error.message : '本地数据无法读取。'; }
}
