(() => {
  const form = document.getElementById("unlock-form");
  const input = document.getElementById("dashboard-password");
  const button = document.getElementById("unlock-button");
  const message = document.getElementById("lock-message");
  const number = new Intl.NumberFormat("fr-FR");
  const pct = new Intl.NumberFormat("fr-FR", {style:"percent",maximumFractionDigits:1});
  const fromBase64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = value => value === null || value === undefined ? "—" : number.format(value);
  const date = value => value ? new Date(value + "T12:00:00").toLocaleDateString("fr-FR") : "—";
  async function decryptDashboard(password, payload) {
    if (payload.version !== 1 || payload.kdf !== "PBKDF2-SHA-256" || payload.cipher !== "AES-GCM") throw new Error("Format de données chiffrées non reconnu.");
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({name:"PBKDF2",salt:fromBase64(payload.salt),iterations:payload.iterations,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["decrypt"]);
    const clear = await crypto.subtle.decrypt({name:"AES-GCM",iv:fromBase64(payload.iv)},key,fromBase64(payload.ciphertext));
    return JSON.parse(new TextDecoder().decode(clear));
  }
  function animatedNumbers() {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target, target = Number(el.dataset.count);
      if (!Number.isFinite(target)) return;
      observer.unobserve(el);
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(target); return; }
      const start = performance.now(), duration = 900;
      function tick(now) {
        const progress = Math.min((now-start)/duration, 1);
        el.textContent = fmt(Math.round(target * (1-Math.pow(1-progress,3))));
        if(progress<1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }),{threshold:.15});
    document.querySelectorAll("[data-count]").forEach(el=>observer.observe(el));
  }
  let activeData = null;
  let selectedPages = null;
  const normalizePage = name => ({"ADENES":"ADENES FRANCE","ADENES Fr":"ADENES FRANCE","ADENES France":"ADENES FRANCE","CREATIV'":"ROADIA","CREATIV’":"ROADIA"})[name] || name;
  const localDay = () => {
    const d=new Date();
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
  };
  const today=localDay();
  const pagePicker=document.getElementById("page-picker"),pagePanel=document.getElementById("page-panel"),pageTrigger=document.getElementById("page-trigger");
  const pageOptions=document.getElementById("page-options"),pageCurrent=document.getElementById("page-current");
  const availablePages=()=>[...new Set([...(activeData?.posts||[]),...(activeData?.followers||[])].map(x=>normalizePage(x.page)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr"));
  function updatePageCurrent(){
    const all=availablePages().length,n=selectedPages?.size??all;
    pageCurrent.textContent=n===all?"Toutes les pages":n===1?[...selectedPages][0]:n+" pages sur "+all;
  }
  function drawPageOptions(){
    const choices=availablePages();
    if(selectedPages===null)selectedPages=new Set(choices);
    pageOptions.innerHTML=choices.map(x=>'<label class="page-option"><input type="checkbox" value="'+escapeHTML(x)+'" '+(selectedPages.has(x)?"checked":"")+'><span>'+escapeHTML(x)+'</span></label>').join("");
    updatePageCurrent();
  }
  function togglePages(open){
    pagePanel.hidden=!open;
    pageTrigger.setAttribute("aria-expanded",String(open));
    if(open)drawPageOptions();
  }
  pageTrigger.addEventListener("click",()=>togglePages(pagePanel.hidden));
  document.getElementById("page-close").addEventListener("click",()=>togglePages(false));
  document.getElementById("page-select-all").addEventListener("click",()=>pageOptions.querySelectorAll("input").forEach(x=>x.checked=true));
  document.getElementById("page-select-none").addEventListener("click",()=>pageOptions.querySelectorAll("input").forEach(x=>x.checked=false));
  document.getElementById("page-apply").addEventListener("click",()=>{
    const names=[...pageOptions.querySelectorAll("input:checked")].map(x=>x.value);
    if(!names.length){document.getElementById("page-error").textContent="Sélectionne au moins une page.";return;}
    document.getElementById("page-error").textContent="";
    selectedPages=new Set(names);
    updatePageCurrent();
    togglePages(false);
    if(activeData)render(activeData);
  });
  document.addEventListener("click",e=>{if(!pagePicker.contains(e.target))togglePages(false)});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")togglePages(false)});

  const fromInput = document.getElementById("date-from");
  const toInput = document.getElementById("date-to");
  toInput.max=today;
  fromInput.max=today;
  toInput.value=today;
  if (!form || !input || !button || !message || !fromInput || !toInput) {
    console.error("Composant obligatoire absent de la page KPI.");
    return;
  }
  function render(data) {
    const within = row => typeof row?.date === "string" && row.date >= fromInput.value && row.date <= toInput.value;
    const posts = (Array.isArray(data.posts) ? data.posts : []).filter(p=>within(p)&&(selectedPages===null||selectedPages.has(normalizePage(p.page))));
    const snapshots = (Array.isArray(data.followers) ? data.followers : []).filter(p=>within(p)&&(selectedPages===null||selectedPages.has(normalizePage(p.page))));
    const valid = posts.filter(p=>p.impressions !== null && p.impressions !== undefined && Number.isFinite(Number(p.impressions)));
    const pages = [...new Set([...posts.map(p=>p.page),...snapshots.map(p=>p.page)].filter(Boolean))];
    const totalImpressions = valid.reduce((n,p)=>n+Number(p.impressions),0);
    const metrics = [
      ["Publications publiées",posts.length],["Pages suivies",pages.length],
      ["Impressions connues",totalImpressions],["Relevés abonnés",snapshots.length]
    ];
    document.getElementById("overview-kpis").innerHTML = metrics.map(([label,value]) =>
      '<article class="kpi"><strong data-count="'+value+'">0</strong><span>'+escapeHTML(label)+'</span></article>').join("");
    const grouped = new Map();
    for(const item of snapshots) {
      if (!item.page || !Number.isFinite(Number(item.count))) continue;
      const key = normalizePage(item.page);
      if(!grouped.has(key)) grouped.set(key,[]);
      grouped.get(key).push(item);
    }
    const rows = [...grouped.entries()].map(([page,observations])=>{
      observations.sort((a,b)=>a.date.localeCompare(b.date));
      const first=observations[0],last=observations[observations.length-1];
      return {page,first,last,delta:last.count-first.count,rate:first.count ? (last.count-first.count)/first.count : null};
    }).sort((a,b)=>b.last.count-a.last.count);
    document.querySelector("#follower-table tbody").innerHTML = rows.map(r=>'<tr><th>'+escapeHTML(r.page)+'</th><td>'+date(r.first.date)+'</td><td>'+date(r.last.date)+'</td><td>'+fmt(r.first.count)+'</td><td>'+fmt(r.last.count)+'</td><td class="'+(r.delta>=0?"positive":"negative")+'">'+(r.delta>0?"+":"")+fmt(r.delta)+'</td><td>'+(r.rate===null?"—":pct.format(r.rate))+'</td></tr>').join("");
    document.getElementById("follower-summary").textContent = rows.length
      ? rows.length+" pages suivies · période de reporting par mois en 2024–2025, dates des relevés historiques conservées dans Notion."
      : "Aucun relevé d'abonnés pour cette période. Les relevés actuellement disponibles dans Notion commencent en février 2024.";
    const maxCount = Math.max(1,...rows.map(r=>Number(r.last.count)));
    document.getElementById("follower-chart").innerHTML = rows.length ? '<h3>Dernier nombre d’abonnés connu par page</h3>'+rows.map(r=>'<div class="bar-line"><span>'+escapeHTML(r.page)+'</span><div class="bar-track"><div class="bar-fill" style="--bar-width:'+Math.round(100*r.last.count/maxCount)+'%"></div></div><strong>'+fmt(r.last.count)+'</strong></div>').join("") : "";
    // Classement décroissant par impressions moyennes sur la sélection.
    const formats=["Carrousel","Repartage","Vidéo","Image","Sondage"];
    const formatStats=formats.map(name=>{
      const items=posts.filter(p=>p.format===name);
      const measured=items.filter(p=>p.impressions!==null&&p.impressions!==undefined&&Number.isFinite(Number(p.impressions)));
      return {name,count:items.length,n:measured.length,avg:measured.length?Math.round(measured.reduce((a,p)=>a+Number(p.impressions),0)/measured.length):null};
    }).filter(x=>x.count>0&&(x.name!=="Sondage"||x.count>1))
      .sort((a,b)=>(b.avg??-1)-(a.avg??-1)||b.n-a.n);
    document.getElementById("format-grid").innerHTML=formatStats.map((x,i)=>
      '<article><span>RANG '+String(i+1).padStart(2,"0")+' · '+fmt(x.count)+' publication(s)</span><h3>'+escapeHTML(x.name)+'</h3><strong>'+fmt(x.avg)+'</strong><p>impressions moyennes · '+fmt(x.n)+' publications mesurées</p></article>'
    ).join("")||'<p>Aucun format comparable pour cette sélection.</p>';
    document.getElementById("format-note").textContent='Formats classés par impressions moyennes, selon les pages et les dates choisies. '+valid.length+' publication(s) mesurée(s) sur '+posts.length+'. Texte exclu ; Sondage exclu si moins de deux publications. Une moyenne sur peu de publications reste fragile.';
    const avg=valid.length?Math.round(totalImpressions/valid.length):null;
    const clickPosts=posts.filter(p=>p.clicks!==null&&p.clicks!==undefined&&p.impressions!==null&&Number(p.impressions)>0&&Number.isFinite(Number(p.clicks)));
    const impressionsForClicks=clickPosts.reduce((n,p)=>n+Number(p.impressions),0);
    const weightedCTR=impressionsForClicks>0?clickPosts.reduce((n,p)=>n+Number(p.clicks),0)/impressionsForClicks:null;
    const byYear={};posts.forEach(p=>{const y=p.date?.slice(0,4);if(y)byYear[y]=(byYear[y]||0)+1;});
    const months=new Set(posts.map(p=>p.date?.slice(0,7)).filter(Boolean));
    document.getElementById("analysis-metrics").innerHTML=[
      ["Impressions moyennes",fmt(avg),"par publication mesurée"],
      ["CTR pondéré",weightedCTR===null?"—":pct.format(weightedCTR),"clics / impressions renseignées"],
      ["Complétude impressions",posts.length?pct.format(valid.length/posts.length):"—","publications avec impressions"]
    ].map(([label,value,detail])=>'<article class="analysis-metric"><span>'+escapeHTML(label)+'</span><strong>'+value+'</strong><span>'+escapeHTML(detail)+'</span></article>').join("");
    const leading=formatStats.find(x=>x.avg!==null);
    const findings=[
      ["Meilleur format selon les impressions",leading?leading.name+" arrive en tête avec "+fmt(leading.avg)+" impressions moyennes sur "+fmt(leading.n)+" publications renseignées. Le classement dépend de la période et des pages sélectionnées.":"Données insuffisantes pour identifier un format dominant."],
      ["Cadence de publication",months.size?fmt(posts.length)+" publications sur "+months.size+" mois actifs, soit "+(posts.length/months.size).toLocaleString("fr-FR",{maximumFractionDigits:1})+" publications par mois actif. Les mois sans publication renseignée sont exclus du dénominateur.":"Aucune publication pour la période choisie."],
      ["Historique par année",Object.keys(byYear).length?Object.keys(byYear).sort().map(y=>y+" : "+fmt(byYear[y])+" publication(s)").join(" · ")+". Comparaison brute, sans correction des années incomplètes.":"Aucune donnée à comparer sur la sélection."],
      ["Qualité et limites",fmt(posts.length-valid.length)+" publications sans impressions utilisables et "+fmt(posts.filter(p=>!p.format).length)+" sans format. L’évolution des abonnés dépend de la date réelle des relevés, en particulier pour les archives 2024–2025."]
    ];
    document.getElementById("analysis-insights").innerHTML=findings.map(([title,body])=>'<article class="insight-card"><h3>'+escapeHTML(title)+'</h3><p>'+escapeHTML(body)+'</p></article>').join("");
    const ranking = [...valid].sort((a,b)=>Number(b.impressions)-Number(a.impressions));
    const rankingList=document.getElementById("ranking-list");
    const top=document.getElementById("top-tab"),flop=document.getElementById("flop-tab");
    function showRanking(mode) {
      top.classList.toggle("active",mode==="top");
      flop.classList.toggle("active",mode==="flop");
      const items = mode==="top" ? ranking.slice(0,10) : [...ranking].reverse().slice(0,10);
      rankingList.innerHTML = items.map((p,index)=>{
        const link = typeof p.url==="string" && /^https:\/\//i.test(p.url) ? p.url : (typeof p.notionUrl==="string" && /^https:\/\//i.test(p.notionUrl)?p.notionUrl:null);
        const safeLink=link?'<a href="'+escapeHTML(link)+'" target="_blank" rel="noopener noreferrer">Voir la publication ↗</a>':'';
        return '<article class="rank-card"><span class="rank-index">'+String(index+1).padStart(2,"0")+'</span><div><span class="rank-meta">'+escapeHTML(p.page||"Page non renseignée")+' · '+date(p.date)+' · '+escapeHTML(p.format||"Format inconnu")+'</span><h3>'+escapeHTML(p.title||"Publication sans titre")+'</h3><p>'+fmt(p.impressions)+' impressions · '+fmt(p.reactions)+' réactions · '+fmt(p.comments)+' commentaires</p>'+safeLink+'</div></article>';
      }).join("") || '<p>Aucune publication avec impressions renseignées.</p>';
    }
    top.onclick=()=>showRanking("top");
    flop.onclick=()=>showRanking("flop");
    showRanking("top");
    animatedNumbers();
    requestAnimationFrame(()=>document.querySelectorAll(".bar-fill").forEach(el=>el.classList.add("grown")));
  }
  function refresh() {
    if (!activeData) return;
    const valid = fromInput.value <= toInput.value;
    fromInput.setCustomValidity(valid ? "" : "La date de début doit précéder la date de fin.");
    toInput.setCustomValidity(valid ? "" : "La date de fin doit suivre la date de début.");
    if (valid) render(activeData);
  }
  fromInput.addEventListener("change", refresh);
  toInput.addEventListener("change", refresh);
  const periodTrigger=document.getElementById("period-trigger");
  const periodPanel=document.getElementById("period-panel");
  const periodCurrent=document.getElementById("period-current");
  const periodError=document.getElementById("period-error");
  const periodPicker=document.getElementById("period-picker");
  const dateLabel=d=>new Date(d+"T12:00:00").toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"});
  function togglePeriod(open){
    periodPanel.hidden=!open;
    periodTrigger.setAttribute("aria-expanded",String(open));
  }
  periodTrigger.addEventListener("click",()=>togglePeriod(periodPanel.hidden));
  document.getElementById("period-close").addEventListener("click",()=>togglePeriod(false));
  document.addEventListener("click",event=>{if(!periodPicker.contains(event.target))togglePeriod(false)});
  document.addEventListener("keydown",event=>{if(event.key==="Escape")togglePeriod(false)});
  function markPreset(value){document.querySelectorAll("[data-period]").forEach(b=>b.classList.toggle("selected",b.dataset.period===value));}
  document.querySelectorAll("[data-period]").forEach(b=>b.addEventListener("click",()=>{
    if(b.dataset.period==="all"){fromInput.value="2022-03-01";toInput.value=today;}
    else if(b.dataset.period==="year"){fromInput.value=today.slice(0,4)+"-01-01";toInput.value=today;}
    else if(b.dataset.period==="quarter"){const d=new Date(today+"T12:00:00");d.setDate(d.getDate()-89);fromInput.value=[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");toInput.value=today;}
    markPreset(b.dataset.period);
  }));
  fromInput.addEventListener("change",()=>markPreset(""));
  toInput.addEventListener("change",()=>markPreset(""));
  document.getElementById("period-apply").addEventListener("click",()=>{
    if(!fromInput.value||!toInput.value||fromInput.value>toInput.value||toInput.value>today){periodError.textContent="Sélectionne une période valide.";return;}
    periodError.textContent="";
    periodCurrent.textContent=dateLabel(fromInput.value)+" — "+dateLabel(toInput.value);
    if(activeData)render(activeData);
    togglePeriod(false);
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const password=input.value;
    if(!password)return;
    button.disabled=true;
    button.textContent="Vérification…";
    message.textContent="";
    try{
      const response=await fetch("./data.enc.json",{cache:"no-store"});
      if(!response.ok)throw new Error("Données chiffrées non disponibles.");
      const data=await decryptDashboard(password,await response.json());
      activeData = data;
      drawPageOptions();
      window.KPI_DASHBOARD_DATA=data;
      document.body.classList.add("unlocked");
      try { render(data); }
      catch (renderError) {
        console.error("Affichage KPI incomplet", renderError);
        const fallback = document.getElementById("follower-summary");
        if (fallback) fallback.textContent = "Données déchiffrées. Une visualisation n'a pas pu être chargée.";
      }
      input.value="";
    }catch(error){
      console.error("Déverrouillage impossible",error);
      message.textContent=error.name==="OperationError"?"Mot de passe incorrect.":(error.message||"Impossible de charger le tableau de bord.");
    }finally{
      button.disabled=false;
      button.innerHTML='Déverrouiller <span>→</span>';
    }
  });
  window.KPI_APP_READY = true;
})();