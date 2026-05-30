// ==UserScript==
// @name         MangaBuff Sequential Loader v2.8 (No Reload Spam)
// @namespace    http://tampermonkey.net/
// @version      2.8.0
// @description  Обновляет данные кнопкой "Обновить статистику", а не перезагрузкой. Умный цикл комментов. Агрессия.
// @match        https://mangabuff.ru/balance
// @match        https://mangabuff.ru/quiz
// @match        https://mangabuff.ru/mine
// @match        https://mangabuff.ru/battle
// @grant        none
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function () {
    'use strict';
    console.log("[Loader v2.8] 🚀 Обновление через кнопку статистики. Без спама перезагрузками.");

    // --- КОНСТАНТЫ ---
    const CHECK_INTERVAL = 5000; 
    const ACTION_DELAY_MIN = 2000;
    const ACTION_DELAY_MAX = 5000;
    
    // Агрессивный режим
    const AGGRESSIVE_TRIGGER_MIN = 61; 
    const AGGRESSIVE_RETRY_MS = 15000; 
    
    // Комментарии
    const COMMENT_CLICK_DELAY = 30000; // 30 секунд между кликами

    // Флаги состояний
    let aggressiveInterval = null;
    let isCommentCycleActive = false;
    let isUpdatingStats = false; // Флаг, чтобы не спамить кнопку обновления

    // --- УТИЛИТЫ ---

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function randomDelay(min = ACTION_DELAY_MIN, max = ACTION_DELAY_MAX) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function showPopup(msg) {
        const div = document.createElement('div');
        div.textContent = msg;
        Object.assign(div.style, {
            position: 'fixed', bottom: '20px', right: '20px', background: '#333', color: '#0f0',
            padding: '10px 15px', borderRadius: '8px', boxShadow: '0 0 10px #000',
            fontSize: '14px', zIndex: 9999, transition: 'opacity 0.5s'
        });
        document.body.appendChild(div);
        setTimeout(() => {
            div.style.opacity = '0';
            setTimeout(() => div.remove(), 500);
        }, 3000);
    }

    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }

    // Поиск кнопки (приоритет Balance Stats)
    function findQuestButton(name) {
        let block = document.querySelector(`.wallet-panel__drop--${name}`);
        if (block) {
            let btn = block.querySelector('.wallet-panel__drop-icon');
            if (isVisible(btn)) return btn;
        }
        return null;
    }

    function getProgressText(name) {
        const block = document.querySelector(`.wallet-panel__drop--${name} .wallet-panel__drop-text`);
        return block ? block.textContent.trim() : null;
    }

    function parseProgress(text) {
        if (!text) return { cur: 0, max: 0 };
        const m = text.match(/(\d+)\s+из\s+(\d+)/i);
        return m ? { cur: parseInt(m[1]), max: parseInt(m[2]) } : { cur: 0, max: 0 };
    }

    // --- LOCAL STORAGE & DATA ---

    function getTodayKey() { return new Date().toLocaleDateString('ru-RU'); }

    function getRewards() {
        try {
            const raw = localStorage.getItem('read_rewards');
            const obj = JSON.parse(raw);
            return Array.isArray(obj?.items) ? obj.items : [];
        } catch { return []; }
    }

    function getTodayCardCount() {
        const today = getTodayKey();
        return getRewards().filter(i => i.type === 'card' && new Date(i.time).toLocaleDateString('ru-RU') === today).length;
    }

    function getLastCardTime() {
        const cards = getRewards().filter(i => i.type === 'card');
        if (cards.length === 0) return null;
        const last = cards.reduce((a, b) => (a.time > b.time ? a : b));
        return typeof last.time === 'number' ? last.time : null;
    }

    function getReadChaptersCount() {
        const text = getProgressText('read_rewards') || getProgressText('read');
        if (text) return parseProgress(text).cur;
        return 0; 
    }

    function hasQuizToday() {
        const stats = JSON.parse(localStorage.getItem("balance_stats") || "[]");
        const today = getTodayKey();
        const todayStats = stats.find(x => x.date === today);
        if (!todayStats) return false;
        return (todayStats.causes && todayStats.causes["Ежедневное прохождение квиза"] > 0);
    }

    function stopAggressiveMode() {
        if (aggressiveInterval) {
            clearInterval(aggressiveInterval);
            aggressiveInterval = null;
        }
    }

    // --- ОБНОВЛЕНИЕ СТАТИСТИКИ БЕЗ РЕЛОАДА ---
    async function refreshStatsViaButton() {
        if (isUpdatingStats) return;
        
        const btn = document.querySelector('button.button'); // Ищем кнопку по классу
        // Более точный поиск, если есть текст
        const buttons = Array.from(document.querySelectorAll('button'));
        const targetBtn = buttons.find(b => b.textContent.includes("Обновить статистику за день"));

        if (targetBtn && isVisible(targetBtn)) {
            isUpdatingStats = true;
            console.log("[Loader] Обновляю статистику через кнопку...");
            targetBtn.click();
            // Даем время на AJAX запрос и отрисовку
            await sleep(3000); 
            isUpdatingStats = false;
        }
    }

    // --- ЛОГИКА АГРЕССИВНОГО СБОРА КАРТ ---
    function startAggressiveRewardCollection() {
        if (aggressiveInterval) return; 

        console.log("[Loader] ⚡ Старт агрессивного сбора наград!");
        showPopup('Агрессивный сбор карт...');

        const btn = findQuestButton('read_rewards');
        if (btn) btn.click();

        aggressiveInterval = setInterval(async () => {
            const cards = getTodayCardCount();
            if (cards >= 10) {
                stopAggressiveMode();
                // Здесь можно просто обновить статистику, но для надежности сброса таймера лучше реолоад
                // Но попробуем без него сначала
                await refreshStatsViaButton();
                return;
            }
            const lastTime = getLastCardTime();
            if (lastTime) {
                const minutesPassed = (Date.now() - lastTime) / 60000;
                if (minutesPassed < 5) { 
                    stopAggressiveMode();
                    await refreshStatsViaButton();
                    return;
                }
            }
            const btn = findQuestButton('read_rewards');
            if (btn) btn.click();
            else stopAggressiveMode();

        }, AGGRESSIVE_RETRY_MS);
    }

    // --- ОСНОВНЫЕ ДЕЙСТВИЯ ---

    // 1. Чтение и Агрессия
    async function handleReadingAndRewards() {
        const chapters = getReadChaptersCount();
        const cards = getTodayCardCount();
        const lastCardTime = getLastCardTime();

        if (cards < 10) {
            let shouldAggress = false;
            if (lastCardTime) {
                const minutesPassed = (Date.now() - lastCardTime) / 60000;
                if (minutesPassed >= AGGRESSIVE_TRIGGER_MIN) shouldAggress = true;
            }
            if (chapters >= 75) shouldAggress = true;

            if (shouldAggress) {
                startAggressiveRewardCollection();
                return;
            }
        }

        if (cards >= 10 && chapters < 75) {
            console.log(`[Loader] Карты собраны. Читаем до 75: ${chapters}/75`);
            const customReadBtn = document.querySelector('.wallet-panel__drop--read .wallet-panel__drop-icon');
            if (customReadBtn && isVisible(customReadBtn)) {
                 customReadBtn.click();
                 showPopup('Читаем до 75...');
                 // Ждем и обновляем статистику
                 await sleep(5000);
                 await refreshStatsViaButton();
            } else {
                 const stdBtn = document.querySelector('.wallet-panel__action--read'); 
                 if(stdBtn) stdBtn.click();
                 await sleep(5000);
                 location.reload(); // Если нет кастомной кнопки, возможно нужен реолоад
            }
            return;
        }
        
        if (chapters < 10) {
             console.log(`[Loader] Чтение для старта: ${chapters}/10`);
             const customReadBtn = document.querySelector('.wallet-panel__drop--read .wallet-panel__drop-icon');
             if (customReadBtn && isVisible(customReadBtn)) {
                 customReadBtn.click();
                 showPopup('Читаем...');
                 await sleep(5000);
                 await refreshStatsViaButton();
             } else {
                 const stdBtn = document.querySelector('.wallet-panel__action--read');
                 if(stdBtn) stdBtn.click();
                 await sleep(5000);
                 location.reload();
             }
        }
    }

    // 2. Квиз
    async function handleQuiz() {
        if (hasQuizToday()) return true; 
        console.log("[Loader] Идем на Квиз (1 карта).");
        showPopup('Переход на Квиз...');
        await sleep(randomDelay());
        window.location.href = "/quiz";
        return false;
    }

    // 3. Реклама
    function clickAdsIfNeeded() {
        const btn = findQuestButton('watch_ads');
        if (btn) {
            const text = getProgressText('watch_ads');
            if (text) {
                const { cur, max } = parseProgress(text);
                if (cur < max) {
                    btn.click();
                    showPopup('Реклама...');
                }
            } else {
                btn.click();
            }
        }
    }

    // 4. Шахта
    function handleMine() {
        const btn = findQuestButton('mine');
        if (btn) {
             const text = getProgressText('mine');
             if (text) {
                 const { cur, max } = parseProgress(text);
                 if (cur < max) {
                     console.log(`[Loader] Шахта (2 карты): ${cur}/${max}.`);
                     btn.click();
                     showPopup('Запуск шахты...');
                 }
             }
        }
    }

    // 5. Комментарии (УМНЫЙ ЦИКЛ)
    function startCommentCycle() {
        if (isCommentCycleActive) return; 
        
        const text = getProgressText('comments');
        if (!text) return;
        
        const { cur, max } = parseProgress(text);
        if (cur >= max) {
            console.log("[Loader] Комментарии уже выполнены.");
            return;
        }

        isCommentCycleActive = true;
        console.log(`[Loader] Запуск цикла комментариев. Текущий: ${cur}, Цель: ${max}. Интервал: 30 сек.`);
        showPopup(`Цикл комментов: ${cur}/${max}`);

        const doCommentStep = async () => {
            const currentText = getProgressText('comments');
            if (!currentText) {
                isCommentCycleActive = false;
                return;
            }
            
            const currentStatus = parseProgress(currentText);
            
            if (currentStatus.cur >= currentStatus.max) {
                console.log("[Loader] Все комментарии написаны.");
                showPopup('Комментарии готовы!');
                isCommentCycleActive = false;
                return;
            }

            const btn = findQuestButton('comments');
            if (btn) {
                console.log(`[Loader] Клик комментария (${currentStatus.cur + 1}/${currentStatus.max})...`);
                btn.click();
            } else {
                console.error("[Loader] Кнопка комментариев не найдена!");
                isCommentCycleActive = false;
                return;
            }

            setTimeout(doCommentStep, COMMENT_CLICK_DELAY);
        };

        doCommentStep();
    }

    // 6. Битва
    async function handleBattle() {
        const battleDoneFlag = localStorage.getItem('battle_done_today_v2');
        if (battleDoneFlag === 'true') {
            console.log("[Loader] Битва уже собрана.");
            return;
        }

        console.log("[Loader] Идем в Битву (5 карт).");
        showPopup('Проверка Битвы...');
        await sleep(randomDelay());
        window.location.href = "/battle";
    }

    // --- ОБРАБОТЧИКИ СТРАНИЦ ---

    function processBattlePage() {
        let canClaim10 = false;
        let canClaim6 = false;
        let claimableButtons = [];

        const articles = document.querySelectorAll('article[data-daily-quest]');
        
        articles.forEach(article => {
            const titleEl = article.querySelector('.battle-home__quest-info b');
            const btn = article.querySelector('button[data-daily-claim]');
            
            if (titleEl && btn && !btn.disabled) {
                const title = titleEl.textContent.trim();
                if (title.includes("Провести 10 боев")) canClaim10 = true;
                if (title.includes("Выиграть 6 боев")) canClaim6 = true;
                
                if (btn.textContent.trim() === "Получить") {
                    claimableButtons.push(btn);
                }
            }
        });

        if (canClaim10 && canClaim6) {
            console.log("[Battle] УСЛОВИЕ ВЫПОЛНЕНО! Сбор наград.");
            showPopup('Сбор наград Битвы...');
            
            claimableButtons.forEach((btn, index) => {
                setTimeout(() => btn.click(), index * 1000);
            });

            setTimeout(() => {
                localStorage.setItem('battle_done_today_v2', 'true');
                showPopup('Битва собрана.');
                setTimeout(() => window.location.href = "/balance", 3000);
            }, claimableButtons.length * 1000 + 1000);

        } else {
            console.log("[Battle] Условия не выполнены. Выход.");
            if (!window.battleCheckDone) {
                 window.battleCheckDone = true;
                 setTimeout(() => window.location.href = "/balance", 5000);
            }
        }
    }

    function scheduleChatDiamond() {
        const delay = (15 * 60 + Math.floor(Math.random() * 10)) * 1000;
        setTimeout(() => {
            const btn = findQuestButton('chat_diamond');
            if (btn) {
                btn.click();
                showPopup('Алмаз за чат');
                // Здесь можно попробовать обновить статистику вместо реолоада
                setTimeout(() => refreshStatsViaButton(), 2000);
            }
            scheduleChatDiamond();
        }, delay);
    }

    function checkDayReset() {
        const lastDate = localStorage.getItem('last_active_date_v2');
        const today = getTodayKey();
        if (lastDate !== today) {
            console.log("[Loader] Новый день. Сброс.");
            localStorage.setItem('last_active_date_v2', today);
            localStorage.removeItem('battle_done_today_v2');
            window.battleCheckDone = false;
            isCommentCycleActive = false;
        }
    }

    // --- ГЛАВНЫЙ ЦИКЛ BALANCE ---

    async function mainLoopOnBalance() {
        checkDayReset();
        
        // 1. Чтение и Агрессия (Приоритет №1)
        await handleReadingAndRewards();
        
        if (aggressiveInterval) return;

        const cards = getTodayCardCount();
        const chapters = getReadChaptersCount();

        // Периодически обновляем статистику, чтобы данные были свежими
        // Но не чаще чем раз в 10 секунд
        if (!isUpdatingStats && Math.random() > 0.7) {
             await refreshStatsViaButton();
        }

        console.log(`[Loader] Статус: Карт ${cards}/10, Глав ${chapters}/75`);

        // 2. Строгая очередь квестов
        
        // ШАГ 1: 1 Карта -> Квиз + Реклама
        if (cards >= 1) {
            if (!hasQuizToday()) {
                await handleQuiz();
                return;
            }
            clickAdsIfNeeded();
        }

        // ШАГ 2: 2 Карты -> Шахта
        if (cards >= 2) {
            handleMine();
        }

        // ШАГ 3: 3 Карты -> ЗАПУСК ЦИКЛА КОММЕНТАРИЕВ
        if (cards >= 3) {
            startCommentCycle();
        }

        // ШАГ 4: 5 Карт -> Битва
        if (cards >= 5) {
            if (!isCommentCycleActive) {
                await handleBattle();
                return;
            }
        }
    }

    // --- ЗАПУСК ---

    if (window.location.pathname.startsWith("/balance")) {
        setTimeout(() => {
            setInterval(mainLoopOnBalance, CHECK_INTERVAL);
            mainLoopOnBalance();
        }, 3000);
        
        scheduleChatDiamond();
    }

    if (window.location.pathname.startsWith("/quiz")) {
        if (!$('.wallet-panel__drop--quiz').length) {
             let answer = "";
             let clickCount = 0;
             const MAX_CLICKS = 11;
             const csrfToken = $('meta[name="csrf-token"]').attr('content');
             
             $.ajaxSetup({
                 headers: { 'X-CSRF-TOKEN': csrfToken },
                 complete: function (params) {
                     if (params.responseJSON && 'question' in params.responseJSON) {
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
                                             showPopup('Квиз готов!');
                                             setTimeout(() => window.location.href = "/balance", 2000);
                                         }
                                     }, 2000);
                                 }
                             }
                         });
                     }
                 }
             });
             
             const targetNode = document.querySelector('.quiz__answers');
             if (targetNode) observer.observe(targetNode, { childList: true, subtree: true });
        }
    }

    if (window.location.pathname.startsWith("/battle")) {
        setTimeout(processBattlePage, 3000);
    }

})();
