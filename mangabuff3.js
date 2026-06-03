// ==UserScript==
// @name         MangaBuff Loader
// @namespace    http://tampermonkey.net/
// @version      1.11.9
// @description  Жёсткие перезагрузки + Задержка 10-120с + Защита от сжигания глав + Умные комментарии + Битва + 180мин карты + Имитация человека
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
// @require      https://cdn.jsdelivr.net/gh/X3JDie/mangabuff-scripts@main/mangabuff4
// ==/UserScript==

(function () {
    'use strict';
    console.log("[Loader] 📦 Скрипт загружен. Версия 1.11.9 (Задержка 10-120с + Защита глав)");

    // ==========================================
    // ⚙️ НАСТРОЙКИ
    // ==========================================
    const CARD_COOLDOWN_MINUTES = 180; // 180 для новых, 60 для старых
    const SCROLL_CHECK_MINUTES = 19;
    const MAX_FAILED_READ_ATTEMPTS = 5;
    // ==========================================

    function setupCSRF() {
        const token = document.querySelector('meta[name="csrf-token"]')?.content;
        if (!token) return false;
        $.ajaxSetup({
            headers: { 'X-CSRF-TOKEN': token },
            beforeSend: function(xhr) {
                const current = document.querySelector('meta[name="csrf-token"]')?.content;
                if (current && current !== token) xhr.setRequestHeader('X-CSRF-TOKEN', current);
            }
        });
        return true;
    }

    const ADS_INTERVAL = 5000;
    const MINE_INTERVAL = 4000;
    const MINE_LIMIT = 120;
    const RELOAD_DELAY_MS = 1500;
    const COMMENT_QUEST_START_AFTER_REWARDS = 3;
    const CHAT_DIAMOND_MIN_MINUTES = 15.5;
    const CHAT_DIAMOND_MAX_MINUTES = 16;
    const BATTLE_REQUIRED_QUESTS = [
        { text: 'Провести 10 боев', required: '10/10' },
        { text: 'Выиграть 6 боев', required: '6/6' }
    ];
    const BATTLE_CHECK_INTERVAL = 8000;

    let chatDiamondTimeout = null;
    let battleQuestCheckInterval = null;
    let questFlowActive = false;
    let _battleReturnGuard = false;
    
    let isFarmingCard = false;
    let farmCardInterval = null;
    
    let commentsClickedThisSession = 0;
    let commentQuestActive = false;

    function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function getTodayKey() { return new Date().toLocaleDateString('ru-RU'); }

    function parseTime(text) {
        if (!text) return null;
        const h = text.match(/(\d+)\sч/);
        const m = text.match(/(\d+)\sмин/);
        const s = text.match(/(\d+)\s*сек/);
        return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (s ? +s[1] / 60 : 0);
    }

    function showPopup(msg) {
        try {
            const div = document.createElement('div');
            div.textContent = msg;
            div.style.position = 'fixed'; div.style.bottom = '20px'; div.style.right = '20px';
            div.style.background = '#222'; div.style.color = '#0f0'; div.style.padding = '10px 15px';
            div.style.borderRadius = '10px'; div.style.boxShadow = '0 0 10px #0f0';
            div.style.fontSize = '14px'; div.style.zIndex = '9999'; div.style.pointerEvents = 'none';
            if (document.body) {
                document.body.appendChild(div);
                setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 3000);
            }
        } catch (e) {}
    }

    function getRewards() {
        try {
            const raw = localStorage.getItem('read_rewards');
            const obj = JSON.parse(raw);
            return Array.isArray(obj?.items) ? obj.items : [];
        } catch { return []; }
    }

    function getTodayCounts() {
        const today = new Date().toLocaleDateString('ru-RU');
        const items = getRewards();
        return {
            cards: items.filter(i => i.type === 'card' && new Date(i.time).toLocaleDateString('ru-RU') === today).length,
            scrolls: items.filter(i => i.type === 'scroll' && new Date(i.time).toLocaleDateString('ru-RU') === today).length
        };
    }

    function getLastRewardTimeFromStorage() {
        const items = getRewards();
        if (items.length === 0) return null;
        const last = items.reduce((a, b) => (a.time > b.time ? a : b));
        return typeof last.time === 'number' ? last.time : null;
    }

    function getLastCardTimeFromStorage() {
        const items = getRewards();
        if (!items || items.length === 0) return null;
        const cards = items.filter(i => i.type === 'card');
        if (cards.length === 0) return null;
        const lastCard = cards.reduce((a, b) => (a.time > b.time ? a : b));
        return typeof lastCard.time === 'number' ? lastCard.time : null;
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

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function getReadRewardsProgress() {
        const block = document.querySelector('.wallet-panel__drop--read_rewards .wallet-panel__drop-text');
        if (!block) return null;
        const m = block.textContent.trim().match(/(\d+)\s*из\s*(\d+)/i);
        return m ? { current: +m[1], total: +m[2], isComplete: +m[1] >= +m[2] } : null;
    }

    // ==========================================
    // ЖЁСТКИЕ ПЕРЕЗАГРУЗКИ (Аналог Ctrl+F5)
    // ==========================================
    function handleHardReloads() {
        const todayReloadKey = `mb_reload_done_${getTodayKey()}`;
        
        if (sessionStorage.getItem(todayReloadKey)) {
            console.log('[Loader] ✅ Жёсткие перезагрузки сегодня уже выполнены');
            return false;
        }

        const reloadState = sessionStorage.getItem('mb_reload_state') || '0';
        
        if (reloadState === '0') {
            console.log('[Loader] 🔄 Выполняю ПЕРВУЮ жёсткую перезагрузку (Ctrl+F5)...');
            sessionStorage.setItem('mb_reload_state', '1');
            setTimeout(() => location.reload(true), 1000);
            return true;
        }
        
        if (reloadState === '1') {
            const delay = 5000 + Math.random() * 6000; // 5-11 секунд
            console.log(`[Loader] 🔄 Выполняю ВТОРУЮ жёсткую перезагрузку через ${Math.round(delay/1000)} сек...`);
            sessionStorage.setItem('mb_reload_state', '2');
            setTimeout(() => location.reload(true), delay);
            return true;
        }
        
        console.log('[Loader] ✅ Обе жёсткие перезагрузки выполнены. Продолжаем работу.');
        sessionStorage.setItem(todayReloadKey, 'true');
        sessionStorage.removeItem('mb_reload_state');
        return false;
    }

    // ==========================================
    // УМНАЯ ЛОГИКА КОММЕНТАРИЕВ
    // ==========================================
    function getCommentsQuestData() {
        const block = document.querySelector('.wallet-panel__drop--comments .wallet-panel__drop-text');
        if (!block) return null;
        const m = block.textContent.trim().match(/(\d+)\s*из\s*(\d+)/i);
        if (m) {
            return {
                current: parseInt(m[1], 10),
                target: parseInt(m[2], 10),
                isComplete: parseInt(m[1], 10) >= parseInt(m[2], 10)
            };
        }
        return null;
    }

    function processCommentsQuest() {
        const data = getCommentsQuestData();
        if (!data) return;
        
        if (data.isComplete) {
            console.log("[Loader] 💬 Квест комментариев выполнен!");
            commentQuestActive = false;
            commentsClickedThisSession = 0;
            return;
        }

        commentQuestActive = true;
        const needed = data.target - data.current;
        
        if (commentsClickedThisSession >= needed) {
            console.log(`[Loader] 💬 Локально сделано ${commentsClickedThisSession} из ${needed}. Перезагружаю страницу для синхронизации...`);
            setTimeout(() => location.reload(), 2000);
            return;
        }

        const btn = document.querySelector('.wallet-panel__drop--comments .wallet-panel__drop-icon');
        if (btn && isVisible(btn)) {
            btn.click();
            commentsClickedThisSession++;
            showPopup(`Комментарий ${commentsClickedThisSession}/${needed}`);
            console.log(`[Loader] 💬 Клик ${commentsClickedThisSession}. Ожидание...`);
            setTimeout(processCommentsQuest, 3000 + Math.random() * 3000);
        } else {
            console.log("[Loader] 💬 Кнопка комментариев не найдена.");
            commentQuestActive = false;
        }
    }

    function tryStartCommentQuest() {
        if (commentQuestActive) return;
        const rewards = getReadRewardsProgress();
        if (rewards && rewards.current >= COMMENT_QUEST_START_AFTER_REWARDS) {
            console.log("[Loader] 💬 Набрано достаточно наград. Запускаю умный сбор комментариев...");
            commentsClickedThisSession = 0;
            setTimeout(processCommentsQuest, 2000);
        }
    }

    // ==========================================
    // БЕЗОПАСНОЕ ЧТЕНИЕ ГЛАВ (С ЗАЩИТОЙ ОТ СЖИГАНИЯ)
    // ==========================================
    function getReadChapters() {
        const block = document.querySelector('.wallet-panel__drop--read .wallet-panel__drop-text');
        if (!block) {
            console.log('[Loader]  ⚠️ Блок чтения не найден в DOM');
            return -1;
        }
        const m = block.textContent.match(/(\d+)\s+из\s+(\d+)/);
        const result = m ? +m[1] : -1;
        console.log(`[Loader] 📚 Счётчик глав: ${result === -1 ? 'не определён' : result}`);
        return result;
    }

    function clickReadButton() {
        const chapters = getReadChapters();
        if (chapters === -1) {
            console.log('[Loader] 📚 ⚠️ Не могу проверить счётчик, пропускаю клик');
            return false;
        }
        if (chapters >= 75) {
            console.log('[Loader] 📚 🛑 Лимит 75 глав достигнут. Останавливаюсь.');
            return false;
        }
        const btn = findQuestButton('read');
        if (btn) { 
            btn.click(); 
            showPopup('Чтение главы'); 
            console.log(`[Loader]  ✅ Кликнул кнопку чтения. Текущий прогресс: ${chapters}/75`);
            return true; 
        }
        console.log('[Loader] 📚 ❌ Кнопка чтения не найдена или невидима');
        return false;
    }

    function ensureChaptersThenEvent() {
        console.log('[Loader] 📚 === ЗАПУСК ЛОГИКИ ЧТЕНИЯ ГЛАВ ===');
        
        let currentChapters = getReadChapters();
        
        if (currentChapters === -1) {
            console.log('[Loader] 📚 ⏳ DOM ещё не загрузился, повторю через 3 сек...');
            setTimeout(ensureChaptersThenEvent, 3000);
            return;
        }
        
        if (currentChapters >= 75) {
            console.log('[Loader] 📚 🛑 Лимит 75 глав уже достигнут. Пропускаю чтение.');
            return;
        }
        
        if (currentChapters >= 10) {
            console.log(`[Loader]  ✅ Уже прочитано ${currentChapters} глав (>=10). Перехожу к Event.`);
            if (!localStorage.getItem("chapters_reload_done")) {
                localStorage.setItem("chapters_reload_done", "true");
                setTimeout(() => location.reload(), 3000);
            }
            return;
        }

        console.log(`[Loader] 📚 📖 Начинаю чтение. Текущий прогресс: ${currentChapters}/10`);
        
        clickReadButton();
        let lastKnownChapters = currentChapters;
        let failedAttempts = 0;
        
        const readInterval = setInterval(() => {
            currentChapters = getReadChapters();
            
            if (currentChapters === -1) {
                console.log('[Loader]  ⚠️ DOM временно недоступен, жду...');
                return;
            }
            
            if (currentChapters >= 10) {
                clearInterval(readInterval);
                console.log(`[Loader] 📚 🎯 ЦЕЛЬ ДОСТИГНУТА! Прочитано ${currentChapters} глав.`);
                if (!localStorage.getItem("chapters_reload_done")) {
                    localStorage.setItem("chapters_reload_done", "true");
                    setTimeout(() => location.reload(), 3000);
                }
                return;
            }
            
            if (currentChapters === lastKnownChapters) {
                failedAttempts++;
                console.log(`[Loader] 📚 ⚠️ Прогресс не изменился: ${currentChapters}. Неудачная попытка ${failedAttempts}/${MAX_FAILED_READ_ATTEMPTS}`);
                
                if (failedAttempts >= MAX_FAILED_READ_ATTEMPTS) {
                    console.log(`[Loader] 📚 🛑 СЛИШКОМ МНОГО НЕУДАЧ (${failedAttempts}). Останавливаю чтение, чтобы не сжечь лимит.`);
                    clearInterval(readInterval);
                    showPopup('Чтение остановлено (сервер не отвечает)');
                    return;
                }
                
                console.log('[Loader] 📚 Повторный клик...');
                clickReadButton();
            } else {
                console.log(`[Loader]  ✅ Прогресс обновлён: ${lastKnownChapters} → ${currentChapters}`);
                lastKnownChapters = currentChapters;
                failedAttempts = 0;
            }
        }, 15000 + Math.random() * 5000);
    }

    // ==========================================
    // КАРТЫ И СВИТКИ
    // ==========================================
    function claimRewardButton() {
        const btn = findQuestButton('read_rewards');
        if (btn && isVisible(btn)) {
            btn.click();
            showPopup('Награда');
            tryStartCommentQuest();
            return true;
        }
        return false;
    }

    function startCardFarming() {
        if (isFarmingCard) return;
        isFarmingCard = true;
        console.log('[Loader]  Запускаем быстрый сбор карты...');
        claimRewardButton();

        farmCardInterval = setInterval(() => {
            const lastCardTime = getLastCardTimeFromStorage();
            const minsPassed = lastCardTime ? (Date.now() - lastCardTime) / (1000 * 60) : 999;
            if (minsPassed < 3) {
                console.log('[Loader] 🃏 Карта получена! Останавливаем сбор.');
                clearInterval(farmCardInterval);
                farmCardInterval = null;
                isFarmingCard = false;
                return;
            }
            console.log('[Loader] 🃏 Карта еще не выпала, повторяем клик...');
            claimRewardButton();
        }, 20000 + Math.random() * 20000);
    }

    function checkCardTimer() {
        if (isFarmingCard) return;
        const lastCardTime = getLastCardTimeFromStorage();
        const minsPassed = lastCardTime ? (Date.now() - lastCardTime) / (1000 * 60) : 999;
        if (minsPassed >= CARD_COOLDOWN_MINUTES + 1) {
            console.log(`[Loader] ⏳ Прошло ${Math.floor(minsPassed)} мин с последней КАРТЫ. Забираем!`);
            startCardFarming();
        }
    }

    // ==========================================
    // АЛМАЗ ЗА ЧАТ
    // ==========================================
    function clickChatDiamond() {
        const btn = findQuestButton('chat_diamond');
        if (btn && isVisible(btn)) {
            btn.click();
            showPopup('Алмаз за чат');
            setTimeout(() => location.reload(), RELOAD_DELAY_MS);
            return true;
        }
        return false;
    }

    function scheduleChatDiamond() {
        if (chatDiamondTimeout) clearTimeout(chatDiamondTimeout);
        const minMs = CHAT_DIAMOND_MIN_MINUTES * 60 * 1000;
        const maxMs = CHAT_DIAMOND_MAX_MINUTES * 60 * 1000;
        const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
        chatDiamondTimeout = setTimeout(() => { clickChatDiamond(); scheduleChatDiamond(); }, delay);
    }

    // ==========================================
    // БИТВА
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
            console.log(`[Loader] ️ Режим битвы изменен на: ${newState ? 'Остаться' : 'Авто-возврат'}`);
            
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
        window._battle_done = true;

        const isStaying = localStorage.getItem('mb_stay_in_battle') === 'true';
        console.log(`[Loader] ️ Квесты выполнены. Текущий режим: ${isStaying ? 'ОСТАТЬСЯ' : 'ВОЗВРАТ'}`);

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

    // ==========================================
    // ПРОЧИЕ КВЕСТЫ
    // ==========================================
    function clickAds() {
        const block = document.querySelector('.wallet-panel__drop--watch_ads .wallet-panel__drop-text');
        const m = block?.textContent.match(/(\d+)\s+из\s+(\d+)/);
        if (!m) return;
        if (+m[1] < +m[2]) {
            const btn = findQuestButton('watch_ads');
            if (btn) { btn.click(); showPopup('Реклама'); }
        }
    }

    function mineLoop() {
        const block = document.querySelector('.wallet-panel__drop--mine .wallet-panel__drop-text');
        const m = block?.textContent.match(/(\d+)\s+из\s+(\d+)/);
        if (!m) return;
        if (+m[1] < MINE_LIMIT && +m[1] < +m[2]) {
            const btn = findQuestButton('mine');
            if (btn) { btn.click(); showPopup('Шахта'); }
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
        if (!hasQuizToday()) window.location.href = "/quiz";
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
    // ИМИТАЦИЯ ЧЕЛОВЕКА
    // ==========================================
    function scheduleRandomWander() {
        if (questFlowActive || isFarmingCard || commentQuestActive) {
            setTimeout(scheduleRandomWander, 5 * 60 * 1000);
            return;
        }

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
    // МАРШРУТИЗАЦИЯ ПО СТРАНИЦАМ
    // ==========================================
    
    if (window.location.pathname === '/notifications' && sessionStorage.getItem('mb_wander_target') === '/notifications') {
        sessionStorage.removeItem('mb_wander_target');
        setTimeout(() => {
            const readAllBtn = document.querySelector('.notifications__read-all-btn');
            if (readAllBtn && isVisible(readAllBtn)) readAllBtn.click();
            setTimeout(() => { window.location.href = '/balance'; }, getRandomInt(20000, 160000));
        }, getRandomInt(60000, 180000));
    }
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
    else if (window.location.pathname === '/chat' && sessionStorage.getItem('mb_wander_target') === '/chat') {
        sessionStorage.removeItem('mb_wander_target');
        setTimeout(() => { window.scrollBy({ top: getRandomInt(300, 800), behavior: 'smooth' }); }, 4000);
        setTimeout(() => { window.location.href = '/balance'; }, getRandomInt(60000, 180000));
    }
    else if (window.location.pathname.startsWith("/quiz")) {
        let answer = "";
        let clickCount = 0;
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
                            if (clickCount < 11) {
                                setTimeout(() => {
                                    item.click(); clickCount++;
                                    if (clickCount >= 11) window.location.href = "/balance";
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
    else if (window.location.pathname.startsWith("/balance")) {
        // ЖЁСТКИЕ ПЕРЕЗАГРУЗКИ
        if (handleHardReloads()) {
            console.log('[Loader] ⏸️ Ожидаю перезагрузку страницы...');
            return;
        }
        
        // ЗАДЕРЖКА 10-120 СЕКУНД ПЕРЕД НАЧАЛОМ ДЕЙСТВИЙ
        const initialDelay = getRandomInt(10000, 120000);
        console.log(`[Loader] ⏳ Задержка перед началом действий: ${Math.round(initialDelay/1000)} секунд (имитация человека)...`);
        
        setTimeout(() => {
            setupCSRF();
            
            console.log('[Loader] 🚀 Запуск основной логики /balance');
            ensureChaptersThenEvent();
            
            if (getReadChapters() >= 10 || getReadChapters() === -1) {
                console.log(`[Loader] ✅ Квест 10 глав выполнен или пропускаем. Запускаем сбор наград...`);
                
                setInterval(() => { 
                    if (!isFarmingCard && !commentQuestActive) claimRewardButton(); 
                }, SCROLL_CHECK_MINUTES * 60 * 1000);
                
                setInterval(checkCardTimer, 60 * 1000);
                checkCardTimer();

                setInterval(clickAds, ADS_INTERVAL);
                setInterval(mineLoop, MINE_INTERVAL);
                scheduleChatDiamond();
                setInterval(tryStartCommentQuest, 10000);
                
                setTimeout(() => { if (!hasQuizToday()) checkQuiz(); }, 2000);
                setTimeout(() => {
                    if (clickUpdateDayButton()) {
                        setTimeout(() => { if (!hasQuizToday()) window.location.href = "/quiz"; }, 5000 + Math.floor(Math.random() * 5000));
                    } else { if (!hasQuizToday()) window.location.href = "/quiz"; }
                }, 4000);
                
                scheduleRandomWander();
            }
        }, initialDelay);
    }
    else if (window.location.pathname.startsWith("/battle")) {
        setupCSRF();
        initBattlePage();
    }

})();
