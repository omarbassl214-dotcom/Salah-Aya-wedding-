const $=selector=>document.querySelector(selector);
const number=value=>new Intl.NumberFormat('ar-JO').format(value);
let loading=false;
function showError(message){$('#dashboard-error').textContent=message;$('#dashboard-error').hidden=!message;}

function formatTime(isoStr){
  if(!isoStr)return '—';
  try{
    const d=new Date(isoStr);
    return new Intl.DateTimeFormat('ar-JO',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'}).format(d);
  }catch(e){return '—';}
}

function renderComments(comments){
  const tbody=$('#comments-tbody');
  const countBadge=$('#comments-count');
  const noComments=$('#no-comments');
  const tableContainer=$('#comments-table-container');
  if(!tbody||!countBadge)return;
  countBadge.textContent=number(comments?comments.length:0);
  if(!comments||comments.length===0){
    tbody.innerHTML='';
    if(tableContainer)tableContainer.hidden=true;
    if(noComments)noComments.hidden=false;
    return;
  }
  if(tableContainer)tableContainer.hidden=false;
  if(noComments)noComments.hidden=true;
  tbody.innerHTML='';
  for(const c of comments){
    const tr=document.createElement('tr');
    
    const tdStatus=document.createElement('td');
    tdStatus.className='cell-status';
    const tag=document.createElement('span');
    tag.className=c.attending?'badge-tag tag-yes':'badge-tag tag-no';
    tag.textContent=c.attending?'✓ سيحضر':'− اعتذر';
    tdStatus.appendChild(tag);
    tr.appendChild(tdStatus);

    const tdParty=document.createElement('td');
    tdParty.className='cell-party';
    if(!c.attending)tdParty.textContent='—';
    else if(c.companions>0)tdParty.textContent=`+ ${number(c.companions)}`;
    else tdParty.textContent='فردي';
    tr.appendChild(tdParty);

    const tdNote=document.createElement('td');
    tdNote.className='cell-note';
    const p=document.createElement('p');
    p.className='comment-text';
    p.textContent=c.note||'';
    tdNote.appendChild(p);
    tr.appendChild(tdNote);

    const tdTime=document.createElement('td');
    tdTime.className='cell-time';
    tdTime.textContent=formatTime(c.updated_at||c.created_at);
    tr.appendChild(tdTime);

    tbody.appendChild(tr);
  }
}

async function load(){
  if(loading)return;loading=true;$('#refresh').disabled=true;
  try{
    const [countsRes,commentsRes]=await Promise.all([
      fetch('/api/admin/counts',{cache:'no-store'}),
      fetch('/api/admin/comments',{cache:'no-store'}).catch(()=>null)
    ]);
    const counts=await countsRes.json();
    if(!countsRes.ok)throw Error(counts.error||'تعذر تحديث العدد. حاول مجددًا.');
    $('#stat-confirmed').textContent=number(counts.yes);
    $('#stat-declined').textContent=number(counts.no);

    if(commentsRes&&commentsRes.ok){
      const data=await commentsRes.json();
      renderComments(data.comments||[]);
    }

    $('#last-updated').textContent='آخر تحديث: '+new Intl.DateTimeFormat('ar-JO',{hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date());
    showError('');
  }
  catch(error){showError(error.message||'تعذر الاتصال. حاول مجددًا.');}
  finally{loading=false;$('#refresh').disabled=false;}
}

$('#refresh').addEventListener('click',load);
$('#reset-button')?.addEventListener('click',async()=>{
  if(!confirm('هل أنت متأكد من تصفير العداد ومسح جميع ردود الاختبار؟'))return;
  const btn=$('#reset-button');btn.disabled=true;
  try{
    const res=await fetch('/api/admin/reset',{method:'POST'});
    const data=await res.json();
    if(!res.ok)throw Error(data.error||'تعذر تصفير العداد.');
    await load();
    alert('تم تصفير العداد بنجاح!');
  }catch(e){showError(e.message);}
  finally{btn.disabled=false;}
});

load();setInterval(()=>{if(!document.hidden)load();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
