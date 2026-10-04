const IS_GITHUB_PAGES = location.hostname.endsWith(".github.io");
const LOCAL_KEY = "ssv_catalog_v4";
const CATALOG_SCHEMA = 4;
const GITHUB_REPO = "vinith1111/premium_saree_website_libas";
const GITHUB_BRANCH = "main";
const GITHUB_TOKEN_KEY = "ssv_github_token_v1";
const ADMIN_TOKEN_KEY = "gh_admin_token_libas";
const LEGACY_TOKEN_KEY = "github_token";
let products=[],settings={},category="All",adminPassword="",reviewsArray=[],githubOriginalIds=new Set(),catalogStatus="loading";
function $(s){return document.querySelector(s)} function all(s){return document.querySelectorAll(s)}
async function localLoad(){
  // GitHub is the single source of truth for catalog/settings.
  return await loadAuthoritativeCatalog();
}
async function loadAuthoritativeCatalog(){
  const [catalog,siteSettings]=await Promise.all([
    githubReadJson("data/products.json"),
    githubReadJson("data/settings.json")
  ]);
  if(!Array.isArray(catalog.value)||catalog.value.length===0) throw new Error("Invalid or empty product catalog.");
  const safeSettings=(siteSettings.value&&typeof siteSettings.value==="object")?siteSettings.value:{};
  return {schema:CATALOG_SCHEMA,products:catalog.value,settings:safeSettings};
}
async function githubRequest(path,options={}){
  const token=getSavedGithubToken();
  if(!token) throw new Error("GitHub storage is not connected. Enter a GitHub token in Admin Studio.");
  const r=await fetch("https://api.github.com"+path,{...options,headers:{
    "Accept":"application/vnd.github+json",
    "Authorization":"Bearer "+token,
    "X-GitHub-Api-Version":"2022-11-28",
    ...(options.headers||{})
  }});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){
    const error=new Error(d.message||"GitHub request failed");
    error.status=r.status;
    throw error;
  }
  return d;
}
async function publicGitHubReadJson(path){
  // Read the authoritative GitHub file through the Contents API instead of
  // raw.githubusercontent.com. This avoids CDN propagation/cache returning
  // an older catalog immediately after an Admin write.
  const url="https://api.github.com/repos/"+GITHUB_REPO+"/contents/"+path+
    "?ref="+encodeURIComponent(GITHUB_BRANCH)+"&v="+Date.now();
  const r=await fetch(url,{cache:"no-store",headers:{
    "Accept":"application/vnd.github+json",
    "X-GitHub-Api-Version":"2022-11-28"
  }});
  if(!r.ok) throw new Error("Git-backed catalog could not be loaded.");
  const d=await r.json();
  const encoded=String(d.content||"").replace(/\n/g,"");
  if(!encoded) throw new Error("Git-backed catalog file is empty.");
  const binary=atob(encoded);
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const value=JSON.parse(new TextDecoder().decode(bytes));
  return {value,sha:d.sha};
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
async function hashAdminPassword(password,salt){
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey("raw",enc.encode(String(password)),{name:"PBKDF2"},false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode(String(salt)),iterations:120000,hash:"SHA-256"},key,256);
  return Array.from(new Uint8Array(bits)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function createPasswordSalt(){
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function verifyAdminPassword(password,settingsValue){
  const salt=String(settingsValue?.adminPasswordSalt||"");
  const hash=String(settingsValue?.adminPasswordHash||"");
  if(!salt||!hash)return false;
  return (await hashAdminPassword(password,salt))===hash;
}

async function localApi(body){
  if(body.action==="recoverWithGithubToken"){
    const supplied=String(body.githubToken||"").trim();
    if(!supplied) throw new Error("Enter your GitHub token.");
    const previousLocal=localStorage.getItem(GITHUB_TOKEN_KEY)||"";
    const previousSession=sessionStorage.getItem(GITHUB_TOKEN_KEY)||"";
    localStorage.setItem(GITHUB_TOKEN_KEY,supplied);
    try{
      await githubReadJson("data/products.json");
      const site=await githubReadJson("data/settings.json");
      const configured=site.value&&typeof site.value==="object"?site.value:{};
      if(!configured.adminPasswordHash) throw new Error("Admin password is not configured yet.");
      return {ok:true,storage:"github",recoveryVerified:true};
    }catch(e){
      if(previousLocal)localStorage.setItem(GITHUB_TOKEN_KEY,previousLocal);
      else localStorage.removeItem(GITHUB_TOKEN_KEY);
      if(previousSession)sessionStorage.setItem(GITHUB_TOKEN_KEY,previousSession);
      else sessionStorage.removeItem(GITHUB_TOKEN_KEY);
      throw e;
    }
  }
  if(body.action==="authenticate"){
    const supplied=String(body.password||"").trim();
    const token=localStorage.getItem(GITHUB_TOKEN_KEY)||sessionStorage.getItem(GITHUB_TOKEN_KEY)||"";
    if(!token) throw new Error("GitHub storage is not connected.");
    const site=await githubReadJson("data/settings.json");
    const configured=site.value&&typeof site.value==="object"?site.value:{};
    if(!configured.adminPasswordHash) return {ok:true,storage:"github",setupRequired:true};
    if(!await verifyAdminPassword(supplied,configured)) throw new Error("Invalid Admin password.");
    await githubReadJson("data/products.json");
    return {ok:true,storage:"github"};
  }

  if(body.action==="setupAdminPassword"||body.action==="resetAdminPassword"){
    const token=localStorage.getItem(GITHUB_TOKEN_KEY)||sessionStorage.getItem(GITHUB_TOKEN_KEY)||"";
    if(!token) throw new Error("GitHub access is required to reset the Admin password.");
    const next=String(body.newPassword||"");
    if(next.length<8) throw new Error("Admin password must be at least 8 characters.");
    await githubReadJson("data/products.json");
    const current=await githubReadJson("data/settings.json");
    const existing=current.value&&typeof current.value==="object"?current.value:{};
    if(body.action==="resetAdminPassword" && !existing.adminPasswordHash) throw new Error("Admin password is not configured yet.");
    const salt=createPasswordSalt();
    const hash=await hashAdminPassword(next,salt);
    const message=body.action==="resetAdminPassword"?"Reset Admin password":"Create Admin password";
    let updated={...existing,adminPasswordHash:hash,adminPasswordSalt:salt};
    delete updated.githubToken;
    try{
      await githubWriteJson("data/settings.json",updated,current.sha,message);
    }catch(writeError){
      if(writeError?.status!==409) throw writeError;
      // Another Admin/settings write won the race. Re-read the latest file and
      // merge only the password fields so unrelated settings are preserved.
      const latest=await githubReadJson("data/settings.json");
      const latestValue=latest.value&&typeof latest.value==="object"?latest.value:{};
      updated={...latestValue,adminPasswordHash:hash,adminPasswordSalt:salt};
      delete updated.githubToken;
      await githubWriteJson("data/settings.json",updated,latest.sha,message);
    }
    const verified=await githubReadJson("data/settings.json");
    if(String(verified.value?.adminPasswordHash||"")!==hash) throw new Error("Password reset could not be verified.");
    return {ok:true,storage:"github"};
  }

  const storedToken=localStorage.getItem(GITHUB_TOKEN_KEY)||sessionStorage.getItem(GITHUB_TOKEN_KEY)||"";
  if(!storedToken) throw new Error("GitHub storage is not connected.");
  const configured=await githubReadJson("data/settings.json");
  const configuredSettings=configured.value&&typeof configured.value==="object"?configured.value:{};
  if(!await verifyAdminPassword(String(body.password||""),configuredSettings)) throw new Error("Unauthorized");
  if(body.action==="saveProduct"){
    const incoming=body.product;
    validateProductInput(incoming);
    const current=await githubReadJson("data/products.json");
    const list=Array.isArray(current.value)?current.value:[];
    const id=Number(incoming.id);
    const exists=list.some(p=>Number(p.id)===id);
    const merged=exists?list.map(p=>Number(p.id)===id?incoming:p):[incoming,...list];
    if(!merged.length) throw new Error("Catalog safety check failed.");
    try{
      await githubWriteJson("data/products.json",merged,current.sha,"Update product");
    }catch(_){
      const latest=await githubReadJson("data/products.json");
      const latestList=Array.isArray(latest.value)?latest.value:[];
      const latestMerged=latestList.some(p=>Number(p.id)===id)
        ?latestList.map(p=>Number(p.id)===id?incoming:p)
        :[incoming,...latestList];
      await githubWriteJson("data/products.json",latestMerged,latest.sha,"Retry product update");
    }
    return {ok:true};
  }
  if(body.action==="deleteProduct"){
    const id=Number(body.id);
    if(!id) throw new Error("Invalid product.");
    const current=await githubReadJson("data/products.json");
    const list=Array.isArray(current.value)?current.value:[];
    const merged=list.filter(p=>Number(p.id)!==id);
    if(!merged.length) throw new Error("Catalog safety check failed.");
    try{
      await githubWriteJson("data/products.json",merged,current.sha,"Delete product");
    }catch(_){
      const latest=await githubReadJson("data/products.json");
      const latestList=Array.isArray(latest.value)?latest.value:[];
      const latestMerged=latestList.filter(p=>Number(p.id)!==id);
      if(!latestMerged.length) throw new Error("Catalog safety check failed.");
      await githubWriteJson("data/products.json",latestMerged,latest.sha,"Retry product deletion");
    }
    return {ok:true};
  }
  if(body.action==="saveSettings"){
    const current=await githubReadJson("data/settings.json");
    const existing=(current.value&&typeof current.value==="object")?current.value:{};
    const incoming=(body.settings&&typeof body.settings==="object")?body.settings:{};
    validateSettingsInput({...existing,...incoming});
    const merged={...existing,...incoming};
    if(String(incoming.whatsapp??"").trim()===""&&String(existing.whatsapp??"").trim()!=="") merged.whatsapp=existing.whatsapp;
    try{
      await githubWriteJson("data/settings.json",merged,current.sha,"Update shop settings");
    }catch(writeError){
      const latest=await githubReadJson("data/settings.json");
      const latestExisting=(latest.value&&typeof latest.value==="object")?latest.value:{};
      const retryMerged={...latestExisting,...incoming};
      if(String(incoming.whatsapp??"").trim()===""&&String(latestExisting.whatsapp??"").trim()!=="") retryMerged.whatsapp=latestExisting.whatsapp;
      await githubWriteJson("data/settings.json",retryMerged,latest.sha,"Retry shop settings update");
    }
    return {ok:true};
  }
  if(body.action==="uploadImage"){
    const filename=String(body.filename||"product.jpg");
    const extension=filename.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/);
    if(!extension) throw new Error("Only JPG, PNG, WEBP or GIF images are allowed.");
    const safe=filename.replace(/[^a-zA-Z0-9._-]/g,"-");
    const randomSuffix=Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b=>b.toString(16).padStart(2,"0")).join("");
    const path="assets/products/"+Date.now()+"-"+randomSuffix+"-"+safe;
    const content=String(body.base64||"").replace(/^data:[^;]+;base64,/,"");
    if(!content) throw new Error("Image data missing");
    const d=await githubRequest("/repos/"+GITHUB_REPO+"/contents/"+path,{
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({message:"Add product image",content,branch:GITHUB_BRANCH})
    });
    return {
      ok:true,
      path:path,
      url:"https://raw.githubusercontent.com/"+GITHUB_REPO+"/"+GITHUB_BRANCH+"/"+path,
      sha:d.content?.sha||""
    };
  }
  if(body.action==="deleteImage"){
    const path=String(body.path||"");
    if(!/^assets\/products\/[a-zA-Z0-9._-]+$/.test(path)) throw new Error("Invalid image path.");
    const file=await githubRequest("/repos/"+GITHUB_REPO+"/contents/"+path);
    if(!file?.sha) throw new Error("Image was not found in GitHub.");
    await githubRequest("/repos/"+GITHUB_REPO+"/contents/"+path,{
      method:"DELETE",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({message:"Remove unused product image",sha:file.sha,branch:GITHUB_BRANCH})
    });
    return {ok:true};
  }
  throw new Error("Unknown action");
}
async function api(body){
  return localApi(body);
}
async function load(){
  try{
    // GitHub is the single source of truth for the storefront. Never fall back
    // to the deployed static JSON because that can temporarily be older than
    // the latest Admin commit and make a newly saved item appear to disappear.
    const [pr,sr]=await Promise.all([
      publicGitHubReadJson("data/products.json"),
      publicGitHubReadJson("data/settings.json")
    ]);
    if(!Array.isArray(pr.value)||pr.value.length===0) throw new Error("Empty Git-backed catalog.");
    products=pr.value;
    catalogStatus="ready";
    githubOriginalIds=new Set(products.map(p=>Number(p.id)));
    settings=sr.value||{};
    delete settings.githubToken;
    apply();
    render();
    loadReviews();
    return true;
  }catch(e){
    // Fail closed. Keep the last successfully rendered in-memory catalog and
    // show the real storage error instead of replacing it with stale data.
    console.error("Git-backed catalog load failed:",e);
    catalogStatus="error";
    if(!Array.isArray(products)||products.length===0){
      products=[];
      settings={name:"SRI SAI VANI",whatsapp:"",instagram:"https://www.instagram.com/sri_sai_vani_collections/"};
      apply();
      render();
    }
    return false;
  }
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function validateProductInput(product){
  if(!product||!Number.isSafeInteger(Number(product.id))||Number(product.id)<=0) throw new Error("Invalid product ID.");
  const name=String(product.name||"").trim();
  if(!name||name.length>120) throw new Error("Product name must be 1-120 characters.");
  if(!["Sarees","Dresses"].includes(String(product.category||""))) throw new Error("Invalid product category.");
  const price=Number(product.price);
  if(!Number.isFinite(price)||price<=0||price>10000000) throw new Error("Invalid product price.");
  if(product.originalPrice!==undefined){
    const original=Number(product.originalPrice);
    if(!Number.isFinite(original)||original<=0||original>10000000) throw new Error("Invalid original price.");
  }
  const image=String(product.image||"").trim();
  if(!image||image.length>1000) throw new Error("A valid product image is required.");
  return true;
}
function validateSettingsInput(settingsValue){
  const s=settingsValue&&typeof settingsValue==="object"?settingsValue:{};
  const name=String(s.name||"").trim();
  if(!name||name.length>100) throw new Error("Shop name must be 1-100 characters.");
  const whatsapp=String(s.whatsapp||"").replace(/\D/g,"");
  if(whatsapp && (whatsapp.length<10||whatsapp.length>15)) throw new Error("WhatsApp number must contain 10-15 digits.");
  const instagram=String(s.instagram||"").trim();
  if(instagram){
    let url;
    try{url=new URL(instagram)}catch(_){throw new Error("Enter a valid Instagram URL.");}
    if(!["https:","http:"].includes(url.protocol)||!/instagram\.com$/i.test(url.hostname.replace(/^www\./i,""))) throw new Error("Instagram URL must point to Instagram.");
  }
  return true;
}
let settingsWriteQueue=Promise.resolve();

function money(n){return "₹"+Number(n).toLocaleString("en-IN")}
function waNumber(){return String(settings.whatsapp||"").replace(/\D/g,"")}
function wa(p){const n=waNumber();return "https://wa.me/"+n+"?text="+encodeURIComponent("Hi Sri Sai Vani, I am interested in "+p.name+" ("+money(p.price)+"). Is it available?")}
function productImageSrc(value){
  const src=String(value||"").trim();
  if(!src)return "";
  if(/^(https?:|data:|blob:)/i.test(src))return src;
  // GitHub raw is used for repository assets so newly uploaded images become
  // available independently of GitHub Pages deployment propagation.
  return "https://raw.githubusercontent.com/"+GITHUB_REPO+"/"+GITHUB_BRANCH+"/"+src.replace(/^\.\//,"");
}
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
    return '<article class="cc-card"><span class="cc-quote-mark" aria-hidden="true">“</span><p class="cc-quote-text">'+text+'</p><p class="cc-author">— '+author+'</p></article>';
  }).join("");
}
function renderTabs(){$("#tabs").innerHTML=["All","Sarees","Dresses"].map(c=>'<button class="'+(category===c?"active":"")+'" data-tab="'+c+'">'+c.toUpperCase()+"</button>").join("")}
function render(){
  renderTabs();
  const grid=$("#products");
  if(!grid)return;
  if(!Array.isArray(products)||products.length===0){
    const message=catalogStatus==="error"
      ?'<strong>Collection temporarily unavailable</strong><span>We could not load the latest collection. Please try again.</span><button type="button" class="btn dark" id="retryCatalog">TRY AGAIN</button>'
      :'<strong>Collection is loading</strong><span>Please wait a moment.</span>';
    grid.innerHTML='<div class="catalog-empty" role="status">'+message+'</div>';
    const retry=$("#retryCatalog");
    if(retry)retry.onclick=()=>load();
    return;
  }const q=$("#search").value.trim().toLowerCase(),pf=$("#price").value;let list=products.filter(p=>(category==="All"||p.category===category)&&(!q||p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q))).sort((a,b)=>{const rank=p=>p.newArrival&&p.bestSeller?0:(p.newArrival||p.bestSeller?1:2);return rank(a)-rank(b)}).filter(p=>!pf||(pf==="0-2000"?p.price<2000:pf==="2000-4000"?p.price>=2000&&p.price<4000:pf==="4000-7000"?p.price>=4000&&p.price<7000:p.price>=7000));const grid=$("#products");if(!list.length){grid.innerHTML='<div class="catalog-empty" role="status"><strong>No pieces found</strong><span>Try another category or search.</span><button type="button" class="btn dark" id="clearCatalogFilters">CLEAR FILTERS</button></div>';const clear=$("#clearCatalogFilters");if(clear)clear.onclick=()=>{category="All";$("#search").value="";$("#price").value="";render();};return}grid.innerHTML=list.map(p=>'<article class="product-card"><div class="product-image"><img src="'+esc(productImageSrc(p.image))+'" alt="'+esc(p.name)+'" loading="lazy" decoding="async" onerror="this.onerror=null;this.closest(\'.product-image\').classList.add(\'image-missing\');this.classList.add(\'image-failed\');"><div class="badges">'+(p.newArrival?'<span class="badge new">NEW ARRIVAL</span>':"")+(p.bestSeller?'<span class="badge best">BEST SELLER</span>':"")+'</div></div><div class="product-info"><h3>'+esc(p.name)+'</h3><span class="meta">'+esc(p.category)+(p.availability===false?" · Unavailable":"")+'</span><div class="price-line"><span class="price">'+money(p.price)+(p.originalPrice&&p.originalPrice>p.price?'<del>'+money(p.originalPrice)+'</del>':"")+'</span><a class="wa-mini" href="'+wa(p)+'" target="_blank" rel="noopener" aria-label="WhatsApp about '+esc(p.name)+'" title="Ask on WhatsApp"><svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.52 3.48A11.86 11.86 0 0 0 12.06 0C5.51 0 .18 5.33.18 11.88c0 2.09.55 4.13 1.59 5.93L.08 24l6.33-1.66a11.9 11.9 0 0 0 5.65 1.44h.01c6.55 0 11.88-5.33 11.88-11.88 0-3.18-1.24-6.17-3.43-8.42ZM12.07 21.8h-.01a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.76.99 1-3.67-.23-.38a9.89 9.89 0 0 1-1.52-5.27C2.14 6.42 6.59 1.97 12.07 1.97c2.65 0 5.14 1.03 7.01 2.9a9.85 9.85 0 0 1 2.9 7.02c0 5.48-4.45 9.91-9.91 9.91Zm5.44-7.43c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.09 4.49.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.12-.27-.2-.57-.35Z"/></svg></a></div></div></article>').join("")}
