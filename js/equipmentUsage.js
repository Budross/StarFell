// Compile actual requirement relationships; descriptive metadata grants no behavior.
export function compileEquipmentUsage(content, processes, requirementSources) {
  const uses = Object.fromEntries(Object.keys(content.equipmentContracts).map(id => [id, []]));
  const add = (type, value) => { if (uses[type] && !uses[type].some(v => v.domain === value.domain && v.id === value.id)) uses[type].push(value); };
  for (const process of Object.values(processes)) add(process.capability, { domain: 'processing', id: process.id, label: process.name });
  for (const { domain, sources } of requirementSources) for (const source of sources) {
    const visit = conditions => {
      for (const type of conditions?.capabilities ?? []) add(type, { domain:source.domain??domain, id: source.path, label: source.label??source.path });
      (conditions?.all ?? []).forEach(visit); (conditions?.any ?? []).forEach(visit); if (conditions?.not) visit(conditions.not);
    };
    visit(source.conditions);
  }
  add('radioCommunication', { domain: 'vessels', id: 'remoteCommands', label: 'Remote vessel commands and contact reports' });
  return uses;
}
