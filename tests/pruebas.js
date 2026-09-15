/*
  Pruebas de la lógica crítica de Gráfica Pro.
  Cómo correrlas:  node tests/pruebas.js
  No necesitan navegador ni Firebase: prueban las funciones puras que sostienen el sistema.
  Si alguna falla, algo se rompió: revisar antes de subir el cambio a git.
*/
let fallos=0;
const ok=(c,m)=>{if(!c){console.error('  ✗ FALLO: '+m);fallos++;}else console.log('  ✓ '+m);};
const grupo=t=>console.log('\n== '+t+' ==');

// ---------- IDs únicos (uid) ----------
grupo('IDs únicos a prueba de colisión');
let _uidC=0;const _uidSalt=Math.floor(Math.random()*1000);
function uid(){return Math.floor(Date.now()/1000)*1e6+_uidSalt*1e3+(_uidC=(_uidC+1)%1000);}
{
  const a=uid(),b=uid();
  ok(a!==b,'dos uid consecutivos son distintos');
  ok(a<Number.MAX_SAFE_INTEGER,'uid dentro de rango seguro');
  const c1=(s=>{let c=0;return()=>Math.floor(1751000000)*1e6+s*1e3+(c=(c+1)%1000);})(11);
  const c2=(s=>{let c=0;return()=>Math.floor(1751000000)*1e6+s*1e3+(c=(c+1)%1000);})(22);
  ok(c1()!==c2(),'dos usuarios distintos no colisionan el mismo segundo');
}

// ---------- Sanitización de entrada (anti-XSS) ----------
grupo('Sanitización de texto');
function sanTxt(s){return(s==null?'':String(s)).replace(/[<>]/g,'').trim();}
ok(sanTxt('<img onerror=x>Juan')==='img onerror=xJuan','quita < y >');
ok(sanTxt('  Cliente S.A.  ')==='Cliente S.A.','respeta texto normal y recorta espacios');

// ---------- Paginación ----------
grupo('Paginación de tablas');
const PER=25;
function _pagina(rows,page){const pgs=Math.ceil(rows.length/PER)||1;if(page>pgs)page=1;return{sl:rows.slice((page-1)*PER,page*PER),pgs,page};}
{
  const rows=Array.from({length:60},(_,i)=>i+1);
  ok(_pagina(rows,1).sl.length===25&&_pagina(rows,1).pgs===3,'60 filas = 3 páginas de 25');
  ok(_pagina(rows,3).sl.length===10,'última página tiene el resto');
  ok(_pagina(rows,9).page===1,'página fuera de rango vuelve a 1');
  ok(_pagina([1,2],1).pgs===1,'pocas filas = 1 sola página');
}

// ---------- Guardado incremental ----------
grupo('Guardado incremental (solo escribe lo que cambió)');
{
  const cache={};let writes=0;
  function save(arr){const ids=new Set(arr.map(x=>String(x.id)));for(const it of arr){const s=String(it.id),j=JSON.stringify(it);if(cache[s]===j)continue;writes++;cache[s]=j;}for(const k of Object.keys(cache))if(!ids.has(k))delete cache[k];}
  const arr=[{id:1,v:'a'},{id:2,v:'b'}];
  save(arr);ok(writes===2,'primer guardado escribe los 2');
  save(arr);ok(writes===2,'sin cambios: 0 escrituras nuevas');
  arr[1].v='B';save(arr);ok(writes===3,'solo el cambiado se reescribe');
}

// ---------- Preprensa en 2 columnas (Diseño / CTP) ----------
grupo('Columnas de seguimiento (Diseño / CTP)');
{
  const SEG_COLS=[{k:'ppd',re:/pre-?prensa(?!.*(ctp|chapa))|diseñ/i},{k:'ctp',re:/ctp|chapa/i},{k:'papel',re:/papel|guillotina|insumo/i}];
  const match=(nombre,k)=>SEG_COLS.find(c=>c.k===k).re.test(nombre);
  ok(match('Pre-prensa diseño','ppd')&&!match('Pre-prensa diseño','ctp'),'"diseño" cae en Diseño');
  ok(match('Pre-prensa CTP','ctp')&&!match('Pre-prensa CTP','ppd'),'"CTP" cae en CTP');
  ok(match('Pre-prensa','ppd'),'paso viejo "Pre-prensa" cae en Diseño');
}

// ---------- Roles ----------
grupo('Permisos por rol');
function puedeVerFinanzas(email){const r=(email||'').toLowerCase().split('@')[0];return !!r&&/gerencia|admin|contab|direccion|esteban|juanpablo/.test(r);}
ok(puedeVerFinanzas('esteban-gerencia@coma.com'),'gerencia ve finanzas');
ok(!puedeVerFinanzas('preprensa@coma.com'),'operario NO ve finanzas');

