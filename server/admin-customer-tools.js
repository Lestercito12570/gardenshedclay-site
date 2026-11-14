(()=>{
 const $=id=>document.getElementById(id),file=$("customer-etsy-file"),status=$("customer-etsy-status"),list=$("customer-etsy-list"),save=$("customer-etsy-save");
 let candidates=[];
 const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
 function parse(text){
  let rows=[],row=[],value="",quoted=false;
  for(let i=0;i<text.length;i++){
   const c=text[i];
   if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
   else if(c===","&&!quoted){row.push(value);value="";}
   else if((c==="\n"||c==="\r")&&!quoted){if(c==="\r"&&text[i+1]==="\n")i++;row.push(value);value="";if(row.some(x=>x.trim()))rows.push(row);row=[];}
   else value+=c;
  }
  if(quoted)throw Error("Unclosed CSV quotation");
  row.push(value);if(row.some(x=>x.trim()))rows.push(row);return rows;
 }
 $("customer-etsy-preview").addEventListener("click",async()=>{
  candidates=[];save.hidden=true;list.replaceChildren();
  if(!file.files.length){status.textContent="Choose a CSV first.";return;}
  if(file.files[0].size>3000000){status.textContent="CSV must be under 3 MB.";return;}
  try{
   const rows=parse((await file.files[0].text()).replace(/^\uFEFF/,""));
   if(rows.length<2)throw Error("No orders found.");
   const head=rows.shift().map(v=>v.trim().toLowerCase());
   const col=name=>head.indexOf(name.toLowerCase());
   for(const name of ["Full Name","Street 1","Ship City","Ship State","Ship Zipcode","Ship Country"])
    if(col(name)<0)throw Error("Missing Etsy column: "+name);
   const response=await fetch("/api/admin/customers",{cache:"no-store"});
   if(!response.ok)throw Error("Unable to load master customers.");
   const data=await response.json(),known=new Set((data.customers||[]).map(c=>norm(c.name)));
   let repeated=0,incomplete=0;
   for(const row of rows){
    const get=name=>col(name)<0?"":String(row[col(name)]||"").trim();
    const c={name:get("Full Name"),address1:get("Street 1"),address2:get("Street 2"),
     city:get("Ship City"),state:get("Ship State"),postalCode:get("Ship Zipcode"),country:get("Ship Country")||"US"};
    if(!c.name)continue;
    const k=norm(c.name);
    if(known.has(k)){repeated++;continue;}
    if(!c.address1||!c.city||!c.postalCode){incomplete++;continue;}
    known.add(k);candidates.push(c);
   }
   status.textContent=candidates.length+" new; "+repeated+" existing/repeat skipped; "+incomplete+" incomplete skipped. Imported customers are not opted into promotional mail.";
   for(const c of candidates){const p=document.createElement("p");p.textContent=[c.name,c.address1,c.address2,c.city,c.state,c.postalCode].filter(Boolean).join(" · ");list.appendChild(p);}
   save.hidden=!candidates.length;
  }catch(e){status.textContent=e.message;}
 });
 file.addEventListener("change",()=>{candidates=[];save.hidden=true;list.replaceChildren();status.textContent="";});
 save.addEventListener("click",async()=>{
  if(!candidates.length||!confirm("Add "+candidates.length+" new customers?"))return;
  save.disabled=true;
  try{
   let added=0,skipped=0;
   for(let i=0;i<candidates.length;i+=500){
    const response=await fetch("/api/admin/customers/import-etsy",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({customers:candidates.slice(i,i+500)})});
    const data=await response.json();if(!response.ok)throw Error(data.error||"Import failed.");
    added+=data.added;skipped+=data.skipped;
   }
   status.textContent=added+" added, "+skipped+" skipped. Reload customers to view.";
   candidates=[];save.hidden=true;list.replaceChildren();
  }catch(e){status.textContent=e.message;}finally{save.disabled=false;}
 });
 $("customer-label-download").addEventListener("click",async()=>{
  const status=$("customer-label-status"),start=Number($("customer-label-start").value);
  if(!Number.isInteger(start)||start<1||start>30){status.textContent="Choose 1–30.";return;}
  status.textContent="Generating...";
  try{
   const response=await fetch("/api/admin/customers/avery-labels.pdf?start="+start,{cache:"no-store"});
   if(!response.ok){const e=await response.json();throw Error(e.error||"PDF failed.");}
   const url=URL.createObjectURL(await response.blob()),a=document.createElement("a");
   a.href=url;a.download="garden-shed-clay-avery-5160.pdf";document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),2000);status.textContent="Downloaded. Print at 100% / Actual Size.";
  }catch(e){status.textContent=e.message;}
 });
})();