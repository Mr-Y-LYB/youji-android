/* Windows desktop bridge. Android loads this file without activating it. */
if(location.protocol==='http:' && location.hostname==='127.0.0.1'){
  window.__YOUJI_WINDOWS__=true;
  document.body.classList.add('windows-app');
  const token=document.querySelector('meta[name="youji-token"]')?.content||'';
  function call(path,data){
    const xhr=new XMLHttpRequest();
    xhr.open(data===undefined?'GET':'POST','/api/'+path,false);
    xhr.setRequestHeader('X-YouJi-Token',token);
    if(data!==undefined)xhr.setRequestHeader('Content-Type','application/json');
    try{xhr.send(data===undefined?null:JSON.stringify(data));return xhr.status===200?JSON.parse(xhr.responseText):{};}
    catch(e){return {};}
  }
  function filePicker(accept,onFile){
    const input=document.createElement('input');input.type='file';input.accept=accept;
    input.onchange=()=>{const file=input.files?.[0];if(file)onFile(file);};
    input.click();
  }
  function fetchJson(path,data,callback){
    fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-YouJi-Token':token},body:JSON.stringify(data)})
      .then(r=>r.json()).then(callback).catch(()=>callback({error:'联网搜索暂不可用'}));
  }
  window.Native={
    getSeenVersion:()=>call('seen-version').version||'',
    markVersionSeen:version=>call('seen-version',{version}),
    loadState:()=>call('state').state||'{"version":1,"games":[]}',
    saveState:state=>!!call('state',{state}).ok,
    ensureCovers:games=>{fetchJson('covers',{games:JSON.parse(games)},()=>{});},
    ensureAchievementIcons:game=>{fetchJson('achievement-icons',{game:JSON.parse(game)},()=>{});},
    pickAchievementIcon:(id,key)=>filePicker('image/*',file=>{
      if(file.size>12*1024*1024){window.onAchievementIconError('图片不能超过 12 MB');return;}
      const reader=new FileReader();reader.onload=()=>{
        const image=new Image();image.onload=()=>{
          const canvas=document.createElement('canvas');canvas.width=80;canvas.height=80;
          const ctx=canvas.getContext('2d'),side=Math.min(image.width,image.height);
          ctx.drawImage(image,(image.width-side)/2,(image.height-side)/2,side,side,0,0,80,80);
          window.onManualAchievementIconReady({id,key,data:canvas.toDataURL('image/jpeg',.85)});
        };image.onerror=()=>window.onAchievementIconError('图标读取失败');image.src=reader.result;
      };reader.readAsDataURL(file);
    }),
    getManualCoverData:id=>call('manual-cover?id='+encodeURIComponent(id)).data||'',
    saveManualCover:(id,data)=>!!call('manual-cover',{id,data}).ok,
    clearAutoCover:id=>call('cover-clear',{id,kind:'auto'}),
    clearManualCover:id=>call('cover-clear',{id,kind:'manual'}),
    clearCover:id=>call('cover-clear',{id,kind:'all'}),
    pickCover:id=>filePicker('image/*',file=>{
      if(file.size>12*1024*1024){window.onCoverError('图片不能超过 12 MB');return;}
      const reader=new FileReader();reader.onload=()=>{
        const result=call('manual-cover',{id,data:String(reader.result).split(',')[1]||''});
        if(result.ok)window.onManualCoverReady({id});else window.onCoverError('封面导入失败，请换一张图片');
      };reader.readAsDataURL(file);
    }),
    pickImport:()=>filePicker('.json,.csv,.tsv,.txt,.html,.htm,.xlsx',file=>{
      const reader=new FileReader();reader.onload=()=>{
        fetch('/api/import-file?name='+encodeURIComponent(file.name),{method:'POST',headers:{'X-YouJi-Token':token},body:reader.result})
          .then(r=>r.json()).then(window.onPickedFile).catch(()=>window.onPickedFile({error:'文件读取失败'}));
      };reader.readAsArrayBuffer(file);
    }),
    pickScreenshot:()=>window.onScreenshotError('Windows 版请使用文字或文件导入'),
    exportBackup:json=>{
      const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='游迹备份-'+new Date().toISOString().slice(0,10)+'.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),3000);window.onExportFinished(true);
    },
    searchOnline:(query,requestId)=>fetchJson('search',{query,requestId},r=>window.onOnlineResults({...r,requestId})),
    resolveEnglish:(steamId,title,requestId)=>fetchJson('english',{steamId,title,requestId},r=>window.onEnglishResolved({...r,requestId,title})),
    fetchAchievements:gameJson=>{const game=JSON.parse(gameJson);fetchJson('achievements',{game},r=>window.onAchievementsLoaded({...r,id:game.id,platform:game.platform,title:game.title}));},
    checkForUpdates:manual=>fetchJson('update',{manual},r=>window.onUpdateCheck({...r,manual})),
    downloadUpdate:url=>{
      if(/^https:\/\/github\.com\/Mr-Y-LYB\/youji-android\/releases\/download\//.test(url)){
        const a=document.createElement('a');a.href=url;a.target='_blank';a.click();
        window.onUpdateDownload({message:'下载完成后打开 Windows 安装包'});
      }
    }
  };
  setInterval(()=>{
    const events=call('cover-events').events||[];
    for(const item of events){if(item.kind==='achievement-icon')window.onAchievementIconReady?.(item);else window.onCoverReady?.(item);}
  },1200);
  window.addEventListener('load',()=>setTimeout(()=>window.Native.checkForUpdates(false),1000));
}
