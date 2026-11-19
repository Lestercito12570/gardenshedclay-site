import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";

const asset=name=>path.join(process.cwd(),"assets","avery5815",name);
const assets={logo:asset("logo.jpg"),regular:asset("EBGaramond12-Regular.ttf"),bold:asset("EBGaramond12-Bold.ttf")};
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
  const missing=Object.entries(assets).filter(([,p])=>!fs.existsSync(p)).map(([name])=>name);
  if(missing.length)return res.status(503).json({error:"Approved label artwork/font assets are not installed: "+missing.join(", ")+". PDF export is unavailable."});
  try{
   const doc=new PDFDocument({size:"LETTER",margin:0,autoFirstPage:false,compress:true});
   res.setHeader("Content-Type","application/pdf");
   res.setHeader("Content-Disposition",'attachment; filename="GardenShedClay_Avery5815.pdf"');
   doc.on("error",err=>{console.error("Avery 5815 PDF failed:",err);res.destroy(err);});
   doc.pipe(res);
   doc.registerFont("EB",assets.regular);doc.registerFont("EBBold",assets.bold);
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
     const fontSize=text.length<=4?16.5:15.5,leading=text.length<=4?19:17.6;
     // PDFKit uses top-down text coordinates; adjust baseline relative to approved ReportLab v3.
     const firstTop=divider+22-fontSize*.88;
     text.forEach((line,i)=>{
      const font=i===0?"EBBold":"EB";
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