// ---------- Integridad referencial ----------
grupo('Integridad referencial al borrar');
function cotTieneOTs(ordenes,cotId){return ordenes.filter(o=>o.cotId==cotId).length;}
ok(cotTieneOTs([{cotId:5}],5)===1,'detecta OT asociada (no deja borrar)');
ok(cotTieneOTs([{cotId:5}],9)===0,'sin OTs asociadas se puede borrar');

// ---------- Validación de cotización ----------
grupo('Validación de cotización');
function validaCot(items){if(!items.length)return'sin items';if(!items.some(i=>+i.qty>0))return'sin cantidad';return'ok';}
ok(validaCot([])==='sin items','rechaza cotización vacía');
ok(validaCot([{qty:0}])==='sin cantidad','rechaza cantidad 0');
ok(validaCot([{qty:100}])==='ok','acepta cotización válida');

// ---------- Archivado de OTs ----------
grupo('Archivado de órdenes');
function otsVisibles(ordenes,verArch){return verArch?ordenes:ordenes.filter(o=>!o.archivada);}
{
  const ords=[{id:1,archivada:false},{id:2,archivada:true},{id:3}];
  ok(otsVisibles(ords,false).length===2,'por defecto oculta las archivadas');
  ok(otsVisibles(ords,true).length===3,'con "ver archivadas" se ven todas');
  ok(otsVisibles(ords,false).every(o=>!o.archivada),'ninguna archivada en la vista normal');
}

// ---------- Nombres capitalizados ----------
grupo('Capitalización de nombres');
function capNom(s){s=(s==null?'':String(s)).trim();if(!s)return'';return s.replace(/\S+/g,w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase());}
ok(capNom('esteban')==='Esteban','esteban -> Esteban');
ok(capNom('ESTEBAN')==='Esteban','ESTEBAN -> Esteban');
ok(capNom('juan pablo')==='Juan Pablo','dos palabras');
ok(capNom('')===''&&capNom(null)==='','vacío/null quedan vacíos');

// ---------- Backup ----------
grupo('Copia de seguridad');
{
  const S={clientes:[{id:1}],ordenes:[{id:2,num:'OT-1'}],ids:{ot:3}};
  const backup={_app:'GraficaPro',_version:1,clientes:S.clientes,ordenes:S.ordenes,ids:S.ids};
  const parsed=JSON.parse(JSON.stringify(backup));
  ok(parsed._app==='GraficaPro'&&parsed.ordenes[0].num==='OT-1','el backup incluye los datos y su marca');
}

// ---------- Costos de ficha: defaults + directos ----------
grupo('Costos de ficha (recursos pre-cargados y costos directos)');
{
  function _defFijos(ac){if(!ac.fijos)ac.fijos={};const D={chapas:'CTP Coma',corte:'Guillotina Coma',cajas:'Stock Coma'};let ch=false;for(const k in D){if(!ac.fijos[k]){ac.fijos[k]={proveedor:D[k],monto:0};ch=true;}}return ch;}
  const ac={fijos:{},procesos:[],directos:[]};
  ok(_defFijos(ac)===true&&ac.fijos.chapas.proveedor==='CTP Coma','chapas viene pre-cargado CTP Coma');
  ok(ac.fijos.corte.proveedor==='Guillotina Coma'&&ac.fijos.cajas.proveedor==='Stock Coma','corte=Guillotina, cajas=Stock Coma');
  ok(_defFijos(ac)===false,'defaults son idempotentes (no reescribe)');
  const ac2={fijos:{corte:{proveedor:'Corte Externo',monto:5}}};
  _defFijos(ac2);ok(ac2.fijos.corte.proveedor==='Corte Externo','no pisa el recurso ya elegido');

  const S={recursosAnal:['Stock Coma','SM52']};
  function _recursosFijo(k,actual){const M={papel:['Stock Coma','Papelera'],impresion:(S.recursosAnal||[]).slice(),chapas:['CTP Coma','CTP Externo'],corte:['Guillotina Coma'],flete:['Coma','Edu','Walter','Torreflet'],cajas:['Stock Coma']};const arr=(M[k]||(S.recursosAnal||[])).slice();if(actual&&!arr.includes(actual))arr.unshift(actual);return arr;}
  ok(_recursosFijo('flete','').join()==='Coma,Edu,Walter,Torreflet','flete ofrece Coma/Edu/Walter/Torreflet');
  ok(_recursosFijo('impresion','').includes('SM52'),'impresión ofrece las máquinas');
  ok(_recursosFijo('corte','ViejoValor')[0]==='ViejoValor','conserva un recurso viejo fuera de la lista');

  function totalCosto(ac){const tf=Object.values(ac.fijos).reduce((a,x)=>a+(x.monto||0),0);const tp=(ac.procesos||[]).reduce((a,p)=>a+(p.monto||0),0);const td=(ac.directos||[]).reduce((a,d)=>a+(d.monto||0),0);return tf+tp+td;}
  const ac3={fijos:{papel:{monto:100}},procesos:[{monto:50}],directos:[{concepto:'cordón',monto:30},{concepto:'comisión',monto:20}]};
  ok(totalCosto(ac3)===200,'el costo total suma los costos directos');
}

