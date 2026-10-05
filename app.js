const IS_GITHUB_PAGES = location.hostname.endsWith(".github.io");
const LOCAL_KEY = "ssv_catalog_v4";
const CATALOG_SCHEMA = 4;
const GITHUB_REPO = "vinith1111/premium_saree_website_libas";
const GITHUB_BRANCH = "main";
const GITHUB_TOKEN_KEY = "ssv_github_token_v1";
const ADMIN_TOKEN_KEY = "gh_admin_token_libas";
const LEGACY_TOKEN_KEY = "github_token";
let products=[],settings={},category="All",adminPassword="",githubOriginalIds=new Set();
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
  if(!otpAdminSession && !await verifyAdminPassword(String(body.password||""),configuredSettings)) throw new Error("Unauthorized");
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
async function loadPublicJson(path){
  // Prefer the same-origin GitHub Pages file. This is the deployed site's
  // authoritative public catalog and avoids raw.githubusercontent.com
  // propagation/rate-limit/cache differences.
  const sources=[
    path,
    "https://raw.githubusercontent.com/"+GITHUB_REPO+"/"+GITHUB_BRANCH+"/"+path
  ];
  let lastError=null;

  for(const base of sources){
    try{
      const separator=base.includes("?")?"&":"?";
      const url=base+separator+"cb="+Date.now();
      const r=await fetch(url,{
        cache:"no-store",
        headers:{"Accept":"application/json"}
      });

      if(!r.ok) throw new Error("HTTP "+r.status);

      const value=await r.json();
      if(path.endsWith("products.json") && !Array.isArray(value)){
        throw new Error("Product catalog format is invalid.");
      }
      if(path.endsWith("products.json") && Array.isArray(value) && value.length===0){
        throw new Error("Product catalog is empty.");
      }

      return {value};
    }catch(e){
      lastError=e;
    }
  }

  throw lastError||new Error("Public catalog could not be loaded.");
}

