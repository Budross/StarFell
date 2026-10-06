// Tuning belongs to one revisioned creation profile, not runtime gameplay.
export const worldGenerationProfiles = {asteroidsV1:{
  generatorRevision:'asteroids-v3',
  space:{min:[-800,-480],max:[800,480],cellSize:10},
  placement:{targetCount:160,maxCount:160,minSpacing:40,patchCount:12,densityFloor:.05,startDensity:.8,startRadius:120},
  topology:{maxDistance:240,extraEdgesPerNode:1,maxAttempts:8},
  geology:{patchCount:18,patchRadius:220,localVariance:.15,maxNodes:8,batchUnits:10000,
    outlierProbability:.03,minAbundance:.22,
    motifs:{
      metallic:{metal:.95,silicate:.3,volatile:.05,carbon:.15,refractory:.9,rare:.8},
      volatile:{metal:.1,silicate:.25,volatile:.95,carbon:.8,refractory:.05,rare:.1},
      mineral:{metal:.25,silicate:.9,volatile:.15,carbon:.2,refractory:.5,rare:.9},
      mixed:{metal:.5,silicate:.55,volatile:.4,carbon:.45,refractory:.25,rare:.25},
      poor:{metal:.12,silicate:.15,volatile:.1,carbon:.15,refractory:.05,rare:.05},
      ordinary:{metal:.3,silicate:.35,volatile:.25,carbon:.35,refractory:.15,rare:.15}
    },
    refractoryGate:.68,rareGate:.62,uraniumGate:.78,
    budgetsM3:[.08,1.5,9,32],budgetWeights:[.12,.55,.29,.04],
    resources:{
      ironOre:{field:'metal',weight:1},nickelOre:{field:'metal',weight:.45},
      copperOre:{field:'metal',weight:.25},titaniumOre:{field:'metal',weight:.22},
      silica:{field:'silicate',weight:.9},aluminumOre:{field:'silicate',weight:.5},
      waterIce:{field:'volatile',weight:1},nitrogen:{field:'volatile',weight:.22,boundVolatile:true},
      carbon:{field:'carbon',weight:.65},methane:{field:'volatile',associate:'carbon',weight:.35,boundVolatile:true},
      ammonia:{field:'volatile',associate:'carbon',weight:.25,boundVolatile:true},
      sulfur:{field:'carbon',weight:.2},tungstenOre:{field:'refractory',weight:.35,gate:'refractory'},
      lithiumOre:{field:'rare',associate:'silicate',weight:.25,gate:'rare'},
      rareEarthMinerals:{field:'rare',associate:'silicate',weight:.35,gate:'rare'},
      uraniumOre:{field:'rare',associate:'silicate',weight:.12,gate:'uranium'}
    }},
  chart:{knownGenerated:3,detectedGenerated:5,approximateStep:40}
}};
export const worldGenerationProfile=worldGenerationProfiles.asteroidsV1;
