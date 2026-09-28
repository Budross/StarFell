import { record, checkedMultiply, safeInteger, checkedAdd } from "./quantities.js";

// Called before any current-content records are initialized. Only saved maps convert.
export function convertLegacyStorage(state, content, world, legacy = LEGACY_STORAGE) {
  function convert(map, capacities, infrastructure = {}, area = false, npc = false) {
    if (!record(map) || !record(infrastructure)) throw new Error("Invalid legacy inventory or infrastructure.");
    for (const [id, amount] of Object.entries(map)) {
      if (!Object.hasOwn(content.resources, id)) throw new Error(`Invalid unknown saved asset ${id}.`);
      const item = legacy.items[id], utility = legacy.utilities[id];
      // A known, newly authored item at zero needs no historical conversion.
      // Nonzero quantities still require explicit legacy metadata.
      if (!item && !utility && amount === 0 && Object.hasOwn(content.items,id)) continue;
      if ((!item && !utility) || (item && content.items[id]?.category !== item.category) ||
          (utility && !content.utilities.includes(id))) throw new Error(`Explicit legacy storage migration required for ${id}.`);
      let limit = area ? 0 : capacities[id] ?? (npc ? 0 : (item ?? utility).baseCapacity);
      if (!npc) for (const [group, bonuses] of Object.entries(legacy.bonuses)) {
        if (infrastructure[group] !== undefined && !record(infrastructure[group])) throw new Error(`Invalid legacy equipment ${group}.`);
        const count = safeInteger(infrastructure[group]?.quantity ?? 0, "legacy equipment count");
        const bonus = checkedMultiply(count, bonuses[id] ?? 0);
        limit = Number.isSafeInteger(limit) ? checkedAdd(limit, bonus) : limit + bonus;
      }
      if (!Number.isFinite(limit) || limit < 0 || limit > Number.MAX_SAFE_INTEGER || !Number.isFinite(amount) || amount < 0 || amount > limit || (item && !Number.isSafeInteger(amount)))
        throw new Error(`Invalid ${id} legacy quantity.`);
      if (item?.category === "resource") {
        const factor = legacy.volumeUnitsPerLegacyUnit[id];
        if (!Number.isSafeInteger(factor) || factor <= 0) throw new Error(`Missing legacy volume conversion for ${id}.`);
        map[id] = checkedMultiply(amount, factor);
      }
    }
  }
  if (state.saveVersion < 3) convert(state.resources, legacy.locationCapacities.habitat ?? {}, state.infrastructure);
  else {
    if (!record(state.locations)) throw new Error("Invalid saved locations.");
    for (const [id, local] of Object.entries(state.locations)) {
      if (!record(local) || !Object.hasOwn(world.definitions, id)) throw new Error(`Invalid or removed saved location ${id}.`);
      convert(local.resources, legacy.locationCapacities[id] ?? {}, local.infrastructure, world.definitions[id].kind === "area");
    }
  }
  if (state.saveVersion >= 5) {
    if (!record(state.npcs)) throw new Error("Invalid saved NPC records.");
    for (const [id, npc] of Object.entries(state.npcs)) {
      if (!record(npc)) throw new Error(`Invalid NPC ${id}.`);
      convert(npc.inventory, legacy.npcCapacities[id] ?? {}, {}, false, true);
    }
  }
}

// Frozen version 1–6 semantics. Never derive conversion factors from current content.
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const LEGACY_STORAGE = freeze({
  "items": {
    "scrap": {
      "category": "resource",
      "baseCapacity": 60
    },
    "electronicSalvage": {
      "category": "resource",
      "baseCapacity": 40
    },
    "siliconMinerals": {
      "category": "resource",
      "baseCapacity": 40
    },
    "iron": {
      "category": "component",
      "baseCapacity": 30
    },
    "conductiveParts": {
      "category": "component",
      "baseCapacity": 30
    },
    "electronicParts": {
      "category": "component",
      "baseCapacity": 30
    },
    "solarCells": {
      "category": "component",
      "baseCapacity": 30
    },
    "solarPanel": {
      "category": "product",
      "baseCapacity": 10
    },
    "batteryBank": {
      "category": "product",
      "baseCapacity": 10
    },
    "radioAntenna": {
      "category": "product",
      "baseCapacity": 10
    }
  },
  "utilities": {
    "power": {
      "name": "Power",
      "baseCapacity": 40,
      "initialQuantity": 0
    }
  },
  "locationCapacities": {
    "supplyPlatform": {
      "power": 20
    }
  },
  "bonuses": {
    "installedBatteryBanks": {
      "power": 10
    }
  },
  "npcCapacities": {
    "mira": {
      "scrap": 20
    },
    "oren": {}
  },
  "volumeUnitsPerLegacyUnit": {
    "scrap": 10000,
    "electronicSalvage": 5000,
    "siliconMinerals": 10000
  }
});