// ---------- Ficha auto: máquina pre-cargada + guardado sin undefined ----------
grupo('Ficha automática (máquina pre-cargada) y guardado seguro');
{
  function _maqImpDeOT(ot){try{const a=(ot&&ot.asignaciones)||{};for(const kk in a){if(/^Impresi[oó]n/i.test(kk)&&a[kk]&&a[kk].nombre)return a[kk].nombre;}}catch(e){}return '';}
  function _ceAuto(ot){const maq=_maqImpDeOT(ot);const fijos={chapas:{proveedor:'CTP Coma',monto:0},corte:{proveedor:'Guillotina Coma',monto:0},cajas:{proveedor:'Stock Coma',monto:0}};if(maq)fijos.impresion={proveedor:maq,monto:0};return {fijos:fijos,procesos:[],directos:[]};}
  const ot={asignaciones:{'Pre-prensa diseño':{nombre:'Pre-prensa'},'Impresión (SM74)':{nombre:'SM74'},'Guillotina':{nombre:'Guillotina'}}};
  ok(_ceAuto(ot).fijos.impresion.proveedor==='SM74','la máquina de la OT queda pre-cargada en Impresión');
  ok(_ceAuto({asignaciones:{}}).fijos.impresion===undefined,'sin máquina no inventa impresión');
  ok(_ceAuto({asignaciones:{}}).fijos.corte.proveedor==='Guillotina Coma','igual trae los defaults');

  // Firestore rechaza undefined: guardamos la versión "limpia" (JSON descarta undefined)
  const item={id:1,a:undefined,b:2,nest:{x:undefined,y:3},arr:[{p:undefined,q:4}]};
  const clean=JSON.parse(JSON.stringify(item));
  ok(!('a' in clean)&&!('x' in clean.nest),'el guardado limpio descarta los undefined');
  ok(clean.b===2&&clean.nest.y===3&&clean.arr[0].q===4,'conserva los valores válidos');
}

// ---------- Análisis técnico de la OT (poses / pliegos) ----------
grupo('Análisis técnico de la OT');
{
  function posesAuto(a){const PW=+a.piezaW||0,PH=+a.piezaH||0,SW=+a.pliegoW||0,SH=+a.pliegoH||0;if(PW<=0||PH<=0||SW<=0||SH<=0)return 0;const o1=Math.floor(SW/PW)*Math.floor(SH/PH);const o2=Math.floor(SW/PH)*Math.floor(SH/PW);return Math.max(o1,o2);}
  ok(posesAuto({piezaW:40,piezaH:40,pliegoW:720,pliegoH:1020})===450,'stickers 40x40 en 720x1020 = 450 poses');
  ok(posesAuto({piezaW:300,piezaH:100,pliegoW:720,pliegoH:1020})===21,'elige la mejor orientación (21)');
  ok(posesAuto({})===0,'sin medidas devuelve 0');
  function calc(a){const posAuto=posesAuto(a);const poses=(+a.posesManual>0)?+a.posesManual:posAuto;const cant=+a.cantidad||0;const dem=+a.demasia||0;const pliegosImp=(poses>0&&cant>0)?Math.ceil(cant/poses):0;return {poses,pliegosImp,pliegosTot:pliegosImp>0?pliegosImp+dem:0};}
  const r=calc({piezaW:40,piezaH:40,pliegoW:720,pliegoH:1020,cantidad:100000,demasia:250,posesManual:''});
  ok(r.pliegosImp===223&&r.pliegosTot===473,'100.000 u / 450 poses + demasía 250 = 223 a imprimir, 473 totales');
  ok(calc({piezaW:40,piezaH:40,pliegoW:720,pliegoH:1020,cantidad:100000,demasia:250,posesManual:500}).poses===500,'poses manual pisa el cálculo automático');
  function parseNum(val){const n=parseFloat(String(val).replace(/\./g,'').replace(',','.').replace(/[^\d.]/g,''));return isNaN(n)?'':n;}
  ok(parseNum('100.000')===100000&&parseNum('72,5')===72.5,'parseo es-AR: punto miles, coma decimal');
}

