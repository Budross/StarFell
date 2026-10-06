// Physical coordinates are simulation truth. Cells carry no ownership/influence.
export const compareKeys = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export const distanceSquared = (a,b) => (a[0]-b[0])**2 + (a[1]-b[1])**2;
export const distance = (a,b) => Math.sqrt(distanceSquared(a,b));
export function validateSpace(space) {
  const { min, max, cellSize } = space ?? {};
  if (![min,max].every(p=>Array.isArray(p) && p.length===2 && p.every(Number.isSafeInteger)) || !Number.isSafeInteger(cellSize) || cellSize<=0 || min.some((n,i)=>max[i]<=n || (max[i]-n)%cellSize)) throw new Error('Invalid world extent.');
  return space;
}
export function containsPosition(space,p) {
  return Array.isArray(p) && p.length===2 && p.every((v,i)=>Number.isFinite(v) && v>=space.min[i] && v<space.max[i]);
}
export const cellAt = (space,p) => p.map((v,i)=>Math.floor((v-space.min[i])/space.cellSize));
export const cellPosition = (space,cell) => cell.map((v,i)=>space.min[i]+(v+.5)*space.cellSize);
export const cellKey = cell => `cell_${cell[0]}_${cell[1]}`;

// Independent decisions use stable keys, never a shared advancing RNG. Frozen
// test vectors and generatorRevision own this implementation's compatibility.
export function keyedRandom(seed,...keys) {
  let h=(seed>>>0)^0x9e3779b9;
  for(const c of JSON.stringify(keys)) { h=Math.imul(h^c.charCodeAt(0),0x85ebca6b); h^=h>>>13; }
  h=Math.imul(h^(h>>>16),0xc2b2ae35); h^=h>>>16;
  return (h>>>0)/4294967296;
}
