import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { conditionReason, validateConditions } from "../js/conditions.js";
import { conditionReason as runtimeReason } from "../js/conditionContext.js";
import { conditionEntityReferences, collectDiscoveryReferences } from "../js/conditionReferences.js";

test("condition core loads and evaluates in isolation without linking any equipment or domain module", () => {
  const source = readFileSync(new URL("../js/conditions.js", import.meta.url), "utf8");
  const script = `import { SourceTextModule } from 'node:vm';
    const m = new SourceTextModule(${JSON.stringify(source)});
    await m.link(specifier => { throw new Error('Unexpected dependency: ' + specifier); });
    await m.evaluate();
    if (m.namespace.conditionReason({flags:{ready:true}}, {flags:['ready']}) !== '') throw new Error('Evaluation failed');`;
  const result = spawnSync(process.execPath, ["--experimental-vm-modules", "--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("independent conditions preserve boolean composition, root/local reads, and messages", () => {
  const root = { flags: { ready: true }, knowledge: { discoveries: { clue: true } },
    locations: { habitat: { flags: { seen: true } } }, npcs: { mira: { flags: { met: true } } } };
  const local = { locationId: "habitat", localFlags: { checked: true } };
  const c = { all: [{ flags: ["ready"] }, { discoveries: ["clue"] }, { localFlags: ["checked"] },
    { locationFlags: { habitat: ["seen"] }, npcFlags: { speaker: ["met"] } },
    { any: [{ flags: ["missing"] }, { locations: ["habitat"] }] }, { not: { flags: ["missing"] } }] };
  validateConditions(c);
  assert.equal(conditionReason(local, c, undefined, { root, npcId: "mira" }), "");
  assert.equal(conditionReason(local, { flags: ["missing"] }, undefined, { root }), "Requires further investigation.");
  assert.equal(conditionReason(local, { not: {} }), "This option is not available right now.");
});

test("missing query dependencies fail even in short-circuited nested branches", () => {
  for (const c of [{ equipment: ["engine"] }, { flags: ["missing"], all: [{ capabilities: ["radio"] }] },
    { any: [{}, { equipment: ["engine"] }] }, { not: { capabilities: ["radio"] } }]) {
    assert.throws(() => conditionReason({ flags: {} }, c), /Missing condition query/);
  }
  assert.throws(() => conditionReason({}, { any: [{}, { completed: ["intro"] }] }), /isCompleted/);
  assert.throws(() => conditionReason({}, { npcFlags: { speaker: ["met"] } }), /context: speaker/);
  assert.equal(conditionReason({}, { equipment: [], capabilities: [] }), "");
});

test("runtime adapter uses current local equipment and allows explicit query overrides", () => {
  const content = { infrastructure: { radio: { capabilities: ["communications"] } } };
  const local = { infrastructure: { radio: { quantity: 1, enabled: true, health: 1 } } };
  const c = { equipment: ["radio"], capabilities: ["communications"] };
  assert.equal(runtimeReason(local, c, content), "");
  local.infrastructure.radio.enabled = false;
  assert.equal(runtimeReason(local, c, content), "Requires operational equipment.");
  assert.equal(runtimeReason(local, c, content, { queries: { isOperational: () => true, hasCapability: () => true } }), "");
  assert.equal(runtimeReason(local, { capabilities: ["communications"] }, content), "Requires additional equipment capability.");
  assert.equal(conditionReason({}, { completed: ["intro"] }, undefined, { isCompleted: () => true }), "");
});

test("reference traversal reports only condition fields and retains nested source paths", () => {
  const c = { any: [{ locations: ["habitat"], discoveries: ["clue"] }, { not: { npcFlags: { speaker: ["seen"], mira: ["seen"] } } }] };
  assert.deepEqual(collectDiscoveryReferences([c], ["earned", "earned"]), { required: ["clue"], granted: ["earned"] });
  const refs = conditionEntityReferences(c, "test");
  assert.deepEqual(refs.map(r => r.targetId), ["habitat", "mira"]);
  assert.equal(refs[1].source, "test.any[1].not");
  assert.equal(refs[1].policy, "retain");
});
