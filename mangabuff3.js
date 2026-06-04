// ==UserScript==
// @name         MangaBuff Loader
// @namespace    http://tampermonkey.net/
// @version      3.2.16
// @description  Читает главы через readFromQueue + Проверка награды по cursor: pointer + ТОЧНЫЙ подсчет конфет + Битва + Имитация активности
// @match        https://mangabuff.ru/balance
// @match        https://mangabuff.ru/quiz
// @match        https://mangabuff.ru/mine
// @match        https://mangabuff.ru/battle
// @match        https://mangabuff.ru/notifications
// @match        https://mangabuff.ru/auctions
// @match        https://mangabuff.ru/chat
// @grant        none
// @run-at       document-end
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function () {
  'use strict';

  console.log("[Loader] 📦 Скрипт загружен v3.2.16 (Битва + Имитация активности)" );
  
  const CHECK_REWARD_INTERVAL = 30000;
  const ADS_INTERVAL = 5000;
  const MINE_INTERVAL = 4000;
  const MINE_LIMIT = 120;
  const BATTLE_REQUIRED_QUESTS = [
    { text: 'Провести 10 боев', required: '10/10' },
    { text: 'Выиграть 11 боев', required: '11/11' }
  ];
  const BATTLE_CHECK_INTERVAL = 8000;

  let battleQuestCheckInterval = null;
  let _battleReturnGuard = false;

  function getTodayKey() {
    return new Date().toLocaleDateString('ru-RU');
  }

  function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
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

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function findQuestButton(name) {
    const block = document.querySelector(`.wallet-panel__drop--${name}`);
    const btn = block?.querySelector('.wallet-panel__drop-icon');
    return isVisible(btn) ? btn : null;
  }

  // ✅ ПРОВЕРКА ИВЕНТА: сначала смотрим в read_rewards_container (от Balance Stats)
  function isEventCompleted() {
    const headings = document.querySelectorAll('.read_rewards_container h2');
    for (let h2 of headings) {
      if (h2.textContent.includes('Конфеты')) {
        const match = h2.textContent.match(/Конфеты\s*\((\d+)\)/i);
        if (match) {
          const candies = parseInt(match[1], 10);
          if (candies >= 35) {
            if (!localStorage.getItem("event35_reload_done")) {
              localStorage.setItem("event35_reload_done", "true");
              location.reload();
            }
            return true; 
          }
        }
      }
    }

    // Fallback: проверяем через виджет квеста
    const eventBlock = document.querySelector('.wallet-panel__drop--event .wallet-panel__drop-text');
    const text = eventBlock?.textContent.replace(/\s+/g, ' ').trim() || '';
    const m = text.match(/Event\s+(\d+)\s+из\s+(\d+)/i);
    if (m) {
      const current = +m[1];
      const total = +m[2];
      if (current >= 35) {
        if (!localStorage.getItem("event35_reload_done")) {
          localStorage.setItem("event35_reload_done", "true");
          location.reload();
        }
        return true;
      }
      return current >= total;
    }

    return false;
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
    if (btn) {
      btn.click();
      showPopup('Event');
    }
  }
  
  function getReadChapters() {
    const block = document.querySelector('.wallet-panel__drop--read .wallet-panel__drop-text');
    const m = block?.textContent.match(/(\d+)\s+из\s+(\d+)/);
    return m ? +m[1] : 0;
  }

  async function readOneChapterDirect() {
    if (typeof window.readFromQueue === 'function') {
      try {
        const res = await window.readFromQueue();
        if (res) {
          console.log('[Loader] 📚 Глава прочитана через readFromQueue');
          return true;
        }
      } catch (e) {
        console.log('[Loader] 📚 readFromQueue ошибка:', e.message);
      }
    }
    const btn = findQuestButton('read');
    if (btn) {
      btn.click();
      showPopup('Чтение главы (fallback)');
      return true;
    }
    return false;
  }

  async function readChaptersUpTo(target) {
    let chapters = getReadChapters();
    console.log(`[Loader] 📚 Начинаю чтение. Текущий прогресс: ${chapters}/${target}`);
    
    while (chapters < target) {
      const success = await readOneChapterDirect();
      if (!success) {
        console.log('[Loader] 📚 Не удалось прочитать главу, жду...');
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      
      await new Promise(r => setTimeout(r, 10000));
      chapters = getReadChapters();
      console.log(`[Loader] 📚 Прогресс: ${chapters}/${target}`);
      
      if (chapters >= target) {
        console.log(`[Loader] 📚 ✅ Достигнуто ${target} глав!`);
        return;
      }
    }
  }

  async function ensureChaptersThenEvent() {
    const chapters = getReadChapters();
    console.log(`[Loader] 📚 Текущий прогресс: ${chapters} глав`);

    if (chapters < 10) {
      await readChaptersUpTo(10);
    }

    if (!localStorage.getItem("chapters_reload_done")) {
      console.log('[Loader] 📚 ✅ Главы >= 10. Делаю reload...');
      localStorage.setItem("chapters_reload_done", "true");
      location.reload();
    } else {
      console.log("[Loader] 📚 Главы >= 10, reload уже был. Кликаю ивент.");
      clickEventButton();
    }
  }

  function checkAndClaimRewards() {
    const rewardIcon = document.querySelector('.wallet-panel__drop--read_rewards .wallet-panel__drop-icon');
    if (!rewardIcon || !isVisible(rewardIcon)) return;

    const style = window.getComputedStyle(rewardIcon);
    if (style.cursor === 'pointer') {
      console.log('[Loader] 🎁 Награда доступна (cursor: pointer)! Забираем.');
      rewardIcon.click();
      showPopup('Награда за чтение');
    } else {
      console.log('[Loader] 🎁 Награда ещё не готова. Пропускаем.');
    }
  }

  function clickAds() {
    const block = document.querySelector('.wallet-panel__drop--watch_ads .wallet-panel__drop-text');
    const m = block?.textContent.match(/(\d+)\s+из\s+(\d+)/);
    if (!m) return;
    const cur = +m[1], max = +m[2];
    if (cur < max) {
      const btn = findQuestButton('watch_ads');
      if (btn) {
        btn.click();
        showPopup('Реклама');
      }
    }
  }

  function mineLoop() {
    const block = document.querySelector('.wallet-panel__drop--mine .wallet-panel__drop-text');
    const m = block?.textContent.match(/Шахта\s+(\d+)\s+из\s+(\d+)/);
    if (!m) return;
    const cur = +m[1], max = +m[2];
    if (cur < MINE_LIMIT && cur < max) {
      const btn = findQuestButton('mine');
      if (btn) {
        btn.click();
        showPopup('Шахта');
      }
    }
  }

  function hasQuizToday() {
    const stats = JSON.parse(localStorage.getItem("balance_stats") || "[]");
    const today = getTodayKey();
    const todayStats = stats.find(x => x.date === today);
    if (!todayStats) return false;
    return (todayStats.causes && todayStats.causes["Ежедневное прохождение квиза"] > 0);
  }

  function checkQuiz() {
    if (!hasQuizToday()) {
      window.location.href = "/quiz";
    }
  }

  // ==========================================
  // ⚔️ БИТВА
  // ==========================================
  function getBattleQuestsStatus() {
    const quests = [];
    document.querySelectorAll('.battle-home__quest[data-daily-quest]').forEach(el => {
      const title = el.querySelector('.battle-home__quest-info b')?.textContent.trim() || '';
      const progress = el.querySelector('.battle-home__quest-progress span')?.textContent.trim() || '';
      const isCompleted = el.classList.contains('battle-home__quest--completed');
      BATTLE_REQUIRED_QUESTS.forEach(req => {
        if (title.includes(req.text)) quests.push({ title, progress, isCompleted });
      });
    });
    return quests;
  }

  function areBattleQuestsComplete() {
    const quests = getBattleQuestsStatus();
    return BATTLE_REQUIRED_QUESTS.every(req => {
      const q = quests.find(x => x.title.includes(req.text));
      return q && q.progress.replace(/\s+/g, ' ').trim() === req.required && q.isCompleted;
    });
  }

  function collectBattleRewards() {
    document.querySelectorAll('.battle-home__quest[data-daily-quest]').forEach(el => {
      const btn = el.querySelector('button[type="button"]');
      if (btn && !btn.disabled && btn.textContent.trim() !== 'Получено' && btn.textContent.trim() !== 'В процессе') {
        btn.click();
      }
    });
  }

  function createBattleToggle() {
    if (window.location.pathname !== '/battle') return;
    const existing = document.getElementById('mb-battle-toggle');
    if (existing) existing.remove();

    const btn = document.createElement('button');
    btn.id = 'mb-battle-toggle';
    
    const updateBtnUI = () => {
      const isStaying = localStorage.getItem('mb_stay_in_battle') === 'true';
      btn.textContent = isStaying ? '🔓 ОСТАТЬСЯ (Возврат ОТКЛЮЧЕН)' : '🔒 АВТО-ВОЗВРАТ на баланс';
      btn.style.borderColor = isStaying ? '#0f0' : '#f00';
      btn.style.background = isStaying ? '#1a3a1a' : '#3a1a1a';
      btn.style.boxShadow = isStaying ? '0 0 15px #0f0' : '0 0 15px #f00';
    };
    
    updateBtnUI();
    btn.style.cssText = 'position:fixed;top:20px;right:20px;padding:12px 20px;color:#fff;border:2px solid;border-radius:8px;cursor:pointer;z-index:9999;font-size:14px;font-weight:bold;transition:0.2s;';
    
    btn.onclick = () => {
      const newState = localStorage.getItem('mb_stay_in_battle') !== 'true';
      localStorage.setItem('mb_stay_in_battle', newState);
      updateBtnUI();
      showPopup(newState ? 'Режим: ОСТАТЬСЯ в битве' : 'Режим: Авто-возврат включен');
      console.log(`[Loader] ⚔️ Режим битвы изменен на: ${newState ? 'Остаться' : 'Авто-возврат'}`);
      
      if (newState && battleQuestCheckInterval) {
        clearInterval(battleQuestCheckInterval);
        battleQuestCheckInterval = null;
        console.log('[Loader] ⚔️ Таймер возврата принудительно остановлен переключателем.');
      }
    };
    
    document.body.appendChild(btn);
  }

  function checkAndCollectBattleRewards() {
    if (!areBattleQuestsComplete() || _battleReturnGuard) return;
    
    _battleReturnGuard = true;
    collectBattleRewards();
    localStorage.setItem(`battle_flow_${getTodayKey()}`, 'true');

    const isStaying = localStorage.getItem('mb_stay_in_battle') === 'true';
    console.log(`[Loader] ⚔️ Квесты выполнены. Текущий режим: ${isStaying ? 'ОСТАТЬСЯ' : 'ВОЗВРАТ'}`);

    if (!isStaying) {
      console.log('[Loader] 🔄 Возврат на /balance через 5 сек...');
      if (battleQuestCheckInterval) {
        clearInterval(battleQuestCheckInterval);
        battleQuestCheckInterval = null;
      }
      setTimeout(() => {
        window.location.replace('https://mangabuff.ru/balance');
      }, 5000);
    } else {
      console.log('[Loader] ⏸️ Режим "Остаться" активен. Редирект отменен.');
      if (battleQuestCheckInterval) {
        clearInterval(battleQuestCheckInterval);
        battleQuestCheckInterval = null;
      }
    }
  }

  function initBattlePage() {
    createBattleToggle();
    checkAndCollectBattleRewards();
    battleQuestCheckInterval = setInterval(checkAndCollectBattleRewards, BATTLE_CHECK_INTERVAL);
  }

  function clickUpdateDayButton() {
    const buttons = document.querySelectorAll("button.button");
    for (const btn of buttons) {
      if (btn.textContent.includes("Обновить статистику за день")) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  // ==========================================
  // 🚶 ИМИТАЦИЯ ЧЕЛОВЕКА
  // ==========================================
  function scheduleRandomWander() {
    const actions = [
      { path: '/notifications', minDelay: 30*60*1000, maxDelay: 3*60*60*1000 },
      { path: '/auctions', minDelay: 30*60*1000, maxDelay: 2*60*60*1000 },
      { path: '/chat', minDelay: 40*60*1000, maxDelay: 2.5*60*60*1000 }
    ];
    const action = actions[Math.floor(Math.random() * actions.length)];
    const delay = getRandomInt(action.minDelay, action.maxDelay);

    console.log(`[Loader] 🚶 Планирую имитацию (${action.path}) через ~${Math.round(delay/60000)} мин.`);
    setTimeout(() => {
      console.log(`[Loader] 🚶 Перехожу на ${action.path}...`);
      sessionStorage.setItem('mb_wander_target', action.path);
      window.location.href = action.path;
    }, delay);
  }

  // ==========================================
  // 📄 СТРАНИЦА КВИЗА
  // ==========================================
  if (window.location.pathname.startsWith("/quiz")) {
    let answer = "";
    let clickCount = 0;
    const MAX_CLICKS = 11;

    $.ajaxSetup({
      headers: { 'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content') },
      complete: function (params) {
        if ('question' in params.responseJSON) {
          answer = params.responseJSON.question.correct_text || "";
        }
      }
    });

    const observer = new MutationObserver(mutations => {
      for (let mutation of mutations) {
        if (mutation.type === 'childList') {
          const items = document.querySelectorAll('.quiz__answer-item');
          if (clickCount === 0 && items.length > 0 && !answer) {
            items[0].click();
            clickCount++;
            return;
          }
          items.forEach(item => {
            if (answer && item.innerText.trim() === answer.trim()) {
              if (clickCount < MAX_CLICKS) {
                setTimeout(() => {
                  item.click();
                  clickCount++;
                  if (clickCount >= MAX_CLICKS) {
                    window.location.href = "/balance";
                  }
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

  // ==========================================
  // 📄 СТРАНИЦА УВЕДОМЛЕНИЙ (имитация)
  // ==========================================
  else if (window.location.pathname === '/notifications' && sessionStorage.getItem('mb_wander_target') === '/notifications') {
    sessionStorage.removeItem('mb_wander_target');
    setTimeout(() => {
      const readAllBtn = document.querySelector('.notifications__read-all-btn');
      if (readAllBtn && isVisible(readAllBtn)) readAllBtn.click();
      setTimeout(() => { window.location.href = '/balance'; }, getRandomInt(20000, 160000));
    }, getRandomInt(60000, 180000));
  }

  // ==========================================
  // 📄 СТРАНИЦА АУКЦИОНОВ (имитация)
  // ==========================================
  else if (window.location.pathname === '/auctions' && sessionStorage.getItem('mb_wander_target') === '/auctions') {
    sessionStorage.removeItem('mb_wander_target');
    setTimeout(() => {
      window.scrollBy({ top: getRandomInt(200, 600), behavior: 'smooth' });
      setTimeout(() => {
        const sortBtns = document.querySelectorAll('.comments__change-sort');
        if (sortBtns.length > 0) sortBtns[Math.floor(Math.random() * sortBtns.length)].click();
      }, 4000);
      setTimeout(() => {
        const textarea = document.querySelector('.comments__send-form textarea');
        if (textarea) { textarea.focus(); setTimeout(() => textarea.blur(), 1500); }
      }, 8000);
    }, 3000);
    setTimeout(() => { window.location.href = '/balance'; }, getRandomInt(150000, 210000));
  }

  // ==========================================
  // 📄 СТРАНИЦА ЧАТА (имитация)
  // ==========================================
  else if (window.location.pathname === '/chat' && sessionStorage.getItem('mb_wander_target') === '/chat') {
    sessionStorage.removeItem('mb_wander_target');
    setTimeout(() => { window.scrollBy({ top: getRandomInt(300, 800), behavior: 'smooth' }); }, 4000);
    setTimeout(() => { window.location.href = '/balance'; }, getRandomInt(60000, 180000));
  }

  // ==========================================
  // 📄 СТРАНИЦА БАЛАНСА (основная логика)
  // ==========================================
  else if (window.location.pathname.startsWith("/balance")) {
    setTimeout(async () => {
      await ensureChaptersThenEvent();

      if (getReadChapters() >= 10) {
        setInterval(checkAndClaimRewards, CHECK_REWARD_INTERVAL);
        checkAndClaimRewards();

        if (isEventCompleted()) {
          proceedEventCheck();
        }

        setInterval(clickAds, ADS_INTERVAL);
        setInterval(mineLoop, MINE_INTERVAL);

        setTimeout(() => {
          if (clickUpdateDayButton()) {
            setTimeout(() => {
              if (!hasQuizToday()) {
                window.location.href = "/quiz";
              }
            }, 5000 + Math.floor(Math.random() * 5000));
          } else {
            if (!hasQuizToday()) {
              window.location.href = "/quiz";
            }
          }
        }, 2000);

        // 🚶 Запускаем имитацию активности
        scheduleRandomWander();
      }
    }, 6000);
  }

  // ==========================================
  // 📄 СТРАНИЦА БИТВЫ
  // ==========================================
  else if (window.location.pathname.startsWith("/battle")) {
    initBattlePage();
  }

})();