function form(p={}){
  const name=esc(p.name||"");
  const category=esc(p.category||"");
  const price=esc(p.price??"");
  const original=esc(p.originalPrice??"");
  const image=esc(p.image||"");
  return '<div class="admin-row"><input id="fName" maxlength="120" placeholder="Product name" value="'+name+'"><select id="fCat"><option value="Sarees" '+(p.category==="Sarees"?"selected":"")+'>Sarees</option><option value="Dresses" '+(p.category==="Dresses"?"selected":"")+'>Dresses</option></select></div><div class="admin-row"><input id="fPrice" type="number" min="1" step="1" placeholder="Price" value="'+price+'"><input id="fOriginal" type="number" min="1" step="1" placeholder="Original price" value="'+original+'"></div><div class="upload-row"><input id="fImage" maxlength="1000" placeholder="Image path or URL" value="'+image+'"><input id="fFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></div><div class="admin-image-preview-wrap"><img id="fImagePreview" class="admin-image-preview" src="'+(image?esc(productImageSrc(p.image)):'')+'" alt="Selected product preview" '+(image?'':'hidden')+'><span id="fImagePreviewEmpty" '+(image?'hidden':'')+'>IMAGE PREVIEW</span></div><label><input id="fNew" type="checkbox" '+(p.newArrival?"checked":"")+'> New arrival</label> <label><input id="fBest" type="checkbox" '+(p.bestSeller?"checked":"")+'> Best seller</label> <label><input id="fAvail" type="checkbox" '+(p.availability!==false?"checked":"")+'> Available</label><br><br><button type="button" class="btn dark" id="saveItem">'+(p.id?"SAVE CHANGES":"SAVE ITEM")+'</button>'+(p.id?' <button type="button" class="danger" id="deleteItem">DELETE ITEM</button>':"");
}
function updateStudioNav(activeView){
  all("[data-view]").forEach(btn=>{
    const active=btn.dataset.view===activeView;
    btn.classList.toggle("active",active);
    if(active) btn.setAttribute("aria-current","page");
    else btn.removeAttribute("aria-current");
  });
}

