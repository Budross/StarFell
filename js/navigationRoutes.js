// Pure graph utility. Costs and legality come from the caller's domain quotes.
export function planRoute(origin,target,neighbors,quoteLeg) {
  const queue=[{area:origin,path:[],fuel:0,duration:0}], settled=new Set();
  const compare=(a,b)=>a.fuel-b.fuel || a.duration-b.duration || a.path.join('/').localeCompare(b.path.join('/'));
  while(queue.length) {
    queue.sort(compare); const next=queue.shift();
    if(settled.has(next.area)) continue;
    if(next.area===target) return next;
    settled.add(next.area);
    for(const area of [...neighbors(next.area)].sort()) {
      if(settled.has(area)) continue;
      const quote=quoteLeg(next.area,area);
      if(!quote?.ok || !Number.isFinite(quote.duration) || quote.duration<=0) continue;
      queue.push({area,path:[...next.path,area],fuel:next.fuel+(quote.fuelUnits ?? 0),duration:next.duration+quote.duration});
    }
  }
  return null;
}
