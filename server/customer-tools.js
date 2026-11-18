import crypto from "node:crypto";
const key=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const headers=token=>({Accept:"application/vnd.github+json",Authorization:"Bearer "+token,"X-GitHub-Api-Version":"2022-11-28","User-Agent":"garden-shed-clay-admin"});
export function registerCustomerTools(app,requireAdmin,{owner,repo,branch,path}){
 const url="https://api.github.com/repos/"+owner+"/"+repo+"/contents/"+path;
 async function load(){
  const token=process.env.GITHUB_TOKEN;if(!token)throw Error("GitHub access unavailable");
  const h=headers(token),r=await fetch(url+"?ref="+branch,{headers:h});
  if(!r.ok)throw Error("Unable to read customers");
  const file=await r.json(),data=JSON.parse(Buffer.from(file.content,"base64").toString("utf8"));
  if(!Array.isArray(data.customers))throw Error("Invalid customer data");
  return {h,file,data};
 }
 app.post("/api/admin/customers/import-etsy",requireAdmin,async(req,res)=>{
  const entries=req.body?.customers;
  if(!Array.isArray(entries)||!entries.length||entries.length>500||
    entries.some(c=>!c||!["name","address1","address2","city","state","postalCode","country"].every(f=>typeof c[f]==="string"&&c[f].length<=200)||
     !c.name.trim()||!c.address1.trim()||!c.city.trim()||!c.postalCode.trim()))
    return res.status(400).json({error:"Invalid customer import"});
  try{
   const {h,file,data}=await load();
   const known=new Set(data.customers.map(c=>key(c.name)).filter(Boolean)),add=[];
   const deleted=new Set(Array.isArray(data.deletedCustomerNameHashes)?data.deletedCustomerNameHashes:[]);
   const hashName=name=>crypto.createHash("sha256").update(key(name)).digest("hex");
   for(const raw of entries){
    const c=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,String(v).trim()]));
    if(known.has(key(c.name))||deleted.has(hashName(c.name)))continue;known.add(key(c.name));
    const now=new Date().toISOString();
    add.push({customerId:"etsy-import-"+crypto.randomUUID(),name:c.name,email:"",phone:"",
     shippingAddress:{address1:c.address1,address2:c.address2,city:c.city,state:c.state,postalCode:c.postalCode,country:c.country||"US"},
     sources:["Etsy"],sales:[],notes:"Etsy import; mailing consent unconfirmed",status:"active",mailingEligible:false,createdAt:now,updatedAt:now});
   }
   if(!add.length)return res.json({added:0,skipped:entries.length});
   data.customers.push(...add);
   const write=await fetch(url,{method:"PUT",headers:{...h,"Content-Type":"application/json"},
    body:JSON.stringify({message:"Import approved Etsy customers",sha:file.sha,branch,
     content:Buffer.from(JSON.stringify(data,null,2)+"\n").toString("base64")})});
   if([409,422].includes(write.status))return res.status(409).json({error:"Customer list changed; preview again"});
   if(!write.ok)throw Error("GitHub write failed");
   return res.json({added:add.length,skipped:entries.length-add.length});
  }catch(e){console.error("Customer import failed",e);return res.status(500).json({error:"Customer import failed"});}
 });
 const averyPdfHandler=async(req,res)=>{
  const requested=req.method==="POST"?req.body?.customerIds:null;
  if(req.method==="POST"&&(!Array.isArray(requested)||!requested.length||requested.length>500||requested.some(id=>typeof id!=="string"||id.length>200)||new Set(requested).size!==requested.length))return res.status(400).json({error:"Select 1–500 unique customers"});
  const selected=requested?new Set(requested):null;
  const start=Number(req.query.start||1);
  if(!Number.isInteger(start)||start<1||start>30)return res.status(400).json({error:"Start label must be 1–30"});
  try{
   const {data}=await load(),seen=new Set(),labels=[];
   for(const c of data.customers){
    if(selected&&!selected.has(c.customerId))continue;
    const a=c.shippingAddress||{};
    if(c.status==="inactive"||(!selected&&c.mailingEligible===false)||!c.name?.trim()||!a.address1?.trim()||!a.city?.trim()||!a.state?.trim()||!a.postalCode?.trim())continue;
    const id=[c.name,a.address1,a.address2,a.city,a.state,a.postalCode].map(key).join("|");
    if(seen.has(id))continue;seen.add(id);
    labels.push([c.name,a.address1,a.address2,a.city+", "+a.state+" "+a.postalCode,
      ["US","USA","UNITED STATES"].includes(String(a.country||"US").toUpperCase())?"":a.country].filter(Boolean));
   }
   if(!labels.length)return res.status(422).json({error:"No eligible complete addresses"});
   if(selected&&labels.length!==selected.size)return res.status(422).json({error:"Some selected customers are inactive, missing, duplicates, or have incomplete addresses. Review selection."});
   const escape=v=>String(v).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\x20-\x7e]/g,"?").replace(/[\\()]/g,"\\$&");
   const pages=[];let i=0;
   while(i<labels.length){
    let stream="";
    for(let slot=pages.length?0:start-1;slot<30&&i<labels.length;slot++){
     const x=20.5+(slot%3)*198,y=756-Math.floor(slot/3)*72;
     const lines=labels[i++],size=lines.some(l=>l.length>35)?8:9;
     lines.slice(0,5).forEach((line,n)=>{
      stream+="BT /F1 "+size+" Tf 1 0 0 1 "+x+" "+(y-16-n*11)+" Tm ("+escape(line.slice(0,42))+") Tj ET\n";
     });
    }pages.push(stream);
   }
   const objects=[null,"<< /Type /Catalog /Pages 2 0 R >>",null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"],kids=[];
   for(const stream of pages){
    const id=objects.length;kids.push(id+" 0 R");
    objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents "+(id+1)+" 0 R >>");
    objects.push("<< /Length "+Buffer.byteLength(stream,"ascii")+" >>\nstream\n"+stream+"endstream");
   }
   objects[2]="<< /Type /Pages /Kids ["+kids.join(" ")+"] /Count "+pages.length+" >>";
   let pdf="%PDF-1.4\n";const offsets=[0];
   for(let n=1;n<objects.length;n++){offsets[n]=Buffer.byteLength(pdf,"ascii");pdf+=n+" 0 obj\n"+objects[n]+"\nendobj\n";}
   const xref=Buffer.byteLength(pdf,"ascii");pdf+="xref\n0 "+objects.length+"\n0000000000 65535 f \n";
   for(let n=1;n<objects.length;n++)pdf+=String(offsets[n]).padStart(10,"0")+" 00000 n \n";
   pdf+="trailer\n<< /Size "+objects.length+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF";
   res.set("Content-Type","application/pdf");res.set("Cache-Control","no-store");
   res.set("Content-Disposition",'attachment; filename="garden-shed-clay-avery-5160.pdf"');
   return res.send(Buffer.from(pdf,"ascii"));
  }catch(e){console.error("Avery PDF failed",e);return res.status(500).json({error:"Unable to generate PDF"});}
 });
}
