export function weddingInstant(config) {
  if (!config?.date || !config?.ceremonyTime) return null;
  const wall=Date.parse(`${config.date}T${config.ceremonyTime}:00Z`);
  if (!Number.isFinite(wall)) return null;
  let result=wall;
  const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:config.timezone||'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++) {
    const p=Object.fromEntries(formatter.formatToParts(new Date(result)).map(x=>[x.type,x.value]));
    result+=wall-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
  }
  return new Date(result);
}
export function countdownParts(target,now=Date.now()) {
  if (!target || !Number.isFinite(target.getTime())) return null;
  const remaining=Math.max(0,target.getTime()-now);
  const seconds=Math.floor(remaining/1000);
  return {days:Math.floor(seconds/86400),hours:Math.floor(seconds/3600)%24,minutes:Math.floor(seconds/60)%60,seconds:seconds%60,started:target.getTime()<=now};
}
