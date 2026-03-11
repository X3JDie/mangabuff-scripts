// ==UserScript==
// @name         MangaBuff Loader
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  MangaBuff automation
// @match        https://mangabuff.ru/*
// @grant        none
// ==/UserScript==

(function () {
'use strict';

console.log("[Loader] MangaBuff script started v4");

const CHECK_REWARD_INTERVAL = 30000;
const ADS_INTERVAL = 5000;
const MINE_INTERVAL = 2000;
const MINE_LIMIT = 120;
const TRIGGER_MINUTES = 19;

let lastRewardClick = 0;
let rewardClickInProgress = false;

function todayKey(){
  return new Date().toLocaleDateString('ru-RU');
}

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
    zIndex:9999
  });

  document.body.appendChild(div);
  setTimeout(()=>div.remove(),3000);
}

function isVisible(el){
  if(!el) return false;

  const style=window.getComputedStyle(el);
  const rect=el.getBoundingClientRect();

  return style.display!=='none' &&
         style.visibility!=='hidden' &&
         rect.width>0 &&
         rect.height>0;
}

function findQuestButton(name){
  const block=document.querySelector(`.user-quest__item--${name}`);
  const btn=block?.querySelector('.user-quest__icon');

  return isVisible(btn)?btn:null;
}

function getRewards(){
  try{
    const raw=localStorage.getItem('read_rewards');
    const obj=JSON.parse(raw);
    return Array.isArray(obj?.items)?obj.items:[];
  }catch{
    return[];
  }
}

function getTodayCounts(){
  const today=todayKey();

  const items=getRewards();

  return{
    cards:items.filter(i=>i.type==='card' && new Date(i.time).toLocaleDateString('ru-RU')===today).length,
    scrolls:items.filter(i=>i.type==='scroll' && new Date(i.time).toLocaleDateString('ru-RU')===today).length
  }
}

function parseTime(text){

  const h=text.match(/(\d+)\s*ч/);
  const m=text.match(/(\d+)\s*мин?/);
  const s=text.match(/(\d+)\s*сек?/);

  return (h?+h[1]*60:0)+(m?+m[1]:0)+(s?+s[1]/60:0);
}

function clickReward(){

  if(rewardClickInProgress) return;

  const btn=findQuestButton('read_rewards');

  if(btn){
    rewardClickInProgress=true;
    btn.click();

    lastRewardClick=Date.now();

    showPopup('Reward');

    setTimeout(()=>rewardClickInProgress=false,20000);
  }

}

function checkReward(){

  const cardsToday=getTodayCounts().cards;

  if(cardsToday>=10) return;

  const rewardBlock=[...document.querySelectorAll('.user-quest__wrapper .user-quest__text')]
  .find(e=>/Последняя награда/i.test(e.textContent));

  let minutes=null;

  if(rewardBlock){
    minutes=parseTime(rewardBlock.textContent.trim());
  }

  if(minutes!==null &&
     minutes>=TRIGGER_MINUTES &&
     Date.now()-lastRewardClick>10*60*1000){
     clickReward();
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
      showPopup("Ads");
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
      showPopup("Mine");
    }

  }

}

function clickChatDiamond(){

  const btn=findQuestButton('chat_diamond');

  if(btn){
    btn.click();
    showPopup("Chat Diamond");
    setTimeout(()=>location.reload(),1500);
  }

}

function scheduleChatDiamond(){

  const delay=(15*60+Math.floor(Math.random()*10))*1000;

  setTimeout(()=>{
    clickChatDiamond();
    scheduleChatDiamond();
  },delay);

}

function isEventCompleted(){

  const block=document.querySelector('.user-quest__item--event .user-quest__text');

  const text=block?.textContent.replace(/\s+/g,' ').trim()||'';

  const m=text.match(/Event\s+(\d+)\s+из\s+(\d+)/i);

  if(!m) return false;

  return +m[1]>=+m[2];

}

function getReadChapters(){

  const block=document.querySelector('.user-quest__item--read .user-quest__text');

  const m=block?.textContent.match(/Глав\s+(\d+)\s+из\s+(\d+)/);

  return m?+m[1]:0;

}

function clickRead(){

  const btn=findQuestButton('read');

  if(btn){
    btn.click();
    showPopup("Read chapter");
  }

}

function ensureChapters(){

  const chapters=getReadChapters();

  if(chapters<10){

    clickRead();

    const wait=setInterval(()=>{

      if(getReadChapters()>=10){
        clearInterval(wait);
        location.reload();
      }

    },5000);

  }

}

function hasQuizToday(){

  const stats=JSON.parse(localStorage.getItem("balance_stats")||"[]");

  const today=todayKey();

  const todayStats=stats.find(x=>x.date===today);

  if(!todayStats) return false;

  return todayStats.causes && todayStats.causes["Ежедневное прохождение квиза"]>0;

}

function checkQuiz(){

  if(!hasQuizToday()){
    window.location.href="/quiz";
  }

}

function startLoops(){

  if(window.mangaLoopsStarted) return;

  window.mangaLoopsStarted=true;

  setInterval(checkReward,CHECK_REWARD_INTERVAL);
  setInterval(clickAds,ADS_INTERVAL);
  setInterval(mineLoop,MINE_INTERVAL);

  scheduleChatDiamond();

}

function startQuizSolver(){

  let answer="";
  let clickCount=0;

  const MAX_CLICKS=11;

  $.ajaxSetup({
    headers:{
      'X-CSRF-TOKEN':$('meta[name="csrf-token"]').attr('content')
    },
    complete:function(params){
      if('question' in params.responseJSON){
        answer=params.responseJSON.question.correct_text||"";
      }
    }
  });

  const observer=new MutationObserver(()=>{

    const items=document.querySelectorAll('.quiz__answer-item');

    if(items.length===0) return;

    if(clickCount===0 && !answer){
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

          },3000);

        }

      }

    });

  });

  const wait=setInterval(()=>{

    const node=document.querySelector('.quiz__answers');

    if(node){
      clearInterval(wait);
      observer.observe(node,{childList:true,subtree:true});
    }

  },500);

}

if(window.location.pathname.startsWith("/quiz")){
  startQuizSolver();
}

if(window.location.pathname.startsWith("/balance")){

  setTimeout(()=>{

    ensureChapters();

    if(isEventCompleted() && getReadChapters()>=10){

      startLoops();

      setTimeout(()=>{

        if(!hasQuizToday()){
          window.location.href="/quiz";
        }

      },4000);

    }

  },3000);

}

window.MangaBuffMain=true;

})();
