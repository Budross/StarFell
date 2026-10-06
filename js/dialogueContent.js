const speakerFlag = flag => ({ npcFlags: { speaker: [flag] } });
const setSpeakerFlag = flag => ({ type: "setFlag", scope: "npc", target: "speaker", flag, value: true });

export const dialogueDefinitions = {
  groups: {
    habitatCrew: { conversations: ["crewGreeting", "habitatLife"] },
    miraPersonal: { conversations: ["miraIntroduction", "miraRequest", "miraFollowup", "miraThanks", "miraDeparture", "miraBenchAdvice"] },
    orenPersonal: { conversations: ["orenRequest", "orenFollowup", "orenThanks"] }
  },
  conversations: {
    miraBenchAdvice: { role: "topic", topicId: "benchAdvice", label: "Advice for the workbench", contactModes:['physical','radio'], order: 12, repeat: "once", entryNode: "advice", nodes: {
      advice: { text: "Start with clean contacts. Loose connections can make a good circuit look broken. The solar cells work much the same way: thin silicon layers, with a contact to collect the response to light.", choices: [
        { id: "note", text: "I'll keep that in mind during my experiments.", effects: [setSpeakerFlag("benchAdvice")], destinationNode: "noted" }
      ] },
      noted: { text: "Try the materials yourself. The bench needs no power for these basic tests, and your observations will stay in the research journal.", ending: true }
    } },
    crewGreeting: { role: "greeting", repeat: "once", entryNode: "hello", nodes: {
      hello: { text: "Welcome. I'm {speaker}. It's good to have another pair of eyes on this place.", ending: true }
    } },
    habitatLife: { role: "topic", topicId: "habitatLife", label: "Life in the habitat", order: 10, entryNode: "life", nodes: {
      life: { text: "We keep the life support running and reclaim what we can. The collectors outside were supposed to power a much larger settlement.", ending: true }
    } },
    miraIntroduction: { role: "topic", topicId: "introduction", label: "Ask about Mira", order: 5, entryNode: "intro", nodes: {
      intro: { text: "I maintained the collector relays before the shutdown. Now I keep this place running.", choices: [
        { id: "shutdown", text: "What happened during the shutdown?", destinationNode: "shutdown" },
        { id: "thanks", text: "Good to meet you.", destinationNode: "thanks" }
      ] },
      shutdown: { text: "The orders stopped arriving. Then the relays went quiet. I still don't know which happened first.", ending: true },
      thanks: { text: "Likewise. Let me know if you find anything useful.", ending: true }
    } },
    miraRequest: { role: "topic", topicId: "relayRequest", label: "The silent relay", order: 20,
      entryConditions: { not: { any: [speakerFlag("requestAccepted"), speakerFlag("requestDeclined"), speakerFlag("requestCompleted")] } },
      entryNode: "offer", nodes: {
        offer: { text: "If you reach the derelict relay, could you inspect its construction manifest? You'll need a ship to get there. I want to know why the work stopped.", choices: [
          { id: "accept", text: "I'll investigate when I can reach it.", effects: [setSpeakerFlag("requestAccepted")], destinationNode: "accepted" },
          { id: "decline", text: "I can't make that promise.", effects: [setSpeakerFlag("requestDeclined")], destinationNode: "declined" }
        ] },
        accepted: { text: "Thank you. The observation console should still be accessible. Come back when you've read the manifest.", ending: true },
        declined: { text: "I understand. Keeping the habitat running comes first.", ending: true }
      }
    },
    miraFollowup: { role: "topic", topicId: "relayRequest", label: "Report on the relay manifest", order: 20, priority: 10,
      entryConditions: { all: [speakerFlag("requestAccepted"), { not: speakerFlag("requestCompleted") }] },
      requirements: { locationFlags: { derelict: ["examined:manifest"] } }, blockedReason: "Inspect the construction manifest at the derelict relay first.",
      entryNode: "report", nodes: {
        report: { text: "Did you find out what happened?", choices: [
          { id: "report", text: "The manifest ends mid-shift. There was no evacuation order.", effects: [setSpeakerFlag("requestCompleted"), { type: "setFlag", scope: "global", flag: "relayMysteryKnown", value: true }], destinationNode: "thanks" }
        ] },
        thanks: { text: "Then they expected to come back. That changes what we should be looking for. Thank you.", ending: true }
      }
    },
    miraThanks: { role: "topic", topicId: "relayRequest", label: "What the manifest means", order: 20, priority: 20,
      entryConditions: speakerFlag("requestCompleted"), entryNode: "thanks", nodes: {
        thanks: { text: "You found us a starting point. Someone interrupted an ordinary shift, and the relay may still hold the reason.", ending: true }
      }
    },
    miraDeparture: { role: "topic", topicId: "relayVisit", label: "Meet at the relay", order: 30, repeat: "once",
      entryConditions: speakerFlag("requestCompleted"), entryNode: "meet", nodes: {
        meet: { text: "I'll arrange passage to the relay and examine the console myself. Shall we meet there?", choices: [
          { id: "agree", text: "Yes. I'll meet you at the relay.", terminal: true, complete: true,
            closingText: "Thank you. I'll arrange passage and meet you at the relay.",
            effects: [{ type: "relocate", npcId: "speaker", destinationId: "derelict" }] }
        ] }
      }
    },
    orenRequest: { role: "topic", topicId: "collectorRequest", label: "The unfinished collectors", order: 20,
      entryConditions: { not: { any: [speakerFlag("requestAccepted"), speakerFlag("requestDeclined"), speakerFlag("requestCompleted")] } },
      entryNode: "offer", nodes: {
        offer: { text: "Would you inspect the unfinished collectors outside? The old ledger claims they were nearly ready, but I'd like a current observation.", choices: [
          { id: "accept", text: "I'll take a look.", effects: [setSpeakerFlag("requestAccepted")], destinationNode: "accepted" },
          { id: "decline", text: "I have other priorities.", effects: [setSpeakerFlag("requestDeclined")], destinationNode: "declined" }
        ] },
        accepted: { text: "The inspection directive is in Operations. I'll be here when you're done.", ending: true },
        declined: { text: "Understood. I'll leave the ledger open for now.", ending: true }
      }
    },
    orenFollowup: { role: "topic", topicId: "collectorRequest", label: "Report on the collectors", order: 20, priority: 10,
      entryConditions: { all: [speakerFlag("requestAccepted"), { not: speakerFlag("requestCompleted") }] },
      requirements: { locationFlags: { habitat: ["examined:collectors"] } }, blockedReason: "Inspect Unfinished collectors in Operations first.",
      entryNode: "report", nodes: {
        report: { text: "What did you see outside?", choices: [
          { id: "report", text: "Unfinished mirrors. Construction stopped a long time ago.", effects: [setSpeakerFlag("requestCompleted")], destinationNode: "thanks" }
        ] },
        thanks: { text: "Then this ledger was a forecast, not a record. I'll mark it accordingly. Thank you for checking.", ending: true }
      }
    },
    orenThanks: { role: "topic", topicId: "collectorRequest", label: "The corrected ledger", order: 20, priority: 20,
      entryConditions: speakerFlag("requestCompleted"), entryNode: "thanks", nodes: {
        thanks: { text: "The ledger now matches what is actually outside. It's a small correction, but we can build on it.", ending: true }
      }
    }
  }
};
