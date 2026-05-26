// ==UserScript==
// @name         MangaBuff Loader
// @namespace    http://tampermonkey.net/
// @version      1.4.0
// @description  Авто-сбор квестов: чтение, реклама, шахта, битва, награды + сбор на /battle
// @match        https://mangabuff.ru/balance
// @match        https://mangabuff.ru/quiz
// @match        https://mangabuff.ru/mine
// @match        https://mangabuff.ru/battle
// @grant        none
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function () {
'use strict';
console.log("[Loader] 📦 Скрипт загружен, версия 1.4.0");

const CHECK_REWARD_INTERVAL = 30000;
const ADS_INTERVAL = 5000;
const MINE_INTERVAL = 4000;
const BATTLE_INTERVAL = 3000;
const RELOAD_DELAY_MS = 1500;
 
const TRIGGER_MINUTES = 19;
const AGGRESSIVE_TRIGGER_MINUTES = 60;
const AGGRESSIVE_RETRY_MS = 20000;  

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

function parseProgress(text) {
    if (!text) return { current: 0, total: 0, done: false };
    text = text.trim();
    if (text.includes('Выполнено')) return { current: 999, total: 999, done: true };
    const m = text.match(/(\d+)\s+из\s+(\d+)/i);
    if (!m) return { current: 0, total: 0, done: false };
    const current = +m[1], total = +m[2];
    return { current, total, done: current >= total };
}

function getLastRewardTimeFromStorage() {
    const items = getRewards();
    if (items.length === 0) return null;
    const last = items.reduce((a, b) => (a.time > b.time ? a : b));
    return typeof last.time === 'number' ? last.time : null;
}

function getReadRewardsCooldown() {
    const block = document.querySelector('.wallet-panel__drop--read_rewards');
    if (!block) return null;
    const tooltip = block.getAttribute('data-tooltip');
    if (!tooltip) return null;
    const h = tooltip.match(/через\s+(\d+)\s*ч/);
    const m = tooltip.match(/(\d+)\s*мин/);
    const s = tooltip.match(/(\d+)\s*сек/);
    return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (s ? +s[1] / 60 : 0);
}

function clickReward() {
    const btn = findQuestButton('read_rewards');
    if (btn) { btn.click(); lastRewardClick = Date.now(); showPopup('🎁 Награда'); }
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
    const cardsToday = getTodayCounts().cards;
    const chaptersDone = getReadChapters();
    
    if (cardsToday >= 10) { stopCardSpam(); return; }
    if (chaptersDone >= 75) { startCardSpamIfNeeded(); return; }

    let minutes = getReadRewardsCooldown();
    if (minutes === null) {
        const rewardTimeEl = document.querySelector('.read_rewards_container .reward-time');
        if (rewardTimeEl && /Последняя награда:/i.test(rewardTimeEl.textContent)) {
            minutes = parseTime(rewardTimeEl.textContent.replace('Последняя награда:', '').trim());
        }
    }
    if (minutes === null) {
        const lastRewardTime = getLastRewardTimeFromStorage();
        if (typeof lastRewardTime === 'number') minutes = (Date.now() - lastRewardTime) / (60 * 1000);
    }
    if (minutes === null) return;

    if (minutes >= AGGRESSIVE_TRIGGER_MINUTES && !aggressiveRewardInterval) {
        aggressiveRewardInterval = setInterval(() => {
            const currentCards = getTodayCounts().cards;
            if (currentCards > cardsToday || currentCards >= 10) {
                clearInterval(aggressiveRewardInterval); aggressiveRewardInterval = null; return;
            }
            const currentEl = document.querySelector('.read_rewards_container .reward-time');
            if (currentEl) {
                const curMin = parseTime(currentEl.textContent.replace('Последняя награда:', '').trim());
                if (curMin !== null && curMin < 5) {
                    clearInterval(aggressiveRewardInterval); aggressiveRewardInterval = null; return;
                }
            }
            clickReward();
        }, AGGRESSIVE_RETRY_MS);
        clickReward();
        return;
    }

    if (minutes >= TRIGGER_MINUTES && Date.now() - lastRewardClick > 10 * 60 * 1000 && !aggressiveRewardInterval) {
        clickReward();
    }
}

function getReadChapters() {
    const block = document.querySelector('.wallet-panel__drop--read .wallet-panel__drop-text');
    const prog = parseProgress(block?.textContent);
    return prog.current;
}

function clickReadButton() {
    const btn = findQuestButton('read');
    if (btn) { btn.click(); showPopup('📚 Глава'); }
}

function ensureChaptersThenEvent() {
    const chapters = getReadChapters();
    if (chapters < 75) {
        clickReadButton();
        const interval = setInterval(() => {
            if (getReadChapters() >= 75) { clearInterval(interval); location.reload(); }
        }, 5000);
        return;
    }
    if (!localStorage.getItem("chapters_reload_done")) {
        localStorage.setItem("chapters_reload_done", "true");
        location.reload();
    } else {
        clickEventButton();
    }
}

function isEventCompleted() {
    const block = document.querySelector('.wallet-panel__drop--event .wallet-panel__drop-text');
    const prog = parseProgress(block?.textContent);
    if (prog.current >= 35 && !localStorage.getItem("event35_reload_done")) {
        localStorage.setItem("event35_reload_done", "true");
        location.reload();
        return true;
    }
    return prog.done;
}

function clickEventButton() {
    const btn = findQuestButton('event');
    if (btn) { btn.click(); showPopup('🎪 Event'); }
}

function proceedEventCheck() {
    if (!isEventCompleted()) { clickEventButton(); } 
    else if (!localStorage.getItem("event_reload_done")) {
        localStorage.setItem("event_reload_done", "true");
        location.reload();
    }
}

function clickAds() {
    const block = document.querySelector('.wallet-panel__drop--watch_ads .wallet-panel__drop-text');
    const prog = parseProgress(block?.textContent);
    if (!prog.done) {
        const btn = findQuestButton('watch_ads');
        if (btn) { btn.click(); showPopup('📺 Реклама'); }
    }
}

function mineLoop() {
    const block = document.querySelector('.wallet-panel__drop--mine .wallet-panel__drop-text');
    const prog = parseProgress(block?.textContent);
    if (!prog.done && prog.current < 125) {
        const btn = findQuestButton('mine');
        if (btn) { btn.click(); showPopup('⛏️ Шахта'); }
    }
}

function clickChatDiamond() {
    const block = document.querySelector('.wallet-panel__drop--chat_diamond .wallet-panel__drop-text');
    const prog = parseProgress(block?.textContent);
    if (prog.done) return;
    
    const btn = findQuestButton('chat_diamond');
    if (btn) {
        btn.click();
        showPopup('💎 Алмаз');
        setTimeout(() => location.reload(), RELOAD_DELAY_MS);
    }
}

function scheduleChatDiamond() {
    const delay = (15 * 60 + Math.floor(Math.random() * 10)) * 1000;
    setTimeout(() => { clickChatDiamond(); scheduleChatDiamond(); }, delay);
}

function getBattleProgress() {
    const block = document.querySelector('.wallet-panel__drop--battle .wallet-panel__drop-text');
    return parseProgress(block?.textContent);
}

function clickBattleButton() {
    const btn = findQuestButton('battle');
    if (btn) { btn.click(); showPopup('⚔️ Битва'); }
}

function battleLoop() {
    const prog = getBattleProgress();
    if (!prog.done) {
        clickBattleButton();
        setTimeout(() => {
            const newProg = getBattleProgress();
            if (!newProg.done) {
                setTimeout(battleLoop, BATTLE_INTERVAL);
            } else {
                showPopup('⚔️ Сбор наград...');
                setTimeout(() => { window.location.href = '/battle'; }, 1500);
            }
        }, 2000);
    }
}

function collectBattleRewards() {
    const articles = document.querySelectorAll('article[data-daily-quest]');
    if (!articles.length) return 0;
    
    let collected = 0;
    for (const article of articles) {
        if (article.classList.contains('battle-home__quest--claimed')) continue;
        
        const button = article.querySelector('button[type="button"]');
        const progressSpan = article.querySelector('.battle-home__quest-progress span');
        if (!button || !progressSpan || button.disabled) continue;
        
        const prog = parseProgress(progressSpan.textContent);
        if (prog.done && button.textContent.trim() !== 'Получено') {
            button.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => {
                if (!button.disabled) {
                    button.click();
                    showPopup('🏆 +награда');
                }
            }, 300 + Math.random() * 500);
            collected++;
            if (collected >= 4) break;
        }
    }
    return collected;
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

if (window.location.pathname.startsWith("/balance")) {
    setTimeout(() => {
        ensureChaptersThenEvent();
        if (getReadChapters() >= 10) {
            setInterval(checkReward, CHECK_REWARD_INTERVAL);
            setInterval(clickAds, ADS_INTERVAL);
            setInterval(mineLoop, MINE_INTERVAL);
            scheduleChatDiamond();
            
            if (document.querySelector('.wallet-panel__drop--battle')) {
                setTimeout(battleLoop, 5000);
            }
            
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

if (window.location.pathname.startsWith("/battle")) {
    setTimeout(() => {
        collectBattleRewards();
        const battleCollectInterval = setInterval(() => {
            const collected = collectBattleRewards();
            if (collected === 0) {
                clearInterval(battleCollectInterval);
            }
        }, 8000);
    }, 3000);
}

})();
