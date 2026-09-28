// Presentation choices consume admitted facts, never raw domain state. They do
// not enter the gameplay action registry or its mutation/save transaction.
export function equipmentObservationActions(context) {
  if (context.status !== 'available') return [];
  const groups = new Map();
  for (const fact of context.facts) {
    if (fact.basis !== 'current' || !fact.subject.equipmentId) continue;
    const id = fact.subject.equipmentId;
    const group = groups.get(id) ?? { name: '', reasons: new Set() };
    if (fact.kind === 'equipment_condition') {
      group.name = fact.data.name;
      if (fact.data.conditionBand !== 'sound') group.reasons.add('Check its condition.');
      if (fact.data.enabled === false) group.reasons.add('It is disabled.');
    }
    if (fact.kind === 'equipment_activity') group.name = fact.data.name;
    if (fact.kind === 'process_activity') {
      group.name ||= fact.data.equipmentName;
      if (fact.data.phase === 'delivery') group.reasons.add('Check the finished batch awaiting delivery.');
      else if (fact.data.workState !== 'working') group.reasons.add('Check what is limiting work.');
    }
    groups.set(id, group);
  }
  return [...groups].filter(([,group]) => group.name && group.reasons.size)
    .sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([equipmentId,group]) => ({
      id: `observe-equipment:${context.locationId}:${equipmentId}`,
      name: `Inspect ${group.name.toLowerCase()}`,
      description: [...group.reasons].join(' '),
      visible: true, available: true, shortcut: '',
      request: { surface: 'inspect_equipment', subjectId: context.locationId, equipmentId }
    }));
}
