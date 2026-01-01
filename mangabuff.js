// ==UserScript==
// @name         MangaBuff Loader
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Подключает основной скрипт из GitHub
// @match        https://mangabuff.ru/*
// @grant        none
// @require      https://raw.githubusercontent.com/X3JDie/mangabuff-scripts/refs/heads/main/mangabuff.js
// ==/UserScript==


(function () {
  'use strict';

  // ==============================
  // 🔧 Утилиты
  // ==============================
  const CHECK_REWARD_INTERVAL = 30 * 1000;
  const ADS_INTERVAL = 5000;
  const MINE_INTERVAL = 2000;
  const MINE_LIMIT = 120;
  const RELOAD_DELAY_MS = 1500;
  const TRIGGER_MINUTES = 19;

  const COMMENT_CHECK_INTERVAL = 5 * 60 * 1000;
  const COMMENT_MIN_DELAY = 30 * 60 * 1000;
  const COMMENT_MAX_DELAY = 60 * 60 * 1000;

  let lastRewardClick = 0;
  let cardSpamInterval = null;

  const COMMENT_POOL = [
    "Привет всем","Всем привет, как настроение?","Добрый день, друзья!",
    "Всем хорошего дня или вечера","Привет, как у вас дела сегодня?",
    "Как проходит ваш день?","Что нового у вас?","Как настроение сегодня?",
    "Чем занимаетесь сейчас?","У меня всё отлично, спасибо!","Настроение супер, а у вас?",
    "День проходит спокойно 👍","Да всё нормально","Спасибо, дела идут хорошо!"
  ];

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
      position:'fixed',bottom:'20px',right:'20px',background:'#222',color:'#0f0',
      padding:'10px 15px',borderRadius:'10px',boxShadow:'0 0 10px #0f0',fontSize:'14px',zIndex:9999
    });
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
  }

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
      cards: items.filter(i => i.type === 'card'   && new Date(i.time).toLocaleDateString('ru-RU') === today).length,
      scrolls: items.filter(i => i.type === 'scroll' && new Date(i.time).toLocaleDateString('ru-RU') === today).length
    };
  }

  function getLastRewardTimeFromStorage() {
    const items = getRewards();
    if (items.length === 0) return null;
    const last = items.reduce((a, b) => (a.time > b.time ? a : b));
    return typeof last.time === 'number' ? last.time : null;
  }

  function getLastCardTime() {
    const cards = getRewards().filter(i => i.type === 'card');
    if (cards.length === 0) return null;
    const last = cards.reduce((a, b) => (a.time > b.time ? a : b));
    return typeof last.time === 'number' ? last.time : null;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function findQuestButton(name) {
    const block = document.querySelector(`.user-quest__item--${name}`);
    const btn = block?.querySelector('.user-quest__icon');
    return isVisible(btn) ? btn : null;
  }

  // ==============================
  // 🎃 Event
  // ==============================
  function isEventCompleted() {
    const eventBlock = document.querySelector('.user-quest__item--event .user-quest__text');
    const text = eventBlock?.textContent.replace(/\s+/g, ' ').trim() || '';
    const m = text.match(/Event\s+(\d+)\s+из\s+(\d+)/i);
    if (!m) return false;
    const cur = +m[1], max = +m[2];
    if (cur >= max) {
      if (!localStorage.getItem('event_done_once')) {
        console.log("✅ Event полностью завершён — обновляем страницу один раз");
        localStorage.setItem('event_done_once', getTodayKey());
        setTimeout(() => location.reload(), 2000);
      }
      return true;
    }
    return false;
  }

  function clickEventButton() {
    const btn = findQuestButton('event');
    if (btn) {
      btn.click();
      showPopup('🎃 Клик по Event');
    }
  }

  // ==============================
  // ❓ Квиз
  // ==============================
  function hasQuizToday() {
    const stats = JSON.parse(localStorage.getItem("balance_stats") || "[]");
    const today = getTodayKey();
    const todayStats = stats.find(x => x.date === today);
    if (!todayStats) return false;
    return (todayStats.causes && todayStats.causes["Ежедневное прохождение квиза"] > 0);
  }

  function checkQuiz() {
    if (!hasQuizToday()) {
      console.log("📗 Квиз не пройден — запускаем автопрохождение");
      window.location.href = "/quiz";
    } else {
      console.log("✅ Квиз уже пройден сегодня");
    }
  }

function clickUpdateDayButton() {
  const buttons = document.querySelectorAll("button.button");
  for (const btn of buttons) {
    if (btn.textContent.includes("Обновить статистику за день")) {
      btn.click();
      console.log("▶️ Нажали на кнопку 'Обновить статистику за день'");
      return true;
    }
  }
  console.log("⚠️ Кнопка 'Обновить статистику за день' не найдена");
  return false;
}

// ==============================
// 🚀 Запуск
// ==============================
window.MANGABUFF_VERSION = "2026.01.01 v1";
console.log("Загружена версия MangaBuff:", window.MANGABUFF_VERSION);


if (window.location.pathname.startsWith("/balance")) {
  setTimeout(() => {
    if (!isEventCompleted()) {
      console.log("🛑 Event не завершён — жмём Event и ждём лимит, остальные модули выключены");
      clickEventButton();
    } else {
      console.log("✅ Event завершён — запускаем основной код");

      setInterval(checkReward, CHECK_REWARD_INTERVAL);
      setInterval(clickAds, ADS_INTERVAL);
      setInterval(mineLoop, MINE_INTERVAL);

      scheduleChatDiamond();
      scheduleComments();

      // 👇 Проверка квиза
      setTimeout(() => {
        if (clickUpdateDayButton()) {
          setTimeout(() => {
            if (!hasQuizToday()) {
              console.log("📗 Квиз не пройден — запускаем автопрохождение");
              window.location.href = "/quiz";
            } else {
              console.log("✅ Квиз уже пройден сегодня");
            }
          }, 5000 + Math.floor(Math.random() * 5000));
        } else {
          if (!hasQuizToday()) {
            console.log("📗 Квиз не пройден — запускаем автопрохождение");
            window.location.href = "/quiz";
          } else {
            console.log("✅ Квиз уже пройден сегодня");
          }
        }
      }, 2000);
    }
  }, 3000);
}

if (window.location.pathname.startsWith("/auctions") || window.location.pathname.startsWith("/rating")) {
  handleCommentPage();
}
