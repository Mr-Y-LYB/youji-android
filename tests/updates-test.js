const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'app.js'), 'utf8');
const catalog = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'catalog.js'), 'utf8');
const elements = {};
const seen = [];
const saved = JSON.stringify({version: 1, games: [{id: 'g1', title: '泰拉瑞亚', titleEn: 'Terraria', platform: 'Steam', hours: 262.2}]});
const context = {
  Native: {
    loadState: () => saved,
    saveState: () => true,
    getSeenVersion: () => '1.1.0',
    markVersionSeen: version => seen.push(version)
  },
  document: {
    getElementById: id => elements[id] ||= {innerHTML: '', addEventListener() {}, classList: {add() {}, remove() {}}},
    querySelectorAll: () => []
  },
  setTimeout, clearTimeout
};
context.window = context;
context.window.scrollTo = () => {};
vm.createContext(context);
vm.runInContext(catalog, context);
vm.runInContext(app.slice(0, app.indexOf("document.addEventListener('click'")), context);

assert.equal(vm.runInContext('tab', context), 'updates');
assert.match(vm.runInContext('renderUpdates()', context), /更新说明/);
assert.match(vm.runInContext('renderUpdates()', context), /v1\.3\.2/);
assert.match(vm.runInContext('renderSettings()', context), /data-to="updates"/);
assert.match(vm.runInContext('renderSettings()', context), /data-action="check-update"/);
assert.equal((vm.runInContext('renderSettings()', context).match(/<svg /g) || []).length, 4);
assert.match(vm.runInContext('renderEditor()', context), /<details class="optional-fields">/);
assert.match(vm.runInContext('renderHome()', context), /class="game-cover"/);
assert.doesNotMatch(vm.runInContext('renderHome()', context), /把玩过的游戏|YOUR PLAY HISTORY/);
assert.equal(vm.runInContext('data.games.length', context), 1);
vm.runInContext("navigate('home')", context);
assert.deepEqual(seen, ['1.3.2']);
assert.equal(vm.runInContext('tab', context), 'home');
assert.match(elements.screen.innerHTML, /泰拉瑞亚/);
vm.runInContext("navigate('settings'); navigate('updates')", context);
assert.match(elements.screen.innerHTML, /返回设置/);
vm.runInContext("window.onUpdateCheck({available:true,version:'1.3.0',notes:'测试更新',url:'https://github.com/example/app.apk',digest:'sha256:abc'})", context);
assert.match(elements['confirm-layer'].innerHTML, /发现新版本 v1.3.0/);
assert.match(elements['confirm-layer'].innerHTML, /测试更新/);
console.log('Update notes and compact UI checks passed');
