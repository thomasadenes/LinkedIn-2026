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
  function render(data) {
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const snapshots = Array.isArray(data.followers) ? data.followers : [];
    const valid = posts.filter(p=>p.impressions !== null && Number.isFinite(Number(p.impressions)));
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
      const key = item.page;
      if(!grouped.has(key)) grouped.set(key,[]);
      grouped.get(key).push(item);
    }
    const rows = [...grouped.entries()].map(([page,observations])=>{
      observations.sort((a,b)=>a.date.localeCompare(b.date));
      const first=observations[0],last=observations[observations.length-1];
      return {page,first,last,delta:last.count-first.count,rate:first.count ? (last.count-first.count)/first.count : null};
    }).sort((a,b)=>b.last.count-a.last.count);
    document.querySelector("#follower-table tbody").innerHTML = rows.map(r=>'<tr><th>'+escapeHTML(r.page)+'</th><td>'+date(r.first.date)+'</td><td>'+date(r.last.date)+'</td><td>'+fmt(r.first.count)+'</td><td>'+fmt(r.last.count)+'</td><td class="'+(r.delta>=0?"positive":"negative")+'">'+(r.delta>0?"+":"")+fmt(r.delta)+'</td><td>'+(r.rate===null?"—":pct.format(r.rate))+'</td></tr>').join("");
    document.getElementById("follower-summary").textContent = rows.length+' pages suivies · relevés datés individuellement, sans supposer un relevé au 31 octobre.';
    const maxCount = Math.max(1,...rows.map(r=>Number(r.last.count)));
    document.getElementById("follower-chart").innerHTML = '<h3>Dernier nombre d’abonnés connu par page</h3>'+rows.map(r=>'<div class="bar-line"><span>'+escapeHTML(r.page)+'</span><div class="bar-track"><div class="bar-fill" style="--bar-width:'+Math.round(100*r.last.count/maxCount)+'%"></div></div><strong>'+fmt(r.last.count)+'</strong></div>').join("");
    const formats = ["Carrousel","Repartage","Vidéo","Image","Texte","Sondage"];
    document.getElementById("format-grid").innerHTML = formats.map(f=>{
      const items=posts.filter(p=>p.format===f);
      const known=items.filter(p=>p.impressions!==null && Number.isFinite(Number(p.impressions)));
      const mean=known.length?Math.round(known.reduce((a,p)=>a+Number(p.impressions),0)/known.length):null;
      return '<article><span>'+fmt(items.length)+' publication(s)</span><h3>'+escapeHTML(f)+'</h3><strong>'+fmt(mean)+'</strong><p>impressions moyennes · '+fmt(known.length)+' publications renseignées</p></article>';
    }).join("");
    document.getElementById("format-note").textContent = 'Moyennes calculées uniquement sur les publications dont le nombre d’impressions est renseigné ('+valid.length+' sur '+posts.length+'). '+posts.filter(p=>!p.format).length+' publication(s) sans format.';
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
    top.addEventListener("click",()=>showRanking("top"));
    flop.addEventListener("click",()=>showRanking("flop"));
    showRanking("top");
    animatedNumbers();
    requestAnimationFrame(()=>document.querySelectorAll(".bar-fill").forEach(el=>el.classList.add("grown")));
  }
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
      render(data);
      window.KPI_DASHBOARD_DATA=data;
      document.body.classList.add("unlocked");
      input.value="";
    }catch(error){
      console.error("Déverrouillage impossible",error.name);
      message.textContent=error.name==="OperationError"?"Mot de passe incorrect.":(error.message||"Impossible de charger le tableau de bord.");
    }finally{
      button.disabled=false;
      button.innerHTML='Déverrouiller <span>→</span>';
    }
  });
})();