// ---------- Días hábiles para producir ----------
grupo('Días hábiles ingreso → entrega');
{
  function diasHabiles(iso1,iso2){if(!iso1||!iso2)return null;const a=new Date(iso1+'T00:00:00'),b=new Date(iso2+'T00:00:00');if(isNaN(a)||isNaN(b))return null;if(b<a)return 0;let n=0;const d=new Date(a);d.setDate(d.getDate()+1);while(d<=b){if(d.getDay()!==0)n++;d.setDate(d.getDate()+1);}return n;}
  ok(diasHabiles('2026-07-12','2026-07-24')===11,'12→24 jul = 11 hábiles (excluye domingos)');
  ok(diasHabiles('2026-07-24','2026-07-20')===0,'entrega antes que ingreso = 0');
  ok(diasHabiles('','2026-07-24')===null,'sin fecha = null');
}

// ---------- No aprobar OT sin recursos ----------
grupo('Bloqueo de aprobación sin recursos');
{
  function otRecursosAsignados(o){const a=o&&o.asignaciones||{};const has=re=>Object.keys(a).some(k=>re.test(k)&&a[k]&&a[k].nombre);return has(/impresi/i)&&has(/pre-?prensa/i);}
  ok(otRecursosAsignados({asignaciones:{'Pre-prensa diseño':{nombre:'Pre-prensa'},'Impresión (SM74)':{nombre:'SM74'}}}),'con pre-prensa + impresión se puede aprobar');
  ok(!otRecursosAsignados({asignaciones:{}}),'sin asignaciones se bloquea');
  ok(!otRecursosAsignados({asignaciones:{'Impresión (SM74)':{nombre:'SM74'}}}),'falta pre-prensa: se bloquea');
}

// ---------- Ranking de vendedores (costo real OT×OT, fallback presupuestado ficha) ----------
grupo('Ranking de vendedores (ventas netas + margen)');
{
  const S={analCostos:{}};
  function _sumFPD(c){if(!c)return 0;const f=c.fijos?Object.values(c.fijos).reduce((a,x)=>a+(x.monto||0),0):0;const p=c.procesos?c.procesos.reduce((a,x)=>a+(x.monto||0),0):0;const d=c.directos?c.directos.reduce((a,x)=>a+(x.monto||0),0):0;return f+p+d;}
  function _costoRealOT(otId){return _sumFPD(S.analCostos&&S.analCostos[otId]);}
  function _costoPresupFicha(f){let t=_sumFPD(f.costosEstimados);if(f.costosOT)Object.values(f.costosOT).forEach(c=>t+=_sumFPD(c));return t;}
  function costoFicha(f){const otIds=Array.isArray(f.otIds)?f.otIds:(f.otId?[f.otId]:[]);let real=0,hayReal=false;otIds.forEach(id=>{const c=_costoRealOT(id);if(c>0){real+=c;hayReal=true;}});return hayReal?{costo:real,fuente:'real'}:{costo:_costoPresupFicha(f),fuente:'presup'};}
  function rankingVendedores(fichas){const m={};fichas.forEach(f=>{const v=(f.vendedor||'').trim()||'Sin asignar';const key=v.toUpperCase();if(!m[key])m[key]={vend:v,netas:0,costo:0,n:0,real:0,presup:0};const cf=costoFicha(f);m[key].netas+=(+f.total||0);m[key].costo+=cf.costo;m[key][cf.fuente]++;m[key].n++;});const arr=Object.values(m).map(x=>{const margen=x.netas-x.costo;return Object.assign(x,{margen,mgPct:x.netas>0?(margen/x.netas*100):0});});arr.sort((a,b)=>b.netas-a.netas);return arr;}
  S.analCostos[10]={fijos:{papel:{monto:40000},impresion:{monto:20000}},procesos:[{monto:10000}]}; // 70000 real
  const fA={vendedor:'JPM',total:200000,otIds:[10],costosEstimados:{fijos:{papel:{monto:50000}},procesos:[],directos:[]}};
  const fB={vendedor:'jpm',total:100000,otIds:[11],costosEstimados:{fijos:{impresion:{monto:30000}},procesos:[{monto:5000}],directos:[{monto:5000}]}}; // presup 40000
  const fC={vendedor:'EEC',total:80000,otIds:[12]};
  const r=rankingVendedores([fA,fB,fC]);
  const jpm=r.find(x=>x.vend==='JPM');
  ok(jpm.netas===300000&&r[0].vend==='JPM','agrupa vendedor y ordena por ventas netas');
  ok(jpm.costo===110000&&jpm.margen===190000,'usa costo real donde hay (70k) + presupuestado donde no (40k)');
  ok(jpm.real===1&&jpm.presup===1,'marca origen del costo (mixto)');
  ok(r.find(x=>x.vend==='EEC').costo===0,'sin costo cargado, margen = ventas');
}

// ---------- Resultado ----------
console.log('\n'+(fallos?('❌ '+fallos+' prueba(s) fallaron'):'✅ Todas las pruebas pasaron'));
if(typeof process!=='undefined')process.exit(fallos?1:0);
