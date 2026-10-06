import { describeItemDesign } from '../../itemDesignCatalog.js';
import { fact } from '../narrativeFacts.js';
const words = value => value.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase();
export function designFactProvider({ content }) {
  return { id:'designs', provide(state,scope) {
    if (!scope.facilities) return [];
    const facts=[];
    for (const [id,group] of Object.entries(state.locations[scope.locationId].infrastructure)) {
      if (!group.quantity || scope.equipmentId && scope.equipmentId !== id) continue;
      const projection=describeItemDesign(content,content.infrastructure[id]?.itemId);
      if (!projection) continue;
      const subject={type:'equipment_group',hostId:scope.locationId,equipmentId:id},physical=projection.physical;
      if (physical.form) facts.push(fact('designs','equipment_physical_form',subject,{equipmentId:id,name:projection.name,
        form:words(physical.form),features:(physical.exposedFeatures??[]).map(words).join(' and ')},scope,{exposure:'facility_detail',importance:.65}));
      // Player discoveries do not imply NPC understanding or reveal hidden lineage.
      if (!scope.speaker && scope.equipmentId===id && projection.design?.principles?.length && projection.design.principles.every(p=>state.knowledge.discoveries[p])){
        facts.push(fact('designs','known_design_family',subject,{name:projection.name,family:words(projection.design.family)},scope,{exposure:'participant_private',importance:.6}));
        const sources=(projection.design.derivedFrom??[]).map(r=>typeof r==='string'?r:r.id).filter(id=>state.knowledge.itemEntries?.[id]).map(id=>content.items[id].name);
        if(sources.length)facts.push(fact('designs','known_design_lineage',subject,{name:projection.name,sources:sources.join(' and ')},scope,{exposure:'participant_private',importance:.65}));
      }
    }
    return facts;
  }};
}
