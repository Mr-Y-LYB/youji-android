const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const catalog = fs.readFileSync(path.join(root, 'catalog.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const game = {id:'g1',title:'Terraria',titleEn:'Terraria',coverKind:'manual',platform:'Steam'};
const ensured=[];
const context = {
  Native: {
    loadState:()=>JSON.stringify({version:1,games:[game]}),
    saveState:()=>true,
    getSeenVersion:()=> '1.3.0',
    getManualCoverData:id=>id==='g1'?'aW1hZ2U=':'',
    ensureCovers:items=>ensured.push(JSON.parse(items)),
  },
  document: {getElementById:()=>({}),querySelectorAll:()=>[]},
  setTimeout,clearTimeout,
};
context.window=context;
vm.createContext(context);
vm.runInContext(catalog,context);
vm.runInContext(source.slice(0,source.indexOf("document.addEventListener('click'")),context);
const backup=vm.runInContext('backupGames()',context);
assert.equal(backup[0].manualCoverData,'aW1hZ2U=');
assert.equal(vm.runInContext('data.games[0].manualCoverData',context),undefined);
assert.match(vm.runInContext('gameCard(data.games[0],0)',context),/class="game-cover"/);
assert.equal(vm.runInContext("normalizeImported({title:'Terraria',steamId:105600,manualCoverData:'aW1hZ2U='}).manualCoverData",context),'aW1hZ2U=');
vm.runInContext('ensureCovers(data.games,true)',context);
assert.equal(ensured[0][0].force,true);
vm.runInContext("window.onCoverReady({id:'g1',steamId:105600})",context);
assert.equal(vm.runInContext('data.games[0].steamId',context),105600);
console.log('Cover and backup checks passed');
