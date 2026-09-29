import { createContextBuilder } from './narrativeContext.js';
import { selectBeats } from './narrativeBeats.js';
import { createTextRealizer,hash } from './narrativeText.js';
import { canonical,freezeDetached } from './narrativeFacts.js';
import { narrativeContent,validateNarrativeContent } from './narrativeContent.js';
export function createNarrativeSystem({providers,world,people,content,source=narrativeContent,seed=source.seed}) {
  const authored=freezeDetached({...source,seed});
  validateNarrativeContent(authored);
  const buildContext=createContextBuilder({providers,world,people,content,surfaces:authored.surfaces}),realize=createTextRealizer(authored);
  const select=context=>freezeDetached(selectBeats(context,authored));
  return Object.freeze({buildContext,selectBeats:select,describe(state,request,options={}) {
    const context=buildContext(state,request);
    if (context.status!=='available') return freezeDetached({status:'unavailable',text:'',segments:[],fingerprint:null});
    const selection=selectBeats(context,authored,options),segments=[];
    if (authored.surfaces[context.surface].base) {
      if (context.speaker) segments.push({text:context.speaker.greeting});
      else if (context.subject.type==='equipment_group') {
        const group=context.facts.find(f=>['equipment_condition','equipment_activity'].includes(f.kind) && f.data.equipmentId===context.subject.equipmentId);
        if (group && !selection.beats.length) segments.push({text:`I inspect ${authored.lexicon.equipmentNames[group.data.name] ?? group.data.name}.`});
      } else {
        const identity=context.facts.find(f=>f.kind==='location_identity').data;
        const fallback=`${identity.name} is your current location.`;
        segments.push({text:authored.bases[identity.baseText] ?? (identity.baseText===fallback?`I am at ${identity.name}.`:identity.baseText)});
      }
    }
    segments.push(...realize(context,selection.beats));
    const prose=segments.map(s=>s.text).join('\n\n');
    const text=context.speaker && prose?`${context.speaker.name}: “${segments.map(s=>s.text).join(' ')}”`:prose;
    return freezeDetached({status:text?'ok':'empty',text,segments,fingerprint:hash(canonical([authored.version,context.surface,context.subject,context.speaker,selection.beats.map(b=>b.meaning),segments[0]?.text])).toString(16),
      diagnostics:options.diagnostics?{...selection,context}:undefined});
  }});
}
