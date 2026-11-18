(()=>{
 const el=id=>document.getElementById(id),status=el("ship-label-feedback");
 const fields=["name","line1","line2","city","state","zip","country"];
 let customers=[];
 const select=el("ship-label-customer");
 async function load(){
  try{
   const r=await fetch("/api/admin/customers",{cache:"no-store"});
   if(!r.ok)throw Error("Customer list unavailable");
   const data=await r.json();
   customers=(data.customers||[]).filter(c=>c.status!=="inactive"&&c.name);
   customers.sort((a,b)=>a.name.localeCompare(b.name));
   for(let i=0;i<customers.length;i++){
    const option=document.createElement("option");option.value=String(i);option.textContent=customers[i].name;select.appendChild(option);
   }
  }catch(e){status.textContent="Existing customers unavailable; manual entry still works.";}
 }
 select.addEventListener("change",()=>{
  if(select.value==="")return;
  const c=customers[Number(select.value)],a=c.shippingAddress||{};
  const values=[c.name,a.address1,a.address2,a.city,a.state,a.postalCode,a.country||"US"];
  fields.forEach((f,i)=>el("ship-label-"+f).value=values[i]||"");
 });
 window.gscPrepare5815=function(customer){
  const panel=el("ship-label-generate").closest("details");
  if(panel)panel.open=true;
  const index=customers.findIndex(c=>c.customerId===customer.customerId);
  select.value=index>=0?String(index):"";
  const a=customer.shippingAddress||{};
  const values=[customer.name,a.address1,a.address2,a.city,a.state,a.postalCode,a.country||"US"];
  fields.forEach((f,i)=>el("ship-label-"+f).value=values[i]||"");
  el("ship-label-save-customer").checked=false;
  el("ship-label-start").value="1";
  el("ship-label-copies").value="1";
  status.textContent="Selected "+customer.name+". Choose your logo image, then open one printable label.";
  el("ship-label-generate").scrollIntoView({behavior:"smooth",block:"center"});
 };
 window.gscPrepareOrder5815=function(recipient){
  const panel=el("ship-label-generate").closest("details");if(panel)panel.open=true;
  select.value="";
  const a=recipient.address;
  const values=[recipient.name,a.address1,a.address2,a.city,a.state,a.postalCode,a.country||"US"];
  fields.forEach((f,i)=>el("ship-label-"+f).value=values[i]||"");
  el("ship-label-save-customer").checked=false;
  el("ship-label-start").value="1";el("ship-label-copies").value="1";
  status.textContent="Order shipping address loaded. Select logo, verify address, and print one label.";
  el("ship-label-generate").scrollIntoView({behavior:"smooth",block:"center"});
 };
 const htmlEscape=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 el("ship-label-generate").addEventListener("click",async()=>{
  const values=fields.map(f=>el("ship-label-"+f).value.trim());
  const [name,line1,line2,city,state,zip,country]=values;
  const start=Number(el("ship-label-start").value),copies=Number(el("ship-label-copies").value);
  if(!name||!line1||!city||!state||!zip){status.textContent="Enter recipient name, street, city, state and postal code.";return;}
  if(!Number.isInteger(start)||start<1||start>8||!Number.isInteger(copies)||copies<1||copies>100){status.textContent="Start must be 1–8; copies must be 1–100.";return;}
  const file=el("ship-label-logo").files[0];
  if(!file||!["image/png","image/jpeg","image/webp"].includes(file.type)){status.textContent="Select your supplied Garden Shed Clay logo image (PNG, JPEG or WebP).";return;}
  if(file.size>4000000){status.textContent="Logo must be under 4 MB.";return;}
  if(el("ship-label-save-customer").checked){
   if(select.value!==""){status.textContent="This address belongs to a selected customer. Uncheck Save as new customer to print without changing the customer list.";return;}
   if(!window.confirm("Save this recipient as a new customer before printing? Promotional mailing will remain disabled."))return;
   const payload={name,email:"",phone:"",notes:"Saved from Avery 5815 shipping label",address1:line1,address2:line2,city,state,postalCode:zip,country:country||"US",mailingEligible:false};
   try{
    const response=await fetch("/api/admin/customers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if(!response.ok){const error=await response.json();throw Error(error.error||"Unable to save customer.");}
    el("ship-label-save-customer").checked=false;
    status.textContent="Customer saved. Preparing label.";
    select.replaceChildren(new Option("Enter an address manually",""));await load();
   }catch(e){status.textContent=e.message;return;}
  }
  const popup=window.open("","_blank");
  if(!popup){status.textContent="Allow popups to open the printable sheet.";return;}
  const reader=new FileReader();
  reader.onerror=()=>{popup.close();status.textContent="Unable to read logo.";};
  reader.onload=()=>{
   const lines=[name,line1,line2,city+", "+state+" "+zip,country&& !["US","USA","UNITED STATES"].includes(country.toUpperCase())?country:""].filter(Boolean);
   const blocks=[];
   for(let i=0;i<start-1+copies;i++){
    if(i<start-1){blocks.push('<div class="label"></div>');continue;}
    blocks.push('<div class="label"><img class="logo" alt="" src="'+reader.result+'"><div class="recipient">'+lines.map((v,j)=>'<div'+(j===0?' class="name"':'')+'>'+htmlEscape(v)+'</div>').join("")+'</div></div>');
   }
   const pages=[];
   for(let i=0;i<blocks.length;i+=8){
    const group=blocks.slice(i,i+8);
    while(group.length<8)group.push('<div class="label"></div>');
    pages.push('<section class="sheet">'+group.join("")+'</section>');
   }
   const doc='<!doctype html><html><head><meta charset="utf-8"><title>Garden Shed Clay — Avery 5815</title><style>'+
    '@page{size:letter;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:white;color:black;font-family:"Times New Roman",Times,serif}'+
    '.sheet{width:8.5in;height:11in;padding:.5in .25in;display:grid;grid-template-columns:4in 4in;grid-template-rows:repeat(4,2.5in);break-after:page;page-break-after:always}'+
    '.sheet:last-child{break-after:auto;page-break-after:auto}.label{width:4in;height:2.5in;overflow:hidden;padding:.12in .20in;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start}'+
    '.logo{width:78%;height:.80in;align-self:center;object-fit:contain;object-position:center top}.recipient{font-size:13pt;line-height:1.2;margin-top:.10in;padding-top:.09in;border-top:1px solid #222;overflow-wrap:anywhere}.recipient .name{font-weight:normal;font-size:14pt}'+
    '@media screen{body{background:#ddd}.sheet{margin:18px auto;background:white;box-shadow:0 1px 8px #aaa}}'+
    '</style></head><body>'+pages.join("")+'</body></html>';
   popup.document.open();popup.document.write(doc);popup.document.close();
   status.textContent="Printable labels opened. Use Print → Save as PDF or print at 100%, US Letter, no margins or scaling.";
  };
  reader.readAsDataURL(file);
 });
 load();
})();