const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const context = {Native: {loadState: () => '{"version":1,"games":[]}'}, console, setTimeout, clearTimeout};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(assets, 'catalog.js'), 'utf8'), context);
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
vm.runInContext(app.slice(0, app.indexOf("document.addEventListener('click'")), context);

const suggestions = vm.runInContext("GAME_CATALOG.map(g=>({...g,score:scoreSuggestion(g,norm('荒野'))})).filter(g=>g.score>0).sort((a,b)=>b.score-a.score)", context);
assert.equal(suggestions[0].titleEn, 'Red Dead Redemption 2');

const copied = `翼星求生 ICARUS\n27.6h\n6.2h\n15 / 171\nOBS Studio\n9.7h\n0.2h\n- / -\n荒野大镖客：救赎2\n447.4h 0h 50 / 51`;
const parsed = vm.runInContext(`parseLooseText(${JSON.stringify(copied)})`, context);
assert.equal(parsed.length, 3);
assert.equal(parsed[0].hours, 27.6);
assert.equal(parsed[0].recentHours, 6.2);
assert.equal(parsed[0].achievements, 15);
assert.equal(parsed[2].totalAchievements, 51);

const lines = [
  {text:'荒野大镖客：救赎2',x:352,y:180,w:210,h:21},
  {text:'447.4h',x:352,y:220,w:80,h:20},
  {text:'0h',x:518,y:220,w:30,h:20},
  {text:'50 / 51',x:596,y:206,w:70,h:20},
  {text:'泰拉瑞亚',x:352,y:410,w:100,h:21},
  {text:'262.2h',x:352,y:449,w:80,h:20},
  {text:'0h',x:518,y:449,w:30,h:20},
  {text:'115 / 137',x:588,y:435,w:80,h:20}
];
const screen = vm.runInContext(`parseScreenshotLines(${JSON.stringify(lines)})`, context);
assert.equal(screen.length, 2);
assert.equal(screen[0].title, '荒野大镖客：救赎2');
assert.equal(screen[0].hours, 447.4);
assert.equal(screen[1].totalAchievements, 137);
console.log('Parser checks passed');
