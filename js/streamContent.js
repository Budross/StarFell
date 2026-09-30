// Text published directly to the narrative stream by the game shell.
export const streamContent = {
  firstRun: {
    arrival: {
      name: 'Arrival at Habitat 05',
      order: 1,
      text: 'The terminal glows in the half-light of Habitat 05. Beyond the viewport, unfinished collectors turn slowly against the glare, their shadows passing over the walls. The power conduit hums beneath your feet. A warning remains lit for the solar array: a structural fitting is badly damaged, and the array is producing only a fraction of what it should.'
    },
    damagedFitting: {
      name: 'The damaged fitting',
      order: 2,
      text: 'Near the array, a fractured bracket still holds the shape of its missing piece. A closer inspection might reveal how it was made. Outside, recoverable metal lies among the local wreckage—enough, perhaps, to make a replacement if you can bring some back.'
    },
    repairPlan: {
      name: 'A repair plan',
      order: 3,
      text: 'The research bench can turn that scrap and what you learned from the fitting into a workable design. If you can research a new design, the Workshop can fabricate the parts. Then you can return to the array and try to restore its output.'
    }
  }
};

export function validateStreamContent(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      !source.firstRun || typeof source.firstRun !== 'object' || Array.isArray(source.firstRun)) {
    throw new Error('Invalid narrative stream content.');
  }
  const orders = new Set();
  for (const [id, entry] of Object.entries(source.firstRun)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) || !entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).some(key => !['name', 'order', 'text'].includes(key)) ||
        typeof entry.name !== 'string' || !entry.name.trim() ||
        !Number.isSafeInteger(entry.order) || entry.order < 0 || orders.has(entry.order) ||
        typeof entry.text !== 'string' || !entry.text.trim()) {
      throw new Error('Invalid narrative stream entry: ' + id);
    }
    orders.add(entry.order);
  }
}

export function firstRunMessages(source = streamContent) {
  validateStreamContent(source);
  return Object.values(source.firstRun).sort((a, b) => a.order - b.order).map(entry => entry.text);
}
