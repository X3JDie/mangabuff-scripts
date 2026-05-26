// ==UserScript==
// @name         MangaBuff Loader
// @namespace    http://tampermonkey.net/
// @version      1.6.0
// @description  Авто-сбор квестов: последовательное выполнение + анти-детект + счетчик побед
// @match        https://mangabuff.ru/balance
// @match        https://mangabuff.ru/quiz
// @match        https://mangabuff.ru/mine
// @match        https://mangabuff.ru/battle
// @grant        none
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function () {
'use strict';
console.log("[Loader] 📦 Скрипт загружен, версия 1.6.0");

const HUMAN_MODE = true;
const MIN_DELAY = 800;
const MAX_DELAY = 3500;
const IDLE_CHANCE = 0.15;
const SCROLL_CHANCE = 0.2;

const CHECK_REWARD_INTERVAL = 30000;
const RELOAD_DELAY_MS = 1500;
const TRIGGER_MINUTES = 19;
const AGGRESSIVE_TRIGGER_MINUTES = 60;
const AGGRESSIVE_RETRY_MS = 20000;  
const VICTORY_TARGET = 10;

const SEQUENCE_TASKS = ['mine', 'quiz', 'watch_ads', 'comments', 'calendar', 'contract'];
const TASK_SELECTORS = {
    mine: '.wallet-panel__drop--mine .wallet-panel__drop-text',
    watch_ads: '.wallet-panel__drop--watch_ads .wallet-panel__drop-text',
    comments: '.wallet-panel__drop--comments .wallet-panel__drop-text',
    calendar: '.wallet-panel__drop--calendar .wallet-panel__drop-text',
    contract: '.wallet-panel__drop--contract .wallet-panel__drop-text'
};

let lastRewardClick = 0;
let cardSpamInterval = null;
let aggressiveRewardInterval = null; 
let victoryCount = 0;
let seqRunning = false;

function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function humanDelay(min = MIN_DELAY, max = MAX_DELAY) { if (!HUMAN_MODE) return min; if (Math.random() < IDLE_CHANCE) return randomInt(3000, 8000); return randomInt(min, max); }
function jitter(base, percent = 0.3) { if (!HUMAN_MODE) return base; return Math.max(500, base + base * percent * (Math.random() * 2 - 1)); }
function getTodayKey() { return new Date().toLocaleDateString('ru-RU'); }

function simulateHumanClick(el) {
    if (!el || !isVisible(el)) return false;
    if (HUMAN_MODE && Math.random() < SCROLL_CHANCE) window.scrollBy({ top: randomInt(-50, 100), behavior: 'smooth' });
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), humanDelay(200, 600));
    setTimeout(() => {
        if (isVisible(el)) {
            el.click();
            if (HUMAN_MODE && Math.random() < 0.4) document.body.dispatchEvent(new MouseEvent('mousemove', { clientX: randomInt(100, 800), clientY: randomInt(100, 600) }));
        }
    }, humanDelay(400, 1200));
    return true;
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
    Object.assign(div.style, { position:'fixed',bottom:'20px',right:'20px',background:'#222',color:'#0f0', padding:'10px 15px',borderRadius:'10px',boxShadow:'0 0 10px #0f0',fontSize:'14px',zIndex:9999 });
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

function parseTime(text) {
    if (!text) return null;
    const h = text.match(/(\d+)\sч/), m = text.match(/(\d+)\sмин/), s = text.match(/(\d+)\s*сек/);
    return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (s ? +s[1] / 60 : 0);
}

