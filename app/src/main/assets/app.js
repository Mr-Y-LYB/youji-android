/* 游迹: all personal records stay in the Android app's private storage. */
const $ = id => document.getElementById(id);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const native = typeof Native !== 'undefined' ? Native : {
  getSeenVersion: () => localStorage.getItem('youji-seen-version') || '',
  markVersionSeen: version => localStorage.setItem('youji-seen-version', version),
  checkForUpdates: () => {},
  downloadUpdate: () => {},
  ensureCovers: () => {},
  pickCover: () => toast('浏览器预览不支持选图'),
  getManualCoverData: () => '',
  saveManualCover: () => false,
  clearAutoCover: () => {},
  clearManualCover: () => {},
  clearCover: () => {},
  loadState: () => localStorage.getItem('youji-state') || '{"version":1,"games":[]}',
  saveState: s => (localStorage.setItem('youji-state', s), true),
  pickImport: () => toast('浏览器预览不支持文件选择'),
  pickScreenshot: () => toast('浏览器预览不支持截图识别'),
  exportBackup: s => { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([s],{type:'application/json'})); a.download='游迹备份.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); },
  searchOnline: () => {}, resolveEnglish: () => {}
};
let data;
try { data=JSON.parse(native.loadState()); if (!Array.isArray(data.games)) throw Error('bad state'); }
catch(e) { data={version:1,games:[]}; }
const APP_VERSION='1.3.1';
const CHANGELOG=[
  {version:'1.3.1',date:'2026-10-20',changes:['更新检查失败时会重试并使用备用版本信息。','手动检查更新会显示实际连接结果。']},
  {version:'1.3.0',date:'2026-10-20',changes:['游戏列表自动显示匹配到的 Steam 官方预览图，图片下载后保存在手机本地。','可为未匹配到的游戏手动选取封面。','统一设置页图标尺寸。']},
  {version:'1.2.0',date:'2026-10-20',changes:['打开应用时检查 GitHub Releases，新版本可在应用内下载。','下载后校验版本与签名，再由 Android 安装。','设置中可手动检查更新。']},
  {version:'1.1.0',date:'2026-10-20',changes:['新增更新说明，升级后首次打开会显示，也可在设置中查看。','精简概览、导入和设置页面。','将编辑游戏的可选数据收起，减少页面长度。']},
  {version:'1.0.0',date:'2026-10-20',changes:['首个版本：本地记录、截图与文件导入、JSON 备份。']}
];
function seenVersion(){try{return native.getSeenVersion()||'';}catch(e){return '';}}
function markVersionSeen(){try{native.markVersionSeen(APP_VERSION);}catch(e){}}
let tab=seenVersion()===APP_VERSION?'home':'updates', updatesReturn='home', editId=null, importMode='screenshot', importCandidates=[], importPage=0, duplicateMode='merge', importTable=null, mapping={}, importSource='', onlineResults=[], onlineStatus='', onlineSeq=0, onlineTimer=null, selectedSearchSeq=0, selectedSteamId=0, libQuery='', libFilter='all', libSort='recent', availableUpdate=null;
const coverEpoch={};
const platforms=['Steam','Epic','Xbox / PC Game Pass','GOG','Ubisoft Connect','EA app','Battle.net','WeGame','其他'];
const statuses=['想玩','在玩','已通关','已搁置','弃坑'];
function norm(s){return String(s||'').toLowerCase().replace(/[\s\-_:：·•.。,，！!？?()（）'"’]/g,'');}
function num(v){const n=Number(String(v==null?'':v).replace(',','.').replace(/[^\d.\-]/g,''));return Number.isFinite(n)&&n>=0?n:0;}
function safeInt(v){return Math.round(num(v));}
function uniqueId(){return 'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);}
function persist(){data.version=1;data.updatedAt=new Date().toISOString();return native.saveState(JSON.stringify(data));}
function findCatalogExact(s){const q=norm(s);return GAME_CATALOG.find(g=>norm(g.title)===q||norm(g.titleEn)===q||g.aliases.some(a=>norm(a)===q));}
function matchCatalog(s){const exact=findCatalogExact(s);if(exact)return exact;return null;}
function artClass(i){return ['','warm','violet','green'][i%4];}
function initials(g){return /[\u3400-\u9fff]/.test(g.title)?g.title.slice(0,2):(g.title||'?').slice(0,2).toUpperCase();}
function platformClass(s){return /^Steam$/i.test(s)?'steam':/^Epic$/i.test(s)?'epic':/Xbox/.test(s)?'xbox':'other';}
function coverUrl(id){const base=window.__YOUJI_WINDOWS__?'':'https://appassets.androidplatform.net';return base+'/youji-covers/'+encodeURIComponent(id)+'.jpg?v='+(coverEpoch[id]||1);}
function coverArt(g,i){return `<span class="game-art ${artClass(i)}"><span class="game-initials">${esc(initials(g))}</span><img class="game-cover" data-cover-id="${esc(g.id)}" src="${esc(coverUrl(g.id))}" alt=""></span>`;}
function ensureCovers(games=data.games,force=false){for(let i=0;i<games.length;i+=100)native.ensureCovers(JSON.stringify(games.slice(i,i+100).map(g=>({id:g.id,title:g.title,titleEn:g.titleEn||'',steamId:g.steamId||0,force}))));}
function refreshCover(id){coverEpoch[id]=Date.now();document.querySelectorAll('.game-cover').forEach(img=>{if(img.dataset.coverId===id){img.hidden=false;img.src=coverUrl(id);}});}
function backupGames(){return data.games.map(g=>{const record={...g};if(g.coverKind==='manual'){const image=native.getManualCoverData(g.id);if(image)record.manualCoverData=image;}return record;});}
function optionList(values,selected){const all=values.includes(selected)?values:[...values,selected];return all.map(v=>`<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(v)}</option>`).join('');}
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast._timer);toast._timer=setTimeout(()=>el.classList.remove('show'),3200);}
function confirmAction(title,body,ok,onConfirm){$('confirm-layer').innerHTML=`<div class="confirm-box"><h3>${esc(title)}</h3><p>${esc(body)}</p><div class="buttons"><button class="btn btn-outline" data-action="cancel-confirm">取消</button><button class="btn btn-danger" data-action="confirm-now">${esc(ok)}</button></div></div>`;$('confirm-layer').classList.remove('hidden');confirmAction.callback=onConfirm;}
function closeConfirm(){$('confirm-layer').classList.add('hidden');$('confirm-layer').innerHTML='';}
function navigate(next){if(tab==='updates'&&next!=='updates')markVersionSeen();if(next==='updates'&&tab!=='updates')updatesReturn=tab;if(next==='add'){editId=null;selectedSteamId=0;}tab=next;render();window.scrollTo(0,0);}
window.goBack=()=>{if(tab==='home')return false;if(tab==='updates')navigate(updatesReturn);else if(tab==='add'||tab==='preview'||tab==='mapping')navigate(tab==='add'?'library':'import');else navigate('home');return true;};
function setNav(){document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab||tab==='updates'&&b.dataset.tab==='settings'||(tab==='preview'||tab==='mapping')&&b.dataset.tab==='import'));}
function gameCard(g,i){return `<button class="game-card" data-action="edit" data-id="${esc(g.id)}">${coverArt(g,i)}<span class="game-body"><span class="game-title">${esc(g.title||'未命名游戏')}</span>${g.titleEn?`<span class="game-en">${esc(g.titleEn)}</span>`:''}<span class="game-meta"><span class="chip ${platformClass(g.platform)}">${esc(g.platform||'其他')}</span><span class="meta-text">${esc(g.status||'在玩')}</span><span class="meta-text">${num(g.hours)} 小时</span></span></span><span class="game-arrow">›</span></button>`;}
function emptyBox(title){
  return `<div class="empty compact-empty">${esc(title)}</div>`;
}
function renderHome(){
  const count=data.games.length;
  const hours=data.games.reduce((sum,g)=>sum+num(g.hours),0);
  const done=data.games.filter(g=>g.status==='已通关').length;
  const recent=[...data.games].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))).slice(0,3);
  return `<h1 class="page-title compact-title">概览</h1>
    <div class="stat-grid compact-stats">
      <div class="stat"><small>游戏</small><b>${count}</b></div>
      <div class="stat"><small>时长</small><b>${Math.round(hours*10)/10}<em>h</em></b></div>
      <div class="stat"><small>通关</small><b>${done}</b></div>
    </div>
    <div class="section-head"><h2>最近记录</h2><button data-action="nav" data-to="library">全部 ›</button></div>
    <div class="game-list">${recent.length?recent.map(gameCard).join(''):emptyBox('暂无记录')}</div>`;
}
function filteredGames(){const q=norm(libQuery);let list=data.games.filter(g=>(libFilter==='all'||g.platform===libFilter)&&(q===''||norm(g.title).includes(q)||norm(g.titleEn).includes(q)||norm(g.notes).includes(q)));if(libSort==='hours')list.sort((a,b)=>num(b.hours)-num(a.hours));else if(libSort==='title')list.sort((a,b)=>String(a.title).localeCompare(String(b.title),'zh-CN'));else list.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));return list;}
function renderLibrary(){
  const present=['all',...new Set(data.games.map(g=>g.platform||'其他'))];
  return `<h1 class="page-title compact-title">游戏库</h1>
    <div class="toolbar"><div class="search-wrap"><input id="lib-search" class="search-input" value="${esc(libQuery)}" placeholder="搜索游戏或备注" autocomplete="off"></div>
      <select id="lib-filter" class="filter-select">${present.map(v=>`<option value="${esc(v)}" ${libFilter===v?'selected':''}>${esc(v==='all'?'全部平台':v)}</option>`).join('')}</select></div>
    <div class="mini-tabs"><button data-action="sort" data-sort="recent" class="${libSort==='recent'?'active':''}">最近更新</button><button data-action="sort" data-sort="hours" class="${libSort==='hours'?'active':''}">时长</button><button data-action="sort" data-sort="title" class="${libSort==='title'?'active':''}">名称</button></div>
    <p class="count-line" id="lib-count"></p><div class="game-list" id="lib-list"></div>`;
}
function updateLibrary(){
  const list=filteredGames();
  $('lib-count').textContent=`${list.length} 条记录`;
  $('lib-list').innerHTML=list.length?list.map(gameCard).join(''):emptyBox('暂无匹配记录');
}
function inputField(label,id,value='',type='text',placeholder='',extra=''){return `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${extra}></div>`;}
function selectField(label,id,choices,value){const options=id==='f-platform'&&!choices.includes(value)?[...choices,value]:choices;return `<div class="field"><label for="${id}">${esc(label)}</label><select id="${id}">${optionList(options,value)}</select></div>`;}
function renderEditor(){
  const g=editId?data.games.find(x=>x.id===editId):null;
  const item=g||{};
  return `<h1 class="page-title compact-title">${g?'编辑游戏':'添加游戏'}</h1>
    <div class="form-panel compact-form">
      ${inputField('游戏名称 *','f-title',item.title||'','text','输入名称搜索','autocomplete="off"')}
      <div id="suggestions" class="suggestions" style="display:none"></div>
      ${inputField('英文原名','f-en',item.titleEn||'','text','可选')}
      <div class="row">${selectField('平台','f-platform',platforms,item.platform||'Steam')}${selectField('状态','f-status',statuses,item.status||'在玩')}</div>
      <div class="row">${inputField('总时长（小时）','f-hours',item.hours??'','number','0','min="0" step="0.1"')}${inputField('近期时长（小时）','f-recent',item.recentHours??'','number','0','min="0" step="0.1"')}</div>
    </div>
    <details class="optional-fields"><summary>更多数据 <span>封面 · 成就 · 评分 · 备注</span></summary>
      <div class="form-panel compact-form">
        ${g?`<div class="cover-picker">${coverArt(g,0)}<div><strong>游戏封面</strong><div class="cover-picker-actions"><button class="btn btn-outline" data-action="pick-cover" data-id="${esc(g.id)}">选择图片</button><button class="btn btn-outline" data-action="auto-cover" data-id="${esc(g.id)}">自动匹配</button></div></div></div>`:''}
        <div class="row">${inputField('已解锁成就','f-ach',item.achievements??'','number','0','min="0" step="1"')}${inputField('成就总数','f-ach-total',item.totalAchievements??'','number','0','min="0" step="1"')}</div>
        <div class="row">${inputField('个人评分（0–10）','f-rating',item.rating??'','number','可选','min="0" max="10" step="0.1"')}${inputField('购买价格（元）','f-price',item.price??'','number','可选','min="0" step="0.01"')}</div>
        <div class="row">${inputField('入库日期','f-acquired',item.acquiredAt||'','date')}${inputField('最近游玩日期','f-last',item.lastPlayedAt||'','date')}</div>
        <div class="field"><label for="f-notes">备注</label><textarea id="f-notes" placeholder="可选">${esc(item.notes||'')}</textarea></div>
      </div>
    </details>
    <div class="form-actions"><button class="btn btn-primary" data-action="save-game">保存</button><button class="btn btn-outline" data-action="nav" data-to="library">取消</button></div>
    ${g?`<button class="btn btn-danger btn-block" data-action="delete-game" data-id="${esc(g.id)}">删除记录</button>`:''}`;
}
function renderImport(){
  return `<h1 class="page-title compact-title">导入</h1>
    <div class="import-tabs">
      <button class="${importMode==='screenshot'?'active':''}" data-action="import-mode" data-mode="screenshot">截图</button>
      <button class="${importMode==='text'?'active':''}" data-action="import-mode" data-mode="text">文字</button>
      <button class="${importMode==='file'?'active':''}" data-action="import-mode" data-mode="file">文件</button>
    </div>
    ${importMode==='screenshot'?`<div class="panel import-panel"><button class="btn btn-primary btn-block" data-action="pick-screenshot">选择小黑盒游戏墙截图</button><p class="helper">识别后核对名称、时长和成就。</p></div>`:importMode==='text'?`<div class="panel import-panel"><textarea id="import-text" class="paste-area" rows="6" placeholder="粘贴游戏名称、时长与成就，例如：\n荒野大镖客：救赎2\n447.4h 0h 50 / 51"></textarea><button class="btn btn-primary btn-block" style="margin-top:10px" data-action="parse-text">解析文字</button></div>`:`<div class="panel import-panel"><button class="btn btn-primary btn-block" data-action="pick-file">选择 JSON / CSV / Excel 文件</button></div>`}`;
}
function settingIcon(kind){
  const paths={export:'M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3',restore:'M12 21V9m-4 4 4-4 4 4M4 7V4h16v3',updates:'M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9',check:'M20 7v5h-5M4 17v-5h5M5.5 9A7 7 0 0 1 18 7l2 5M4 12l2 5a7 7 0 0 0 12.5-2'};
  return `<span class="symbol"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[kind]}"/></svg></span>`;
}
function renderSettings(){
  return `<h1 class="page-title compact-title">设置</h1>
    <button class="setting-action" data-action="export">${settingIcon('export')}<span><b>导出 JSON 备份</b></span><span class="arrow">›</span></button>
    <button class="setting-action" data-action="restore">${settingIcon('restore')}<span><b>导入 JSON 备份</b></span><span class="arrow">›</span></button>
    <button class="setting-action" data-action="nav" data-to="updates">${settingIcon('updates')}<span><b>更新说明</b></span><span class="arrow">›</span></button>
    <button class="setting-action" data-action="check-update">${settingIcon('check')}<span><b>检查更新</b></span><span class="arrow">›</span></button>
    <div class="settings-meta"><span>${data.games.length} 条记录 · 仅本机</span><span>v${APP_VERSION}</span></div>`;
}
function renderUpdates(){
  const latest=CHANGELOG[0];
  return `<h1 class="page-title compact-title">更新说明</h1>
    <div class="update-panel"><div class="version-head"><strong>v${esc(latest.version)}</strong><time>${esc(latest.date)}</time></div>
      <ul>${latest.changes.map(change=>`<li>${esc(change)}</li>`).join('')}</ul></div>
    <details class="update-history"><summary>历史版本</summary>
      ${CHANGELOG.slice(1).map(entry=>`<div class="history-entry"><strong>v${esc(entry.version)}</strong><time>${esc(entry.date)}</time><ul>${entry.changes.map(change=>`<li>${esc(change)}</li>`).join('')}</ul></div>`).join('')}
    </details>
    <button class="btn btn-primary btn-block updates-done" data-action="nav" data-to="${esc(updatesReturn)}">${updatesReturn==='home'?'开始使用':'返回设置'}</button>`;
}
function render(){
  setNav();
  $('screen').innerHTML=tab==='home'?renderHome():tab==='library'?renderLibrary():tab==='add'?renderEditor():tab==='import'?renderImport():tab==='settings'?renderSettings():tab==='updates'?renderUpdates():tab==='mapping'?renderMapping():tab==='preview'?renderPreview():'';
  if(tab==='library'){
    updateLibrary();
    $('lib-search').addEventListener('input',e=>{libQuery=e.target.value;updateLibrary();});
    $('lib-filter').addEventListener('change',e=>{libFilter=e.target.value;updateLibrary();});
  }
  if(tab==='add'){
    $('f-title').addEventListener('input',onTitleInput);
    if(!editId&&$('f-title').value.trim())showSuggestions($('f-title').value.trim());
  }
  if(tab==='preview')$('duplicate-mode').value=duplicateMode;
}
function onTitleInput(e){const q=e.target.value.trim();selectedSteamId=0;onlineResults=[];onlineStatus='';clearTimeout(onlineTimer);if(!q){$('suggestions').style.display='none';return;}showSuggestions(q);if(q.length>=2){onlineStatus='联网搜索中…';showSuggestions(q);const req=++onlineSeq;onlineTimer=setTimeout(()=>native.searchOnline(q,req),450);}}
function scoreSuggestion(g,q){const words=[g.title,g.titleEn,...(g.aliases||[])].map(norm);let best=0;for(const w of words){if(w===q)best=Math.max(best,100);else if(w.startsWith(q))best=Math.max(best,70);else if(w.includes(q))best=Math.max(best,45);}return best;}
function showSuggestions(q){const el=$('suggestions');if(!el)return;const query=norm(q);if(!query){el.style.display='none';return;}const local=GAME_CATALOG.map(g=>({...g,score:scoreSuggestion(g,query),source:'本地目录'})).filter(g=>g.score>0).sort((a,b)=>b.score-a.score).slice(0,7);const seen=new Set(local.map(g=>norm(g.title)));const remote=onlineResults.filter(g=>!seen.has(norm(g.title))).slice(0,8);const all=[...local,...remote];el.innerHTML=all.map((g,i)=>`<button type="button" class="suggestion" data-action="pick-suggestion" data-index="${i}"><small class="suggestion-tag">${esc(g.source)}</small><b>${esc(g.title)}</b><small>${esc(g.titleEn||'点击后尝试读取英文名')}</small></button>`).join('')+(onlineStatus?`<div class="online-status">${esc(onlineStatus)}</div>`:'');el.style.display=all.length||onlineStatus?'block':'none';el._choices=all;}
window.onOnlineResults=response=>{if(tab!=='add'||response.requestId!==onlineSeq)return;onlineResults=(response.results||[]).map(x=>({...x,source:x.source||'Steam 商店'}));onlineStatus=response.error||'';showSuggestions($('f-title').value.trim());};
window.onEnglishResolved=result=>{if(tab!=='add'||result.requestId!==selectedSearchSeq)return;if($('f-title').value===result.title&&result.titleEn){$('f-en').value=result.titleEn;toast('已补全英文名称');}};
function saveGame(){
  const title=$('f-title').value.trim();
  if(!title){toast('请填写游戏名称');$('f-title').focus();return;}
  const existing=editId?data.games.find(g=>g.id===editId):null;
  const titleEn=$('f-en').value.trim();
  const changed=!!existing&&(existing.title!==title||existing.titleEn!==titleEn);
  const item={...(existing||{}),id:existing?.id||uniqueId(),title,titleEn,
    steamId:selectedSteamId||(!changed?Number(existing?.steamId)||0:0),
    platform:$('f-platform').value,status:$('f-status').value,
    hours:num($('f-hours').value),recentHours:num($('f-recent').value),
    achievements:safeInt($('f-ach').value),totalAchievements:safeInt($('f-ach-total').value),
    rating:$('f-rating').value===''?'':Math.min(10,num($('f-rating').value)),
    price:$('f-price').value===''?'':num($('f-price').value),
    acquiredAt:$('f-acquired').value,lastPlayedAt:$('f-last').value,
    notes:$('f-notes').value.trim(),updatedAt:new Date().toISOString()};
  if(item.totalAchievements>0&&item.achievements>item.totalAchievements){toast('已解锁成就不能大于成就总数');return;}
  if(changed)native.clearAutoCover(item.id);
  if(existing)Object.assign(existing,item);else data.games.push(item);
  if(!persist()){toast('保存失败，请检查存储空间');return;}
  ensureCovers([item]);
  toast(existing?'已保存修改':'已加入游戏库');navigate('library');
}
function deleteGame(id){
  const g=data.games.find(x=>x.id===id);if(!g)return;
  confirmAction('删除这条记录？',`“${g.title}”的游玩时长、成就和备注都会从本机移除。`,'删除',()=>{
    data.games=data.games.filter(x=>x.id!==id);native.clearCover(id);persist();closeConfirm();toast('已删除');navigate('library');
  });
}
function normalizeImported(raw){
  if(!raw||typeof raw!=='object')return null;
  const title=String(raw.title||raw.name||raw.game||raw.gameName||raw['游戏名称']||raw['名称']||'').trim();
  if(!title)return null;
  const cat=matchCatalog(title);
  let platform=String(raw.platform||raw['平台']||'Steam').trim();if(!platform)platform='Steam';
  const result={id:uniqueId(),title:cat?.title||title,
    titleEn:String(raw.titleEn||raw.englishName||raw['英文名']||cat?.titleEn||'').trim(),
    steamId:safeInt(raw.steamId??cat?.steamId??0),platform,
    status:String(raw.status||raw['状态']||'在玩'),
    hours:num(raw.hours??raw.playtime??raw.playTime??raw['游玩时长']??raw['时长']??0),
    recentHours:num(raw.recentHours??raw['近期时长']??0),
    achievements:safeInt(raw.achievements??raw['已解锁成就']??raw['已完成成就']??0),
    totalAchievements:safeInt(raw.totalAchievements??raw['成就总数']??0),
    rating:raw.rating??'',price:raw.price??'',acquiredAt:String(raw.acquiredAt||''),
    lastPlayedAt:String(raw.lastPlayedAt||''),notes:String(raw.notes||raw['备注']||''),
    source:String(raw.source||importSource||'导入'),updatedAt:new Date().toISOString(),
    manualCoverData:String(raw.manualCoverData||'').slice(0,500000)};
  if(!statuses.includes(result.status))result.status='在玩';
  return result;
}
function parseDelimited(text,delimiter){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}else field+=c;}row.push(field);if(row.some(v=>v.trim()))rows.push(row);return rows.slice(0,10001);}
function looksLikeHeader(row){return row.some(c=>/游戏|名称|title|name|时长|hour|playtime|成就|平台|platform/i.test(String(c)));}
function startTable(rows,source){const clean=rows.filter(r=>Array.isArray(r)&&r.some(c=>String(c??'').trim()));if(!clean.length){toast('文件里没有可导入的行');return;}const header=looksLikeHeader(clean[0])?clean.shift().map((x,i)=>String(x||`列 ${i+1}`)):(clean[0]||[]).map((_,i)=>`列 ${i+1}`);importTable={headers:header,rows:clean,source};mapping=autoMap(header);importSource=source;tab='mapping';render();}
function autoMap(headers){const rules={title:/游戏名称|游戏名|^名称$|^title$|^name$|^game$/i,titleEn:/英文|english|origin/i,platform:/平台|platform|store/i,hours:/总时长|游玩时长|^时长$|^hours$|playtime/i,recentHours:/近期时长|最近.*时长|recent/i,achievements:/已解锁成就|已完成成就|^achievements$|achieved/i,totalAchievements:/成就总数|total.*achievements/i,status:/状态|status/i,notes:/备注|notes/i};const out={};for(const [key,rx] of Object.entries(rules)){const index=headers.findIndex(h=>rx.test(h));out[key]=index<0?'':String(index);}return out;}
function renderMapping(){if(!importTable)return '';const fields=[['title','游戏名称 *'],['titleEn','英文原名'],['platform','平台'],['hours','总时长（小时）'],['recentHours','近期时长'],['achievements','已解锁成就'],['totalAchievements','成就总数'],['status','游玩状态'],['notes','备注']];return `<h1 class="page-title compact-title">对应表格列</h1><p class="count-line">${esc(importTable.source)} · ${importTable.rows.length} 行</p><div class="panel"><h2>字段对应</h2>${fields.map(([key,label])=>`<div class="mapping-row"><label>${esc(label)}</label><select data-map="${key}"><option value="">不导入</option>${importTable.headers.map((h,i)=>`<option value="${i}" ${mapping[key]===String(i)?'selected':''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}</div><div class="panel"><h2>前两行预览</h2>${importTable.rows.slice(0,2).map(row=>`<p class="helper">${row.map((v,i)=>`${esc(importTable.headers[i]||`列${i+1}`)}: ${esc(v)}`).join(' · ')}</p>`).join('')}</div><button class="btn btn-primary btn-block" data-action="apply-mapping">下一步：核对记录</button>`;}
function applyMapping(){document.querySelectorAll('[data-map]').forEach(el=>mapping[el.dataset.map]=el.value);if(mapping.title===''){toast('请指定游戏名称列');return;}const items=importTable.rows.map(row=>{const raw={source:importTable.source};for(const [key,index] of Object.entries(mapping))if(index!=='')raw[key]=row[Number(index)]||'';return normalizeImported(raw);}).filter(Boolean);startPreview(items,importTable.source);}
function parseLooseText(text){const lines=String(text||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);const items=[];let current=null;for(const line of lines){if(/^(游戏墙|游戏库|总时长|成就|\d{1,2}:\d{2})$/.test(line))continue;const hours=[...line.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:h|小时)/gi)];const ach=line.match(/(\d+)\s*[\/／]\s*(\d+)/);if(hours.length){if(!current)continue;if(current.hours===undefined){current.hours=num(hours[0][1]);if(hours[1])current.recentHours=num(hours[1][1]);}else if(current.recentHours===undefined)current.recentHours=num(hours[0][1]);if(ach){current.achievements=safeInt(ach[1]);current.totalAchievements=safeInt(ach[2]);}continue;}if(ach&&current){current.achievements=safeInt(ach[1]);current.totalAchievements=safeInt(ach[2]);continue;}if(/^[\d.\/／\s-]+$/.test(line))continue;if(current&&current.hours!==undefined)items.push(current);current={title:line};}if(current&&current.hours!==undefined)items.push(current);if(!items.length){for(const line of lines){const parts=line.split(/[,，\t|]/).map(s=>s.trim());if(parts[0]&&parts.length>1&&/[\d.]/.test(parts[1]))items.push({title:parts[0],hours:num(parts[1]),achievements:parts[2]?safeInt(parts[2]):0,totalAchievements:parts[3]?safeInt(parts[3]):0});}}return items;}
function parseScreenshotLines(lines){const all=(lines||[]).map(x=>({...x,text:String(x.text||'').trim()})).filter(x=>x.text).sort((a,b)=>a.y-b.y||a.x-b.x);const hourLines=all.filter(x=>/^\d+(?:[.,]\d+)?\s*(?:h|小时)$/i.test(x.text));const groups=[];for(const line of hourLines){let g=groups.find(g=>Math.abs(g.y-line.y)<Math.max(15,line.h*.9));if(!g){g={y:line.y,hours:[]};groups.push(g);}g.hours.push(line);}const items=[];for(const group of groups){group.hours.sort((a,b)=>a.x-b.x);const main=group.hours[0];const names=all.filter(x=>x.y<main.y&&main.y-x.y<Math.max(75,main.h*4)&&x.x>=main.x-45&&x.x<main.x+110&&!/^(\d+\s*[\/／]\s*\d+|\d+(?:[.,]\d+)?\s*h)$/i.test(x.text)&&!/游戏墙|13:|Wi-Fi/.test(x.text)).sort((a,b)=>b.y-a.y||a.x-b.x);let title=names[0]?.text||'';if(!title)continue;const achieved=all.filter(x=>Math.abs(x.y-main.y)<Math.max(35,main.h*2)&&x.x>main.x+Math.max(100,main.w*2)).map(x=>x.text).find(t=>/\d+\s*[\/／]\s*\d+/.test(t));const a=achieved?.match(/(\d+)\s*[\/／]\s*(\d+)/);items.push({title,hours:num(main.text),recentHours:group.hours[1]?num(group.hours[1].text):0,achievements:a?safeInt(a[1]):0,totalAchievements:a?safeInt(a[2]):0});}return items;}
function startPreview(items,source){importCandidates=items.slice(0,10000).map(normalizeImported).filter(Boolean).map(g=>({...g,_selected:true}));importPage=0;duplicateMode='merge';importSource=source;tab='preview';render();window.scrollTo(0,0);if(!importCandidates.length)toast('没有识别到记录，请改用粘贴文字或手动添加');}
function renderPreview(){const pageSize=50,start=importPage*pageSize,sample=importCandidates.slice(start,start+pageSize),pages=Math.max(1,Math.ceil(importCandidates.length/pageSize));return `<h1 class="page-title compact-title">核对导入</h1><p class="count-line">${esc(importSource)} · ${importCandidates.length} 条</p><div class="panel"><h2>遇到已有记录时</h2><div class="field"><select id="duplicate-mode"><option value="merge">更新时长和成就，保留原备注</option><option value="skip">跳过重复记录</option><option value="copy">另存一条记录</option></select></div></div>${pages>1?`<div class="section-head"><h2>第 ${importPage+1} / ${pages} 页</h2><div><button data-action="preview-page" data-page="${importPage-1}" ${importPage===0?'disabled':''}>‹ 上页</button><button data-action="preview-page" data-page="${importPage+1}" ${importPage>=pages-1?'disabled':''}>下页 ›</button></div></div>`:''}<div id="review-list">${sample.map((g,j)=>{const i=start+j;return `<div class="review-row" data-review="${i}"><header><input type="checkbox" ${g._selected!==false?'checked':''} aria-label="导入此游戏"><b>记录 ${i+1}</b><button class="remove" data-action="remove-review" data-index="${i}">移除</button></header><div class="row"><div class="field"><label>游戏名称</label><input data-key="title" value="${esc(g.title)}"></div><div class="field"><label>英文原名</label><input data-key="titleEn" value="${esc(g.titleEn)}"></div></div><div class="row"><div class="field"><label>平台</label><select data-key="platform">${optionList(platforms,g.platform)}</select></div><div class="field"><label>总时长（小时）</label><input data-key="hours" type="number" min="0" step="0.1" value="${num(g.hours)}"></div></div><div class="row"><div class="field"><label>近期时长</label><input data-key="recentHours" type="number" min="0" step="0.1" value="${num(g.recentHours)}"></div><div class="field"><label>已解锁 / 总成就</label><input data-key="achievementPair" value="${safeInt(g.achievements)} / ${safeInt(g.totalAchievements)}"></div></div></div>`;}).join('')}</div><div class="form-actions"><button class="btn btn-primary" data-action="commit-import">确认导入全部已选记录</button><button class="btn btn-outline" data-action="nav" data-to="import">取消</button></div>`;}
function captureReview(){document.querySelectorAll('[data-review]').forEach(row=>{const g=importCandidates[Number(row.dataset.review)];if(!g)return;g._selected=row.querySelector('header input').checked;row.querySelectorAll('[data-key]').forEach(input=>{if(input.dataset.key==='achievementPair'){const m=input.value.match(/(\d+)\s*[\/／]\s*(\d+)/);g.achievements=m?safeInt(m[1]):0;g.totalAchievements=m?safeInt(m[2]):0;}else g[input.dataset.key]=input.value;});g.title=g.title.trim();g.titleEn=g.titleEn.trim();g.hours=num(g.hours);g.recentHours=num(g.recentHours);});}
function commitImport(){
  captureReview();
  const picked=importCandidates.filter(g=>g._selected!==false&&g.title);
  if(!picked.length){toast('请至少选择一条记录');return;}
  const mode=$('duplicate-mode').value, before=JSON.stringify(data.games), coverCopies=[];
  let added=0,updated=0,skipped=0;
  for(const item of picked){
    const key=norm(item.titleEn||item.title);
    const old=data.games.find(g=>g.platform===item.platform&&(norm(g.titleEn||g.title)===key||norm(g.title)===norm(item.title)));
    if(!old||mode==='copy'){
      const {_selected,manualCoverData,...record}=item;
      const game={...record,id:uniqueId(),updatedAt:new Date().toISOString()};
      if(manualCoverData)coverCopies.push({id:game.id,data:manualCoverData,game});
      delete game.coverKind;
      data.games.push(game);added++;
    }else if(mode==='skip')skipped++;
    else{
      old.hours=item.hours;old.recentHours=item.recentHours;
      old.achievements=item.achievements;old.totalAchievements=item.totalAchievements;
      old.titleEn=old.titleEn||item.titleEn;old.steamId=old.steamId||item.steamId||0;
      old.source=item.source;old.updatedAt=new Date().toISOString();
      if(item.manualCoverData)coverCopies.push({id:old.id,data:item.manualCoverData,game:old});
      updated++;
    }
  }
  if(!persist()){data.games=JSON.parse(before);toast('保存失败，请检查存储空间');return;}
  for(const cover of coverCopies){
    if(native.saveManualCover(cover.id,cover.data)){
      cover.game.coverKind='manual';
      refreshCover(cover.id);
    }
  }
  if(coverCopies.length)persist();
  importCandidates=[];importTable=null;
  toast(`已导入 ${added} 条，更新 ${updated} 条${skipped?`，跳过 ${skipped} 条`:''}`);
  navigate('library');
  ensureCovers(data.games);
}
window.onPickedFile=result=>{if(result.error){toast(result.error);return;}const name=result.name||'文件';if(Array.isArray(result.rows)){startTable(result.rows,name);return;}const text=String(result.text||'').trim();if(!text){toast('文件为空');return;}try{const json=JSON.parse(text);const arr=Array.isArray(json)?json:Array.isArray(json.games)?json.games:Array.isArray(json.data)?json.data:null;if(arr){importSource=json.format==='youji-backup'?'游迹 JSON 备份':name;startPreview(arr,importSource);return;}}catch(e){}if(/^\s*</.test(text)){const doc=new DOMParser().parseFromString(text,'text/html');const tables=[...doc.querySelectorAll('table')];if(tables.length){const rows=[...tables[0].querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(x=>x.textContent.trim()));startTable(rows,name);return;}startPreview(parseLooseText(doc.body.textContent),name);return;}const first=text.split(/\r?\n/,1)[0];if(first.includes('\t')||first.includes(',')||first.includes('，')){const delimiter=first.includes('\t')?'\t':first.includes(',')?',':'，';const rows=parseDelimited(text,delimiter);if(rows.length>1&&rows[0].length>1){startTable(rows,name);return;}}startPreview(parseLooseText(text),name);};
window.onScreenshotText=lines=>{const parsed=parseScreenshotLines(lines);startPreview(parsed,'小黑盒截图');if(!parsed.length)toast('未识别出完整游戏行，可尝试裁剪图片或改用文字导入');};
window.onScreenshotError=message=>toast(message);
window.onExportFinished=ok=>toast(ok?'备份已保存':'导出失败，请重试');
window.onUpdateCheck=info=>{
  if(info.error){if(info.manual)toast(info.error);return;}
  if(!info.available){if(info.manual)toast('已是最新版本');return;}
  availableUpdate=info;
  const layer=$('confirm-layer');
  layer.innerHTML=`<div class="confirm-box"><h3>发现新版本 v${esc(info.version)}</h3><p class="update-notes">${esc(info.notes||'有新版本可用')}</p><div class="buttons"><button class="btn btn-outline" data-action="update-later">稍后</button><button class="btn btn-primary" data-action="update-now">下载更新</button></div></div>`;
  layer.classList.remove('hidden');
};
window.onUpdateProgress=info=>toast(`下载更新 ${Math.max(0,Math.min(100,Number(info.percent)||0))}%`);
window.onUpdateDownload=info=>toast(info.message||'更新失败');
window.onCoverReady=result=>{
  const game=data.games.find(g=>g.id===result.id);
  if(game&&result.steamId&&!game.steamId){game.steamId=result.steamId;persist();}
  refreshCover(result.id);
};
window.onManualCoverReady=result=>{
  const game=data.games.find(g=>g.id===result.id);
  if(game){game.coverKind='manual';persist();}
  refreshCover(result.id);toast('封面已保存');
};
window.onCoverError=message=>toast(message);
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  switch(b.dataset.action){
    case 'nav':navigate(b.dataset.to);break;
    case 'edit':editId=b.dataset.id;selectedSteamId=0;tab='add';render();window.scrollTo(0,0);break;
    case 'sort':libSort=b.dataset.sort;render();break;
    case 'save-game':saveGame();break;
    case 'delete-game':deleteGame(b.dataset.id);break;
    case 'pick-suggestion':{
      const item=$('suggestions')._choices?.[Number(b.dataset.index)];if(!item)break;
      $('f-title').value=item.title;$('f-en').value=item.titleEn||'';
      selectedSteamId=Number(item.steamId)||0;
      $('suggestions').style.display='none';
      if(item.steamId&&!item.titleEn){selectedSearchSeq++;native.resolveEnglish(item.steamId,item.title,selectedSearchSeq);}
      break;
    }
    case 'pick-cover':native.pickCover(b.dataset.id);break;
    case 'auto-cover':{
      const game=data.games.find(g=>g.id===b.dataset.id);if(!game)break;
      native.clearManualCover(game.id);native.clearAutoCover(game.id);
      delete game.coverKind;persist();refreshCover(game.id);ensureCovers([game],true);toast('正在匹配封面');
      break;
    }
    case 'import-mode':importMode=b.dataset.mode;render();break;
    case 'pick-screenshot':native.pickScreenshot();break;
    case 'pick-file':native.pickImport();break;
    case 'parse-text':startPreview(parseLooseText($('import-text').value),'粘贴文字');break;
    case 'apply-mapping':applyMapping();break;
    case 'preview-page':captureReview();importPage=Number(b.dataset.page);render();window.scrollTo(0,0);break;
    case 'remove-review':{
      const row=b.closest('[data-review]');
      if(row){row.querySelector('header input').checked=false;row.style.opacity='.45';}
      break;
    }
    case 'commit-import':commitImport();break;
    case 'export':native.exportBackup(JSON.stringify({format:'youji-backup',version:1,exportedAt:new Date().toISOString(),games:backupGames()},null,2));break;
    case 'restore':native.pickImport();break;
    case 'check-update':toast('正在检查更新');native.checkForUpdates(true);break;
    case 'update-later':closeConfirm();break;
    case 'update-now':if(availableUpdate){const item=availableUpdate;closeConfirm();toast('开始下载更新');native.downloadUpdate(item.url,item.digest,item.version);}break;
    case 'cancel-confirm':closeConfirm();break;
    case 'confirm-now':if(confirmAction.callback)confirmAction.callback();break;
  }
});
document.addEventListener('error',e=>{if(e.target?.classList?.contains('game-cover'))e.target.hidden=true;},true);
document.addEventListener('change',e=>{if(e.target.id==='duplicate-mode')duplicateMode=e.target.value;});
document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.tab)));
$('header-add').addEventListener('click',()=>navigate('add'));
render();
ensureCovers();
