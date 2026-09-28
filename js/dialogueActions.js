import { performDialogue } from "./dialogue.js";

export function createDialogueActions(system, effectServices) {
  return ["start", "topic", "choice", "topics", "leave"].map(operation => ({
    id: `dialogue:${operation}`, name: `Dialogue ${operation}`, scope: "global", group: "dialogue",
    execute: (state, _context, payload) => performDialogue(state, operation, payload, system, effectServices)
  }));
}