function showView(v){
  updateStudioNav(v);
  const b=$("#studioBody");
  if(v==="products"){
    b.innerHTML=products.map(p=>'<div class="admin-item"><div class="admin-product-main"><img class="admin-product-thumb" src="'+esc(productImageSrc(p.image))+'" alt="" loading="lazy" onerror="this.classList.add(\'image-missing\')"><div class="admin-product-copy"><strong>'+esc(p.name)+'</strong><br><small>'+esc(p.category)+" · "+money(p.price)+(p.newArrival?" · NEW":"")+(p.bestSeller?" · BEST":"")+(p.availability===false?" · UNAVAILABLE":"")+'</small></div></div><button class="danger edit" data-id="'+Number(p.id)+'">EDIT</button></div>').join("");
  }else if(v==="add"){
    b.innerHTML=form();
    const fileInput=$("#fFile"), imageInput=$("#fImage"), preview=$("#fImagePreview"), previewEmpty=$("#fImagePreviewEmpty");
    const syncPreview=(src)=>{const value=String(src||"").trim();if(value){preview.src=productImageSrc(value);preview.hidden=false;previewEmpty.hidden=true;}else{preview.removeAttribute("src");preview.hidden=true;previewEmpty.hidden=false;}};
    if(imageInput)imageInput.addEventListener("input",()=>syncPreview(imageInput.value));
    if(fileInput)fileInput.addEventListener("change",()=>{const file=fileInput.files?.[0];if(file)syncPreview(URL.createObjectURL(file));else syncPreview(imageInput?.value||"");});
    const saveBtn=$("#saveItem");
    if(saveBtn){
      saveBtn.type="button";
      saveBtn.onclick=async(e)=>{
        e.preventDefault();
        e.stopPropagation();
        await saveProduct(0);
      };
    }
  }else{
    b.innerHTML='<p>Shop name</p><input id="setName" maxlength="100" value="'+esc(settings.name||"")+'"><p>WhatsApp number</p><input id="setWa" inputmode="tel" maxlength="15" value="'+esc(settings.whatsapp||"")+'"><p>Instagram URL</p><input id="setIg" type="url" value="'+esc(settings.instagram||"")+'"><button type="button" class="btn dark" id="saveSettings">SAVE SETTINGS</button>';
  }
}
function edit(id){
  const p=products.find(x=>Number(x.id)===Number(id));
  if(!p)return;
  $("#studioBody").innerHTML=form(p);
  const saveBtn=$("#saveItem");
  if(saveBtn){
    saveBtn.type="button";
    saveBtn.onclick=async(e)=>{
      e.preventDefault();
      e.stopPropagation();
      await saveProduct(id);
    };
  }
  $("#deleteItem").onclick=async()=>{
    if(!confirm("Delete this product?\n\nThis action cannot be undone."))return;
    const oldProducts=products.slice();
    const btn=$("#deleteItem");
    const originalDeleteText=btn?.textContent||"DELETE ITEM";
    if(btn){btn.disabled=true;btn.classList.add("is-busy");btn.textContent="DELETING...";}
    try{
      products=oldProducts.filter(x=>Number(x.id)!==Number(id));
      await deleteProductFromGithub(id);
      await load();
      showView("products");
      showAdminToast("Product deleted successfully.","success");
    }catch(e){
      products=oldProducts;
      render();
      if(btn){btn.disabled=false;btn.classList.remove("is-busy");btn.textContent=originalDeleteText;}
      showAdminToast("Could not delete product. "+(e?.message||"Please try again."),"error");
    }
  };
}
async function persistProduct(product){
  await api({action:"saveProduct",password:adminPassword,product});
}
async function deleteProductFromGithub(id){
  const deleteOperation=async()=>{
    await api({action:"deleteProduct",password:adminPassword,id:Number(id)});
    const latest=await githubReadJson("data/products.json");
    const list=Array.isArray(latest.value)?latest.value:[];
    if(list.some(p=>Number(p.id)===Number(id))){
      throw new Error("Product deletion could not be verified.");
    }
    return list;
  };
  catalogWriteQueue=catalogWriteQueue.then(deleteOperation,deleteOperation);
  const verified=await catalogWriteQueue;
  products=verified;
  githubOriginalIds=new Set(products.map(p=>Number(p.id)));
}
function showAdminToast(message,type="success"){
  let el=$("#adminToast");
  if(!el){
    el=document.createElement("div");
    el.id="adminToast";
    el.setAttribute("role","status");
    const admin=$("#admin");
    if(admin)admin.appendChild(el);
  }
  el.textContent=message;
  el.className="admin-toast "+type;
  clearTimeout(window.__adminToastTimer);
  window.__adminToastTimer=setTimeout(()=>el.classList.remove("show"),2600);
  requestAnimationFrame(()=>el.classList.add("show"));
}

