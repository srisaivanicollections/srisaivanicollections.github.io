const API="/.netlify/functions/catalog";
const IS_GITHUB_PAGES = location.hostname.endsWith(".github.io");
const LOCAL_KEY = "ssv_catalog_v4";
const CATALOG_SCHEMA = 4;
const LOCAL_ADMIN_PASSWORD = "admin123";
const GITHUB_REPO = "vinith1111/premium_saree_website_libas";
const GITHUB_BRANCH = "main";
const GITHUB_TOKEN_KEY = "ssv_github_token_v1";
let products=[],settings={},category="All",adminPassword="",reviewsArray=[],githubOriginalIds=new Set();
function $(s){return document.querySelector(s)} function all(s){return document.querySelectorAll(s)}
async function localLoad(){
  const pr=await fetch("data/products.json",{cache:"no-store"});
  if(!pr.ok) throw new Error("Catalog files could not be loaded.");
  const sr=await fetch("data/settings.json",{cache:"no-store"}).catch(()=>null);
  if(!pr.ok||!sr.ok) throw new Error("Catalog files could not be loaded.");
  const baseProducts=await pr.json();
  const baseSettings=sr&&sr.ok?await sr.json():{name:"SRI SAI VANI",whatsapp:"",instagram:"https://www.instagram.com/sri_sai_vani_collections/"};
  if(!Array.isArray(baseProducts)||baseProducts.length===0) throw new Error("Invalid or empty product catalog.");
  let saved=null;
  try{saved=JSON.parse(localStorage.getItem(LOCAL_KEY)||"null")}catch(_){saved=null}
  if(!saved||!Array.isArray(saved.products)||!saved.settings){
    const fresh={schema:CATALOG_SCHEMA,products:baseProducts,settings:baseSettings};
    localStorage.setItem(LOCAL_KEY,JSON.stringify(fresh));
    return fresh;
  }
  const savedById=new Map(saved.products.map(p=>[Number(p.id),p]));
  const baseIds=new Set(baseProducts.map(p=>Number(p.id)));
  // STRICT CATALOG RULE: every committed product must remain in the live catalog.
  // Local admin data may update a committed product, but cannot make a committed
  // product disappear just because an old localStorage snapshot is stale.
  const merged=baseProducts.map(base=>savedById.get(Number(base.id))||base);
  // Preserve products created through Admin on this device.
  for(const local of saved.products){
    if(!baseIds.has(Number(local.id))) merged.push(local);
  }
  const state={schema:CATALOG_SCHEMA,products:merged,settings:saved.settings||baseSettings};
  if(state.products.length===0) throw new Error("Catalog safety check failed.");
  localStorage.setItem(LOCAL_KEY,JSON.stringify(state));
  return state;
}
async function githubRequest(path,options={}){
  const token=localStorage.getItem(GITHUB_TOKEN_KEY)||sessionStorage.getItem(GITHUB_TOKEN_KEY)||"";
  if(!token) throw new Error("GitHub storage is not connected. Enter a GitHub token in Admin Studio.");
  const r=await fetch("https://api.github.com"+path,{...options,headers:{
    "Accept":"application/vnd.github+json",
    "Authorization":"Bearer "+token,
    "X-GitHub-Api-Version":"2022-11-28",
    ...(options.headers||{})
  }});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.message||"GitHub request failed");
  return d;
}
async function publicGitHubReadJson(path){
  const r=await fetch("https://raw.githubusercontent.com/"+GITHUB_REPO+"/"+GITHUB_BRANCH+"/"+path+"?v="+Date.now(),{cache:"no-store"});
  if(!r.ok) throw new Error("Git-backed catalog could not be loaded.");
  return {value:await r.json()};
}
async function githubReadJson(path){
  const d=await githubRequest("/repos/"+GITHUB_REPO+"/contents/"+path+"?ref="+encodeURIComponent(GITHUB_BRANCH));
  const content=atob(String(d.content||"").replace(/\n/g,""));
  return {value:JSON.parse(content),sha:d.sha};
}
async function githubWriteJson(path,value,sha,message){
  const content=btoa(unescape(encodeURIComponent(JSON.stringify(value,null,2))));
  return githubRequest("/repos/"+GITHUB_REPO+"/contents/"+path,{
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({message,content,sha,branch:GITHUB_BRANCH})
  });
}
async function localApi(body){
  if(body.action==="authenticate"){
    const supplied=String(body.password||"").trim();
    if(supplied===LOCAL_ADMIN_PASSWORD){
      const token=localStorage.getItem(GITHUB_TOKEN_KEY)||sessionStorage.getItem(GITHUB_TOKEN_KEY)||"";
      if(!token) throw new Error("Enter your GitHub token in Admin Studio.");
      await githubReadJson("data/products.json");
      return {ok:true,storage:"github"};
    }
    if(!supplied) throw new Error("Enter your GitHub token.");
    localStorage.setItem(GITHUB_TOKEN_KEY,supplied);
    await githubReadJson("data/products.json");
    return {ok:true,storage:"github"};
  }
  if(body.password!==LOCAL_ADMIN_PASSWORD && body.password!==localStorage.getItem(GITHUB_TOKEN_KEY)) throw new Error("Unauthorized");
  if(body.action==="saveProducts"){
    if(!Array.isArray(body.products)||body.products.length===0) throw new Error("Catalog safety check failed.");
    const current=await githubReadJson("data/products.json");
    const incomingById=new Map(body.products.map(p=>[Number(p.id),p]));
    const removed=new Set((body.removedIds||[]).map(Number));
    const merged=[];
    for(const p of current.value||[]){
      const id=Number(p.id);
      if(removed.has(id)) continue;
      merged.push(incomingById.has(id)?incomingById.get(id):p);
    }
    const currentIds=new Set((current.value||[]).map(p=>Number(p.id)));
    for(const p of body.products){
      if(!currentIds.has(Number(p.id))) merged.push(p);
    }
    if(!merged.length) throw new Error("Catalog safety check failed.");
    await githubWriteJson("data/products.json",merged,current.sha,"Update product catalogue");
    return {ok:true};
  }
  if(body.action==="saveSettings"){
    const current=await githubReadJson("data/settings.json");
    const existing=(current.value&&typeof current.value==="object")?current.value:{};
    const incoming=(body.settings&&typeof body.settings==="object")?body.settings:{};
    const merged={...existing,...incoming};
    if(String(incoming.whatsapp??"").trim()===""&&String(existing.whatsapp??"").trim()!=="") merged.whatsapp=existing.whatsapp;
    await githubWriteJson("data/settings.json",merged,current.sha,"Update shop settings");
    return {ok:true};
  }
  if(body.action==="uploadImage"){
    const safe=String(body.filename||"product.jpg").replace(/[^a-zA-Z0-9._-]/g,"-");
    const path="assets/products/"+Date.now()+"-"+safe;
    const content=String(body.base64||"").replace(/^data:[^;]+;base64,/,"");
    if(!content) throw new Error("Image data missing");
    const d=await githubRequest("/repos/"+GITHUB_REPO+"/contents/"+path,{
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({message:"Add product image",content,branch:GITHUB_BRANCH})
    });
    return {ok:true,path:path,sha:d.content?.sha||""};
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
      const [pr,sr]=await Promise.all([publicGitHubReadJson("data/products.json"),publicGitHubReadJson("data/settings.json")]);
      if(!Array.isArray(pr.value)||pr.value.length===0) throw new Error("Empty Git-backed catalog.");
      products=pr.value;githubOriginalIds=new Set(products.map(p=>Number(p.id)));settings=sr.value||{}; delete settings.githubToken; apply();render();loadReviews();return;
    }
    const r=await fetch(API,{cache:"no-store"});if(!r.ok)throw new Error();const d=await r.json();if(!Array.isArray(d.products)||d.products.length===0)throw new Error("Empty catalog response.");products=d.products;githubOriginalIds=new Set(products.map(p=>Number(p.id)));settings=d.settings||{};apply();render();loadReviews();
  }catch(e){
    try{
      const [pr,sr]=await Promise.all([fetch("data/products.json",{cache:"no-store"}),fetch("data/settings.json",{cache:"no-store"})]);
      products=await pr.json();if(!Array.isArray(products)||products.length===0)throw new Error("Empty static catalog.");githubOriginalIds=new Set(products.map(p=>Number(p.id)));settings=await sr.json();apply();render();loadReviews()
    }catch(err){
      products=[];settings={name:"SRI SAI VANI",whatsapp:"",instagram:"https://www.instagram.com/sri_sai_vani_collections/"};apply();render();loadReviews()
    }
  }
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function money(n){return "₹"+Number(n).toLocaleString("en-IN")}
function waNumber(){return String(settings.whatsapp||"").replace(/\D/g,"")}
function wa(p){const n=waNumber();return "https://wa.me/"+n+"?text="+encodeURIComponent("Hi Sri Sai Vani, I am interested in "+p.name+" ("+money(p.price)+"). Is it available?")}
function apply(){all(".brand b").forEach(x=>x.textContent=settings.name||"SRI SAI VANI");const n=waNumber();$("#waMain").href=n?"https://wa.me/"+n+"?text="+encodeURIComponent("Hi Sri Sai Vani, I would like to know about your collection."): "#";$("#instagram").href=settings.instagram}
async function loadReviews(){
  try{
    const r=await fetch("data/reviews.json",{cache:"no-store"});
    if(!r.ok)throw new Error("Reviews unavailable");
    const data=await r.json();
    reviewsArray=Array.isArray(data)?data:[];
  }catch(_){
    reviewsArray=[];
  }
  renderReviews();
}
function renderReviews(){
  const container=document.getElementById("reviews-container");
  if(!container)return;
  const validReviews=reviewsArray.filter(item=>{
    const text=String(item?.text||item?.comment||"");
    const lower=text.toLowerCase();
    return !lower.includes("3.7 / 5")&&!lower.includes("google customer reviews");
  });
  container.innerHTML=validReviews.map(item=>{
    const text=esc(item.text||item.comment||"");
    const author=esc(item.author||item.name||"Verified Patron");
    return '<article class="cc-card"><span class="cc-quote-mark" aria-hidden="true">“</span><div class="cc-card-stars" aria-hidden="true">★★★★☆</div><p class="cc-quote-text">'+text+'</p><p class="cc-author">— '+author+'</p></article>';
  }).join("");
}
function renderTabs(){$("#tabs").innerHTML=["All","Sarees","Dresses"].map(c=>'<button class="'+(category===c?"active":"")+'" data-tab="'+c+'">'+c.toUpperCase()+"</button>").join("")}
function render(){renderTabs();if(!Array.isArray(products)||products.length===0){return}const q=$("#search").value.trim().toLowerCase(),pf=$("#price").value;let list=products.filter(p=>(category==="All"||p.category===category)&&(!q||p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q))).sort((a,b)=>{const rank=p=>p.newArrival&&p.bestSeller?0:(p.newArrival||p.bestSeller?1:2);return rank(a)-rank(b)}).filter(p=>!pf||(pf==="0-2000"?p.price<2000:pf==="2000-4000"?p.price>=2000&&p.price<4000:pf==="4000-7000"?p.price>=4000&&p.price<7000:p.price>=7000));$("#products").innerHTML=list.map(p=>'<article class="product-card"><div class="product-image"><img src="'+esc(p.image)+'" alt="'+esc(p.name)+'" loading="lazy" onerror="this.closest(\'.product-image\').classList.add(\'image-missing\')"><div class="badges">'+(p.newArrival?'<span class="badge new">NEW ARRIVAL</span>':"")+(p.bestSeller?'<span class="badge best">BEST SELLER</span>':"")+'</div></div><div class="product-info"><h3>'+esc(p.name)+'</h3><span class="meta">'+esc(p.category)+(p.availability===false?" · Unavailable":"")+'</span><div class="price-line"><span class="price">'+money(p.price)+(p.originalPrice&&p.originalPrice>p.price?'<del>'+money(p.originalPrice)+'</del>':"")+'</span><a class="wa-mini" href="'+wa(p)+'" target="_blank" rel="noopener" aria-label="WhatsApp about '+esc(p.name)+'" title="Ask on WhatsApp"><svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.52 3.48A11.86 11.86 0 0 0 12.06 0C5.51 0 .18 5.33.18 11.88c0 2.09.55 4.13 1.59 5.93L.08 24l6.33-1.66a11.9 11.9 0 0 0 5.65 1.44h.01c6.55 0 11.88-5.33 11.88-11.88 0-3.18-1.24-6.17-3.43-8.42ZM12.07 21.8h-.01a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.76.99 1-3.67-.23-.38a9.89 9.89 0 0 1-1.52-5.27C2.14 6.42 6.59 1.97 12.07 1.97c2.65 0 5.14 1.03 7.01 2.9a9.85 9.85 0 0 1 2.9 7.02c0 5.48-4.45 9.91-9.91 9.91Zm5.44-7.43c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.09 4.49.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.12-.27-.2-.57-.35Z"/></svg></a></div></div></article>').join("")}
function form(p={}){return '<div class="admin-row"><input id="fName" placeholder="Product name" value="'+(p.name||"")+'"><select id="fCat"><option '+(p.category==="Sarees"?"selected":"")+'>Sarees</option><option '+(p.category==="Dresses"?"selected":"")+'>Dresses</option></select></div><div class="admin-row"><input id="fPrice" type="number" placeholder="Price" value="'+(p.price||"")+'"><input id="fOriginal" type="number" placeholder="Original price" value="'+(p.originalPrice||"")+'"></div><div class="upload-row"><input id="fImage" placeholder="Image path or URL" value="'+(p.image||"")+'"><input id="fFile" type="file" accept="image/*"></div><label><input id="fNew" type="checkbox" '+(p.newArrival?"checked":"")+'> New arrival</label> <label><input id="fBest" type="checkbox" '+(p.bestSeller?"checked":"")+'> Best seller</label> <label><input id="fAvail" type="checkbox" '+(p.availability!==false?"checked":"")+'> Available</label><br><br><button class="btn dark" id="saveItem">SAVE ITEM</button>'+(p.id?' <button class="danger" id="deleteItem">DELETE</button>':"")}
function showView(v){const b=$("#studioBody");if(v==="products"){b.innerHTML=products.map(p=>'<div class="admin-item"><div><strong>'+p.name+'</strong><br><small>'+p.category+" · "+money(p.price)+(p.newArrival?" · NEW":"")+(p.bestSeller?" · BEST":"")+'</small></div><button class="danger edit" data-id="'+p.id+'">EDIT</button></div>').join("")}else if(v==="add"){b.innerHTML=form();$("#saveItem").onclick=()=>saveProduct(0)}else{b.innerHTML='<p>Shop name</p><input id="setName" value="'+(settings.name||"")+'"><p>WhatsApp number</p><input id="setWa" value="'+(settings.whatsapp||"")+'"><p>Instagram URL</p><input id="setIg" value="'+(settings.instagram||"")+'"><small>GitHub access is already connected on this browser. The token is stored locally and is not saved to your shop settings.</small><button class="btn dark" id="saveSettings">SAVE SETTINGS</button>'}}
function edit(id){
  const p=products.find(x=>x.id===id);
  if(!p)return;
  $("#studioBody").innerHTML=form(p);
  $("#saveItem").onclick=()=>saveProduct(id);
  $("#deleteItem").onclick=async()=>{
    if(!confirm("Delete this item?"))return;
    const oldProducts=products.slice();
    const btn=$("#deleteItem");
    if(btn)btn.disabled=true;
    try{
      products=oldProducts.filter(x=>x.id!==id);
      await persistProducts();
      await load();
      render();
      showView("products");
      alert("Item deleted successfully.");
    }catch(e){
      products=oldProducts;
      render();
      if(btn)btn.disabled=false;
      alert("Unable to delete item: "+(e?.message||e));
    }
  };
}
async function persistProducts(){
  const currentIds=new Set(products.map(p=>Number(p.id)));
  const removedIds=Array.from(githubOriginalIds).filter(id=>!currentIds.has(Number(id)));
  await api({action:"saveProducts",password:adminPassword,products,removedIds});
  githubOriginalIds=new Set(products.map(p=>Number(p.id)));
}
async function saveProduct(id){
  const btn=$("#saveItem");
  if(btn)btn.disabled=true;
  const oldProducts=products.slice();
  try{
    const name=$("#fName").value.trim();
    const categoryValue=$("#fCat").value;
    const price=Number($("#fPrice").value);
    const originalPrice=Number($("#fOriginal").value)||undefined;
    let image=$("#fImage").value.trim();
    const file=$("#fFile").files[0];

    if(!name)throw new Error("Please enter a product name.");
    if(!Number.isFinite(price)||price<=0)throw new Error("Please enter a valid price.");
    if(!image&&!file)throw new Error("Please add an image URL/path or select an image file.");

    if(file){
      if(file.size>5*1024*1024)throw new Error("Image must be 5MB or smaller.");
      const base64=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(new Error("Could not read the selected image."));
        reader.readAsDataURL(file);
      });
      const up=await api({action:"uploadImage",password:adminPassword,filename:file.name,base64});
      if(!up?.path)throw new Error("Image upload failed.");
      image=up.path;
    }

    const p={
      id:id||Date.now(),
      name,
      category:categoryValue,
      price,
      originalPrice,
      image,
      newArrival:$("#fNew").checked,
      bestSeller:$("#fBest").checked,
      availability:$("#fAvail").checked
    };

    if(id)products=products.map(x=>Number(x.id)===Number(id)?p:x);
    else products=[p,...products];

    await persistProducts();
    await load();
    render();
    showView("products");
    alert(id?"Item updated successfully.":"Item added successfully.");
  }catch(e){
    products=oldProducts;
    render();
    alert("Unable to save item: "+(e?.message||e));
  }finally{
    if(btn)btn.disabled=false;
  }
}
$("#menu").onclick=()=>$("#nav").classList.toggle("open");
function getSavedGithubToken(){
  return (localStorage.getItem(GITHUB_TOKEN_KEY)||sessionStorage.getItem(GITHUB_TOKEN_KEY)||"").trim();
}
function clearSavedGithubToken(){
  localStorage.removeItem(GITHUB_TOKEN_KEY);
  sessionStorage.removeItem(GITHUB_TOKEN_KEY);
}
async function openStudioWithToken(token, remember=true){
  const value=String(token||"").trim();
  if(!value) return false;
  try{
    const result=await api({action:"authenticate",password:value});
    adminPassword=value;
    if(remember) localStorage.setItem(GITHUB_TOKEN_KEY,value);
    $("#login").classList.add("hidden");
    $("#studio").classList.remove("hidden");
    $("#password").value="";
    $("#loginMsg").textContent="";
    showView("products");
    return true;
  }catch(e){
    adminPassword="";
    if(getSavedGithubToken()===value) clearSavedGithubToken();
    $("#login").classList.remove("hidden");
    $("#studio").classList.add("hidden");
    $("#loginMsg").textContent=e.message||"GitHub token is invalid.";
    return false;
  }
}
$("#adminOpen").onclick=async()=>{
  $("#admin").classList.remove("hidden");
  const saved=getSavedGithubToken();
  if(saved){
    const ok=await openStudioWithToken(saved,false);
    if(ok) return;
  }
  $("#login").classList.remove("hidden");
  $("#studio").classList.add("hidden");
  $("#password").focus();
};
$("#adminClose").onclick=()=>$("#admin").classList.add("hidden");
$("#loginBtn").onclick=async()=>{
  const entered=$("#password").value.trim();
  const saved=getSavedGithubToken();
  await openStudioWithToken(entered||saved,true);
};
function logoutAdmin(){
  adminPassword="";
  const studio=$("#studio");
  const login=$("#login");
  const admin=$("#admin");
  if(studio) studio.classList.add("hidden");
  if(login) login.classList.add("hidden");
  if(admin) admin.classList.add("hidden");
  $("#password").value="";
  $("#loginMsg").textContent="";
}
$("#logoutBtn").onclick=logoutAdmin;
all("[data-view]").forEach(b=>b.onclick=()=>showView(b.dataset.view));
document.addEventListener("click",e=>{const t=e.target.closest("[data-tab]");if(t){category=t.dataset.tab;render()}const c=e.target.closest("[data-cat]");if(c){category=c.dataset.cat;$("#nav").classList.remove("open");render()}const eb=e.target.closest(".edit");if(eb)edit(Number(eb.dataset.id));if(e.target.id==="saveSettings"){settings.name=$("#setName").value.trim()||"SRI SAI VANI";settings.whatsapp=$("#setWa").value.replace(/\D/g,"");settings.instagram=$("#setIg").value.trim(); delete settings.githubToken; api({action:"saveSettings",password:adminPassword,settings}).then(()=>{apply();render();showView("products")}).catch(e=>alert(e.message))}});
$("#search").oninput=render;$("#price").onchange=render;load();