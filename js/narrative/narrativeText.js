import { canonical,freezeDetached } from './narrativeFacts.js';
export function hash(text) { let h=2166136261; for (let i=0;i<text.length;i++) h=Math.imul(h^text.charCodeAt(i),16777619); return h>>>0; }
export function compileTemplates(source) {
  const compiled={};
  for (const [family,def] of Object.entries(source)) {
    const ids=new Set();
    if (!Array.isArray(def.slots) || new Set(def.slots).size !== def.slots.length || !def.variants?.length) throw new Error('Invalid template family: '+family);
    compiled[family]={slots:[...def.slots],variants:def.variants.map(([id,text]) => {
      if (!id || ids.has(id) || typeof text !== 'string') throw new Error('Invalid template variant: '+family); ids.add(id);
      const tokens=[]; let last=0; const regex=/\{([A-Za-z]+)\}/g;
      for (const match of text.matchAll(regex)) { const literal=text.slice(last,match.index); if (/[{}]/.test(literal) || !def.slots.includes(match[1])) throw new Error('Invalid template slot: '+family); tokens.push({literal},{slot:match[1]}); last=match.index+match[0].length; }
      const tail=text.slice(last); if (/[{}]/.test(tail)) throw new Error('Unmatched template brace: '+family); tokens.push({literal:tail});
      if (def.slots.some(slot => !tokens.some(t => t.slot===slot))) throw new Error('Unused template slot: '+family);
      return {id,tokens};
    })};
  }
  return freezeDetached(compiled);
}
export function createTextRealizer(content) {
  const templates=compileTemplates(content.templates);
  return (context,beats) => beats.map(beat => {
    const salt=canonical([content.seed,content.version,context.surface,context.subject,context.speaker?.tone,beat.id,beat.meaning]);
    const family=templates[beat.family]; if (!family) throw new Error('Unknown narrative family: '+beat.family);
    const slots={...beat.slots};
    if (slots.conditionBand) { const words=content.lexicon.condition[slots.conditionBand]; if (!words?.length) throw new Error('Unknown condition lexicon.'); slots.condition=words[hash(salt+':condition')%words.length]; delete slots.conditionBand; }
    if (family.slots.some(k => !['string','number'].includes(typeof slots[k])) || Object.keys(slots).some(k => !family.slots.includes(k))) throw new Error('Invalid resolved slots: '+beat.family);
    const variant=family.variants[hash(salt+':variant')%family.variants.length];
    return {beatId:beat.id,text:variant.tokens.map(t => t.slot ? String(slots[t.slot]) : t.literal).join(''),variantId:variant.id};
  });
}
