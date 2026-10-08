import styles from './styles.css';
import { getSubject, getUser, loggedInUsername, subjectFromPage } from './api.ts';
import { load } from './storage.ts';
import { openPanel } from './ui.ts';

declare global {
  interface Window {
    bprInitialized?: boolean;
    chiiLib?: { ukagaka?: { addGeneralConfig: (config: {
      title: string; name: string; type: 'radio'; defaultValue: string;
      getCurrentValue: () => string; onChange: (value: string) => void;
      options: { value: string; label: string }[];
    }) => void } };
  }
}

function start(): void {
  if (window.bprInitialized) return;
  window.bprInitialized = true;
  const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
  let lastKey = '';
  let generation = 0;
  let settingsRegistered = false;
  let selectedModel = 'bt';

  async function mount(): Promise<void> {
    const username = loggedInUsername();
    const subjectId = location.pathname.match(/^\/subject\/(\d+)\/?$/)?.[1];
    const key = `${username}:${subjectId}`;
    if (key === lastKey) return;
    lastKey = key;
    const stamp = ++generation;
    document.querySelector('#bpr-entry')?.remove();
    document.querySelector<HTMLDialogElement>('#bpr-dialog')?.close();
    if (!username) return;
    try {
      const user = await getUser(username);
      const data = await load(user.id); selectedModel = data.config.model;
      if (stamp !== generation) return;
      registerSettings();
      if (!subjectId) return;
      const subject = subjectFromPage(Number(subjectId)) ?? await getSubject(Number(subjectId));
      if (!subject || stamp !== generation) return;
      const host = document.querySelector('#columnSubjectHomeA, #columnSubjectHome') ?? document.querySelector('h1.nameSingle')?.parentElement;
      if (!host) return;
      const entry = document.createElement('div'); entry.id = 'bpr-entry';
      const button = document.createElement('button'); button.textContent = '偏好评分';
      const summary = document.createElement('span');
      async function refreshLabel(): Promise<void> {
        try {
          const currentData = await load(user.id); selectedModel = currentData.config.model;
          const record = currentData.records.find(r => r.subjectId === subject!.id);
          summary.textContent = record ? record.useful >= 3 ? `${record.score.toFixed(2)} · 初步建议` : `${record.useful} 次比较 · 继续评分` : '比较几个条目，找到你的评分';
        } catch { summary.textContent = '本地数据读取失败'; }
      }
      button.onclick = () => void openPanel(user, subject, () => void refreshLabel());
      entry.append(button, summary); host.prepend(entry); void refreshLabel();
    } catch (error) {
      // Visible retry on the subject page without silently overwriting storage.
      if (stamp !== generation || !subjectId) return;
      const host = document.querySelector('#columnSubjectHomeA, #columnSubjectHome');
      if (!host) return;
      const entry = document.createElement('div'); entry.id = 'bpr-entry';
      const message = document.createElement('span'); message.textContent = error instanceof Error ? error.message : '偏好评分初始化失败。';
      const retry = document.createElement('button'); retry.textContent = '重试'; retry.onclick = () => { lastKey = ''; void mount(); };
      entry.append(message, retry); host.prepend(entry);
    }
  }

  function registerSettings(): void {
    const panel = window.chiiLib?.ukagaka;
    if (settingsRegistered || !panel?.addGeneralConfig) return;
    settingsRegistered = true;
    panel.addGeneralConfig({
      title: '偏好评分算法', name: 'bpr-model', type: 'radio', defaultValue: 'bt',
      getCurrentValue: () => selectedModel,
      onChange: value => {
        void (async () => {
          const username = loggedInUsername(); if (!username) return;
          if (value === 'settings') { await openPanel(await getUser(username), null); return; }
          if (value !== 'bt' && value !== 'elo') return;
          const user = await getUser(username);
          await openPanel(user, null, () => { void load(user.id).then(data => { selectedModel = data.config.model; }); }, value);
        })().catch(error => alert(error instanceof Error ? error.message : '设置保存失败。'));
      },
      options: [{ value: 'bt', label: 'Bradley–Terry（MAP 近似）' }, { value: 'elo', label: 'Elo' }, { value: 'settings', label: '数据与备份…' }],
    });
  }

  let timer: ReturnType<typeof setTimeout>;
  function schedule(): void {
    clearTimeout(timer); timer = setTimeout(() => { void mount(); registerSettings(); }, 150);
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  void mount();
  setTimeout(registerSettings, 1500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
