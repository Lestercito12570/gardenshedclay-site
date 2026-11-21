(()=>{
"use strict";
const $=id=>document.getElementById(id);
const fields=["name","line1","line2","city","state","zip","country"];
const queue=[];
const panel=$("ship-label-queue");
if(!panel)return;
const status=$("ship-queue-status");
function addressFrom(source){
 const a=source.shippingAddress||source.address||{};
 return {name:source.name||"",line1:a.address1||"",line2:a.address2||"",city:a.city||"",state:a.state||"",zip:a.postalCode||"",country:a.country||"US"};
}
function complete(r){return !!(r.name&&r.line1&&r.city&&r.state&&r.zip);}
function escape(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function show(){panel.open=true;panel.scrollIntoView({block:"nearest",behavior:"smooth"});}
function render(){
 const body=$("ship-queue-items");body.replaceChildren();
 queue.forEach((item,i)=>{
  const row=document.createElement("div");row.style.cssText="border:1px solid #ddd;padding:12px;margin:8px 0";
  const header=document.createElement("div");header.textContent=(i+1)+". "+(item.source||"Manual")+" — "+(item.address.name||"Address needed");header.style.fontWeight="bold";row.append(header);
  const inputs=document.createElement("div");inputs.style.cssText="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:6px;margin:8px 0";
  fields.forEach(f=>{
   const input=document.createElement("input");input.setAttribute("aria-label",f);input.placeholder=f;input.value=item.address[f]||"";
   input.addEventListener("input",()=>{item.address[f]=input.value.trim();status.textContent="";});
   inputs.append(input);
  });row.append(inputs);
  const qty=document.createElement("input");qty.type="number";qty.min="1";qty.max="100";qty.value=item.copies;qty.style.width="70px";qty.setAttribute("aria-label","Number of copies");
  qty.addEventListener("change",()=>{item.copies=Number(qty.value);});
  const label=document.createElement("label");label.textContent="Copies ";label.append(qty);row.append(label);
  const remove=document.createElement("button");remove.type="button";remove.className="button";remove.textContent="Remove";remove.style.marginLeft="10px";remove.onclick=()=>{queue.splice(i,1);render();};row.append(remove);body.append(row);
 });
 const count=queue.reduce((sum,item)=>sum+(Number.isInteger(item.copies)?item.copies:0),0);
 $("ship-queue-count").textContent=count+" label(s) from "+queue.length+" recipient(s)";
}
window.gscAdd5815ToQueue=(source,origin="Order")=>{
 queue.push({source:origin,address:addressFrom(source),copies:1});render();show();
 status.textContent=complete(queue[queue.length-1].address)?"Added to queue. Verify address and quantity.":"Added to queue. Complete the missing address before exporting.";
};
$("ship-queue-add-manual").onclick=()=>window.gscAdd5815ToQueue({name:"",shippingAddress:{}},"Manual");
$("ship-queue-clear").onclick=()=>{if(queue.length&& !confirm("Clear all queued labels?"))return;queue.length=0;render();};
$("ship-queue-export").onclick=async()=>{
 const start=Number($("ship-queue-start").value);
 if(!Number.isInteger(start)||start<1||start>8){status.textContent="Choose a starting position from 1 to 8.";return;}
 if(!queue.length){status.textContent="Add a recipient first.";return;}
 if(queue.some(item=>!complete(item.address)||!Number.isInteger(item.copies)||item.copies<1||item.copies>100)){
  status.textContent="Complete all recipient addresses and use 1–100 copies per recipient.";return;
 }
 try{
  status.textContent="Preparing PDF…";
  const response=await fetch("/api/admin/avery-5815-queue.pdf",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({start,entries:queue})});
  if(!response.ok){const error=await response.json();throw Error(error.error||"PDF generation failed.");}
  const blob=await response.blob();
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");link.href=url;link.download="GardenShedClay_Avery5815.pdf";document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  status.textContent="PDF downloaded. Print at Actual Size / 100% and verify against plain paper before using label stock.";
 }catch(e){status.textContent=e.message;}
};
render();
})();