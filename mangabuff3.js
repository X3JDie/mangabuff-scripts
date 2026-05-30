// ==UserScript==
// @name         MangaBuff Loader
// @namespace    http://tampermonkey.net/
// @version      1.10.0-full-restore
// @description  Полная логика v1.3.1 + клик по кнопке комментариев после 3 наград (20-44 сек) + алмазы 15:30-16 мин + битва с надёжным возвратом. Все функции сохранены.
// @match        https://mangabuff.ru/balance
// @match        https://mangabuff.ru/quiz
// @match        https://mangabuff.ru/mine
// @match        https://mangabuff.ru/battle
// @grant        none
// @run-at       document-end
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function () {
    'use strict';
    console.log("[Loader] 📦 Скрипт загружен. Версия 1.10.0 (полная логика + исправления)");

    // =====================================================================
    // 🔐 1. CSRF НАСТРОЙКА
    // =====================================================================
    function setupCSRF() {
        const token = document.querySelector('meta[name="csrf-token"]')?.content;
        if (!token) { console.warn('[Loader] ⚠️ CSRF-токен не найден'); return false; }
        $.ajaxSetup({
            headers: { 'X-CSRF-TOKEN': token },
            beforeSend: function(xhr) {
                const current = document.querySelector('meta[name="csrf-token"]')?.content;
                if (current && current !== token) xhr.setRequestHeader('X-CSRF-TOKEN', current);
            }
        });
        return true;
    }

    // =====================================================================
    // ⚙️ 2. НАСТРОЙКИ
    // =====================================================================
    const CHECK_REWARD_INTERVAL = 30000;
    const ADS_INTERVAL = 5000;
    const MINE_INTERVAL = 4000;
    const MINE_LIMIT = 120;
    const RELOAD_DELAY_MS = 1500;
    const TRIGGER_MINUTES = 19;
    const AGGRESSIVE_TRIGGER_MINUTES = 60;
    const AGGRESSIVE_RETRY_MS = 20000;

    // Комментарии (только клик по кнопке)
    const COMMENT_QUEST_START_AFTER_REWARDS = 3;
    const COMMENT_QUEST_MIN_DELAY = 20000;
    const COMMENT_QUEST_MAX_DELAY = 44000;

    // Алмазы за чат
    const CHAT_DIAMOND_MIN_MINUTES = 15.5;
    const CHAT_DIAMOND_MAX_MINUTES = 16;

    // Битва
    const BATTLE_REQUIRED_QUESTS = [
        { text: 'Провести 10 боев', required: '10/10' },
        { text: 'Выиграть 6 боев', required: '6/6' }
    ];
    const BATTLE_CHECK_INTERVAL = 8000;

    // =====================================================================
    // 📦 3. ПЕРЕМЕННЫЕ СОСТОЯНИЯ
    // =====================================================================
    let lastRewardClick = 0;
    let cardSpamInterval = null;
    let aggressiveRewardInterval = null;
    let commentQuestTimeout = null;
    let chatDiamondTimeout = null;
    let battleQuestCheckInterval = null;
    let battleFlowCompleted = false;
    let commentQuestStarted = false;
    let commentQuestDone = false;
    let questFlowActive = false;
    let _battleReturnGuard = false; // Защита от зацикливания возврата

    // Оригинальный пул (сохранён для совместимости, но не используется для отправки)
    const COMMENT_POOL = [
        "Привет всем ", "Всем привет, как настроение? ", "Добрый день, друзья! ",
        "Всем хорошего дня или вечера ", "Привет, как у вас дела сегодня? ",
        "Как проходит ваш день? ", "Что нового у вас? ", "Как настроение сегодня? ",
        "Чем занимаетесь сейчас? ", "У меня всё отлично, спасибо! ", "Настроение супер, а у вас? ",
        "День проходит спокойно 👍 ", "Да всё нормально ", "Спасибо, дела идут хорошо! "
    ];

    // =====================================================================
    // 🔧 4. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // =====================================================================
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
        } catch (e) { console.warn('[Loader] Popup error:', e); }
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

    // =====================================================================
    // 📊 5. ЧТЕНИЕ ПРОГРЕССА (DOM)
    // =====================================================================
    function getReadRewardsProgress() {
        const block = document.querySelector('.wallet-panel__drop--read_rewards .wallet-panel__drop-text');
        if (!block) return null;
        const m = block.textContent.trim().match(/(\d+)\s*из\s*(\d+)/i);
        return m ? { current: +m[1], total: +m[2], isComplete: +m[1] >= +m[2] } : null;
    }

    function getCommentsQuestProgress() {
        const block = document.querySelector('.wallet-panel__drop--comments .wallet-panel__drop-text');
        if (!block) return null;
        const m = block.textContent.trim().match(/(\d+)\s*из\s*(\d+)/i);
        return m ? { current: +m[1], total: +m[2], isComplete: +m[1] >= +m[2] } : null;
    }

    // =====================================================================
    // 💬 6. КЛИК ПО КВЕСТУ КОММЕНТАРИЕВ
    // =====================================================================
    function clickCommentsQuestButton() {
        const block = document.querySelector('.wallet-panel__drop--comments');
        const btn = block?.querySelector('.wallet-panel__drop-icon');
        if (btn && isVisible(btn)) {
            btn.click();
            showPopup('Комментарии +1');
            return true;
        }
        return false;
    }

    function scheduleCommentQuestClick() {
        if (commentQuestTimeout) clearTimeout(commentQuestTimeout);
        if (commentQuestDone) return;
        const progress = getCommentsQuestProgress();
        if (progress?.isComplete) { commentQuestDone = true; return; }
        const delay = COMMENT_QUEST_MIN_DELAY + Math.floor(Math.random() * (COMMENT_QUEST_MAX_DELAY - COMMENT_QUEST_MIN_DELAY));
        commentQuestTimeout = setTimeout(() => { clickCommentsQuestButton(); scheduleCommentQuestClick(); }, delay);
    }

    function tryStartCommentQuest() {
        if (commentQuestStarted || commentQuestDone) return;
        if (getCommentsQuestProgress()?.isComplete) { commentQuestDone = true; return; }
        const rewards = getReadRewardsProgress();
        if (rewards && rewards.current >= COMMENT_QUEST_START_AFTER_REWARDS) {
            commentQuestStarted = true;
            scheduleCommentQuestClick();
        }
    }

    // =====================================================================
    // 💎 7. АЛМАЗЫ ЗА ЧАТ
    // =====================================================================
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

    // =====================================================================
    // ⚔️ 8. БИТВА
    // =====================================================================
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

    function checkAndCollectBattleRewards() {
        if (!areBattleQuestsComplete() || _battleReturnGuard) return;
        _battleReturnGuard = true;

        console.log('[Loader] ✅ Квесты битвы выполнены. Сбор наград...');
        collectBattleRewards();

        // Синхронная запись флага перед переходом
        localStorage.setItem(`battle_flow_${getTodayKey()}`, 'true');
        window._battle_done = true;

        console.log('[Loader] 🔄 Возврат на /balance через 5 сек...');
        setTimeout(() => {
            window.location.assign('https://mangabuff.ru/balance');
        }, 5000);

        if (battleQuestCheckInterval) { clearInterval(battleQuestCheckInterval); battleQuestCheckInterval = null; }
    }

    function initBattlePage() {
        console.log('[Loader] ⚔️ Битва: запуск отслеживания');
        checkAndCollectBattleRewards();
        battleQuestCheckInterval = setInterval(checkAndCollectBattleRewards, BATTLE_CHECK_INTERVAL);
    }

    // =====================================================================
    // 📚 9. ЧТЕНИЕ И ИВЕНТЫ (ОРИГИНАЛ)
    // =====================================================================
    function isEventCompleted() {
        const text = document.querySelector('.wallet-panel__drop--event .wallet-panel__drop-text')?.textContent.replace(/\s+/g, ' ').trim() || '';
        const m = text.match(/(\d+)\s+из\s+(\d+)/i);
        if (!m) return false;
        const current = +m[1];
        const total = +m[2];
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
        if (!isEventCompleted()) { clickEventButton(); } 
        else {
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

    function getReadChapters() {
        const block = document.querySelector('.wallet-panel__drop--read .wallet-panel__drop-text');
        const m = block?.textContent.match(/(\d+)\s+из\s+(\d+)/);
        return m ? +m[1] : 0;
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

    // =====================================================================
    // 💎 10. НАГРАДЫ (ОРИГИНАЛ + КАРД-СПАМ + АГРЕССИВНЫЙ РЕЖИМ)
    // =====================================================================
    function clickReward() {
        const btn = findQuestButton('read_rewards');
        if (btn) {
            btn.click();
            lastRewardClick = Date.now();
            showPopup('Награда за чтение');
            tryStartCommentQuest();
            return true;
        }
        return false;
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
        if (aggressiveRewardInterval) { clearInterval(aggressiveRewardInterval); aggressiveRewardInterval = null; }
    }

    function checkReward() {
        if (questFlowActive) return; // Не мешаем последовательности квестов

        const cardsToday = getTodayCounts().cards;
        const chaptersDone = getReadChapters();
        
        if (cardsToday >= 10) {
            stopCardSpam();
            if (aggressiveRewardInterval) { clearInterval(aggressiveRewardInterval); aggressiveRewardInterval = null; }
            return;
        }
        
        if (chaptersDone >= 75) {
            startCardSpamIfNeeded();
            return;
        }

        const rewardTimeEl = document.querySelector('.read_rewards_container .reward-time');
        let minutes = null;
        
        if (rewardTimeEl && /Последняя награда:/i.test(rewardTimeEl.textContent)) {
            const timeText = rewardTimeEl.textContent.replace('Последняя награда:', '').trim();
            minutes = parseTime(timeText);
        } else {
            const lastRewardTime = getLastRewardTimeFromStorage();
            if (typeof lastRewardTime === 'number') {
                minutes = (Date.now() - lastRewardTime) / (60 * 1000);
            }
        }

        if (minutes === null) return;

        // АГРЕССИВНЫЙ РЕЖИМ
        if (minutes >= AGGRESSIVE_TRIGGER_MINUTES && !aggressiveRewardInterval) {
            console.log(`[Loader] ⚡ Агрессивный режим: прошло ${minutes} мин`);
            aggressiveRewardInterval = setInterval(() => {
                const currentCards = getTodayCounts().cards;
                if (currentCards > cardsToday || currentCards >= 10) {
                    console.log('[Loader] ✅ Награда получена, выход из агрессивного режима');
                    clearInterval(aggressiveRewardInterval); aggressiveRewardInterval = null; return;
                }
                const currentEl = document.querySelector('.read_rewards_container .reward-time');
                if (currentEl) {
                    const curText = currentEl.textContent.replace('Последняя награда:', '').trim();
                    const curMin = parseTime(curText);
                    if (curMin !== null && curMin < 5) {
                        console.log('[Loader] ✅ Таймер сбросился, выход из агрессивного режима');
                        clearInterval(aggressiveRewardInterval); aggressiveRewardInterval = null; return;
                    }
                }
                clickReward();
            }, AGGRESSIVE_RETRY_MS);
            clickReward();
            return;
        }

        // ОБЫЧНЫЙ РЕЖИМ
        if (minutes >= TRIGGER_MINUTES && Date.now() - lastRewardClick > 10 * 60 * 1000 && !aggressiveRewardInterval) {
            clickReward();
        }
    }

    // =====================================================================
    // 📺 11. РЕКЛАМА / ⛏️ ШАХТА
    // =====================================================================
    function clickAds() {
        const block = document.querySelector('.wallet-panel__drop--watch_ads .wallet-panel__drop-text');
        const m = block?.textContent.match(/(\d+)\s+из\s+(\d+)/);
        if (!m) return;
        const cur = +m[1], max = +m[2];
        if (cur < max) {
            const btn = findQuestButton('watch_ads');
            if (btn) { btn.click(); showPopup('Реклама'); }
        }
    }

    function mineLoop() {
        const block = document.querySelector('.wallet-panel__drop--mine .wallet-panel__drop-text');
        const m = block?.textContent.match(/(\d+)\s+из\s+(\d+)/);
        if (!m) return;
        const cur = +m[1], max = +m[2];
        if (cur < MINE_LIMIT && cur < max) {
            const btn = findQuestButton('mine');
            if (btn) { btn.click(); showPopup('Шахта'); }
        }
    }

    // =====================================================================
    // ❓ 12. КВИЗ (ОРИГИНАЛ)
    // =====================================================================
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

    // QUIZ SOLVER
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

    // =====================================================================
    // 🚀 13. ПОСЛЕДОВАТЕЛЬНОСТЬ КВЕСТОВ
    // =====================================================================
    function startQuestFlow() {
        // Жёсткая проверка флага (localStorage + window)
        const doneFlag = localStorage.getItem(`battle_flow_${getTodayKey()}`) === 'true' || window._battle_done === true;
        if (doneFlag || questFlowActive) {
            console.log('[Loader] ⏭️ Битва уже пройдена или поток активен.');
            return;
        }
        questFlowActive = true;
        console.log('[Loader] 🚀 Запуск последовательности квестов');
        runAllStages();
    }

    async function runAllStages() {
        // 1. Шахта
        console.log('[Loader] ⛏️ Этап 1: Шахта');
        const mineBtn = findQuestButton('mine');
        if (mineBtn && isVisible(mineBtn)) { mineBtn.click(); showPopup('Шахта'); }
        await sleep(3000);

        // 2. Ждём 3 награды
        console.log('[Loader] 💎 Этап 2: Ждём 3+ награды');
        while (true) {
            const rewards = getReadRewardsProgress();
            if (rewards && rewards.current >= 3) break;
            const rewardTimeEl = document.querySelector('.read_rewards_container .reward-time');
            let minutes = null;
            if (rewardTimeEl && /Последняя награда:/i.test(rewardTimeEl.textContent)) {
                minutes = parseTime(rewardTimeEl.textContent.replace('Последняя награда:', '').trim());
            }
            if (minutes !== null && minutes >= TRIGGER_MINUTES && Date.now() - lastRewardClick > 10*60*1000) {
                clickReward();
            }
            await sleep(5000);
        }

        // 3. Реклама + Квиз
        console.log('[Loader] 📺 Этап 3: Реклама и Квиз');
        const adsCheck = setInterval(() => {
            const block = document.querySelector('.wallet-panel__drop--watch_ads .wallet-panel__drop-text');
            const m = block?.textContent.match(/(\d+)\s+из\s+(\d+)/);
            if (m && +m[1] < +m[2]) {
                const btn = findQuestButton('watch_ads');
                if (btn && isVisible(btn)) btn.click();
            }
        }, ADS_INTERVAL);

        if (!hasQuizToday()) {
            console.log('[Loader] 🧩 Переход на квиз...');
            clearInterval(adsCheck);
            await sleep(2000);
            window.location.href = '/quiz';
            return;
        }
        clearInterval(adsCheck);
        await sleep(3000);

        // 4. Битва
        console.log('[Loader] ⚔️ Этап 4: Переход на /battle');
        await sleep(2000);
        window.location.href = '/battle';
    }

    // =====================================================================
    // 📍 14. ТОЧКИ ВХОДА
    // =====================================================================
    if (window.location.pathname.startsWith("/balance")) {
        setTimeout(() => {
            setupCSRF();
            ensureChaptersThenEvent();
            
            if (getReadChapters() >= 10) {
                setInterval(checkReward, CHECK_REWARD_INTERVAL);
                setInterval(clickAds, ADS_INTERVAL);
                setInterval(mineLoop, MINE_INTERVAL);
                scheduleChatDiamond();
                setInterval(tryStartCommentQuest, 10000);
                
                // Запуск цепочки квестов
                setTimeout(() => {
                    if (!hasQuizToday()) checkQuiz();
                }, 2000);

                setTimeout(() => {
                    if (clickUpdateDayButton()) {
                        setTimeout(() => { if (!hasQuizToday()) window.location.href = "/quiz"; }, 5000 + Math.floor(Math.random() * 5000));
                    } else { if (!hasQuizToday()) window.location.href = "/quiz"; }
                }, 4000);

                if (!questFlowActive && !window._battle_done) {
                    setTimeout(startQuestFlow, 8000);
                }
            }
        }, 6000);
    }

    if (window.location.pathname.startsWith("/battle")) {
        setupCSRF();
        initBattlePage();
    }

    if (window.location.pathname.startsWith("/quiz")) {
        setupCSRF();
    }

})();
