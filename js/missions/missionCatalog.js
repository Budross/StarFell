const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const check = (ok, message) => { if (!ok) throw new Error(`Mission: ${message}.`); };
export const fields = (value, allowed) => check(record(value) && Object.keys(value).every(k => allowed.includes(k)), 'invalid fields');
export const identity = id => typeof id === 'string' && /^[A-Za-z][\w-]{0,127}$/.test(id) && !['constructor','prototype','__proto__'].includes(id);
export function freezeData(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeData); Object.freeze(value); }
  return value;
}
function plainData(value,depth=0) {
  check(depth<=16,'authoring metadata is too deep');
  if(value===null || typeof value==='string' || typeof value==='boolean')return;
  if(typeof value==='number'){check(Number.isFinite(value),'nonfinite authoring value');return;}
  check(Array.isArray(value) || record(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value)),'authoring contracts must be plain data');
  Object.values(value).forEach(v=>plainData(v,depth+1));
}

// The lookup is derived from supplied capabilities, never from a production list.
export function createMissionCatalog(actions, destinations, definitions = {}) {
  check(Array.isArray(actions), 'actions must be supplied');
  const versions = new Map(), current = new Map();
  for (const action of actions) {
    check(identity(action?.id) && Number.isSafeInteger(action.semanticVersion) && action.semanticVersion > 0, 'invalid action identity');
    check(action.assignable===undefined || typeof action.assignable==='boolean','invalid assignable flag');
    const key = `${action.id}:${action.semanticVersion}`;
    check(!versions.has(key), `duplicate action ${key}`);
    for (const operation of ['compileParameters','validate','preview','advance']) check(typeof action[operation] === 'function', `missing ${operation} on ${key}`);
    for (const operation of ['activate','safeToReplace','references','report','projectPendingWork']) check(action[operation] === undefined || typeof action[operation] === 'function', `invalid ${operation} on ${key}`);
    check(record(action.authoring) && typeof action.authoring.label === 'string' && record(action.authoring.parameters), 'invalid authoring contract');
    plainData(action.authoring);
    const descriptor = Object.freeze({ ...action, authoring: freezeData(structuredClone(action.authoring)) });
    versions.set(key, descriptor);
    if (action.assignable !== false) { check(!current.has(action.id), `ambiguous assignable action ${action.id}`); current.set(action.id, descriptor); }
  }
  function resolve(id, version) {
    const action = version === undefined ? current.get(id) : versions.get(`${id}:${version}`);
    check(!!action, `unsupported action/version ${id}:${version ?? 'current'}`);
    return action;
  }
  const destinationIds = new Set(destinations.map(d => d.id));
  function objective(raw, accepted = false, authored = false, state) {
    fields(raw, ['id','destinationId','action','actionVersion','parameters']);
    check(identity(raw.id) && identity(raw.destinationId) && identity(raw.action), 'invalid objective identity');
    if (!accepted && authored && !destinationIds.has(raw.destinationId)) throw Object.assign(new Error(`Mission: invalid stationary destination ${raw.destinationId}.`),{reference:{catalog:'locations',id:raw.destinationId,field:'id'}});
    const action = resolve(raw.action, accepted ? raw.actionVersion : undefined);
    if(!accepted)check(raw.actionVersion===undefined || raw.actionVersion===action.semanticVersion,'unsupported requested action version');
    if (accepted) check(Number.isSafeInteger(raw.actionVersion), 'missing accepted action version');
    const result = { id: raw.id, destinationId: raw.destinationId, action: action.id, actionVersion: action.semanticVersion,
      parameters: accepted ? structuredClone(raw.parameters) : action.compileParameters(structuredClone(raw.parameters), raw.destinationId, state) };
    action.validate(result, null, state);
    return result;
  }
  function compile(raw, accepted = false, definition = false, state) {
    fields(raw, ['name','description','homeLocationId','objectives','returnPolicy']);
    check(typeof raw.name === 'string' && raw.name.trim().length > 0 && raw.name.length <= 128, 'invalid name');
    check(raw.description === undefined || typeof raw.description === 'string' && raw.description.length <= 512, 'invalid description');
    check(definition && raw.homeLocationId===undefined || identity(raw.homeLocationId) && (accepted || !definition || destinationIds.has(raw.homeLocationId)), 'home must be a stationary dockable site');
    fields(raw.returnPolicy, ['onComplete','onBlocked']);
    check(raw.returnPolicy.onComplete === 'home' && raw.returnPolicy.onBlocked === 'home', 'unsupported return policy');
    check(Array.isArray(raw.objectives) && raw.objectives.length > 0 && raw.objectives.length <= 32, 'expected 1–32 ordered objectives');
    const objectives = raw.objectives.map((o,i) => { try{return objective(o, accepted,definition,state);}catch(cause){throw Object.assign(new Error(`Mission objectives.${i}: ${cause.message}`,{cause}),{path:`objectives.${i}`,reference:cause.reference});} });
    check(new Set(objectives.map(o => o.id)).size === objectives.length, 'duplicate objective ID');
    return { name: raw.name.trim(), homeLocationId: raw.homeLocationId, objectives, returnPolicy: { ...raw.returnPolicy } };
  }
  const catalog = Object.create(null);
  for (const [id, raw] of Object.entries(definitions)) {
    check(identity(id), 'invalid definition ID');
    try { catalog[id] = { id, ...compile(raw,false,true),...(raw.description===undefined?{}:{description:raw.description}) }; }
    catch(cause) { throw Object.assign(new Error(`missionDefinitions.${id}.${cause.path ?? 'homeLocationId'}: ${cause.message}`,{cause}),{path:`missionDefinitions.${id}.${cause.path ?? 'homeLocationId'}`,reference:cause.reference}); }
  }
  return Object.freeze({ resolve, compile, objective, definitions: freezeData(catalog),
    authoringContracts: () => freezeData(structuredClone([...current.values()].map(a => ({ id: a.id, semanticVersion: a.semanticVersion, ...a.authoring })))),
    destinations: freezeData(structuredClone(destinations)) });
}
