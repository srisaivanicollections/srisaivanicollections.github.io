const API="/.netlify/functions/catalog";
const IS_GITHUB_PAGES = location.hostname.endsWith(".github.io");
const LOCAL_KEY = "ssv_catalog_v1";
const LOCAL_ADMIN_PASSWORD = "admin123";
let products=[],settings={},category="All",adminPassword="";
const seedFallback=[];
function $(s){return document.querySelector(s)} function all(s){return document.querySelectorAll(s)}
async function localLoad(){
  const [pr,sr]=await Promise.all([
    fetch("data/products.json",{cache:"no-store"}),
    fetch("data/settings.json",{cache:"no-store"})
  ]);
  const base={products:await pr.json(),settings:await sr.json()};
  try{
    const saved=JSON.parse(localStorage.getItem(LOCAL_KEY)||"null");
    if(saved&&Array.isArray(saved.products)&&saved.settings) return saved;
  }catch(_){}
  localStorage.setItem(LOCAL_KEY,JSON.stringify(base));
  return base;
}
async function localApi(body){
  if(body.action==="authenticate"){
    if(body.password!==LOCAL_ADMIN_PASSWORD) throw new Error("Incorrect password.");
    return {ok:true};
  }
  if(body.password!==LOCAL_ADMIN_PASSWORD) throw new Error("Unauthorized");
  const state=await localLoad();
  if(body.action==="saveProducts"){
    state.products=body.products||[];
    localStorage.setItem(LOCAL_KEY,JSON.stringify(state));
    return {ok:true};
  }
  if(body.action==="saveSettings"){
    state.settings=body.settings||{};
    localStorage.setItem(LOCAL_KEY,JSON.stringify(state));
    return {ok:true};
  }
  if(body.action==="uploadImage"){
    return {ok:true,path:String(body.base64||"")};
  }
  throw new Error("Unknown action");
}
async function api(body){
  if(IS_GITHUB_PAGES) return localApi(body);
  const r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const d=await r.json();if(!r.ok)throw new Error(d.error||"Request failed");return d
}
async function load(){
  try{
    if(IS_GITHUB_PAGES){
      const d=await localLoad();
      products=d.products||[];settings=d.settings||{};apply();render();$("#empty").classList.toggle("hidden",products.length>0);return;
    }
    const r=await fetch(API,{cache:"no-store"});if(!r.ok)throw new Error();const d=await r.json();products=d.products||[];settings=d.settings||{};apply();render();
  }catch(e){
    try{
      const [pr,sr]=await Promise.all([fetch("data/products.json",{cache:"no-store"}),fetch("data/settings.json",{cache:"no-store"})]);
      products=await pr.json();settings=await sr.json();apply();render();$("#empty").classList.add("hidden")
    }catch(err){
      products=[];settings={name:"SRI SAI VANI",whatsapp:"919999999999",instagram:"https://www.instagram.com/sri_sai_vani_collections/"};apply();render();$("#empty").classList.remove("hidden");$("#empty").textContent="Catalogue temporarily unavailable. Please refresh in a moment."
    }
  }
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function money(n){return "₹"+Number(n).toLocaleString("en-IN")}
function wa(p){return "https://wa.me/"+settings.whatsapp+"?text="+encodeURIComponent("Hi Sri Sai Vani, I am interested in "+p.name+" ("+money(p.price)+"). Is it available?")}
async function api(body){const r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||"Request failed");return d}
async function load(){try{const r=await fetch(API,{cache:"no-store"});if(!r.ok)throw new Error();const d=await r.json();products=d.products||[];settings=d.settings||{};apply();render()}catch(e){try{const [pr,sr]=await Promise.all([fetch("data/products.json",{cache:"no-store"}),fetch("data/settings.json",{cache:"no-store"})]);products=await pr.json();settings=await sr.json();apply();render();$("#empty").classList.add("hidden")}catch(err){products=[];settings={name:"SRI SAI VANI",whatsapp:"919999999999",instagram:"https://www.instagram.com/sri_sai_vani_collections/"};apply();render();$("#empty").classList.remove("hidden");$("#empty").textContent="Catalogue temporarily unavailable. Please refresh in a moment."}}}
function apply(){all(".brand b").forEach(x=>x.textContent=settings.name||"SRI SAI VANI");$("#waMain").href="https://wa.me/"+settings.whatsapp+"?text="+encodeURIComponent("Hi Sri Sai Vani, I would like to know about your collection.");$("#instagram").href=settings.instagram}
function renderTabs(){$("#tabs").innerHTML=["All","Sarees","Dresses"].map(c=>'<button class="'+(category===c?"active":"")+'" data-tab="'+c+'">'+c.toUpperCase()+"</button>").join("")}
function render(){renderTabs();const q=$("#search").value.trim().toLowerCase(),pf=$("#price").value;let list=products.filter(p=>(category==="All"||p.category===category)&&(!q||p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q)||String(p.description||"").toLowerCase().includes(q))).sort((a,b)=>{const rank=p=>p.newArrival&&p.bestSeller?0:(p.newArrival||p.bestSeller?1:2);return rank(a)-rank(b)}).filter(p=>!pf||(pf==="0-2000"?p.price<2000:pf==="2000-4000"?p.price>=2000&&p.price<4000:pf==="4000-7000"?p.price>=4000&&p.price<7000:p.price>=7000));$("#products").innerHTML=list.map(p=>'<article class="product-card"><div class="product-image"><img src="'+esc(p.image)+'" alt="'+esc(p.name)+'" loading="lazy" onerror="this.closest(\'.product-image\').classList.add(\'image-missing\')"><div class="badges">'+(p.newArrival?'<span class="badge new">NEW ARRIVAL</span>':"")+(p.bestSeller?'<span class="badge best">BEST SELLER</span>':"")+'</div></div><div class="product-info"><h3>'+esc(p.name)+'</h3><span class="meta">'+esc(p.category)+(p.availability===false?" · Unavailable":"")+'</span><p class="description">'+esc(p.description||"")+'</p><div class="price-line"><span class="price">'+money(p.price)+(p.originalPrice&&p.originalPrice>p.price?'<del>'+money(p.originalPrice)+'</del>':"")+'</span><a class="wa-mini" href="'+wa(p)+'" target="_blank" rel="noopener" aria-label="WhatsApp about '+esc(p.name)+'" title="Ask on WhatsApp"><span aria-hidden="true">◉</span></a></div></div></article>').join("");$("#empty").classList.toggle("hidden",!list.length)}
function form(p={}){return '<div class="admin-row"><input id="fName" placeholder="Product name" value="'+(p.name||"")+'"><select id="fCat"><option '+(p.category==="Sarees"?"selected":"")+'>Sarees</option><option '+(p.category==="Dresses"?"selected":"")+'>Dresses</option></select></div><div class="admin-row"><input id="fPrice" type="number" placeholder="Price" value="'+(p.price||"")+'"><input id="fOriginal" type="number" placeholder="Original price" value="'+(p.originalPrice||"")+'"></div><div class="upload-row"><input id="fImage" placeholder="Image path or URL" value="'+(p.image||"")+'"><input id="fFile" type="file" accept="image/*"></div><label><input id="fNew" type="checkbox" '+(p.newArrival?"checked":"")+'> New arrival</label> <label><input id="fBest" type="checkbox" '+(p.bestSeller?"checked":"")+'> Best seller</label> <label><input id="fAvail" type="checkbox" '+(p.availability!==false?"checked":"")+'> Available</label><br><br><button class="btn dark" id="saveItem">SAVE ITEM</button>'+(p.id?' <button class="danger" id="deleteItem">DELETE</button>':"")}
function showView(v){const b=$("#studioBody");if(v==="products"){b.innerHTML=products.map(p=>'<div class="admin-item"><div><strong>'+p.name+'</strong><br><small>'+p.category+" · "+money(p.price)+(p.newArrival?" · NEW":"")+(p.bestSeller?" · BEST":"")+'</small></div><button class="danger edit" data-id="'+p.id+'">EDIT</button></div>').join("")}else if(v==="add"){b.innerHTML=form();$("#saveItem").onclick=()=>saveProduct(0)}else{b.innerHTML='<p>Shop name</p><input id="setName" value="'+(settings.name||"")+'"><p>WhatsApp number</p><input id="setWa" value="'+(settings.whatsapp||"")+'"><p>Instagram URL</p><input id="setIg" value="'+(settings.instagram||"")+'"><button class="btn dark" id="saveSettings">SAVE SETTINGS</button>'}}
function edit(id){const p=products.find(x=>x.id===id);$("#studioBody").innerHTML=form(p);$("#saveItem").onclick=()=>saveProduct(id);$("#deleteItem").onclick=async()=>{if(!confirm("Delete this item?"))return;products=products.filter(x=>x.id!==id);await persistProducts();render();showView("products")}}
async function persistProducts(){await api({action:"saveProducts",password:adminPassword,products})}
async function saveProduct(id){let image=$("#fImage").value.trim(),file=$("#fFile").files[0];try{if(file){if(file.size>5*1024*1024)throw new Error("Image must be 5MB or smaller.");const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)});const up=await api({action:"uploadImage",password:adminPassword,filename:file.name,base64});image=up.path}const p={id:id||Date.now(),name:$("#fName").value.trim(),category:$("#fCat").value,price:Number($("#fPrice").value),originalPrice:Number($("#fOriginal").value)||undefined,image,newArrival:$("#fNew").checked,bestSeller:$("#fBest").checked,availability:$("#fAvail").checked};if(!p.name||!p.price||!p.image)throw new Error("Please fill product name, price and image.");if(id)products=products.map(x=>x.id===id?p:x);else products.unshift(p);await persistProducts();render();showView("products")}catch(e){alert(e.message)}}
$("#menu").onclick=()=>$("#nav").classList.toggle("open");
$("#adminOpen").onclick=()=>$("#admin").classList.remove("hidden");
$("#adminMobile").onclick=e=>{e.preventDefault();$("#nav").classList.remove("open");$("#admin").classList.remove("hidden")};
$("#adminClose").onclick=()=>$("#admin").classList.add("hidden");
$("#loginBtn").onclick=()=>{adminPassword=$("#password").value;if(!adminPassword)return;api({action:"authenticate",password:adminPassword}).then(()=>{$("#login").classList.add("hidden");$("#studio").classList.remove("hidden");showView("products")}).catch(e=>{$("#loginMsg").textContent=e.message||"Incorrect password or storage is not configured."})};
all("[data-view]").forEach(b=>b.onclick=()=>showView(b.dataset.view));
document.addEventListener("click",e=>{const t=e.target.closest("[data-tab]");if(t){category=t.dataset.tab;render()}const c=e.target.closest("[data-cat]");if(c){category=c.dataset.cat;$("#nav").classList.remove("open");render()}const eb=e.target.closest(".edit");if(eb)edit(Number(eb.dataset.id));if(e.target.id==="saveSettings"){settings.name=$("#setName").value.trim()||"SRI SAI VANI";settings.whatsapp=$("#setWa").value.replace(/\D/g,"");settings.instagram=$("#setIg").value.trim();api({action:"saveSettings",password:adminPassword,settings}).then(()=>{apply();showView("products")}).catch(e=>alert(e.message))}});
$("#search").oninput=render;$("#price").onchange=render;load();