import { content as defaultContent } from "./content.js";
import { locationDefinitions } from "./locationContent.js";
import { buildGameSystems } from "./bootstrap.js";

// Standalone default consumers use the same complete composition as the app.
// Keep production feature registration in bootstrap.js, not in this wrapper.
export function compileWorld(content, source = locationDefinitions) {
  const systems=buildGameSystems({ content, locationSource: source });
  Object.defineProperty(systems.world,'peopleSystem',{value:systems.people,enumerable:false});
  return systems.world;
}

export const defaultWorld = compileWorld(defaultContent);
export const worldFor = content => content === defaultContent ? defaultWorld : compileWorld(content);
