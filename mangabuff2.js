// ==UserScript==
// @name         MangaBuff Loader
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Адаптирован под balance-stats v2.1 (.wallet-panel__drop) + пакетная отправка комментариев
// @match        https://mangabuff.ru/balance
// @match        https://mangabuff.ru/quiz
// @match        https://mangabuff.ru/mine
// @match        https://mangabuff.ru/decks/757109
// @grant        none
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==
(function () {
'use strict';
console.log("[Loader] 📦 Скрипт загружен из GitHub 1.2");

const CHECK_REWARD_INTERVAL = 30000;
const ADS_INTERVAL = 5000;
const MINE_INTERVAL = 4000;
const MINE_LIMIT = 120;
const RELOAD_DELAY_MS = 1500;
 
const TRIGGER_MINUTES = 19;
const AGGRESSIVE_TRIGGER_MINUTES = 60;
const AGGRESSIVE_RETRY_MS = 20000;  

const COMMENT_CHECK_INTERVAL = 300000;
const COMMENT_MIN_DELAY = 1800000;
const COMMENT_MAX_DELAY = 3600000;
const COMMENT_BATCH_DELAY = 5000; 

let lastRewardClick = 0;
let cardSpamInterval = null;
let aggressiveRewardInterval = null; 

function getTodayKey() { return new Date().toLocaleDateString('ru-RU'); }

function parseTime(text) {
    if (!text) return null;
    const h = text.match(/(\d+)\sч/);
    const m = text.match(/(\d+)\sмин/);
    const s = text.match(/(\d+)\s*сек/);
    return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (s ? +s[1] / 60 : 0);
}
  
function getCommentTargetPage() {
    return "/decks/757109"; // 🔥 фиксированный адрес
}

// 🔽 Считаем сколько осталось комментариев (парсим "1 из 13")
function getRemainingComments() {
    const block = document.querySelector('.wallet-panel__drop--comments .wallet-panel__drop-text');
    if (!block) return 0;
    const text = block.textContent.trim();
    const m = text.match(/(\d+)\s+из\s+(\d+)/i);
    if (!m) return 0;
    const current = +m[1];
    const total = +m[2];
    return Math.max(0, total - current);
}
  
function getLastRewardTimeFromStorage() {
    const items = getRewards();
    if (items.length === 0) return null;
    const last = items.reduce((a, b) => (a.time > b.time ? a : b));
    return typeof last.time === 'number' ? last.time : null;
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

function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

// 🔽 ОБНОВЛЕНО: Ищем кнопки в новой структуре balance-stats
function findQuestButton(name) {
    const block = document.querySelector(`.wallet-panel__drop--${name}`);
    const btn = block?.querySelector('.wallet-panel__drop-icon');
    return isVisible(btn) ? btn : null;
}

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

function shouldStopComments() {
    const block = document.querySelector('.wallet-panel__drop--comments .wallet-panel__drop-text');
    if (!block) return false;
    const m = block.textContent.match(/(\d+)\s+из\s+(\d+)/i);
    return m ? (+m[1] >= +m[2]) : false;
}

// 🔽 Планировщик: сохраняем сколько нужно отправить
function scheduleComments() {
    setInterval(() => {
        if (shouldStopComments()) return;
        const now = Date.now();
        const next = +localStorage.getItem('next_comment_time') || 0;
        if (next && now < next) return;
        
        const remaining = getRemainingComments();
        if (remaining <= 0) {
            console.log('[Loader] 💬 Лимит комментариев достигнут');
            return;
        }
        
        console.log(`[Loader] 💬 Начинаем отправку: ${remaining} комментариев`);
        localStorage.setItem('pending_comment', 'true');
        localStorage.setItem('comments_to_send', remaining);
        localStorage.setItem('comments_sent', 0);
        window.location.href = getCommentTargetPage();
    }, COMMENT_CHECK_INTERVAL);
}

// 🔽 Обработчик страницы: отправка пачкой с задержкой 2 сек
function handleCommentPage() {
    if (localStorage.getItem('pending_comment') !== 'true') return;
    
    const totalToSend = +localStorage.getItem('comments_to_send') || 1;
    let sent = +localStorage.getItem('comments_sent') || 0;
    
    console.log(`[Loader] 💬 План: ${totalToSend}, отправлено: ${sent}`);
    
    function sendNextComment() {
        // ✅ Все отправили — завершаем
        if (sent >= totalToSend) {
            console.log('[Loader] ✅ Все комментарии отправлены!');
            localStorage.removeItem('pending_comment');
            localStorage.removeItem('comments_to_send');
            localStorage.removeItem('comments_sent');
            
            // 🕐 Следующая сессия через 30-60 мин
            const nextDelay = 1800000 + Math.floor(Math.random() * 1800000);
            localStorage.setItem('next_comment_time', Date.now() + nextDelay);
            
            setTimeout(() => {
                window.location.href = "/balance";
            }, 2000);
            return;
        }
        
        const textarea = document.querySelector('.comments__send-form textarea');
        const sendBtn = document.querySelector('.comments__send-btn');
        
        if (textarea && sendBtn && isVisible(textarea)) {
            textarea.value = "Алмазики";
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            
            setTimeout(() => {
                sendBtn.click();
                sent++;
                localStorage.setItem('comments_sent', sent);
                console.log(`[Loader] 💎 ${sent}/${totalToSend} отправлено`);
                showPopup(`💬 ${sent}/${totalToSend}`);
                
                // ⏱ Следующий комментарий через 2 секунды
                setTimeout(sendNextComment, COMMENT_BATCH_DELAY);
            }, 300);
        } else {
            // ⚠️ Форма ещё не загрузилась — ждём и пробуем снова
            console.log('[Loader] ⏳ Ждём форму комментариев...');
            setTimeout(sendNextComment, 1000);
        }
    }
    
    // 🚀 Старт после загрузки страницы
    setTimeout(sendNextComment, 2000);
}

function clickReward() {
    const btn = findQuestButton('read_rewards');
    if (btn) { btn.click(); lastRewardClick = Date.now(); showPopup('Награда за чтение'); }
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
    if (cardSpamInterval) { 
        clearInterval(cardSpamInterval); 
        cardSpamInterval = null; 
    }
   
    if (aggressiveRewardInterval) {
        clearInterval(aggressiveRewardInterval);
        aggressiveRewardInterval = null;
    }
}

function checkReward() {
    const cardsToday = getTodayCounts().cards;
    const chaptersDone = getReadChapters();
    
    // 🛑 Если 10 карт собрано — останавливаем ВСЕ режимы
    if (cardsToday >= 10) {
        stopCardSpam();
        if (aggressiveRewardInterval) {
            clearInterval(aggressiveRewardInterval);
            aggressiveRewardInterval = null;
        }
        return;
    }
    
    // 🎯 Если прочитано >=75 глав — работает кард-спам (отдельная логика)
    if (chaptersDone >= 75) {
        startCardSpamIfNeeded();
        return;
    }

    // 🔍 Определяем время с последней награды
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

    // 🚀 АГРЕССИВНЫЙ РЕЖИМ: если прошло ≥60 мин и награда не получена
    if (minutes >= AGGRESSIVE_TRIGGER_MINUTES && !aggressiveRewardInterval) {
        console.log(`[Loader] ⚡ Агрессивный режим: прошло ${minutes} мин, начинаю сбор каждые 20 сек`);
        
        aggressiveRewardInterval = setInterval(() => {
            const currentCards = getTodayCounts().cards;
            
            // ✅ Условие остановки 1: карта получена
            if (currentCards > cardsToday || currentCards >= 10) {
                console.log('[Loader] ✅ Награда получена, выход из агрессивного режима');
                clearInterval(aggressiveRewardInterval);
                aggressiveRewardInterval = null;
                return;
            }
            
            // ✅ Условие остановки 2: таймер сбросился (< 5 мин)
            const currentEl = document.querySelector('.read_rewards_container .reward-time');
            if (currentEl) {
                const curText = currentEl.textContent.replace('Последняя награда:', '').trim();
                const curMin = parseTime(curText);
                if (curMin !== null && curMin < 5) {
                    console.log('[Loader] ✅ Таймер сбросился, выход из агрессивного режима');
                    clearInterval(aggressiveRewardInterval);
                    aggressiveRewardInterval = null;
                    return;
                }
            }
            
            // 🔄 Ещё не получили — кликаем снова
            clickReward();
            
        }, AGGRESSIVE_RETRY_MS);
        
        // Первый клик сразу при входе в режим
        clickReward();
        return; // чтобы не сработал обычный клик ниже
    }

    // 🟢 ОБЫЧНЫЙ РЕЖИМ: клик раз в ~19 минут (только если не в агрессивном)
    if (minutes >= TRIGGER_MINUTES && 
        Date.now() - lastRewardClick > 10 * 60 * 1000 && 
        !aggressiveRewardInterval) {
        clickReward();
    }
}

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

function clickChatDiamond() {
    const btn = findQuestButton('chat_diamond');
    if (btn) {
        btn.click();
        showPopup('Алмаз за чат');
        setTimeout(() => location.reload(), RELOAD_DELAY_MS);
    }
}

function scheduleChatDiamond() {
    const delay = (15 * 60 + Math.floor(Math.random() * 10)) * 1000;
    setTimeout(() => {
        clickChatDiamond();
        scheduleChatDiamond();
    }, delay);
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

// 🔽 QUIZ SOLVER (без изменений, требует jQuery)
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

// 🔽 MAIN BALANCE PAGE LOGIC
if (window.location.pathname.startsWith("/balance")) {
    setTimeout(() => {
        ensureChaptersThenEvent();
        if (getReadChapters() >= 10) {
            setInterval(checkReward, CHECK_REWARD_INTERVAL);
            setInterval(clickAds, ADS_INTERVAL);
            setInterval(mineLoop, MINE_INTERVAL);
            scheduleChatDiamond();
            scheduleComments(); // 🔥 запускаем планировщик комментариев
            
            setTimeout(() => {
                if (clickUpdateDayButton()) {
                    setTimeout(() => { if (!hasQuizToday()) window.location.href = "/quiz"; }, 5000 + Math.floor(Math.random() * 5000));
                } else {
                    if (!hasQuizToday()) window.location.href = "/quiz";
                }
            }, 2000);
        }
    }, 6000);
}

if (window.location.pathname.startsWith("/decks/757109")) {
    handleCommentPage();
}

})();