async function removeLegacyInstagramEmbed(){
  document.querySelectorAll('iframe[src*="instagram.com"], iframe[src*="instagramcdn.com"], .instagram-media, .instagram-embed').forEach(function(el){ el.remove(); });
}
async function load(){
  removeLegacyInstagramEmbed();
  try{
    // Storefront reads are PUBLIC. They must never depend on an Admin GitHub
    // token or GitHub API rate-limit. Admin credentials are only required for
    // CRUD/settings writes.
    const [pr,sr]=await Promise.all([
      loadPublicJson("data/products.json"),
      loadPublicJson("data/settings.json")
    ]);
    if(!Array.isArray(pr.value)||pr.value.length===0) throw new Error("Empty Git-backed catalog.");
    products=pr.value;
    githubOriginalIds=new Set(products.map(p=>Number(p.id)));
    settings=(sr.value&&typeof sr.value==="object")?{...sr.value}:{};
    delete settings.githubToken;
    apply();
    render();
     return true;
  }catch(e){
    console.error("Public catalog load failed:",e);
    if(Array.isArray(products)&&products.length){
      render();
      return false;
    }
    products=[];
    settings={name:"SRI SAI VANI",whatsapp:"",instagram:"https://www.instagram.com/sri_sai_vani_collections/"};
    apply();
    const grid=$("#products");
    if(grid)grid.innerHTML='<div class="lux-empty"><strong>Collection temporarily unavailable</strong><br><span>Please refresh in a moment.</span></div>';
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


function renderTabs(){$("#tabs").innerHTML=["All","Sarees","Dresses","Best Seller"].map(c=>'<button class="'+(category===c?"active":"")+'" data-tab="'+c+'">'+c.toUpperCase()+"</button>").join("")}
function render(){
  renderTabs();
  const grid=$("#products");
  if(!grid)return;
  if(!Array.isArray(products)||products.length===0){
    $("#products").innerHTML='<div class="lux-empty"><strong>No pieces found</strong><br><span>Try another category or search.</span></div>';
    return;
  }
  const q=$("#search").value.trim().toLowerCase(),pf=$("#price").value;
  let list=products.filter(p=>{
    const productCategory=String(p.category||"").trim().toLowerCase();
    const selectedCategory=String(category||"All").trim().toLowerCase();
    const isBestSeller=p.bestSeller===true||p.bestSeller==="true"||p.bestSeller===1||p.bestSeller==="1";
    const matchesCollection=
      selectedCategory==="all" ||
      (selectedCategory==="best seller" ? isBestSeller : productCategory===selectedCategory);
    const matchesSearch=
      !q ||
      String(p.name||"").toLowerCase().includes(q) ||
      productCategory.includes(q);
    return matchesCollection && matchesSearch;
  }).filter(p=>{
    if(!pf)return true;
    const price=Number(p.price);
    if(!Number.isFinite(price))return false;
    if(pf==="0-2000")return price<2000;
    if(pf==="2000-4000")return price>=2000&&price<4000;
    if(pf==="4000-7000")return price>=4000&&price<7000;
    if(pf==="7000+")return price>=7000;
    return true;
  });
  if(!list.length){
    grid.innerHTML='<div class="lux-empty"><strong>No pieces found</strong><br><span>Try another category or search.</span><br><button type="button" class="btn dark" id="clearCatalogFilters">CLEAR FILTERS</button></div>';
    const clear=$("#clearCatalogFilters");
    if(clear)clear.onclick=()=>{category="All";$("#search").value="";$("#price").value="";render()};
    return;
  }
  grid.innerHTML=list.map(p=>{
    const original=Number(p.originalPrice||0);
    const price=Number(p.price||0);
    const discount=original>price?Math.round((1-price/original)*100):0;
    const categoryTag=String(p.tag||p.label||"").trim();
    const badgeDock=(p.newArrival||p.bestSeller)?'<div class="ssv-badge-dock">'+
      (p.newArrival?'<span class="ssv-badge-pill pill-new">NEW</span>':"")+
      (p.bestSeller?'<span class="ssv-badge-pill pill-best">BEST SELLER</span>':"")+
      '</div>':"";
    return '<article class="lux-item-card">'+
      '<div class="lux-item-media">'+
        '<img src="'+esc(productImageSrc(p.image))+'" alt="'+esc(p.name)+'" loading="lazy" decoding="async" onerror="this.onerror=null;this.closest(".lux-item-media").classList.add("image-missing");this.classList.add("image-failed");">'+
        badgeDock+
      '</div>'+
      '<div class="lux-item-body">'+
        (categoryTag?'<div class="lux-item-cat">'+esc(categoryTag)+'</div>':"")+
        '<h3 class="lux-item-title">'+esc(p.name)+'</h3>'+
        '<div class="lux-item-footer">'+
          '<div class="lux-pricing-block">'+
            '<span class="lux-price-current">'+money(p.price)+'</span>'+
            (original>price?'<span class="lux-price-original">'+money(p.originalPrice)+'</span>':"")+
            (discount?'<span class="lux-price-discount">'+discount+'% off</span>':"")+
          '</div>'+
          '<a class="lux-wa-action" href="'+wa(p)+'" target="_blank" rel="noopener" aria-label="WhatsApp about '+esc(p.name)+'" title="Ask on WhatsApp">'+
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.52 3.48A11.86 11.86 0 0 0 12.06 0C5.51 0 .18 5.33 .18 11.88c0 2.09 .55 4.13 1.59 5.93L.08 24l6.33-1.66a11.9 11.9 0 0 0 5.65 1.44h.01c6.55 0 11.88-5.33 11.88-11.88 0-3.18-1.24-6.17-3.43-8.42ZM12.07 21.8h-.01a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.76.99 1-3.67-.23-.38a9.89 9.89 0 0 1-1.52-5.27C2.14 6.42 6.59 1.97 12.07 1.97c2.65 0 5.14 1.03 7.01 2.9a9.85 9.85 0 0 1 2.9 7.02c0 5.48-4.45 9.91-9.91 9.91Zm5.44-7.43c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.09 4.49.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.12-.27-.2-.57-.35Z"/></svg>'+
          '</a>'+
        '</div>'+
      '</div>'+
    '</article>';
  }).join("");
}
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
let otpAdminSession=false;
let otpAdminEmail="";
let otpRequestInProgress=false;
let adminLogoutLock=false;

const OTP_WORKER_URL="https://ssv-admin-otp.vinith-paithari.workers.dev";
const TRUSTED_ADMIN_EMAILS=new Set(["vinith.paithari@gmail.com"]);

function isTrustedAdminEmail(email){
  return TRUSTED_ADMIN_EMAILS.has(String(email||"").trim().toLowerCase());
}

function normalizeAdminEmail(email){
  return String(email||"").trim().toLowerCase();
}

function updateAdminView(){
  const loginSection=$("#login");
  const studioSection=$("#studio");
  const active=adminSessionActive===true;
  if(loginSection){
    loginSection.classList.toggle("hidden",active);
    loginSection.style.setProperty("display",active?"none":"block","important");
  }
  if(studioSection){
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
  el.textContent=message||"";
  el.classList.toggle("connected",!!connected);
  el.style.color=connected?"#10B981":"#78716C";
}
function resetOtpScreen(){
  const email=$("#adminEmail");
  const otp=$("#adminOtp");
  const send=$("#sendOtpBtn");
  const verify=$("#verifyOtpBtn");
  if(email){email.value="";email.disabled=false;}
  if(otp){otp.value="";otp.disabled=true;otp.style.display="none";}
  if(send){send.disabled=false;send.style.display="";}
  if(verify){verify.disabled=true;verify.style.display="none";}
  setStorageStatus("");
}
function showAdminLogin(){
  adminSessionActive=false;
  otpAdminSession=false;
  otpAdminEmail="";
  otpRequestInProgress=false;
  updateAdminView();
  const email=$("#adminEmail");
  const otp=$("#adminOtp");
  const send=$("#sendOtpBtn");
  const verify=$("#verifyOtpBtn");
  if(email){email.value="";email.disabled=false;email.focus();}
  if(otp){otp.value="";otp.disabled=true;otp.style.display="none";}
  if(send){send.disabled=false;send.style.display="";}
  if(verify){verify.disabled=true;verify.style.display="none";}
  if($("#adminAuthHeading"))$("#adminAuthHeading").textContent="Admin sign in";
  if($("#adminAuthDescription"))$("#adminAuthDescription").textContent="Enter your trusted email address to receive a one-time verification code.";
  if($("#forgotPassword"))$("#forgotPassword").style.display="none";
  setStorageStatus("");
}
async function callOtpWorker(action,email,otp=""){
  const response=await fetch(OTP_WORKER_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action,email,otp})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.success!==true) throw new Error(data.message||"OTP request failed.");
  return data;
}
async function requestAdminOtp(){
  if(otpRequestInProgress)return;
  const email=normalizeAdminEmail($("#adminEmail")?.value);
  if(!email){
    setStorageStatus("Enter your email address.");
    return;
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    setStorageStatus("Enter a valid email address.");
    return;
  }
  if(!isTrustedAdminEmail(email)){
    setStorageStatus("This email is not authorized for Admin access.");
    return;
  }
  otpRequestInProgress=true;
  const btn=$("#sendOtpBtn");
  if(btn){btn.disabled=true;btn.textContent="SENDING...";}
  try{
    await callOtpWorker("send",email);
    otpAdminEmail=email;
    const otp=$("#adminOtp");
    const verify=$("#verifyOtpBtn");
    if($("#adminEmail"))$("#adminEmail").disabled=true;
    if(otp){otp.value="";otp.disabled=false;otp.style.display="";otp.maxLength=6;otp.inputMode="numeric";otp.autocomplete="one-time-code";otp.focus();}
    if(btn)btn.style.display="none";
    if(verify){verify.disabled=false;verify.style.display="";verify.textContent="VERIFY OTP";}
    setStorageStatus("OTP sent. Check your email.",true);
  }catch(e){
    setStorageStatus(e?.message||"Could not send OTP.");
    if(btn){btn.disabled=false;btn.textContent="SEND OTP";}
  }finally{
    otpRequestInProgress=false;
  }
}
async function verifyAdminOtp(){
  const email=normalizeAdminEmail(otpAdminEmail||$("#adminEmail")?.value);
  const otp=String($("#adminOtp")?.value||"").replace(/\D/g,"");
  if(!isTrustedAdminEmail(email)){setStorageStatus("This email is not authorized for Admin access.");return false;}
  if(!/^\d{6}$/.test(otp)){setStorageStatus("Enter the 6-digit OTP.");return false;}
  const btn=$("#verifyOtpBtn");
  if(btn){btn.disabled=true;btn.textContent="VERIFYING...";}
  try{
    await callOtpWorker("verify",email,otp);
    const token=getSavedGithubToken();
    if(!token){
      throw new Error("OTP verified, but Admin storage is not connected on this device. Connect the GitHub Admin storage once, then use Email OTP.");
    }
    otpAdminSession=true;
    otpAdminEmail=email;
    adminSessionActive=true;
    adminPassword="";
    setStorageStatus("Signed in successfully.",true);
    if($("#adminOtp"))$("#adminOtp").value="";
    updateAdminView();
    showView("products");
    return true;
  }catch(e){
    otpAdminSession=false;
    adminSessionActive=false;
    setStorageStatus(e?.message||"OTP verification failed.");
    return false;
  }finally{
    if(btn){btn.disabled=false;btn.textContent="VERIFY OTP";}
  }
}
function logoutAdmin(){
  adminLogoutLock=true;
  adminSessionActive=false;
  otpAdminSession=false;
  otpAdminEmail="";
  closeAdminModal();
  resetOtpScreen();
  updateAdminView();
  window.setTimeout(()=>{adminLogoutLock=false;},300);
}

if(!window.__LIBAS_ADMIN_OTP_BOUND){
  window.__LIBAS_ADMIN_OTP_BOUND=true;
  document.addEventListener("click",async(e)=>{
    const admin=e.target.closest("#adminOpen");
    if(admin){
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      if(adminLogoutLock)return;
      lastAdminTrigger=admin;
      openAdminModal();
      showAdminLogin();
      return;
    }
    const close=e.target.closest("#adminClose");
    if(close){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();closeAdminModal();return;}
    const logout=e.target.closest("#logoutBtn");
    if(logout){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();logoutAdmin();return;}
    const send=e.target.closest("#sendOtpBtn");
    if(send){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();await requestAdminOtp();return;}
    const verify=e.target.closest("#verifyOtpBtn");
    if(verify){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();await verifyAdminOtp();return;}
  },true);
  document.addEventListener("keydown",(e)=>{
    if(e.key==="Escape"&&$("#admin")&&!$("#admin").classList.contains("hidden")){
      e.preventDefault();closeAdminModal();lastAdminTrigger?.focus?.();return;
    }
    trapAdminFocus(e);
  });
}
if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",updateAdminView,{once:true});
}else{
  updateAdminView();
}

all("[data-view]").forEach(b=>b.onclick=()=>showView(b.dataset.view));
document.addEventListener("click",async e=>{const t=e.target.closest("[data-tab]");if(t){category=t.dataset.tab;render()}const c=e.target.closest("[data-cat]");if(c){category=c.dataset.cat;$("#nav").classList.remove("open");render()}const eb=e.target.closest(".edit");if(eb)edit(Number(eb.dataset.id));if(e.target.id==="saveSettings"){
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
$("#search").oninput=render;$("#price").onchange=render;load();