let catalogWriteQueue=Promise.resolve();

function nextProductId(){
  let id=Date.now();
  while(products.some(p=>Number(p.id)===id)) id++;
  return id;
}

async function verifyProductPersistence(product){
  const latest=await githubReadJson("data/products.json");
  const list=Array.isArray(latest.value)?latest.value:[];
  const saved=list.find(p=>Number(p.id)===Number(product.id));
  if(!saved) throw new Error("GitHub saved the change, but the product could not be verified.");
  if(String(saved.name||"").trim()!==String(product.name||"").trim()) throw new Error("Product verification failed.");
  if(String(saved.image||"").trim()!==String(product.image||"").trim()) throw new Error("Product image verification failed.");
  return latest.value;
}

async function saveProduct(id){
  const btn=$("#saveItem");
  const originalText=btn?.textContent||"SAVE ITEM";
  if(btn){
    btn.disabled=true;
    btn.classList.add("is-busy");
    btn.textContent="SAVING...";
  }
  const oldProducts=products.slice();
  try{
    const name=$("#fName").value.trim();
    const categoryValue=$("#fCat").value;
    const price=Number($("#fPrice").value);
    const originalPrice=Number($("#fOriginal").value)||undefined;
    let image=$("#fImage").value.trim();
    const file=$("#fFile").files[0];
    let uploadedImagePath="";

    if(!name)throw new Error("Please enter a product name.");
    if(!Number.isFinite(price)||price<=0)throw new Error("Please enter a valid price.");
    if(originalPrice!==undefined && originalPrice<=0)throw new Error("Original price must be greater than zero.");
    if(originalPrice!==undefined && originalPrice<price)throw new Error("Original price cannot be lower than sale price.");
    if(!image&&!file)throw new Error("Please add an image URL/path or select an image file.");

    // Build from the existing Git-backed product when editing so unrelated
    // fields are never accidentally erased by an Admin form update.
    const existing=id?products.find(x=>Number(x.id)===Number(id)):null;

    if(file){
      if(file.size>5*1024*1024)throw new Error("Image must be 5MB or smaller.");
      const allowedTypes=["image/jpeg","image/png","image/webp","image/gif"];
      if(!allowedTypes.includes(file.type))throw new Error("Only JPG, PNG, WEBP or GIF images are allowed.");
      const base64=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(new Error("Could not read the selected image."));
        reader.readAsDataURL(file);
      });
      const up=await api({action:"uploadImage",password:adminPassword,filename:file.name,base64});
      if(!up?.path)throw new Error("Image upload failed.");
      uploadedImagePath=up.path;
      image=up.path;
    }

    const p={
      ...(existing||{}),
      id:id?Number(id):nextProductId(),
      name,
      category:categoryValue,
      price,
      ...(originalPrice===undefined?{originalPrice:undefined}:{originalPrice}),
      image,
      newArrival:$("#fNew").checked,
      bestSeller:$("#fBest").checked,
      availability:$("#fAvail").checked
    };

    // Serialize catalog writes. Two rapid Admin operations must never race
    // against each other with stale GitHub file SHAs.
    const write=async()=>{
      await persistProduct(p);
      const verified=await verifyProductPersistence(p);
      products=verified;
      githubOriginalIds=new Set(products.map(x=>Number(x.id)));
      render();
    };
    catalogWriteQueue=catalogWriteQueue.then(write,write);
    await catalogWriteQueue;

    // Re-read the authoritative catalog after the write. No localStorage merge
    // and no static-file fallback can resurrect or remove products.
    await load();
    showView("products");
    showAdminToast(id?"Product updated successfully.":"Product added successfully.","success");
  }catch(e){
    products=oldProducts;
    render();
    if(uploadedImagePath){
      try{await api({action:"deleteImage",password:adminPassword,path:uploadedImagePath});}catch(cleanupError){console.warn("Uploaded image cleanup failed:",cleanupError);}
    }
    showAdminToast("Could not save product. "+(e?.message||"Please try again."),"error");
  }finally{
    if(btn){
      btn.disabled=false;
      btn.classList.remove("is-busy");
      btn.textContent=originalText;
    }
  }
}
$("#menu").onclick=()=>$("#nav").classList.toggle("open");
let adminSessionActive=false;
let adminSetupMode=false;
let adminResetMode=false;
let adminRecoveryTokenMode=false;
let adminLogoutLock=false;

