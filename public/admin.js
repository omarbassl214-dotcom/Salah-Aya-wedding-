const $=selector=>document.querySelector(selector);
const number=value=>new Intl.NumberFormat('ar-JO').format(value);
let loading=false;
function showError(message){$('#dashboard-error').textContent=message;$('#dashboard-error').hidden=!message;}
async function load(){
 if(loading)return;loading=true;$('#refresh').disabled=true;
 try{const response=await fetch('/api/admin/counts',{cache:'no-store'});const counts=await response.json();if(!response.ok)throw Error(counts.error||'تعذر تحديث العدد. حاول مجددًا.');$('#stat-confirmed').textContent=number(counts.yes);$('#stat-declined').textContent=number(counts.no);$('#last-updated').textContent='آخر تحديث: '+new Intl.DateTimeFormat('ar-JO',{hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date());showError('');}
 catch(error){showError(error.message||'تعذر الاتصال. حاول مجددًا.');}
 finally{loading=false;$('#refresh').disabled=false;}
}
$('#refresh').addEventListener('click',load);
load();setInterval(()=>{if(!document.hidden)load();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
