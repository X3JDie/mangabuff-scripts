// ==UserScript==
// @name         MangaBuff Loader [Universal]
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Подключает основной скрипт из локального файла [Поддержка старого и нового дизайна]
// @match        https://mangabuff.ru/balance
// @match        https://mangabuff.ru/quiz
// @match        https://mangabuff.ru/mine
// @grant        none
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function () {
  'use strict';

  console.log("[Loader] 📦 Скрипт загружен | Universal v2.0 | Design: " + detectSiteDesign());

  // ========== ГЛОБАЛЬНЫЕ УТИЛИТЫ ==========
  function detectSiteDesign() {
    return document.querySelector('.wallet-panel') ? 'new' : 'old';
  }

  function parseProgress(text) {
    if (!text) return null;
    const t = text.trim();
    let m = t.match(/(\d+)\s*из\s*(\d+)/i);
    if (m) return { current: +m[1], total: +m[2] };
    m = t.match(/(\d+)\s*\/\s*(\d+)/);
    if (m) return { current: +m[1], total: +m[2] };
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight;
  }

  function getTodayKey() {
    return new Date().toLocaleDateString('ru-RU');
  }

  function parseTime(text) {
    const h = text.match(/(\d+)\s*ч/);
    const m = text.match(/(\d+)\s*мин/);
    const s = text.match(/(\d+)\s*сек/);
    return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (s ? +s[1] / 60 : 0);
  }

  function showPopup(msg) {
    const div = document.createElement('div');
    div.textContent = msg;
    Object.assign(div.style, {
      position:'fixed', bottom:'20px', right:'20px', background:'#222', color:'#0f0',
      padding:'10px 15px', borderRadius:'10px', boxShadow:'0 0 10px #0f0', fontSize:'14px', zIndex:9999
    });
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
  }

  // ========== ХРАНИЛИЩЕ НАГРАД ==========
  function getRewards() {
    try {
      const raw = localStorage.getItem('read_rewards');
      const obj = JSON.parse(raw);
      return Array.isArray(obj?.items) ? obj.items : [];
    } catch { return []; }
  }

  function getTodayCounts() {
    const today = getTodayKey();
    const items = getRewards();
    return {
      cards: items.filter(i => i.type === 'card' && new Date(i.time).toLocaleDateString('ru-RU') === today).length,
      scrolls: items.filter(i => i.type === 'scroll' && new Date(i.time).toLocaleDateString('ru-RU') === today).length
    };
  }

  function getLastCardTime() {
    const cards = getRewards().filter(i => i.type === 'card');
    if (cards.length === 0) return null;
    const last = cards.reduce((a, b) => (a.time > b.time ? a : b));
    return typeof last.time === 'number' ? last.time : null;
  }

  function getLastRewardTimeFromStorage() {
    const items = getRewards();
    if (items.length === 0) return null;
    const last = items.reduce((a, b) => (a.time > b.time ? a : b));
    return typeof last.time === 'number' ? last.time : null;
  }

  // ========== ПОИСК КНОПОК КВЕСТОВ (УНИВЕРСАЛЬНЫЙ) ==========
  function findQuestButton(name) {
    // Старый дизайн
    const oldBlock = document.querySelector(`.user-quest__item--${name}`);
    const oldBtn = oldBlock?.querySelector('.user-quest__icon');
    if (isVisible(oldBtn)) return oldBtn;

    // Новый дизайн — маппинг
    const newMap = {
      'read': () => document.querySelector('.wallet-panel__stat:nth-child(2)'),
      'comments': () => document.querySelector('.wallet-panel__stat:first-child'),
      'read_rewards': () => document.querySelector('.wallet-panel__drop'),
      'watch_ads': () => document.querySelector('.wallet-panel__action--ads'),
      'chat_diamond': () => null,
      'mine': () => null,
      'event': () => document.querySelector('.wallet-panel__drop')
    };

    const getter = newMap[name];
    if (getter) {
      const el = getter();
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  // ========== ПРОГРЕСС ЧТЕНИЯ И КОММЕНТАРИЕВ ==========
  function getReadChapters() {
    const oldBlock = document.querySelector('.user-quest__item--read .user-quest__text');
    if (oldBlock) {
      const m = oldBlock.textContent.match(/Глав\s+(\d+)\s+из\s+(\d+)/);
      if (m) return +m[1];
    }
    const newStat = document.querySelector('.wallet-panel__stat:nth-child(2) b');
    if (newStat) {
      const p = parseProgress(newStat.textContent);
      if (p) return p.current;
    }
    return 0;
  }

  function shouldStopComments() {
    const oldBlock = document.querySelector('.user-quest__item--comments .user-quest__text');
    if (oldBlock) {
      const m = oldBlock.textContent.match(/Комментариев\s+(\d+)\s+из\s+(\d+)/i);
      return m ? (+m[1] >= +m[2]) : false;
    }
    const newStat = document.querySelector('.wallet-panel__stat:first-child b');
    if (newStat) {
      const p = parseProgress(newStat.textContent);
      return p ? (p.current >= p.total) : false;
    }
    return false;
  }

  function getReadRewardStatus() {
    const oldBlock = document.querySelector('.user-quest__item--read_rewards .user-quest__text');
    if (oldBlock) {
      const m = oldBlock.textContent.match(/(\d+)\s*из\s*(\d+)/);
      if (m) return { current: +m[1], total: +m[2] };
    }
    const dropText = document.querySelector('.wallet-panel__drop-text');
    if (dropText) {
      const m = dropText.textContent.match(/(\d+)\s*из\s*(\d+)/);
      if (m) return { current: +m[1], total: +m[2] };
    }
    const dropLine = document.querySelector('.wallet-panel__drop-line span');
    if (dropLine) {
      const width = parseFloat(dropLine.style.width) || 0;
      return { current: Math.round(width * 0.1), total: 10 };
    }
    return { current: 0, total: 10 };
  }

  // ========== ИВЕНТ ==========
  function isEventCompleted() {
    const eventBlock = document.querySelector('.user-quest__item--event .user-quest__text');
    const text = eventBlock?.textContent.replace(/\s+/g, ' ').trim() || '';
    const m = text.match(/Event\s+(\d+)\s+из\s+(\d+)/i);
    if (!m) return false;
    const current = +m[1], total = +m[2];
    if (current >= 35) {
      if (!localStorage.getItem("event35_reload_done")) {
        localStorage.setItem("event35_reload_done", "true");
        location.reload();
        return true;
      }
    }
    return current >= total;
  }

  function proceedEventCheck() {
    if (!isEventCompleted()) {
      clickEventButton();
    } else {
      if (!localStorage.getItem("event_reload_done")) {
        localStorage.setItem("event_reload_done", "true");
        location.reload();
      } else {
        console.log("[Loader] Эвент собран, reload уже был");
      }
    }
  }

  function clickEventButton() {
    const btn = findQuestButton('event');
    if (btn) { btn.click(); showPopup('Event'); }
  }

  function clickReadButton() {
    const btn = findQuestButton('read');
    if (btn) { btn.click(); showPopup('Чтение главы'); }
  }

  function ensureChaptersThenEvent() {
    const chapters = getReadChapters();
    if (chapters < 5) {
      clickReadButton();
      const interval5 = setInterval(() => {
        if (getReadChapters() >= 5) { clearInterval(interval5); location.reload(); }
      }, 5000);
      return;
    }
    if (chapters < 10) {
      clickReadButton();
      const interval10 = setInterval(() => {
        if (getReadChapters() >= 10) { clearInterval(interval10); location.reload(); }
      }, 5000);
      return;
    }
    if (!localStorage.getItem("chapters_reload_done")) {
      localStorage.setItem("chapters_reload_done", "true");
      location.reload();
    } else {
      console.log("[Loader] Главы >= 10, reload уже был");
      clickEventButton();
    }
  }

  // ========== КОММЕНТАРИИ ==========
  const COMMENT_POOL = [
    "Привет всем","Всем привет, как настроение?","Добрый день, друзья!",
    "Всем хорошего дня или вечера","Привет, как у вас дела сегодня?",
    "Как проходит ваш день?","Что нового у вас?","Как настроение сегодня?",
    "Чем занимаетесь сейчас?","У меня всё отлично, спасибо!","Настроение супер, а у вас?",
    "День проходит спокойно 👍","Да всё нормально","Спасибо, дела идут хорошо!"
  ];
  const COMMENT_CHECK_INTERVAL = 300000;
  const COMMENT_MIN_DELAY = 1800000;
  const COMMENT_MAX_DELAY = 3600000;

  function getRandomCommentTargetPage() {
    return ["/auctions", "/rating"][Math.floor(Math.random() * 2)];
  }

  function scheduleComments() {
    setInterval(() => {
      if (shouldStopComments()) return;
      const now = Date.now();
      const next = +localStorage.getItem('next_comment_time') || 0;
      if (next && now < next) return;
      localStorage.setItem('pending_comment', 'true');
      window.location.href = getRandomCommentTargetPage();
    }, COMMENT_CHECK_INTERVAL);
  }

  function handleCommentPage() {
    if (localStorage.getItem('pending_comment') !== 'true') return;
    setTimeout(() => {
      const textarea = document.querySelector('.comments__send-form textarea');
      const sendBtn = document.querySelector('.comments__send-btn');
      if (textarea && sendBtn) {
        textarea.value = COMMENT_POOL[Math.floor(Math.random() * COMMENT_POOL.length)];
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        sendBtn.click();
        const nextDelay = COMMENT_MIN_DELAY + Math.floor(Math.random() * (COMMENT_MAX_DELAY - COMMENT_MIN_DELAY));
        localStorage.setItem('next_comment_time', Date.now() + nextDelay);
        showPopup('Комментарий отправлен');
      }
      localStorage.removeItem('pending_comment');
      setTimeout(() => window.location.href = "/balance", 2000);
    }, 10000);
  }

  // ========== НАГРАДЫ ЗА ЧТЕНИЕ ==========
  const CHECK_REWARD_INTERVAL = 30000;
  const TRIGGER_MINUTES = 19;
  let lastRewardClick = 0;
  let cardSpamInterval = null;

  function clickReward() {
    const oldBtn = findQuestButton('read_rewards');
    if (oldBtn) {
      oldBtn.click();
      lastRewardClick = Date.now();
      showPopup('Награда за чтение');
      return;
    }
    const drop = document.querySelector('.wallet-panel__drop');
    const state = drop?.querySelector('.wallet-panel__drop-state');
    if (drop && (!state || !state.classList.contains('wallet-panel__drop-state--wait'))) {
      drop.click();
      lastRewardClick = Date.now();
      showPopup('Награда за чтение');
    }
  }

  function startCardSpamIfNeeded() {
    const cardsToday = getTodayCounts().cards;
    const chaptersDone = getReadChapters();
    const lastCardTime = getLastCardTime();
    if (chaptersDone >= 75 && cardsToday < 10 && lastCardTime) {
      const minutes = (Date.now() - lastCardTime) / (60 * 1000);
      if (minutes >= 60 && !cardSpamInterval) {
        cardSpamInterval = setInterval(() => {
          const nowCards = getTodayCounts().cards;
          if (nowCards >= 10) { clearInterval(cardSpamInterval); cardSpamInterval = null; return; }
          const lc = getLastCardTime();
          const mins = lc ? (Date.now() - lc) / (60 * 1000) : 999;
          if (mins >= 60) clickReward();
        }, 60000);
      }
    }
  }

  function stopCardSpam() {
    if (cardSpamInterval) { clearInterval(cardSpamInterval); cardSpamInterval = null; }
  }

  function checkReward() {
    const cardsToday = getTodayCounts().cards;
    const chaptersDone = getReadChapters();
    if (chaptersDone >= 75) {
      if (cardsToday >= 10) { stopCardSpam(); return; }
      startCardSpamIfNeeded();
      return;
    }
    if (cardsToday >= 10) { stopCardSpam(); return; }

    const status = getReadRewardStatus();
    let minutes = null;
    if (status.current < status.total) {
      const rewardBlock = [...document.querySelectorAll('.user-quest__wrapper .user-quest__text')]
        .find(e => /Последняя награда/i.test(e.textContent));
      if (rewardBlock) minutes = parseTime(rewardBlock.textContent.trim());
      else {
        const lastRewardTime = getLastRewardTimeFromStorage();
        if (typeof lastRewardTime === 'number') minutes = (Date.now() - lastRewardTime) / (60 * 1000);
      }
    }
    if (minutes !== null && minutes >= TRIGGER_MINUTES && Date.now() - lastRewardClick > 10 * 60 * 1000) {
      clickReward();
    }
  }

  // ========== РЕКЛАМА ==========
  const ADS_INTERVAL = 5000;
  function clickAds() {
    const block = document.querySelector('.user-quest__item--watch_ads .user-quest__text') ||
                  document.querySelector('.wallet-panel__action--ads span');
    const text = block?.textContent || '';
    const m = text.match(/(\d+)\s*[xх]\s*(\d+)|(\d+)\s*из\s*(\d+)/i);
    if (!m) return;
    const cur = +(m[1] || m[3]), max = +(m[2] || m[4]);
    if (cur < max) {
      const btn = findQuestButton('watch_ads');
      if (btn) { btn.click(); showPopup('Реклама'); }
    }
  }

  // ========== ШАХТА ==========
  const MINE_INTERVAL = 4000;
  const MINE_LIMIT = 120;
  function mineLoop() {
    if (window.location.pathname !== '/mine') return;
    const block = document.querySelector('.user-quest__item--mine .user-quest__text') ||
                  document.querySelector('.main-mine__game-hits-left');
    const text = block?.textContent || '';
    const m = text.match(/Шахта\s+(\d+)\s*из\s+(\d+)|(\d+)\s*\/\s*(\d+)/);
    if (!m) return;
    const cur = +(m[1] || m[3]), max = +(m[2] || m[4]);
    if (cur < MINE_LIMIT && cur < max) {
      const btn = document.querySelector('.main-mine__hit-btn') || findQuestButton('mine');
      if (btn) { btn.click(); showPopup('Шахта'); }
    }
  }

  // ========== АЛМАЗ ЗА ЧАТ ==========
  const RELOAD_DELAY_MS = 1500;
  function clickChatDiamond() {
    const btn = findQuestButton('chat_diamond');
    if (btn) { btn.click(); showPopup('Алмаз за чат'); setTimeout(() => location.reload(), RELOAD_DELAY_MS); }
  }
  function scheduleChatDiamond() {
    const delay = (15 * 60 + Math.floor(Math.random() * 10)) * 1000;
    setTimeout(() => { clickChatDiamond(); scheduleChatDiamond(); }, delay);
  }

  // ========== КВИЗ ==========
  function hasQuizToday() {
    const stats = JSON.parse(localStorage.getItem("balance_stats") || "[]");
    const today = getTodayKey();
    const todayStats = stats.find(x => x.date === today);
    if (!todayStats) return false;
    return (todayStats.causes && todayStats.causes["Ежедневное прохождение квиза"] > 0);
  }

  function checkQuiz() {
    if (!hasQuizToday()) window.location.href = "/quiz";
  }

  function clickUpdateDayButton() {
    const buttons = document.querySelectorAll("button.button");
    for (const btn of buttons) {
      if (btn.textContent.includes("Обновить статистику за день")) { btn.click(); return true; }
    }
    return false;
  }

  // ========== QUIZ PAGE LOGIC ==========
  if (window.location.pathname.startsWith("/quiz")) {
    let answer = "";
    let clickCount = 0;
    const MAX_CLICKS = 11;
    $.ajaxSetup({
      headers: { 'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content') },
      complete: function (params) {
        if ('question' in params.responseJSON) answer = params.responseJSON.question.correct_text || "";
      }
    });
    const observer = new MutationObserver(mutations => {
      for (let mutation of mutations) {
        if (mutation.type === 'childList') {
          const items = document.querySelectorAll('.quiz__answer-item');
          if (clickCount === 0 && items.length > 0 && !answer) { items[0].click(); clickCount++; return; }
          items.forEach(item => {
            if (answer && item.innerText.trim() === answer.trim()) {
              if (clickCount < MAX_CLICKS) {
                setTimeout(() => {
                  item.click(); clickCount++;
                  if (clickCount >= MAX_CLICKS) window.location.href = "/balance";
                }, 5000);
              }
            }
          });
        }
      }
    });
    const targetNode = document.querySelector('.quiz__answers');
    if (targetNode) observer.observe(targetNode, { childList: true, subtree: true });
  }

  // ========== BALANCE PAGE LOGIC ==========
  if (window.location.pathname.startsWith("/balance")) {
    setTimeout(() => {
      ensureChaptersThenEvent();
      if (getReadChapters() >= 10) {
        setInterval(checkReward, CHECK_REWARD_INTERVAL);
        setInterval(clickAds, ADS_INTERVAL);
        if (window.location.pathname === '/mine') setInterval(mineLoop, MINE_INTERVAL);
        scheduleChatDiamond();
        // scheduleComments(); // закомментировано по умолчанию

        setTimeout(() => {
          if (clickUpdateDayButton()) {
            setTimeout(() => { if (!hasQuizToday()) window.location.href = "/quiz"; }, 5000 + Math.floor(Math.random() * 5000));
          } else { if (!hasQuizToday()) window.location.href = "/quiz"; }
        }, 2000);
      }
    }, 6000);
  }

  // ========== COMMENT PAGES ==========
  if (window.location.pathname.startsWith("/auctions") || window.location.pathname.startsWith("/rating")) {
    handleCommentPage();
  }

})();