function getSavedGithubToken(){
  const keys=[GITHUB_TOKEN_KEY,ADMIN_TOKEN_KEY,LEGACY_TOKEN_KEY];
  for(const key of keys){
    const local=(localStorage.getItem(key)||"").trim();
    if(local)return local;
    const session=(sessionStorage.getItem(key)||"").trim();
    if(session)return session;
  }
  return "";
}

function storeAdminToken(token){
  const value=String(token||"").trim();
  if(!value)return;
  // Keep the existing app key plus the two compatibility keys requested for
  // Admin authentication. This does not touch catalog/localStorage data.
  localStorage.setItem(GITHUB_TOKEN_KEY,value);
  localStorage.setItem(ADMIN_TOKEN_KEY,value);
  localStorage.setItem(LEGACY_TOKEN_KEY,value);
}

function updateAdminView(){
  const loginSection=$("#login")||$("#adminLoginScreen")||$(".admin-token-section");
  const studioSection=$("#studio")||$("#adminStudioScreen")||$(".admin-studio-content");
  const active=adminSessionActive===true;
  if(loginSection){
    loginSection.classList.toggle("admin-screen-hidden",active);
    loginSection.classList.toggle("hidden",active);
    loginSection.style.setProperty("display",active?"none":"block","important");
  }
  if(studioSection){
    studioSection.classList.toggle("admin-screen-hidden",!active);
    studioSection.classList.toggle("hidden",!active);
    studioSection.style.setProperty("display",active?"block":"none","important");
  }
}

