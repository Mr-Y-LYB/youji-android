const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const saved = [];
const fetched = [];
const listeners = {};
const elements = {};
const game = {id:'g1',title:'荒野大镖客：救赎2',titleEn:'Red Dead Redemption 2',platform:'Steam',
  steamId:1174180,achievements:50,totalAchievements:51,hours:447.4};
const context = {
  Native:{loadState:()=>JSON.stringify({version:1,games:[game]}),saveState:s=>(saved.push(JSON.parse(s)),true),
    getSeenVersion:()=> '1.3.2',fetchAchievements:json=>fetched.push(JSON.parse(json)),ensureCovers:()=>{}},
  document:{
    getElementById:id=>elements[id] ||= {innerHTML:'',addEventListener(){},classList:{add(){},remove(){}}},
    querySelectorAll:()=>[],
    addEventListener:(type,fn)=>listeners[type]=fn
  },
  setTimeout,clearTimeout
};
context.window=context;
context.window.scrollTo=()=>{};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(assets,'catalog.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(assets,'app.js'),'utf8'),context);

vm.runInContext("openDetail('g1')",context);
assert.match(elements.screen.innerHTML,/旧版统计：50 \/ 51/);
assert.doesNotMatch(vm.runInContext('renderEditor()',context),/f-ach|f-ach-total/);
assert.doesNotMatch(vm.runInContext('renderPreview()',context),/achievementPair|已解锁 \/ 总成就/);
context.window.onAchievementsLoaded({id:'g1',platform:'Steam',title:game.title,steamId:1174180,
  items:[{key:'Achievement1',name:'Back in the Mud',description:'Complete Chapter 1.'},
    {key:'Achievement2',name:'Just a Scratch',description:'Complete a mission.'}]});
assert.match(elements.screen.innerHTML,/成就 0 \/ 2/);
assert.equal(saved.at(-1).games[0].achievementItems.length,2);
listeners.change({target:{id:'',dataset:{achievementIndex:'0'},checked:true,matches:selector=>selector==='[data-achievement-index]'}});
assert.match(elements.screen.innerHTML,/成就 1 \/ 2/);
assert.equal(saved.at(-1).games[0].achievementItems[0].unlocked,true);
context.window.onAchievementsLoaded({id:'g1',platform:'Steam',title:game.title,steamId:1174180,
  items:[{key:'Achievement1',name:'Back in the Mud',description:'Updated description.'},
    {key:'Achievement2',name:'Just a Scratch',description:'Complete a mission.'}]});
assert.equal(saved.at(-1).games[0].achievementItems[0].unlocked,true);
assert.equal(saved.at(-1).games[0].achievements,50);
vm.runInContext("data.games.push(...['g2','g3','g4'].map(id=>({id,title:id,platform:'Steam'}))); data.games.slice(1).forEach(g=>requestAchievements(g,false,true))",context);
assert.equal(fetched.length,3); // one earlier request, two concurrent background reads
assert.equal(vm.runInContext('achievementPending.length',context),1);
context.window.onAchievementsLoaded({id:'g2',platform:'Steam',title:'g2',steamId:2,items:[]});
assert.equal(fetched.length,4);
assert.equal(fetched[3].id,'g4');
console.log('Achievement detail, unlock and history checks passed');
