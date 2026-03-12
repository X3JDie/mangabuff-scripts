```javascript
// ==UserScript==
// @name         MangaBuff Loader
// @namespace    http://tampermonkey.net/
// @version      3.2.2
// @description  MangaBuff automation
// @match        https://mangabuff.ru/*
// @grant        none
// ==/UserScript==

(function () {
'use strict';

console.log("[Loader] 📦Скрипт загружен из GitHub  Эвент начался v3.2.2");

const CHECK_REWARD_INTERVAL = 30000;
const ADS_INTERVAL = 5000;
const MINE_INTERVAL = 2000;
const MINE_LIMIT = 120;
const RELOAD_DELAY_MS = 1500;

let lastRewardClick = 0;
let cardSpamInterval = null;

const COMMENT_POOL = [
"Привет всем","Всем привет, как настроение?","Добрый день, друзья!",
"Всем хорошего дня или вечера","Привет, как у вас дела сегодня?",
"Как проходит ваш день?","Что нового у вас?","Как настроение сегодня?",
"Чем занимаетесь сейчас?","У меня всё отлично, спасибо!","Настроение супер, а у вас?",
"День проходит спокойно 👍","Да всё нормально","Спасибо, дела идут хорошо!"
];

function showPopup(msg){
const div=document.createElement('div');
div.textContent=msg;

Object.assign(div.style,{
position:'fixed',
bottom:'20px',
right:'20px',
background:'#222',
color:'#0f0',
padding:'10px 15px',
borderRadius:'10px',
boxShadow:'0 0 10px #0f0',
fontSize:'14px',
zIndex:9999
});

document.body.appendChild(div);
setTimeout(()=>div.remove(),3000);
}

function isVisible(el){
if(!el) return false;

const style=getComputedStyle(el);
const rect=el.getBoundingClientRect();

return style.display!=='none' && style.visibility!=='hidden' && rect.width>0 && rect.height>0;
}

function findQuestButton(name){

const block=document.querySelector(`.user-quest__item--${name}`);

const btn=block?.querySelector('.user-quest__icon');

return isVisible(btn)?btn:null;

}

function isEventCompleted(){

const eventBlock=document.querySelector('.user-quest__item--event .user-quest__text');

const text=eventBlock?.textContent.replace(/\s+/g,' ').trim()||'';

const m=text.match(/Event\s+(\d+)\s+из\s+(\d+)/i);

if(!m) return false;

return +m[1] >= +m[2];

}

function clickEventButton(){

const btn=findQuestButton('event');

if(btn){
btn.click();
showPopup('Event');
}

}

function proceedEventCheck(){

if(!isEventCompleted()){

clickEventButton();

}else{

if(!localStorage.getItem("event_reload_done")){

localStorage.setItem("event_reload_done","true");

location.reload();

}

}

}

function getReadChapters(){

const block=document.querySelector('.user-quest__item--read .user-quest__text');

const m=block?.textContent.match(/Глав\s+(\d+)\s+из\s+(\d+)/);

return m ? +m[1] : 0;

}

function clickReadButton(){

const btn=findQuestButton('read');

if(btn){

btn.click();

showPopup('Чтение главы');

}

}

function ensureChaptersThenEvent(){

const chapters=getReadChapters();

if(chapters<5){

clickReadButton();

return;

}

if(chapters<10){

clickReadButton();

return;

}

if(!localStorage.getItem("chapters_reload_done")){

localStorage.setItem("chapters_reload_done","true");

location.reload();

}

}

function clickReward(){

const btn=findQuestButton('read_rewards');

if(btn){

btn.click();

lastRewardClick=Date.now();

showPopup('Награда за чтение');

}

}

function clickAds(){

const block=document.querySelector('.user-quest__item--watch_ads .user-quest__text');

const m=block?.textContent.match(/(\d+)\s+из\s+(\d+)/);

if(!m) return;

const cur=+m[1];
const max=+m[2];

if(cur<max){

const btn=findQuestButton('watch_ads');

if(btn){

btn.click();

showPopup('Реклама');

}

}

}

function mineLoop(){

const block=document.querySelector('.user-quest__item--mine .user-quest__text');

const m=block?.textContent.match(/Шахта\s+(\d+)\s+из\s+(\d+)/);

if(!m) return;

const cur=+m[1];
const max=+m[2];

if(cur<MINE_LIMIT && cur<max){

const btn=findQuestButton('mine');

if(btn){

btn.click();

showPopup('Шахта');

}

}

}

function clickChatDiamond(){

const btn=findQuestButton('chat_diamond');

if(btn){

btn.click();

showPopup('Алмаз за чат');

setTimeout(()=>location.reload(),RELOAD_DELAY_MS);

}

}

function scheduleChatDiamond(){

const delay=(15*60+Math.floor(Math.random()*10))*1000;

setTimeout(()=>{

clickChatDiamond();

scheduleChatDiamond();

},delay);

}

function hasQuizToday(){

const stats=JSON.parse(localStorage.getItem("balance_stats")||"[]");

const today=new Date().toLocaleDateString('ru-RU');

const todayStats=stats.find(x=>x.date===today);

if(!todayStats) return false;

return todayStats.causes && todayStats.causes["Ежедневное прохождение квиза"]>0;

}

if(window.location.pathname.startsWith("/balance")){

setTimeout(()=>{

ensureChaptersThenEvent();

proceedEventCheck();

if(getReadChapters()>=10){

setInterval(clickReward,CHECK_REWARD_INTERVAL);

setInterval(clickAds,ADS_INTERVAL);

setInterval(mineLoop,MINE_INTERVAL);

scheduleChatDiamond();

}

},3000);

}

if(window.location.pathname.startsWith("/quiz")){

let answer="";
let clickCount=0;

const MAX_CLICKS=11;

if(window.$){

$.ajaxSetup({

headers:{'X-CSRF-TOKEN':$('meta[name="csrf-token"]').attr('content')},

complete:function(params){

if(params.responseJSON && 'question' in params.responseJSON){

answer=params.responseJSON.question.correct_text || "";

}

}

});

}

const observer=new MutationObserver(()=>{

const items=document.querySelectorAll('.quiz__answer-item');

if(clickCount===0 && items.length>0 && !answer){

items[0].click();

clickCount++;

return;

}

items.forEach(item=>{

if(answer && item.innerText.trim()===answer.trim()){

if(clickCount<MAX_CLICKS){

setTimeout(()=>{

item.click();

clickCount++;

if(clickCount>=MAX_CLICKS){

window.location.href="/balance";

}

},5000);

}

}

});

});

const node=document.querySelector('.quiz__answers');

if(node) observer.observe(node,{childList:true,subtree:true});

}

})();
```