let lastAdminTrigger=null;
function focusAdminDialog(){
  const modal=$("#admin");
  if(!modal)return;
  modal.setAttribute("role","dialog");
  modal.setAttribute("aria-modal","true");
  modal.setAttribute("aria-labelledby","adminTitle");
  $("#adminTitle")?.focus();
}
function trapAdminFocus(e){
  const modal=$("#admin");
  if(!modal||modal.classList.contains("hidden")||e.key!=="Tab")return;
  const focusable=[...modal.querySelectorAll('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled&&el.offsetParent!==null);
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
}

function openAdminModal(){
  const modal=$("#admin");
  if(!modal)return;
  modal.classList.remove("hidden");
  modal.style.setProperty("display","flex","important");
  updateAdminView();
  focusAdminDialog();
}

function closeAdminModal(){
  const modal=$("#admin");
  if(!modal)return;
  modal.classList.add("hidden");
  modal.style.setProperty("display","none","important");
}

function setStorageStatus(message,connected=false){
  const el=$("#loginMsg");
  if(!el)return;
  el.textContent=connected?"":message;
  el.classList.toggle("connected",!!connected);
  el.style.color=connected?"#10B981":"#78716C";
}

function showAdminSetupScreen(){
  adminSetupMode=true;
  adminResetMode=false;
  adminRecoveryTokenMode=false;
  const input=$("#password");
  if(input){
    input.value="";
    input.type="password";
    input.placeholder="Create a password";
    input.setAttribute("autocomplete","new-password");
  }
  if($("#passwordLabel"))$("#passwordLabel").textContent="Password";
  if($("#adminAuthHeading"))$("#adminAuthHeading").textContent="Create password";
  if($("#adminAuthDescription"))$("#adminAuthDescription").textContent="";
  if($("#loginBtn"))$("#loginBtn").textContent="CREATE PASSWORD";
  if($("#forgotPassword")){ $("#forgotPassword").textContent=""; $("#forgotPassword").style.display="none"; }
  setStorageStatus("",true);
}

function showAdminLogin(){
  adminSessionActive=false;
  adminPassword="";
  adminSetupMode=false;
  adminResetMode=false;
  adminRecoveryTokenMode=false;
  updateAdminView();
  const input=$("#password");
  const label=$("#passwordLabel");
  const toggle=$("#passwordToggle");
  const forgot=$("#forgotPassword");
  const heading=$("#adminAuthHeading");
  const description=$("#adminAuthDescription");
  if(input){
    input.value="";
    input.type="password";
    input.setAttribute("autocomplete","current-password");
    input.placeholder="Enter password";
  }
  if(toggle){
    toggle.textContent="SHOW";
    toggle.setAttribute("aria-label","Show password");
    toggle.setAttribute("aria-pressed","false");
  }
  const hasGithubToken=!!getSavedGithubToken();
  const passwordConfigured=!!String(settings?.adminPasswordHash||"").trim();

  if(hasGithubToken && !passwordConfigured){
    showAdminSetupScreen();
    return;
  }

  if(hasGithubToken){
    if(heading)heading.textContent="Sign in";
    if(description)description.textContent="";
    if(label)label.textContent="Password";
    if($("#loginBtn"))$("#loginBtn").textContent="SIGN IN";
    if(forgot){forgot.textContent="Forgot password?";forgot.style.display="";}
    setStorageStatus("",true);
  }else{
    if(heading)heading.textContent="Connect Admin storage";
    if(description)description.textContent="Connect your GitHub storage once. Then you will create your private Admin password.";
    if(label)label.textContent="GitHub access token";
    if(input){
      input.placeholder="Paste your GitHub access token";
      input.setAttribute("autocomplete","off");
    }
    if($("#loginBtn"))$("#loginBtn").textContent="CONNECT GITHUB";
    if(forgot)forgot.textContent="Forgot password?";
    setStorageStatus("GitHub storage connection required.",false);
  }
}

function showAdminStudio(){
  adminSessionActive=true;
  updateAdminView();
  if($("#password"))$("#password").value="";
  if($("#loginMsg"))$("#loginMsg").textContent="";
  showView("products");
}

async function signInAdmin(value){
  const inputValue=String(value||"");
  if(!inputValue.trim()){
    if($("#loginMsg"))$("#loginMsg").textContent=adminResetMode||adminSetupMode?"Enter a new Admin password.":"Enter your Admin password.";
    return false;
  }
  const btn=$("#loginBtn");
  const oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent=adminResetMode?"RESETTING...":adminSetupMode?"CREATING...":"SIGNING IN...";}
  try{
    if(adminRecoveryTokenMode){
      await api({action:"recoverWithGithubToken",githubToken:inputValue});
      adminRecoveryTokenMode=false;
      adminResetMode=true;
      if($("#password")){
        $("#password").value="";
        $("#password").placeholder="Enter new Admin password (8+ characters)";
        $("#password").setAttribute("autocomplete","new-password");
      }
      if($("#passwordLabel"))$("#passwordLabel").textContent="New Admin password";
      if($("#adminAuthHeading"))$("#adminAuthHeading").textContent="Set a new Admin password";
      if($("#adminAuthDescription"))$("#adminAuthDescription").textContent="Choose a new password of at least 8 characters.";
      if($("#loginBtn"))$("#loginBtn").textContent="RESET PASSWORD";
      if($("#forgotPassword"))$("#forgotPassword").textContent="";
      setStorageStatus("GitHub access verified. Choose your new Admin password.",true);
      return false;
    }
    if(adminResetMode){
      await api({action:"resetAdminPassword",newPassword:inputValue});
      adminResetMode=false;
      adminSetupMode=false;
      settings.adminPasswordHash="configured";
      settings.adminPasswordSalt="configured";
      if($("#password"))$("#password").value="";
      showAdminLogin();
      setStorageStatus("Password reset successfully. Sign in with your new password.",true);
      return false;
    }

    const hasGithubToken=!!getSavedGithubToken();
    if(!hasGithubToken){
      await api({action:"authenticate",password:inputValue});
      if($("#password"))$("#password").value="";
      showAdminSetupScreen();
      setStorageStatus("● Storage connected",true);
      return false;
    }

    if(adminSetupMode){
      if(inputValue.length<8) throw new Error("Admin password must be at least 8 characters.");
      await api({action:"setupAdminPassword",newPassword:inputValue});
      adminSetupMode=false;
      settings.adminPasswordHash="configured";
      settings.adminPasswordSalt="configured";
      adminPassword=inputValue;
      setStorageStatus("Admin password created.",true);
    }else{
      const auth=await api({action:"authenticate",password:inputValue});
      if(auth?.setupRequired){
        showAdminSetupScreen();
        setStorageStatus("● Storage connected",true);
        return false;
      }
      adminPassword=inputValue;
      setStorageStatus("Signed in.",true);
    }

    adminSessionActive=true;
    openAdminModal();
    updateAdminView();
    if($("#password"))$("#password").value="";
    showView("products");
    return true;
  }catch(e){
    adminPassword="";
    let message=e?.message||"Sign in failed.";
    if(e?.status===409 || /does not match [0-9a-f]{7,40}/i.test(message)){
      message="GitHub settings changed while saving. Please try the password reset again.";
    }
    if($("#loginMsg"))$("#loginMsg").textContent=message;
    return false;
  }finally{
    if(btn){
      btn.disabled=false;
      if(adminRecoveryTokenMode) btn.textContent="CONNECT & RESET PASSWORD";
      else if(adminResetMode) btn.textContent="RESET PASSWORD";
      else if(adminSetupMode) btn.textContent="CREATE PASSWORD";
      else if(adminSessionActive) btn.textContent="SIGN IN";
      else if(!getSavedGithubToken()) btn.textContent="CONNECT GITHUB";
      else btn.textContent="SIGN IN";
    }
  }
}

function startPasswordReset(){
  if(adminSetupMode || adminResetMode || adminRecoveryTokenMode){
    showAdminLogin();
    return;
  }
  if(!getSavedGithubToken()){
    adminResetMode=false;
    adminRecoveryTokenMode=true;
    if($("#password")){
      $("#password").placeholder="Paste your GitHub access token";
      $("#password").setAttribute("autocomplete","off");
    }
    if($("#passwordLabel"))$("#passwordLabel").textContent="GitHub access token";
    if($("#adminAuthHeading"))$("#adminAuthHeading").textContent="Recover Admin access";
    if($("#adminAuthDescription"))$("#adminAuthDescription").textContent="Enter your GitHub access token to verify ownership, then choose a new Admin password.";
    if($("#loginBtn"))$("#loginBtn").textContent="CONNECT & RESET PASSWORD";
    if($("#forgotPassword"))$("#forgotPassword").textContent="";
    setStorageStatus("",false);
    return;
  }
  adminResetMode=true;
  adminSetupMode=false;
  if($("#password")){
    $("#password").value="";
    $("#password").placeholder="Enter new Admin password (8+ characters)";
    $("#password").setAttribute("autocomplete","new-password");
    $("#password").focus();
  }
  if($("#passwordLabel"))$("#passwordLabel").textContent="New Admin password";
  if($("#adminAuthHeading"))$("#adminAuthHeading").textContent="Set a new Admin password";
  if($("#adminAuthDescription"))$("#adminAuthDescription").textContent="Choose a new password of at least 8 characters. Your GitHub access verifies the change.";
  if($("#loginBtn"))$("#loginBtn").textContent="RESET PASSWORD";
  if($("#forgotPassword"))$("#forgotPassword").textContent="Cancel";
  setStorageStatus("",false);
}

function logoutAdmin(){
  adminLogoutLock=true;
  adminSessionActive=false;
  adminPassword="";
  // Keep the hidden GitHub connection so future Admin login and password recovery do not require the token again.
  if($("#password"))$("#password").value="";
  if($("#loginMsg"))$("#loginMsg").textContent="";
  closeAdminModal();
  updateAdminView();
  window.setTimeout(()=>{
    adminSessionActive=false;
    adminPassword="";
    updateAdminView();
    closeAdminModal();
    adminLogoutLock=false;
  },700);
}

if(!window.__LIBAS_ADMIN_PASSWORD_TOGGLE_BOUND){
  window.__LIBAS_ADMIN_PASSWORD_TOGGLE_BOUND=true;
  document.addEventListener("click",(e)=>{
    const toggle=e.target.closest("#passwordToggle");
    if(!toggle)return;
    const input=$("#password");
    if(!input)return;
    const show=input.type==="password";
    input.type=show?"text":"password";
    toggle.textContent=show?"HIDE":"SHOW";
    toggle.setAttribute("aria-label",show?"Hide password":"Show password");
    toggle.setAttribute("aria-pressed",String(show));
  });
}

if(!window.__LIBAS_ADMIN_KEYBOARD_BOUND){
  window.__LIBAS_ADMIN_KEYBOARD_BOUND=true;
  document.addEventListener("keydown",(e)=>{
    if(e.key==="Escape"&&$("#admin")&&!$("#admin").classList.contains("hidden")){
      e.preventDefault();
      closeAdminModal();
      lastAdminTrigger?.focus?.();
      return;
    }
    trapAdminFocus(e);
  });
}

if(!window.__LIBAS_ADMIN_AUTH_BOUND){
  window.__LIBAS_ADMIN_AUTH_BOUND=true;

  document.addEventListener("click",async(e)=>{
    const logout=e.target.closest("#logoutBtn");
    if(logout){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      logoutAdmin();
      return;
    }

    const admin=e.target.closest("#adminOpen");
    if(admin){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if(adminLogoutLock)return;
      lastAdminTrigger=admin;
      openAdminModal();
      updateAdminView();
      adminSessionActive=false;
      adminPassword="";
      showAdminLogin();
      return;
    }

    const close=e.target.closest("#adminClose");
    if(close){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      closeAdminModal();
      return;
    }

    const forgot=e.target.closest("#forgotPassword");
    if(forgot){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      startPasswordReset();
      return;
    }

    const login=e.target.closest("#loginBtn");
    if(login){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      await signInAdmin($("#password")?.value);
      return;
    }
  },true);

  const form=$("#login");
  if(form){
    form.addEventListener("submit",async(e)=>{
      e.preventDefault();
      e.stopPropagation();
      if(e.defaultPrevented) await signInAdmin($("#password")?.value);
    },true);
  }
}

// Authoritative initial Admin view state. Catalog/CRUD state is untouched.
if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",updateAdminView,{once:true});
}else{
  updateAdminView();
}