function getRewards() {
    try { const obj = JSON.parse(localStorage.getItem('read_rewards')); return Array.isArray(obj?.items) ? obj.items : []; } catch { return []; }
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

function getReadRewardsCooldown() {
    const block = document.querySelector('.wallet-panel__drop--read_rewards');
    if (!block) return null;
    const tooltip = block.getAttribute('data-tooltip');
    if (!tooltip) return null;
    const h = tooltip.match(/через\s+(\d+)\s*ч/), m = tooltip.match(/(\d+)\s*мин/), s = tooltip.match(/(\d+)\s*сек/);
    return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (s ? +s[1] / 60 : 0);
}

function clickReward() {
    const btn = findQuestButton('read_rewards');
    if (btn) { simulateHumanClick(btn); lastRewardClick = Date.now(); showPopup('🎁 Награда'); }
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
            }, jitter(60000, 0.4));
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
        if (rewardTimeEl && /Последняя награда:/i.test(rewardTimeEl.textContent)) minutes = parseTime(rewardTimeEl.textContent.replace('Последняя награда:', '').trim());
    }
    if (minutes === null) {
        const lastRewardTime = getLastRewardTimeFromStorage();
        if (typeof lastRewardTime === 'number') minutes = (Date.now() - lastRewardTime) / (60 * 1000);
    }
    if (minutes === null) return;

    if (minutes >= AGGRESSIVE_TRIGGER_MINUTES && !aggressiveRewardInterval) {
        aggressiveRewardInterval = setInterval(() => {
            const currentCards = getTodayCounts().cards;
            if (currentCards > cardsToday || currentCards >= 10) { clearInterval(aggressiveRewardInterval); aggressiveRewardInterval = null; return; }
            const currentEl = document.querySelector('.read_rewards_container .reward-time');
            if (currentEl) {
                const curMin = parseTime(currentEl.textContent.replace('Последняя награда:', '').trim());
                if (curMin !== null && curMin < 5) { clearInterval(aggressiveRewardInterval); aggressiveRewardInterval = null; return; }
            }
            clickReward();
        }, jitter(AGGRESSIVE_RETRY_MS, 0.35));
        clickReward();
        return;
    }
    if (minutes >= TRIGGER_MINUTES && Date.now() - lastRewardClick > 10 * 60 * 1000 && !aggressiveRewardInterval) clickReward();
}

function getReadChapters() {
    const block = document.querySelector('.wallet-panel__drop--read .wallet-panel__drop-text');
    const prog = parseProgress(block?.textContent);
    return prog.current;
}

function clickReadButton() {
    const btn = findQuestButton('read');
    if (btn) { simulateHumanClick(btn); showPopup('📚 Глава'); }
}

function ensureChaptersThenEvent() {
    const chapters = getReadChapters();
    if (chapters < 75) {
        clickReadButton();
        const interval = setInterval(() => { if (getReadChapters() >= 75) { clearInterval(interval); setTimeout(() => location.reload(), humanDelay()); } }, jitter(5000, 0.3));
        return;
    }
    if (!localStorage.getItem("chapters_reload_done")) { localStorage.setItem("chapters_reload_done", "true"); setTimeout(() => location.reload(), humanDelay()); } else { clickEventButton(); }
}

function isEventCompleted() {
    const block = document.querySelector('.wallet-panel__drop--event .wallet-panel__drop-text');
    const prog = parseProgress(block?.textContent);
    if (prog.current >= 35 && !localStorage.getItem("event35_reload_done")) { localStorage.setItem("event35_reload_done", "true"); setTimeout(() => location.reload(), humanDelay()); return true; }
    return prog.done;
}

function clickEventButton() {
    const btn = findQuestButton('event');
    if (btn) { simulateHumanClick(btn); showPopup('🎪 Event'); }
}

function hasQuizToday() {
    const stats = JSON.parse(localStorage.getItem("balance_stats") || "[]");
    const today = getTodayKey();
    const todayStats = stats.find(x => x.date === today);
    return todayStats?.causes?.["Ежедневное прохождение квиза"] > 0;
}

function clickChatDiamond() {
    const block = document.querySelector('.wallet-panel__drop--chat_diamond .wallet-panel__drop-text');
    const prog = parseProgress(block?.textContent);
    if (prog.done) return;
    const btn = findQuestButton('chat_diamond');
    if (btn) { simulateHumanClick(btn); showPopup('💎 Алмаз'); setTimeout(() => location.reload(), RELOAD_DELAY_MS); }
}

function scheduleChatDiamond() {
    const delay = (15 * 60 + Math.floor(Math.random() * 10)) * 1000;
    setTimeout(() => { clickChatDiamond(); scheduleChatDiamond(); }, jitter(delay, 0.2));
}

function runSequentialTasks() {
    if (seqRunning) return;
    const today = getTodayKey();
    if (localStorage.getItem('seq_day') !== today) {
        localStorage.setItem('seq_day', today);
        localStorage.setItem('seq_index', '0');
        localStorage.removeItem('battles_seq_started');
    }

    let idx = parseInt(localStorage.getItem('seq_index') || '0');
    if (idx >= SEQUENCE_TASKS.length) {
        if (document.querySelector('.wallet-panel__drop--battle') && !localStorage.getItem('battles_seq_started')) {
            localStorage.setItem('battles_seq_started', today);
            setTimeout(battleLoop, humanDelay(1500, 4000));
        }
        return;
    }

    seqRunning = true;
    const task = SEQUENCE_TASKS[idx];

    if (task === 'quiz') {
        if (!hasQuizToday()) {
            showPopup('📝 Переход к квизу...');
            setTimeout(() => window.location.href = '/quiz', humanDelay(1000, 2000));
        } else {
            localStorage.setItem('seq_index', String(idx + 1));
            seqRunning = false;
            setTimeout(runSequentialTasks, humanDelay(800, 1500));
        }
        return;
    }

    const selector = TASK_SELECTORS[task];
    const el = selector ? document.querySelector(selector) : null;
    const prog = el ? parseProgress(el.textContent) : { done: true };

    if (prog.done || !el) {
        localStorage.setItem('seq_index', String(idx + 1));
        seqRunning = false;
        setTimeout(runSequentialTasks, humanDelay(800, 2000));
        return;
    }

    const btn = findQuestButton(task);
    if (btn) {
        simulateHumanClick(btn);
        showPopup(`▶️ ${task}`);
    }

    const checkDone = setInterval(() => {
        const currentEl = selector ? document.querySelector(selector) : null;
        const currentProg = currentEl ? parseProgress(currentEl.textContent) : { done: true };
        if (currentProg.done || !currentEl) {
            clearInterval(checkDone);
            localStorage.setItem('seq_index', String(idx + 1));
            seqRunning = false;
            setTimeout(runSequentialTasks, humanDelay(1000, 2500));
        }
    }, jitter(2000, 0.3));
}

