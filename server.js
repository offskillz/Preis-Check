const express=require("express");
const multer=require("multer");
const fs=require("fs");
const path=require("path");
const app=express();
const upload=multer({dest:"uploads/",limits:{fileSize:10*1024*1024}});
app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname,"public")));

app.get("/api/health",(req,res)=>res.json({ok:true,service:"PreisCheck",livePricesConfigured:Boolean(process.env.AMAZON_CLIENT_ID)}));

app.post("/api/analyze-image",upload.single("image"),async(req,res)=>{
 if(!req.file)return res.status(400).json({error:"Kein Bild erhalten."});
 if(!process.env.OPENAI_API_KEY){try{fs.unlinkSync(req.file.path)}catch{}return res.status(503).json({error:"KI ist noch nicht konfiguriert. OPENAI_API_KEY auf dem Server setzen."})}
 try{
  const b64=fs.readFileSync(req.file.path).toString("base64"), mime=req.file.mimetype||"image/jpeg";
  const api=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.OPENAI_API_KEY},
   body:JSON.stringify({model:process.env.OPENAI_VISION_MODEL||"gpt-4.1-mini",input:[{role:"user",content:[
    {type:"input_text",text:"Identifiziere das Produkt. Antworte ausschließlich mit JSON: {brand,model,variant,ean_or_gtin_if_visible,confidence}. Nutze null wenn unbekannt."},
    {type:"input_image",image_url:`data:${mime};base64,${b64}`}
   ]}]})});
  const data=await api.json();try{fs.unlinkSync(req.file.path)}catch{}
  if(!api.ok)return res.status(502).json({error:"KI-Anbieter hat einen Fehler zurückgegeben."});
  let out=data.output_text||"";
  try{out=JSON.parse(out)}catch{}
  res.json(out);
 }catch(e){try{fs.unlinkSync(req.file.path)}catch{}res.status(500).json({error:"KI-Anfrage fehlgeschlagen."})}
});

/* Amazon Creators API: server-side scaffold. Credentials NEVER go into frontend. */
let amazonToken={value:null,expires:0};
async function getAmazonToken(){
 const now=Date.now();
 if(amazonToken.value && amazonToken.expires>now+60000)return amazonToken.value;
 const endpoint=process.env.AMAZON_TOKEN_URL||"https://api.amazon.co.uk/auth/o2/token";
 const body={grant_type:"client_credentials",client_id:process.env.AMAZON_CLIENT_ID,client_secret:process.env.AMAZON_CLIENT_SECRET,scope:"creatorsapi::default"};
 const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 if(!r.ok)throw new Error("Amazon Auth fehlgeschlagen");
 const j=await r.json();amazonToken={value:j.access_token,expires:now+(j.expires_in||3600)*1000};return amazonToken.value;
}
app.get("/api/amazon/search",async(req,res)=>{
 const q=String(req.query.q||"").trim();
 if(!q)return res.status(400).json({error:"Suchbegriff fehlt."});
 if(!process.env.AMAZON_CLIENT_ID)return res.status(503).json({live:false,message:"Amazon Creators API noch nicht konfiguriert."});
 try{
  const token=await getAmazonToken();
  const r=await fetch("https://creatorsapi.amazon/catalog/v1/searchItems",{method:"POST",
   headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json","x-marketplace":process.env.AMAZON_MARKETPLACE||"www.amazon.de"},
   body:JSON.stringify({keywords:q,marketplace:process.env.AMAZON_MARKETPLACE||"www.amazon.de",partnerTag:process.env.AMAZON_PARTNER_TAG,resources:["images.primary.large","itemInfo.title","itemInfo.byLineInfo","offersV2.listings"]})});
  const j=await r.json();res.status(r.ok?200:502).json(j);
 }catch(e){res.status(502).json({error:"Amazon-Abfrage fehlgeschlagen."})}
});

app.get("/api/prices",async(req,res)=>{
 const q=String(req.query.q||"").trim();
 if(!q)return res.status(400).json({error:"Produkt fehlt."});
 if(!process.env.AMAZON_CLIENT_ID)return res.status(503).json({live:false,message:"Noch kein Live-Preisprovider konfiguriert. Keine erfundenen Preise."});
 res.status(501).json({live:false,message:"Provider-Orchestrierung ist vorbereitet; weitere Händler werden nach Zugang ergänzt."});
});

app.listen(process.env.PORT||3000,()=>console.log("PreisCheck Server gestartet"));
