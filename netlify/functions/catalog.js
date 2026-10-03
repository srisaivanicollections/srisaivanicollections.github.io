const API = "https://api.github.com";
const REPO = process.env.GITHUB_REPO || "vinith1111/premium_saree_website_libas";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PRODUCTS_PATH = "data/products.json";
const SETTINGS_PATH = "data/settings.json";

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28"
};

async function gh(path, options={}) {
  const res = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...(options.headers||{}) }});
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(data?.message || "GitHub request failed");
  return data;
}

async function readJson(path, fallback) {
  const data = await gh(`/repos/${REPO}/contents/${path}?ref=${encodeURIComponent(BRANCH)}`);
  const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
  return { value: JSON.parse(content), sha: data.sha };
}

async function writeJson(path, value, sha, message) {
  const content = Buffer.from(JSON.stringify(value, null, 2)).toString("base64");
  return gh(`/repos/${REPO}/contents/${path}`, {
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({message,content,sha,branch:BRANCH})
  });
}

function json(status, body) {
  return { statusCode:status, headers:{"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"}, body:JSON.stringify(body) };
}

exports.handler = async (event) => {
  try {
    if (!TOKEN) return json(500,{error:"GitHub storage is not configured."});
    if (event.httpMethod === "OPTIONS") return {statusCode:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"GET,POST"}};
    if (event.httpMethod === "GET") {
      const [p,s] = await Promise.all([
        readJson(PRODUCTS_PATH,[]),
        readJson(SETTINGS_PATH,{name:"SRI SAI VANI",whatsapp:"919999999999",instagram:"https://www.instagram.com/sri_sai_vani_collections/"})
      ]);
      return json(200,{products:p.value,settings:s.value});
    }
    if (event.httpMethod !== "POST") return json(405,{error:"Method not allowed"});
    const body=JSON.parse(event.body||"{}");
    if (!ADMIN_PASSWORD || body.password !== ADMIN_PASSWORD) return json(401,{error:"Unauthorized"});
    
    if(body.action==="authenticate") return json(200,{ok:true});
    if(body.action==="saveProducts"){
      const current=await readJson(PRODUCTS_PATH,[]);
      await writeJson(PRODUCTS_PATH,body.products,current.sha,"Update product catalogue");
      return json(200,{ok:true});
    }
    if(body.action==="saveSettings"){
      const current=await readJson(SETTINGS_PATH,{});
      await writeJson(SETTINGS_PATH,body.settings,current.sha,"Update shop settings");
      return json(200,{ok:true});
    }
    if(body.action==="uploadImage"){
      const safe=String(body.filename||"product.jpg").replace(/[^a-zA-Z0-9._-]/g,"-");
      const path=`public/products/${Date.now()}-${safe}`;
      const content=String(body.base64||"").replace(/^data:[^;]+;base64,/,"");
      if(!content) return json(400,{error:"Image data missing"});
      const result=await gh(`/repos/${REPO}/contents/${path}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"Add product image",content,branch:BRANCH})});
      return json(200,{ok:true,path,sha:result.content.sha});
    }
    return json(400,{error:"Unknown action"});
  } catch(e) {
    return json(500,{error:e.message||"Server error"});
  }
};