all("[data-view]").forEach(b=>b.onclick=()=>showView(b.dataset.view));
document.addEventListener("click",async e=>{const c=e.target.closest("[data-cat]");if(c){category=c.dataset.cat;$("#nav").classList.remove("open");render()}const eb=e.target.closest(".edit");if(eb)edit(Number(eb.dataset.id));if(e.target.id==="saveSettings"){
  e.preventDefault();
  const nextSettings={
    name:$("#setName").value.trim()||"SRI SAI VANI",
    whatsapp:$("#setWa").value.replace(/\D/g,""),
    instagram:$("#setIg").value.trim()
  };
  delete nextSettings.githubToken;
  const btn=e.target;
  const oldText=btn.textContent;
  btn.disabled=true;
  btn.textContent="SAVING...";
  try{
    const saveSettingsOperation=async()=>api({action:"saveSettings",password:adminPassword,settings:nextSettings});
    settingsWriteQueue=settingsWriteQueue.then(saveSettingsOperation,saveSettingsOperation);
    await settingsWriteQueue;
    const verified=await githubReadJson("data/settings.json");
    if(!verified.value||String(verified.value.name||"")!==String(nextSettings.name||"")||String(verified.value.whatsapp||"")!==String(nextSettings.whatsapp||"")||String(verified.value.instagram||"")!==String(nextSettings.instagram||"")){
      throw new Error("Settings could not be verified after saving.");
    }
    settings=verified.value;
    apply();
    render();
    showView("products");
    alert("Settings saved successfully.");
  }catch(err){
    alert(err?.message||"Settings could not be saved.");
  }finally{
    btn.disabled=false;
    btn.textContent=oldText;
  }
}});
const collectionTabs=$("#tabs");
if(collectionTabs){
  collectionTabs.addEventListener("click",e=>{
    const tab=e.target.closest("[data-tab]");
    if(!tab||!collectionTabs.contains(tab))return;
    const next=tab.dataset.tab;
    if(!["All","Sarees","Dresses"].includes(next))return;
    category=next;
    render();
  });
}
const collectionSearch=$("#search");
if(collectionSearch)collectionSearch.addEventListener("input",render);
const collectionPrice=$("#price");
if(collectionPrice)collectionPrice.addEventListener("change",render);
load();