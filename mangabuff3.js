// ==UserScript==
// @name         MangaBuff Loader
// @namespace    http://tampermonkey.net/
// @version      1.5.0
// @description  Navigator with Battle Reward Flag logic
// @match        https://mangabuff.ru/balance
// @match        https://mangabuff.ru/quiz
// @match        https://mangabuff.ru/mine
// @grant        none
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==
(function () {
'use strict';
console.log("[Loader] 📦 Скрипт загружен: v1.5.0 (Smart Battle Flag)");

const CHECK_REWARD_INTERVAL = 30000;
const ADS_INTERVAL = 5000;
const MINE_INTERVAL = 4000;
const MINE_LIMIT = 120;
const RELOAD_DELAY_MS = 1500;
const TRIGGER_MINUTES = 19;
const AGGRESSIVE_TRIGGER_MINUTES = 60;
const AGGRESSIVE_RETRY_MS = 20000;

let lastRewardClick = 0;
let cardSpamInterval = null;
let aggressiveRewardInterval = null;

// 🔑 Ключ флага в localStorage
const BATTLE_FLAG_KEY = 'battle_rewards_collected_today';

function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function parseTime(text) {
    if (!text) return null;
    const h = text.match(/(\d+)\sч/);
    const m = text.match(/(\d+)\sмин/);
    const s = text.match(/(\d+)\s*сек/);
    return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (s ? +s[1] / 60 : 0);
}

function getLastRewardTimeFromStorage() {
    const items = getRewards();
    if (items.length === 0) return null;
    const last = items.reduce((a, b) => (a.time > b.time ? a : b));
    return typeof last.time === 'number' ? last.time : null;
}

function showPopup(msg, color = '#0f0') {
    const div = document.createElement('div');
    div.textContent = msg;
    Object.assign(div.style, {
        position:'fixed',bottom:'20px',right:'20px',background:'#222',color:color,
        padding:'10px 15px',borderRadius:'10px',boxShadow:'0 0 10px '+color,fontSize:'14px',zIndex:9999
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
    const todayRU = new Date().toLocaleDateString('ru-RU');
    const items = getRewards();
    return {
        cards: items.filter(i => i.type === 'card' && new Date(i.time).toLocaleDateString('ru-RU') === todayRU).length,
        scrolls: items.filter(i => i.type === 'scroll' && new Date(i.time).toLocaleDateString('ru-RU') === todayRU).length
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

function getReadChapters() {
    const block = document.querySelector('.wallet-panel__drop--read .wallet-panel__drop-text');
    const m = block?.textContent.match(/(\d+)\s+из\s+(\d+)/);
    return m ? +m[1] : 0;
}

function clickReadButton() {
    const btn = findQuestButton('read');
    if (btn) { btn.click(); showPopup('📚 Глава'); }
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
    console.log("[Loader] Главы >= 10");
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

function stopAllIntervals() {
    if (cardSpamInterval) { clearInterval(cardSpamInterval); cardSpamInterval = null; }
    if (aggressiveRewardInterval) { clearInterval(aggressiveRewardInterval); aggressiveRewardInterval = null; }
}

function checkReward() {
    const cardsToday = getTodayCounts().cards;
    const chaptersDone = getReadChapters();

    if (cardsToday >= 10) { stopAllIntervals(); return; }
    if (chaptersDone >= 75) { startCardSpamIfNeeded(); return; }

    const rewardTimeEl = document.querySelector('.read_rewards_container .reward-time');
    let minutes = null;

    if (rewardTimeEl && /Последняя награда:/i.test(rewardTimeEl.textContent)) {
        minutes = parseTime(rewardTimeEl.textContent.replace('Последняя награда:', '').trim());
    } else {
        const last = getLastRewardTimeFromStorage();
        if (typeof last === 'number') minutes = (Date.now() - last) / (60 * 1000);
    }
    if (minutes === null) return;

    if (minutes >= AGGRESSIVE_TRIGGER_MINUTES && !aggressiveRewardInterval) {
        aggressiveRewardInterval = setInterval(() => {
            const currentCards = getTodayCounts().cards;
            if (currentCards > cardsToday || currentCards >= 10) {
                clearInterval(aggressiveRewardInterval); aggressiveRewardInterval = null; return;
            }
            const el = document.querySelector('.read_rewards_container .reward-time');
            if (el) {
                const cur = parseTime(el.textContent.replace('Последняя награда:', '').trim());
                if (cur !== null && cur < 5) { clearInterval(aggressiveRewardInterval); aggressiveRewardInterval = null; return; }
            }
            clickReward();
        }, AGGRESSIVE_RETRY_MS);
        clickReward();
        return;
    }

    if (minutes >= TRIGGER_MINUTES && Date.now() - lastRewardClick > 600000 && !aggressiveRewardInterval) {
        clickReward();
    }
}

function clickAds() {
    const block = document.querySelector('.wallet-panel__drop--watch_ads .wallet-panel__drop-text');
    const m = block?.textContent.match(/(\d+)\s+из\s+(\d+)/);
    if (m && +m[1] < +m[2]) {
        const btn = findQuestButton('watch_ads');
        if (btn) { btn.click(); showPopup('📺 Реклама'); }
    }
}

function mineLoop() {
    const block = document.querySelector('.wallet-panel__drop--mine .wallet-panel__drop-text');
    const m = block?.textContent.match(/(\d+)\s+из\s+(\d+)/);
    if (m && +m[1] < Math.min(MINE_LIMIT, +m[2])) {
        const btn = findQuestButton('mine');
        if (btn) { btn.click(); showPopup('⛏️ Шахта'); }
    }
}

function clickChatDiamond() {
    const btn = findQuestButton('chat_diamond');
    if (btn) {
        btn.click();
        showPopup('💎 Чат');
        setTimeout(() => location.reload(), RELOAD_DELAY_MS);
    }
}

function scheduleChatDiamond() {
    const delay = (15 * 60 + Math.floor(Math.random() * 10)) * 1000;
    setTimeout(() => { clickChatDiamond(); scheduleChatDiamond(); }, delay);
}

function hasQuizToday() {
    try {
        const stats = JSON.parse(localStorage.getItem("balance_stats") || "[]");
        const todayISO = getTodayKey();
        const todayRU = new Date().toLocaleDateString('ru-RU');
        let todayStats = stats.find(x => x.date === todayISO);
        if (!todayStats) todayStats = stats.find(x => x.date === todayRU);
        if (!todayStats || !todayStats.causes) return false;
        return (todayStats.causes["Ежедневное прохождение квиза"] > 0);
    } catch (e) {
        return false;
    }
}

function goToBattle() {
    // 🔥 ПРОВЕРКА ФЛАГА ПЕРЕД ПЕРЕХОДОМ
    if (localStorage.getItem(BATTLE_FLAG_KEY) === 'true') {
        console.log('[Loader] 🛑 Награды за битвы уже собраны сегодня. Остаюсь на Balance.');
        showPopup('🛑 Битвы пройдены', '#e74c3c');
        return;
    }

    console.log('[Loader] ⚔️ Переход на арену...');
    showPopup('⚔️ Переход на арену...', '#0af');
    setTimeout(() => {
        window.location.href = '/battle';
    }, 2000);
}

if (window.location.pathname.startsWith("/quiz")) {
    // 🔥 СБРОС ФЛАГА ПРИ ВХОДЕ В КВИЗ
    // Логика: Новый день/цикл начинается с квиза. Сбрасываем флаг, чтобы снова пойти на битву.
    console.log('[Loader] 🧩 Вход в квиз. Сброс флага битв.');
    localStorage.removeItem(BATTLE_FLAG_KEY);

    if (hasQuizToday()) {
        goToBattle();
    } else {
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
                                    if (clickCount >= MAX_CLICKS) goToBattle();
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
}

if (window.location.pathname.startsWith("/balance")) {
    setTimeout(() => {
        ensureChaptersThenEvent();
        if (getReadChapters() >= 10) {
            setInterval(checkReward, CHECK_REWARD_INTERVAL);
            setInterval(clickAds, ADS_INTERVAL);
            setInterval(mineLoop, MINE_INTERVAL);
            scheduleChatDiamond();

            if (hasQuizToday()) {
                goToBattle();
            } else {
                setTimeout(() => {
                    window.location.href = "/quiz";
                }, 5000);
            }
        }
    }, 6000);
}

})();