function getBattleProgress() {
    const block = document.querySelector('.wallet-panel__drop--battle .wallet-panel__drop-text');
    return parseProgress(block?.textContent);
}

function clickBattleButton() {
    const btn = findQuestButton('battle');
    if (btn) { simulateHumanClick(btn); showPopup('⚔️ Битва'); }
}

function battleLoop() {
    const prog = getBattleProgress();
    if (!prog.done) {
        clickBattleButton();
        setTimeout(() => {
            const newProg = getBattleProgress();
            if (!newProg.done) setTimeout(battleLoop, jitter(3000, 0.4));
            else { showPopup('⚔️ Сбор наград...'); setTimeout(() => { window.location.href = '/battle'; }, humanDelay(1000, 2500)); }
        }, humanDelay(1500, 3000));
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
            setTimeout(() => { if (!button.disabled) { simulateHumanClick(button); showPopup('🏆 +награда'); } }, humanDelay(300, 800));
            collected++;
            if (collected >= 4) break;
        }
    }
    return collected;
}

function clickUpdateDayButton() {
    const buttons = document.querySelectorAll("button.button");
    for (const btn of buttons) { if (btn.textContent.includes("Обновить статистику за день")) { simulateHumanClick(btn); return true; } }
    return false;
}

function observeVictories() {
    const observer = new MutationObserver(mutations => {
        for (let mutation of mutations) {
            if (mutation.type === 'childList') {
                document.querySelectorAll('#toast-container .toast-message').forEach(toast => {
                    if (toast.textContent.includes('Победа!') && !toast.dataset.counted) {
                        toast.dataset.counted = 'true';
                        victoryCount++;
                        showPopup(`⚔️ Побед: ${victoryCount}/${VICTORY_TARGET}`);
                        if (victoryCount >= VICTORY_TARGET) {
                            victoryCount = 0;
                            showPopup('🏆 10 побед! Забираем награды...');
                            setTimeout(() => { window.location.href = '/battle'; }, humanDelay(1000, 2500));
                        }
                    }
                });
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

if (window.location.pathname.startsWith("/quiz")) {
    let answer = "", clickCount = 0;
    const MAX_CLICKS = 11;
    $.ajaxSetup({ headers: { 'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content') }, complete: function (params) { if ('question' in params.responseJSON) answer = params.responseJSON.question.correct_text || ""; } });
    const observer = new MutationObserver(mutations => {
        for (let mutation of mutations) {
            if (mutation.type === 'childList') {
                const items = document.querySelectorAll('.quiz__answer-item');
                if (clickCount === 0 && items.length > 0 && !answer) { simulateHumanClick(items[0]); clickCount++; return; }
                items.forEach(item => {
                    if (answer && item.innerText.trim() === answer.trim() && clickCount < MAX_CLICKS) {
                        setTimeout(() => { simulateHumanClick(item); clickCount++; if (clickCount >= MAX_CLICKS) window.location.href = "/balance"; }, humanDelay(3000, 7000));
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
            observeVictories();
            setInterval(checkReward, jitter(CHECK_REWARD_INTERVAL, 0.35));
            scheduleChatDiamond();
            setTimeout(runSequentialTasks, humanDelay(2000, 5000));
        }
    }, humanDelay(4000, 9000));
}

if (window.location.pathname.startsWith("/battle")) {
    setTimeout(() => {
        collectBattleRewards();
        const battleCollectInterval = setInterval(() => { if (collectBattleRewards() === 0) clearInterval(battleCollectInterval); }, jitter(8000, 0.3));
    }, humanDelay(2000, 5000));
}

})();
