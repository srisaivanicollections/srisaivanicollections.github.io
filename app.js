const API="/.netlify/functions/catalog";
const IS_GITHUB_PAGES = location.hostname.endsWith(".github.io");
const LOCAL_KEY = "ssv_catalog_v2";
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
      products=d.products||[];settings=d.settings||{};apply();render();return;
    }
    const r=await fetch(API,{cache:"no-store"});if(!r.ok)throw new Error();const d=await r.json();products=d.products||[];settings=d.settings||{};apply();render();
  }catch(e){
    try{
      const [pr,sr]=await Promise.all([fetch("data/products.json",{cache:"no-store"}),fetch("data/settings.json",{cache:"no-store"})]);
      products=await pr.json();settings=await sr.json();apply();render()
    }catch(err){
      products=[];settings={name:"SRI SAI VANI",whatsapp:"919999999999",instagram:"https://www.instagram.com/sri_sai_vani_collections/"};apply();render()
    }
  }
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function money(n){return "₹"+Number(n).toLocaleString("en-IN")}
function wa(p){return "https://wa.me/"+settings.whatsapp+"?text="+encodeURIComponent("Hi Sri Sai Vani, I am interested in "+p.name+" ("+money(p.price)+"). Is it available?")}
function apply(){all(".brand b").forEach(x=>x.textContent=settings.name||"SRI SAI VANI");$("#waMain").href="https://wa.me/"+settings.whatsapp+"?text="+encodeURIComponent("Hi Sri Sai Vani, I would like to know about your collection.");$("#instagram").href=settings.instagram}
function renderTabs(){$("#tabs").innerHTML=["All","Sarees","Dresses"].map(c=>'<button class="'+(category===c?"active":"")+'" data-tab="'+c+'">'+c.toUpperCase()+"</button>").join("")}
function render(){renderTabs();const q=$("#search").value.trim().toLowerCase(),pf=$("#price").value;let list=products.filter(p=>(category==="All"||p.category===category)&&(!q||p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q))).sort((a,b)=>{const rank=p=>p.newArrival&&p.bestSeller?0:(p.newArrival||p.bestSeller?1:2);return rank(a)-rank(b)}).filter(p=>!pf||(pf==="0-2000"?p.price<2000:pf==="2000-4000"?p.price>=2000&&p.price<4000:pf==="4000-7000"?p.price>=4000&&p.price<7000:p.price>=7000));$("#products").innerHTML=list.map(p=>'<article class="product-card"><div class="product-image"><img src="'+esc(p.image)+'" alt="'+esc(p.name)+'" loading="lazy" onerror="this.closest(\'.product-image\').classList.add(\'image-missing\')"><div class="badges">'+(p.newArrival?'<span class="badge new">NEW ARRIVAL</span>':"")+(p.bestSeller?'<span class="badge best">BEST SELLER</span>':"")+'</div></div><div class="product-info"><h3>'+esc(p.name)+'</h3><span class="meta">'+esc(p.category)+(p.availability===false?" · Unavailable":"")+'</span><div class="price-line"><span class="price">'+money(p.price)+(p.originalPrice&&p.originalPrice>p.price?'<del>'+money(p.originalPrice)+'</del>':"")+'</span><a class="wa-mini" href="'+wa(p)+'" target="_blank" rel="noopener" aria-label="WhatsApp about '+esc(p.name)+'" title="Ask on WhatsApp"><svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.52 3.48A11.86 11.86 0 0 0 12.06 0C5.51 0 .18 5.33.18 11.88c0 2.09.55 4.13 1.59 5.93L.08 24l6.33-1.66a11.9 11.9 0 0 0 5.65 1.44h.01c6.55 0 11.88-5.33 11.88-11.88 0-3.18-1.24-6.17-3.43-8.42ZM12.07 21.8h-.01a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.76.99 1-3.67-.23-.38a9.89 9.89 0 0 1-1.52-5.27C2.14 6.42 6.59 1.97 12.07 1.97c2.65 0 5.14 1.03 7.01 2.9a9.85 9.85 0 0 1 2.9 7.02c0 5.48-4.45 9.91-9.91 9.91Zm5.44-7.43c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.09 4.49.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.12-.27-.2-.57-.35Z"/></svg></a></div></div></article>').join("")}
function form(p={}){return '<div class="admin-row"><input id="fName" placeholder="Product name" value="'+(p.name||"")+'"><select id="fCat"><option '+(p.category==="Sarees"?"selected":"")+'>Sarees</option><option '+(p.category==="Dresses"?"selected":"")+'>Dresses</option></select></div><div class="admin-row"><input id="fPrice" type="number" placeholder="Price" value="'+(p.price||"")+'"><input id="fOriginal" type="number" placeholder="Original price" value="'+(p.originalPrice||"")+'"></div><div class="upload-row"><input id="fImage" placeholder="Image path or URL" value="'+(p.image||"")+'"><input id="fFile" type="file" accept="image/*"></div><label><input id="fNew" type="checkbox" '+(p.newArrival?"checked":"")+'> New arrival</label> <label><input id="fBest" type="checkbox" '+(p.bestSeller?"checked":"")+'> Best seller</label> <label><input id="fAvail" type="checkbox" '+(p.availability!==false?"checked":"")+'> Available</label><br><br><button class="btn dark" id="saveItem">SAVE ITEM</button>'+(p.id?' <button class="danger" id="deleteItem">DELETE</button>':"")}
function showView(v){const b=$("#studioBody");if(v==="products"){b.innerHTML=products.map(p=>'<div class="admin-item"><div><strong>'+p.name+'</strong><br><small>'+p.category+" · "+money(p.price)+(p.newArrival?" · NEW":"")+(p.bestSeller?" · BEST":"")+'</small></div><button class="danger edit" data-id="'+p.id+'">EDIT</button></div>').join("")}else if(v==="add"){b.innerHTML=form();$("#saveItem").onclick=()=>saveProduct(0)}else{b.innerHTML='<p>Shop name</p><input id="setName" value="'+(settings.name||"")+'"><p>WhatsApp number</p><input id="setWa" value="'+(settings.whatsapp||"")+'"><p>Instagram URL</p><input id="setIg" value="'+(settings.instagram||"")+'"><button class="btn dark" id="saveSettings">SAVE SETTINGS</button>'}}
function edit(id){const p=products.find(x=>x.id===id);$("#studioBody").innerHTML=form(p);$("#saveItem").onclick=()=>saveProduct(id);$("#deleteItem").onclick=async()=>{if(!confirm("Delete this item?"))return;products=products.filter(x=>x.id!==id);await persistProducts();render();showView("products")}}
async function persistProducts(){await api({action:"saveProducts",password:adminPassword,products})}
async function saveProduct(id){let image=$("#fImage").value.trim(),file=$("#fFile").files[0];try{if(file){if(file.size>5*1024*1024)throw new Error("Image must be 5MB or smaller.");const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)});const up=await api({action:"uploadImage",password:adminPassword,filename:file.name,base64});image=up.path}const p={id:id||Date.now(),name:$("#fName").value.trim(),category:$("#fCat").value,price:Number($("#fPrice").value),originalPrice:Number($("#fOriginal").value)||undefined,image,newArrival:$("#fNew").checked,bestSeller:$("#fBest").checked,availability:$("#fAvail").checked};if(!p.name||!p.price||!p.image)throw new Error("Please fill product name, price and image.");if(id)products=products.map(x=>x.id===id?p:x);else products.unshift(p);await persistProducts();render();showView("products")}catch(e){alert(e.message)}}
$("#menu").onclick=()=>$("#nav").classList.toggle("open");
$("#adminOpen").onclick=()=>$("#admin").classList.remove("hidden");
const adminMobile=$("#adminMobile"); if(adminMobile) adminMobile.onclick=e=>{e.preventDefault();$("#nav").classList.remove("open");$("#admin").classList.remove("hidden")};
$("#adminClose").onclick=()=>$("#admin").classList.add("hidden");
$("#loginBtn").onclick=()=>{adminPassword=$("#password").value;if(!adminPassword)return;api({action:"authenticate",password:adminPassword}).then(()=>{$("#login").classList.add("hidden");$("#studio").classList.remove("hidden");$("#password").value="";$("#loginMsg").textContent="";$("#adminOpen").textContent="ADMIN";showView("products")}).catch(e=>{$("#loginMsg").textContent=e.message||"Incorrect password or storage is not configured."})};
$("#logoutBtn").onclick=()=>{adminPassword="";$("#studio").classList.add("hidden");$("#login").classList.remove("hidden");$("#password").value="";$("#loginMsg").textContent="";$("#adminOpen").textContent="ADMIN";$("#admin").classList.add("hidden")};
all("[data-view]").forEach(b=>b.onclick=()=>showView(b.dataset.view));
document.addEventListener("click",e=>{const t=e.target.closest("[data-tab]");if(t){category=t.dataset.tab;render()}const c=e.target.closest("[data-cat]");if(c){category=c.dataset.cat;$("#nav").classList.remove("open");render()}const eb=e.target.closest(".edit");if(eb)edit(Number(eb.dataset.id));if(e.target.id==="saveSettings"){settings.name=$("#setName").value.trim()||"SRI SAI VANI";settings.whatsapp=$("#setWa").value.replace(/\D/g,"");settings.instagram=$("#setIg").value.trim();api({action:"saveSettings",password:adminPassword,settings}).then(()=>{apply();showView("products")}).catch(e=>alert(e.message))}});
$("#search").oninput=render;$("#price").onchange=render;load();