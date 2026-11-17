// Anti IDE - renderer robusto (funciona con/sin internet, con/sin Electron)
(function(){
'use strict';
let root=null, tabs=[], activePath=null, editor=null, monacoReady=false, useFallback=false;
let activeJdk=null, jdkCache=[];
const $=id=>document.getElementById(id);
const api=(window.api||null);
const extLang={js:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',py:'python',java:'java',c:'c',h:'c',cpp:'cpp',cc:'cpp',cs:'csharp',go:'go',php:'php',rb:'ruby',rs:'rust',kt:'kotlin',html:'html',htm:'html',css:'css',json:'json',xml:'xml',yml:'yaml',yaml:'yaml',md:'markdown',sql:'sql',sh:'shell',ps1:'powershell',dart:'dart',swift:'swift',lua:'lua',pl:'perl',r:'r',scala:'scala',vue:'html',svelte:'html'};
const langOf=p=>extLang[((p||'').split('.').pop()||'').toLowerCase()]||'plaintext';

function showErr(m){const b=$('err-banner');if(!b)return;b.style.display='block';b.textContent='Anti IDE: '+m;setTimeout(()=>{b.style.display='none';},6000);}
window.addEventListener('error',e=>{try{if(e.message&&e.message.indexOf('prompt')===-1)showErr(e.message);}catch{}});
// ---------- modales propios (prompt/confirm/alert no existen en Electron) ----------
function modal(opts){
  return new Promise((resolve)=>{
    const ov=$('modal-overlay'),ti=$('modal-title'),ms=$('modal-msg'),inp=$('modal-input'),ok=$('modal-ok'),cx=$('modal-cancel');
    ti.textContent=opts.title||'Anti IDE';
    ms.textContent=opts.message||'';
    const needInput=!!opts.input;
    inp.style.display=needInput?'block':'none';
    inp.value=opts.defaultValue||'';
    inp.placeholder=opts.placeholder||'';
    cx.style.display=opts.hideCancel?'none':'';
    ok.textContent=opts.okText||'Aceptar';
    ov.classList.remove('hidden');
    const done=(v)=>{ov.classList.add('hidden');ok.onclick=null;cx.onclick=null;inp.onkeydown=null;resolve(v);};
    ok.onclick=()=>done(needInput?inp.value:true);
    cx.onclick=()=>done(needInput?null:false);
    inp.onkeydown=(e)=>{if(e.key==='Enter')done(inp.value);if(e.key==='Escape')done(null);};
    setTimeout(()=>{if(needInput)inp.focus();else ok.focus();},50);
  });
}
function askText(title,defVal){return modal({title:title,message:'',input:true,defaultValue:defVal||''});}
function askConfirm(msg){return modal({title:'Confirmar',message:msg,input:false});}
async function msg(m){showBottom('run');setRun(String(m));await modal({title:'Anti IDE',message:String(m),input:false,hideCancel:true});}
function setRun(t){$('run-out').textContent=t;}
function escapeHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function showBottom(name){const b=document.querySelector('.btab[data-b="'+name+'"]');if(b)b.click();}
function hideWelcome(){if($('welcome'))$('welcome').classList.add('hidden');if($('tabsbar'))$('tabsbar').classList.remove('hidden');const ed=$('editor');const fb=$('fallback-editor');if(useFallback){if(fb)fb.classList.remove('hidden');}else{if(ed)ed.classList.remove('hidden');}}

// ---------- editor abstraction ----------
function edGet(){if(monacoReady&&editor)return editor.getValue();return $('fallback-editor').value;}
function edSet(v){if(monacoReady&&editor){const old=editor.getModel();if(old)old.dispose();editor.setModel(monaco.editor.createModel(v||'',langOf(activePath||'a.txt')));}else{$('fallback-editor').value=v||'';}}
function edFocus(){if(monacoReady&&editor)editor.focus();else $('fallback-editor').focus();}

function initEditor(){
  // si no hay loader -> fallback inmediato
  const tryFallback=(reason)=>{
    if(monacoReady)return;
    useFallback=true;
    const fb=$('fallback-editor');const ed=$('editor');
    if(fb&&activePath)fb.classList.remove('hidden');
    if(fb)fb.oninput=()=>{const t=tabs.find(t=>t.path===activePath);if(t){if(t.content!==fb.value){t.dirty=true;renderTabs();}updateProblems(fb.value);}};
    if(reason)setRun('Editor simple activado ('+reason+'). Todo lo demás sigue funcionando.');
  };
  try{
    if(window._monacoLoadError){tryFallback('sin internet, Monaco CDN falló');return;}
    if(typeof require==='undefined'||!require.config){
      // espera 1.5s por si el CDN lento carga
      let n=0;const iv=setInterval(()=>{n++;
        if(typeof require!=='undefined'&&require.config){clearInterval(iv);initMonaco(tryFallback);}
        else if(n>15){clearInterval(iv);tryFallback('Monaco no cargó (usa local node_modules)');}
      },200);
      return;
    }
    initMonaco(tryFallback);
  }catch(e){tryFallback(String(e&&e.message||e));}
}
function initMonaco(tryFallback){
  try{
    require.config({paths:{vs: window._localVs || './node_modules/monaco-editor/min/vs'}});
  }catch(e){
    try{require.config({paths:{vs:'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs'}});}catch(e2){tryFallback('config');return;}
  }
  try{
    require(['vs/editor/editor.main'],()=>{
      try{
        monacoReady=true;useFallback=false;
        monaco.editor.defineTheme('darcula',{base:'vs-dark',inherit:true,rules:[],colors:{'editor.background':'#1e1f22','editor.foreground':'#bcbec4'}});
        editor=monaco.editor.create($('editor'),{theme:'vs-dark',automaticLayout:true,fontSize:14,minimap:{enabled:true},scrollBeyondLastLine:false,padding:{top:8},suggestOnTriggerCharacters:true,quickSuggestions:true,tabSize:4,value:'// Anti IDE listo'});
        editor.onDidChangeModelContent(()=>{const t=tabs.find(t=>t.path===activePath);if(t&&t.content!==editor.getValue()){t.dirty=true;renderTabs();}try{updateProblems(editor.getValue());}catch{}});
        editor.onDidChangeCursorPosition(e=>{try{$('st-pos').textContent='Ln '+e.position.lineNumber+', Col '+e.position.column;}catch{}});
        try{editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyS,()=>saveFile());}catch{}
        if(activePath){const t=tabs.find(t=>t.path===activePath);if(t)edSet(t.content);}
      }catch(e){monacoReady=false;tryFallback(String(e&&e.message||e));}
    },()=>{tryFallback('CDN/local Monaco no encontrado');});
  }catch(e){tryFallback(String(e&&e.message||e));}
  // seguridad: si en 8s no cargó, fallback
  setTimeout(()=>{if(!monacoReady&&!useFallback)tryFallback('timeout 8s');},8000);
}

// ---------- sidebar ----------
document.querySelectorAll('.strip-btn').forEach(b=>{b.addEventListener('click',()=>{
  document.querySelectorAll('.strip-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');
  document.querySelectorAll('.side-view').forEach(v=>v.classList.add('hidden'));
  const v=$('view-'+b.dataset.view);if(v)v.classList.remove('hidden');
});});
document.querySelectorAll('.btab').forEach(b=>{b.addEventListener('click',()=>{
  document.querySelectorAll('.btab').forEach(x=>x.classList.remove('active'));b.classList.add('active');
  document.querySelectorAll('.bpanel').forEach(p=>p.classList.add('hidden'));
  const p=$('panel-'+b.dataset.b);if(p)p.classList.remove('hidden');
});});
if(document.body)document.body.addEventListener('click',()=>{const m=$('ctx-menu');if(m)m.classList.add('hidden');});

// ---------- archivos ----------
async function pickFolder(){
  if(!api){showBottom('run');setRun('No hay puente Electron (window.api). Corre: npm start');await msg('Abre con Electron: npm start en la carpeta Anti IDE');return;}
  try{const p=await api.openFolder();if(p)setRoot(p);else setRun('Diálogo cancelado. Puedes usar + New Project que crea en Documentos sin diálogo.');}catch(e){await msg(String(e));}
}
async function setRoot(p){
  root=p;
  $('project-name').textContent='- '+String(p).split(/[/\\]/).pop()+' ('+p+')';
  hideWelcome();refreshExplorer();detectGitBranch();
  // cargar JDK del proyecto
  try{
    const pr=await api.jdkGetProject();
    if(pr&&pr.jdk){activeJdk=pr.jdk;}
    else if(pr&&pr.active){activeJdk=pr.active;}
    updateJdkStatus();if($('np-jdk'))$('np-jdk').value=activeJdk||'';
  }catch{}
  showBottom('run');setRun('📂 Proyecto: '+p+'\nJDK: '+(activeJdk||'sin JDK')+'\nCrea un archivo con +📄 o abre demo.');
}
async function refreshExplorer(){
  if(!root||!api)return;
  try{
    const tree=await api.list(root);
    renderTree($('explorer'),tree||[]);
    if(!tree||!tree.length)$('explorer').innerHTML='<div style="color:#888;padding:8px">Carpeta vacía. Usa +📄 para crear Main.java</div>';
  }catch(e){$('explorer').innerHTML='Error: '+escapeHtml(String(e));}
}
function renderTree(container,nodes){
  container.innerHTML='';
  const mk=(n,parent)=>{
    const d=document.createElement('div');d.className='f-item '+(n.isDir?'dir':'file');
    d.textContent=(n.isDir?'📁 ':'📄 ')+n.name;d.title=n.path;
    d.addEventListener('click',(e)=>{e.stopPropagation();
      if(n.isDir){const c=d.nextSibling;if(c)c.style.display=(c.style.display==='none')?'':'none';}
      else openFile(n.path);
      document.querySelectorAll('.f-item').forEach(x=>x.classList.remove('active'));d.classList.add('active');});
    d.addEventListener('contextmenu',(e)=>{e.preventDefault();e.stopPropagation();showCtx(e.clientX,e.clientY,n);});
    parent.appendChild(d);
    if(n.isDir&&n.children&&n.children.length){const w=document.createElement('div');w.className='f-children';n.children.forEach(c=>mk(c,w));parent.appendChild(w);}
  };
  nodes.forEach(n=>mk(n,container));
}
function showCtx(x,y,node){
  const m=$('ctx-menu');if(!m)return;m.innerHTML='';
  const items=node.isDir?[['+ New File',()=>newFile(node.path,false)],['+ New Folder',()=>newFile(node.path,true)],['Refresh',refreshExplorer]]
    :[['Open',()=>openFile(node.path)],['Rename',()=>renameFile(node)],['Delete',()=>deleteFile(node.path)],['▶ Run',()=>{openFile(node.path);setTimeout(runCurrent,300);}]];
  items.forEach(([label,fn])=>{const d=document.createElement('div');d.textContent=label;d.addEventListener('click',()=>{m.classList.add('hidden');try{const r=fn();if(r&&r.catch)r.catch(e=>showErr(String(e)));}catch(e){showErr(String(e));}});m.appendChild(d);});
  m.style.left=x+'px';m.style.top=y+'px';m.classList.remove('hidden');
}
async function newFile(base,isDir){
  if(!api){await msg('Sin Electron no puedo crear archivos');return;}
  if(!base&&!root){await msg('Primero Open Folder o + New Project');return;}
  const name=await askText(isDir?'Nueva carpeta':'Nuevo archivo (ej: Main.java):','');
  if(!name)return;
  try{const r=await api.create(base||root,name,isDir);if(!r.ok)await msg(r.error);else refreshExplorer();}catch(e){await msg(String(e));}
}
async function renameFile(node){
  const nn=await askText('Renombrar a:',node.name);if(!nn)return;
  const np=node.path.replace(/[^/\\]+$/,nn);
  try{await api.rename(node.path,np);refreshExplorer();}catch(e){await msg(String(e));}
}
async function deleteFile(p){
  if(!await askConfirm('Eliminar '+p+' ?'))return;
  try{await api.del(p);}catch(e){await msg(String(e));return;}
  tabs=tabs.filter(t=>t.path!==p);if(activePath===p)activePath=tabs.length?tabs[0].path:null;
  renderTabs();if(activePath)openFile(activePath);refreshExplorer();
}

// ---------- tabs / abrir ----------
async function openFile(p){
  if(!api&&!String(p).includes('(memoria)')){await msg('Sin Electron no puedo leer archivos');return;}
  let t=tabs.find(t=>t.path===p);
  if(!t){
    if(String(p).includes('(memoria)'))return; // ya creado
    try{
      const r=await api.read(p);if(!r.ok){await msg(r.error);return;}
      t={path:p,content:r.content||'',dirty:false};tabs.push(t);
    }catch(e){await msg(String(e));return;}
  }
  activePath=p;renderTabs();hideWelcome();
  try{$('st-file').textContent=p;$('st-lang').textContent=langOf(p);$('run-target').textContent=String(p).split(/[/\\]/).pop();$('breadcrumb').textContent=p;}catch{}
  edSet(t.content);
  try{updateStructure(t.content,langOf(p));updateProblems(t.content);}catch{}
}
function renderTabs(){
  const c=$('tabs');if(!c)return;c.innerHTML='';
  tabs.forEach(t=>{
    const d=document.createElement('div');d.setAttribute('id','tab');
    if(t.path===activePath)d.classList.add('active');if(t.dirty)d.classList.add('dirty');
    const nm=String(t.path).split(/[/\\]/).pop();
    d.innerHTML='<span class="dot"></span><span></span><span class="x" style="margin-left:8px">✕</span>';
    d.children[1].textContent=nm;
    d.addEventListener('click',(e)=>{
      if(e.target.classList.contains('x')){
        (async()=>{if(t.dirty){if(!await askConfirm('Cerrar sin guardar?'))return;}tabs=tabs.filter(x=>x!==t);
          if(activePath===t.path){activePath=tabs.length?tabs[0].path:null;if(activePath)await openFile(activePath);else renderTabs();}
          else renderTabs();})();
      }else openFile(t.path);
    });
    c.appendChild(d);
  });
}
async function saveFile(){
  const t=tabs.find(t=>t.path===activePath);if(!t){return;}
  if(String(t.path).includes('(memoria)')){t.content=edGet();t.dirty=false;renderTabs();return;}
  if(!api){await msg('Sin Electron');return;}
  const v=edGet();
  try{const r=await api.write(t.path,v);if(r.ok){t.content=v;t.dirty=false;renderTabs();$('run-status').textContent='Saved ✓ '+new Date().toLocaleTimeString();}else await msg(r.error);}catch(e){await msg(String(e));}
}
function updateStructure(code,lang){
  const el=$('structure-list');if(!el)return;
  const items=[];(String(code||'').split('\n')).forEach((l,i)=>{if(/(class |function |def |public |private |protected |void\s+\w+|fn\s+|func\s+)/.test(l))items.push({l:i+1,t:l.trim().slice(0,60)});});
  el.innerHTML='';if(!items.length){el.textContent='Sin estructura detectada.';return;}
  items.slice(0,200).forEach(it=>{const d=document.createElement('div');d.className='f-item file';d.textContent='['+it.l+'] '+it.t;d.addEventListener('click',()=>{edFocus();});el.appendChild(d);});
}
function updateProblems(code){
  const el=$('problems-out');if(!el)return;
  const warns=[];(String(code||'').split('\n')).forEach((l,i)=>{if(l.includes('TODO')||l.includes('FIXME'))warns.push('Line '+(i+1)+': '+l.trim());});
  el.textContent=warns.length?warns.join('\n'):('No problems. '+String(code||'').split('\n').length+' lines.');
}

// ---------- run / build / terminal ----------
function termPrint(cmd,out,err,code){
  const d=$('term-out');if(!d)return;const e=document.createElement('div');
  const pre=document.createElement('pre');pre.style.color=code===0?'#bcbec4':'#ff7b72';
  pre.textContent=(out||'')+(err?'\n'+err:'')||'(sin salida)';
  const head=document.createElement('div');head.style.color='#7ab8ff';head.textContent='PS> '+cmd;
  e.appendChild(head);e.appendChild(pre);d.appendChild(e);
}
async function runCurrent(){
  if(!activePath){await msg('Abre un archivo primero (Open Folder o demo)');return;}
  const mem=String(activePath).includes('(memoria)');
  if(mem){
    if(!root||!api){showBottom('run');setRun('La demo en memoria no se puede ejecutar sin carpeta. Haz Open Folder, crea demo.js y Run.');await msg('Primero Open Folder para poder correr la demo en disco');return;}
  }
  // sincroniza contenido actual a memoria
  const t=tabs.find(t=>t.path===activePath);if(t)t.content=edGet();
  if(t&&t.dirty&&!mem){await saveFile();}
  showBottom('run');setRun('▶ '+activePath+'\nCompilando/ejecutando...'+(activeJdk?'\nJDK: '+activeJdk:'')+'\n');$('run-status').textContent='Running...';
  if(!api){setRun('Sin Electron no puedo ejecutar');return;}
  try{
    const r=await api.runFile(activePath, activeJdk);
    if(r.preview){showBottom('preview');$('preview-frame').src='file:///'+String(r.preview).replace(/\\/g,'/');setRun('Preview HTML abierto → pestaña Preview');$('run-status').textContent='Preview';return;}
    if(!r.ok){setRun('❌ ERROR:\n'+(r.error||'falló'));$('run-status').textContent='Failed';return;}
    setRun('✔ '+(r.label||'')+' exit='+(r.code)+' \n———— STDOUT ————\n'+(r.out||'(vacío)')+'\n———— STDERR ————\n'+(r.err||''));
    $('run-status').textContent='Done exit '+r.code;
  }catch(e){setRun('❌ EXCEPCIÓN:\n'+String(e));}
}
async function buildProject(){
  showBottom('run');setRun('🔨 Building...\n');
  if(!root||!api){setRun('Abre una carpeta primero (Open Folder)');return;}
  try{const r=await api.termExec(root,'javac -version; java -version; node --version; git --version',activeJdk);setRun('🔨 Build info:\n'+(r.out||'')+(r.err||''));}catch(e){setRun(String(e));}
}
async function execTerm(){
  const inp=$('term-in');if(!inp)return;const cmd=inp.value.trim();if(!cmd)return;inp.value='';
  if(!api){termPrint(cmd,'','Sin Electron',1);return;}
  termPrint(cmd,'...','',0);
  try{const r=await api.termExec(root,cmd,activeJdk);const last=$('term-out').lastChild;if(last)last.querySelector('pre').textContent=((r.out||'')+(r.err?'\n'+r.err:''))||'(sin salida)';}catch(e){termPrint(cmd,'',String(e),1);}
}
async function detectGitBranch(){
  if(!root||!api)return;
  try{const r=await api.gitExec(root,'rev-parse --abbrev-ref HEAD');if(r.code===0)$('st-branch').textContent='⎇ '+String(r.out).trim();else $('st-branch').textContent='⎇ (no git)';}catch{}
}

// ---------- wiring (SIEMPRE, aunque falle Monaco) ----------
async function diag(){
  showBottom('run');
  let out='🔍 DIAGNÓSTICO Anti IDE\n';
  out+='api: '+(api?'OK':'FALTA (corre con npm start, no con doble clic al html)')+'\n';
  if(api){
    try{const p=await api.ping();out+='electron: '+(p.electron||'?')+' node: '+(p.node||'?')+'\n';}catch(e){out+='ping FAIL: '+e+'\n';}
    out+='root: '+(root||'(ninguno)')+'\n';
    try{const r=await api.termExec(root,'node --version');out+='node: '+(r.out||r.err||'?').trim()+'\n';}catch(e){out+='node FAIL '+e+'\n';}
    try{const r=await api.termExec(root,'javac -version',activeJdk);out+='javac: '+((r.out||'')+(r.err||'')).trim().slice(0,120)+'\n';}catch(e){out+='javac FAIL\n';}
    try{const r=await api.jdkList();out+='JDKs detectados: '+((r&&r.list||[]).length)+'\n';(r&&r.list||[]).forEach(j=>{out+='   • '+(j.vendor||'JDK')+' '+j.version+'  ['+j.source+']  '+j.path+'\n';});out+='JDK activo: '+(activeJdk||'(ninguno)')+'\n';}catch(e){out+='jdkList FAIL '+e+'\n';}
  } else out+='Abre con: cd "Anti IDE" ; npm start\n';
  out+='monaco: '+(monacoReady?'OK':'fallback simple (sin internet, igual funciona)')+'\n';
  setRun(out);
}
// ---------- New Project dialog (IntelliJ style) ----------
let npState={tpl:'java',build:'intellij',parent:''};
async function openNewProjectDialog(){
  if(!api){await msg('Corre con npm start (no abras el html directo)');diag();return;}
  let defs={desktop:'',documents:''};
  try{defs=await api.defaultLocation();}catch{}
  npState.parent=(defs.desktop||'');
  npState.tpl='java';npState.build='intellij';
  const nameI=$('np-name'),locI=$('np-loc');
  nameI.value='untitled';locI.value=npState.parent;
  document.querySelectorAll('.np-item').forEach(it=>it.classList.toggle('active',it.dataset.tpl==='java'));
  document.querySelectorAll('.np-segbtn').forEach(b=>b.classList.toggle('active',b.dataset.build==='intellij'));
  $('np-git').checked=false;$('np-sample').checked=true;$('np-status').textContent='';$('np-status').className='';
  $('np-adv').classList.add('hidden');
  updateNpHint();
  refreshJdkDropdown();
  $('np-overlay').classList.remove('hidden');
  setTimeout(()=>{nameI.focus();nameI.select();},60);
}
function closeNpDialog(){$('np-overlay').classList.add('hidden');}
function updateNpHint(){
  const nm=($('np-name').value||'untitled').replace(/[<>:"/\\|?*]/g,'_');
  const p=npState.parent||'~';
  $('np-hint2').textContent=(p.endsWith('\\')?p:p+'\\')+nm;
}
function wireNewProjectDialog(){
  if(!$('np-overlay'))return;
  $('np-close').addEventListener('click',closeNpDialog);
  $('np-cancel').addEventListener('click',closeNpDialog);
  $('np-overlay').addEventListener('click',(e)=>{if(e.target===$('np-overlay'))closeNpDialog();});
  $('np-adv-toggle').addEventListener('click',(e)=>{const a=$('np-adv');a.classList.toggle('hidden');e.target.textContent=(a.classList.contains('hidden')?'▸':'▾')+' Advanced Settings';});
  $('np-name').addEventListener('input',updateNpHint);
  $('np-browse').addEventListener('click',async()=>{
    try{const p=await api.pickParent();if(p){npState.parent=p;$('np-loc').value=p;updateNpHint();}}catch(e){}
  });
  document.querySelectorAll('.np-item').forEach(it=>it.addEventListener('click',()=>{
    document.querySelectorAll('.np-item').forEach(x=>x.classList.remove('active'));it.classList.add('active');
    npState.tpl=it.dataset.tpl;
    const map={maven:'maven',gradle:'gradle'};
    if(map[npState.tpl]){npState.build=npState.tpl;document.querySelectorAll('.np-segbtn').forEach(b=>b.classList.toggle('active',b.dataset.build===npState.build));}
  }));
  document.querySelectorAll('.np-segbtn').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.np-segbtn').forEach(x=>x.classList.remove('active'));b.classList.add('active');npState.build=b.dataset.build;
  }));
  $('np-create').addEventListener('click',async()=>{
    const name=$('np-name').value.trim()||'untitled';
    const st=$('np-status');st.className='';st.textContent='⏳ Creando...';
    try{
      const r=await api.newProject({name:name,location:npState.parent,template:npState.tpl,build:npState.build,git:$('np-git').checked,group:$('np-group').value,jdk:activeJdk});
      if(!r||!r.ok){st.className='err';st.textContent='❌ '+((r&&r.error)||'no se pudo crear');return;}
      st.className='ok';st.textContent='✔ Creado en '+r.path;
      closeNpDialog();
      setRoot(r.path);
      try{const tree=await api.list(r.path);const first=(tree||[]).find(n=>!n.isDir)||findFirstFile(tree);if(first)openFile(first.path);}catch{}
    }catch(e){st.className='err';st.textContent='❌ '+String(e);}
  });
  $('np-name').addEventListener('keydown',e=>{if(e.key==='Enter')$('np-create').click();if(e.key==='Escape')closeNpDialog();});
  // JDK en el diálogo
  const manage=$('np-jdk-manage');if(manage)manage.addEventListener('click',()=>openJdkManager());
  const sel=$('np-jdk');if(sel)sel.addEventListener('change',async()=>{
    const v=sel.value;
    if(v==='__install__'){sel.value=activeJdk||'';openJdkManager();return;}
    activeJdk=v||null;updateJdkStatus();
    if(root&&api){try{await api.jdkSetActive(activeJdk);}catch{}}
  });
  refreshJdkDropdown();
}
async function refreshJdkDropdown(){
  const sel=$('np-jdk');if(!sel||!api)return;
  try{
    const r=await api.jdkList();
    jdkCache=(r&&r.list)||[];
    if(!activeJdk)activeJdk=(r&&r.active)||null;
    sel.innerHTML='';
    const none=document.createElement('option');none.value='';none.textContent='Sin JDK (solo archivos)';sel.appendChild(none);
    jdkCache.forEach(j=>{
      const o=document.createElement('option');o.value=j.path;
      o.textContent=(j.vendor||'JDK')+' '+j.version+'  ['+j.source+']'+(j.path===activeJdk?'  ✓':'');
      sel.appendChild(o);
    });
    const inst=document.createElement('option');inst.value='__install__';inst.textContent='+ Instalar JDK...';sel.appendChild(inst);
    sel.value=activeJdk||'';
  }catch(e){}
}
function updateJdkStatus(){
  const el=document.querySelector('#statusbar .st-jdk');if(!el)return;
  if(!activeJdk){el.textContent='☕ Sin JDK';return;}
  const j=jdkCache.find(x=>x.path===activeJdk);
  el.textContent='☕ '+(j?(j.vendor+' '+j.version):'JDK');
}
// ---------- JDK Manager dialog ----------
async function openJdkManager(){
  if(!api){await msg('Corre con npm start');return;}
  $('jdk-overlay').classList.remove('hidden');$('jdk-status').textContent='';
  await renderJdkManager();
}
function closeJdkManager(){$('jdk-overlay').classList.add('hidden');}
async function renderJdkManager(){
  const listEl=$('jdk-list'),versEl=$('jdk-vers');
  let r;try{r=await api.jdkList();}catch{r={list:[]};}
  jdkCache=(r&&r.list)||[];
  activeJdk=activeJdk||(r&&r.active)||null;
  listEl.innerHTML='';
  if(!jdkCache.length){listEl.innerHTML='<div style="color:#7a7d85;padding:8px">No hay JDKs instalados. Instala uno abajo ↓</div>';}
  jdkCache.forEach(j=>{
    const d=document.createElement('div');d.className='jdk-item'+(j.path===activeJdk?' active':'');
    d.innerHTML='<span class="jdk-ic">☕</span><span class="jdk-name">'+escapeHtml((j.vendor||'JDK')+' '+j.version)+'</span>'+
      '<span class="jdk-tag">'+escapeHtml(j.source||'')+'</span>'+
      (j.path===activeJdk?'<span class="jdk-badge">activo</span>':'')+
      '<span style="color:#7a7d85;font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis">'+(j.path===activeJdk?'':'')+'</span>';
    d.title=j.path;
    d.addEventListener('click',async()=>{
      activeJdk=j.path;
      try{await api.jdkSetActive(activeJdk);}catch{}
      updateJdkStatus();await renderJdkManager();await refreshJdkDropdown();
      $('jdk-status').textContent='✔ Activo: '+j.version;
    });
    listEl.appendChild(d);
  });
  const vers=await api.jdkVersions();
  versEl.innerHTML='';
  vers.forEach(v=>{
    const b=document.createElement('button');b.className='jdk-vbtn'+(v.lts?' lts':'');b.textContent=v.label;
    b.addEventListener('click',()=>startJdkInstall(v.v,b));
    versEl.appendChild(b);
  });
}
async function startJdkInstall(version,btn){
  if(btn)btn.disabled=true;
  const wrap=$('jdk-prog-wrap'),fill=$('jdk-bar-fill'),m=$('jdk-prog-msg');
  wrap.classList.remove('hidden');fill.style.width='0%';m.textContent='Conectando con Adoptium...';$('jdk-status').textContent='';
  const r=await api.jdkInstall(version);
  if(!r||!r.ok){
    m.textContent='❌ '+(r&&r.error||'falló');$('jdk-status').textContent='Error instalando';if(btn)btn.disabled=false;return;
  }
  fill.style.width='100%';m.textContent='✅ Instalado Temurin '+r.jdk.version;
  activeJdk=r.jdk.path;try{await api.jdkSetActive(activeJdk);}catch{}
  updateJdkStatus();await renderJdkManager();await refreshJdkDropdown();
  $('jdk-status').textContent='✔ Listo: '+r.jdk.version;
  if(btn)btn.disabled=false;
}
function wireJdkManager(){
  if(!$('jdk-overlay'))return;
  $('jdk-close').addEventListener('click',closeJdkManager);
  $('jdk-done').addEventListener('click',closeJdkManager);
  $('jdk-overlay').addEventListener('click',(e)=>{if(e.target===$('jdk-overlay'))closeJdkManager();});
  if(api)api.onJdkProgress((d)=>{
    const m=$('jdk-prog-msg'),fill=$('jdk-bar-fill');
    if(typeof d==='string'){if(m)m.textContent=d;}
    else if(d&&d.msg==='descarga'&&m){m.textContent='⬇ Descargando... '+d.data.pct+'%  ('+(d.data.got/1048576).toFixed(0)+' / '+(d.data.total/1048576).toFixed(0)+' MB)';if(fill)fill.style.width=d.data.pct+'%';}
    else if(d&&d.msg&&m){m.textContent=d.msg;}
  });
}
function findFirstFile(nodes){
  for(const n of nodes||[]){if(!n.isDir)return n;if(n.isDir&&n.children&&n.children.length){const f=findFirstFile(n.children);if(f)return f;}}
  return null;
}
async function mkProjectFlow(){ openNewProjectDialog(); }
function wireMenu(){
  const closeAll=()=>document.querySelectorAll('.menu-drop').forEach(d=>d.classList.add('hidden'));
  document.querySelectorAll('.menu-item').forEach(mi=>{
    mi.addEventListener('click',(e)=>{
      e.stopPropagation();
      const drop=mi.querySelector('.menu-drop');
      const was=drop?drop.classList.contains('hidden'):true;
      closeAll();if(drop&&was)drop.classList.remove('hidden');
    });
  });
  document.addEventListener('click',closeAll);
  document.querySelectorAll('.menu-drop div[data-a]').forEach(d=>{
    d.addEventListener('click',(e)=>{
      e.stopPropagation();closeAll();
      const a=d.dataset.a;
      if(a==='open')pickFolder();
      else if(a==='new')mkProjectFlow();
      else if(a==='save')saveFile();
      else if(a==='diag')diag();
      else if(a==='jdk')openJdkManager();
      else if(a==='format'){try{editor&&editor.getAction('editor.action.formatDocument').run();}catch{msg('Reformat solo en Monaco');}}
      else if(a==='find'){try{editor&&editor.getAction('actions.find').run();}catch{edFocus();}}
      else if(a==='explorer'){document.querySelector('.strip-btn[data-view="project"]').click();}
      else if(a==='terminal')showBottom('terminal');
      else if(a==='run')runCurrent();
      else if(a==='build')buildProject();
      else if(a==='gstatus'){document.querySelector('.strip-btn[data-view="git"]').click();}
      else if(a==='glog'){document.querySelector('.strip-btn[data-view="git"]').click();}
      else if(a==='about')msg('Anti IDE 1.0\nElectron + Monaco');
    });
  });
  const s=$('search-top');if(s)s.addEventListener('click',async()=>{
    const q=await askText('Go to file (nombre):','');if(!q||!root||!api)return;
    api.list(root).then(function find(nodes){for(const n of nodes||[]){if(!n.isDir&&n.name.toLowerCase().includes(q.toLowerCase())){openFile(n.path);return true;}if(n.isDir&&find(n.children))return true;}return false;});
  });
}
function wire(){
  const on=(id,fn)=>{const el=$(id);if(el)el.addEventListener('click',()=>{try{const r=fn();if(r&&r.catch)r.catch(e=>{showErr(String(e));setRun('❌ '+String(e));});}catch(e){showErr(e.message);}});};
  wireMenu();
  on('btn-open',pickFolder);on('w-open',pickFolder);
  on('btn-run',runCurrent);on('btn-run2',runCurrent);  on('btn-build',buildProject);
  on('btn-jdk',openJdkManager);
  on('btn-terminal-toggle',()=>showBottom('terminal'));
  on('btn-refresh',refreshExplorer);
  on('btn-new-file',()=>newFile(root,false));on('btn-new-folder',()=>newFile(root,true));
  on('btn-git-status',async()=>{if(!api||!root){$('git-out').textContent='Abre una carpeta primero';return;}const r=await api.gitExec(root,'status --short --branch');$('git-out').textContent=(r.out||'')+(r.err||'');});
  on('btn-git-log',async()=>{if(!api||!root){$('git-out').textContent='Abre una carpeta primero';return;}const r=await api.gitExec(root,'log --oneline -20');$('git-out').textContent=r.out||r.err||'(sin commits)';});
  on('btn-git-commit',async()=>{if(!api||!root)return;const m=($('git-msg').value||'update').replace(/"/g,'');const r=await api.gitExec(root,'add -A && git commit -m "'+m+'"');$('git-out').textContent=(r.out||'')+(r.err||'');});
  on('btn-about',()=>msg('Anti IDE 1.0\nElectron + Monaco\nSoporta todos los lenguajes vía compiladores locales'));
  on('w-new',mkProjectFlow);
  on('w-diag',diag);
  wireNewProjectDialog();
  wireJdkManager();
  on('w-demo',async()=>{
    if(!api){await msg('Corre con npm start');diag();return;}
    showBottom('run');setRun('⏳ Creando demo...');
    try{
      let base=root;
      if(!base){const loc=await api.defaultLocation();const r0=await api.newProject({name:'demo',location:loc.desktop,template:'javascript'});if(!r0||!r0.ok){setRun('❌ '+((r0&&r0.error)||'no se pudo'));return;}base=r0.path;setRoot(base);}
      const demo='// Demo Anti IDE\nconsole.log("Hola Anti IDE!");\nfor(let i=1;i<=5;i++) console.log("linea "+i);';
      const fp=base+'\\demo.js';
      try{await api.create(base,'demo.js',false);}catch{}
      const w=await api.write(fp,demo);
      if(!w.ok){setRun('❌ No pude escribir demo: '+w.error);return;}
      refreshExplorer();setTimeout(()=>openFile(fp),400);
      setRun('✔ Demo lista. Pulsa ▶ Run.');
    }catch(e){setRun('❌ '+String(e));}
  });
  const ti=$('term-in');if(ti)ti.addEventListener('keydown',e=>{if(e.key==='Enter')execTerm();});
  const st=$('sel-theme');if(st)st.addEventListener('change',e=>{try{if(monacoReady)monaco.editor.setTheme(e.target.value);}catch{}});
  const fs=$('font-size');if(fs)fs.addEventListener('change',e=>{try{if(monacoReady)editor.updateOptions({fontSize:+e.target.value});else $('fallback-editor').style.fontSize=(+e.target.value)+'px';}catch{}});
  const mm=$('chk-minimap');if(mm)mm.addEventListener('change',e=>{try{if(monacoReady)editor.updateOptions({minimap:{enabled:e.target.checked}});}catch{}});
  const fb=$('fallback-editor');if(fb)fb.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveFile();}});
  document.addEventListener('keydown',e=>{
    if(e.shiftKey&&e.key==='F10'){e.preventDefault();runCurrent();}
    if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveFile();}
  });
  if(api){
    try{
      api.onFolderOpened(p=>setRoot(p));
      api.onMenu('menu:save',saveFile);api.onMenu('menu:run',runCurrent);api.onMenu('menu:build',buildProject);
      api.onMenu('menu:new-file',()=>newFile(root,false));
      api.onMenu('menu:format',()=>{try{editor&&editor.getAction('editor.action.formatDocument').run();}catch{}});
      api.onMenu('menu:find',()=>{try{editor&&editor.getAction('actions.find').run();}catch{}});
    }catch{}
  }else{
    setRun('Modo web sin Electron: abre con npm start para archivos/Run/Terminal.');
  }
  // estado api en statusbar
  try{$('st-file').textContent=api?'Electron OK':'SIN Electron (npm start)';}catch{}
}

wire();
initEditor();
})();
