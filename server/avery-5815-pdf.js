import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

const asset=name=>path.join(process.cwd(),"assets","avery5815",name);
// The approved artwork and embedded Garamond font are distributed together in the uploaded ZIP.
let cachedAssets;
function loadAssets(){
 if(cachedAssets)return cachedAssets;
 const zipPath=path.join(process.cwd(),"GSC_Avery_5815_website_assets.zip");
 if(!fs.existsSync(zipPath))throw Error("Approved Avery 5815 assets ZIP is missing.");
 const entries=unzipSync(fs.readFileSync(zipPath));
 const names=Object.keys(entries);
 const logoName=names.find(n=>/(^|\\/)logo\\.(png|jpg|jpeg)$/i.test(n));
 const fontName=names.find(n=>/(^|\\/)EBGaramond12-Regular\\.ttf$/i.test(n));
 if(!logoName||!fontName)throw Error("Approved Avery 5815 ZIP is missing logo.png or EBGaramond12-Regular.ttf.");
 cachedAssets={logo:Buffer.from(entries[logoName]),regular:Buffer.from(entries[fontName])};
 return cachedAssets;
}
const clean=s=>typeof s==="string"?s.trim():"";
const valid=(r)=>r&&["name","line1","city","state","zip"].every(k=>clean(r[k]))&&["name","line1","line2","city","state","zip","country"].every(k=>!r[k]||typeof r[k]==="string"&&r[k].length<=150);
export function registerAvery5815Pdf(app,requireAdmin){
 app.post("/api/admin/avery-5815-queue.pdf",requireAdmin,(req,res)=>{
  const {entries,start}=req.body||{};
  if(!Array.isArray(entries)||!entries.length||entries.length>100||!Number.isInteger(start)||start<1||start>8||entries.some(e=>!valid(e.address)||!Number.isInteger(e.copies)||e.copies<1||e.copies>100)){
   return res.status(400).json({error:"Complete every address, use 1–100 copies per recipient, and choose starting position 1–8."});
  }
  const count=entries.reduce((n,e)=>n+e.copies,0);
  if(count>400)return res.status(400).json({error:"Maximum 400 labels per PDF."});
  let assets;
  try{assets=loadAssets();}catch(err){console.error("Avery 5815 asset error:",err);return res.status(503).json({error:"Approved label assets unavailable: "+err.message});}
  try{
   const doc=new PDFDocument({size:"LETTER",margin:0,autoFirstPage:false,compress:true});
   res.setHeader("Content-Type","application/pdf");
   res.setHeader("Content-Disposition",'attachment; filename="GardenShedClay_Avery5815.pdf"');
   doc.on("error",err=>{console.error("Avery 5815 PDF failed:",err);res.destroy(err);});
   doc.pipe(res);
   doc.registerFont("EB",assets.regular);
   const labels=[];
   for(const e of entries)for(let i=0;i<e.copies;i++)labels.push(e.address);
   const pageCount=Math.ceil((start-1+labels.length)/8);
   for(let page=0;page<pageCount;page++){
    doc.addPage();
    for(let slot=0;slot<8;slot++){
     const index=page*8+slot-(start-1);
     if(index<0||index>=labels.length)continue;
     const a=labels[index],lines=[clean(a.name),clean(a.line1),clean(a.line2),[clean(a.city),clean(a.state)].filter(Boolean).join(", ")+" "+clean(a.zip)];
     if(clean(a.country)&&!["US","USA","UNITED STATES"].includes(clean(a.country).toUpperCase()))lines.push(clean(a.country));
     const text=lines.filter(Boolean);
     const x=18+(slot%2)*288,y=36+Math.floor(slot/2)*180;
     const logoW=94;
     // Image ratio is measured by PDFKit, preserving the approved v3 geometry.
     const img=doc.openImage(assets.logo),logoH=logoW*img.height/img.width;
     doc.image(img,x+(288-logoW)/2,y+9,{width:logoW});
     const divider=y+9+logoH+9;
     doc.save().lineWidth(.55).strokeColor("#000000").moveTo(x+24,divider).lineTo(x+264,divider).stroke().restore();
     const fontSize=text.length<=4?17.5:15.5,leading=text.length<=4?20:17.6;
     // PDFKit uses top-down text coordinates; adjust baseline relative to approved ReportLab v3.
     const firstTop=divider+22-fontSize*.88;
     text.forEach((line,i)=>{
      const font="EB";
      doc.font(font).fontSize(fontSize).fillColor("#000000");
      // Shrink unusually long lines to stay within the safe 238pt text width.
      const width=doc.widthOfString(line);
      const actualSize=width>238?fontSize*238/width:fontSize;
      doc.fontSize(actualSize).text(line,x+25,firstTop+i*leading,{lineBreak:false,width:238,characterSpacing:0});
     });
    }
   }
   doc.end();
  }catch(err){console.error("Avery 5815 generation error:",err);if(!res.headersSent)res.status(500).json({error:"Unable to generate PDF."});else res.destroy(err);}
 });
}
