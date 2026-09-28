// A presentation-only tour. It never calls a game action or writes a save.
const STEPS = [
  { tab: 'operations', target: '#player-actions', title: 'Operations',
    text: 'Inspect the damaged fitting and gather nearby salvage here. The activity stream records what you learn and what changes.' },
  { tab: 'research', target: '#research-form', title: 'Research',
    text: 'Take gathered materials to the research bench. Select samples and run experiments to uncover designs.' },
  { tab: 'workshop', target: '#recipe-select', title: 'Workshop',
    text: 'New designs appear as recipes here. Fabricate parts from stored materials, then use Operations directives to install or repair equipment.' },
  { tab: 'locations', target: '#location-map', title: 'Locations',
    text: 'Browse nearby places on the map. Selecting and zooming only inspect the network; travel is a separate action.' },
  { tab: 'people', target: '.people-roster', title: 'People',
    text: 'See who is nearby and speak with them. They may have clues about the habitat or work underway.' },
  { tab: 'shipyard', target: '#yard-canvas', title: 'Shipyard',
    text: 'Later, build ships and drones from fabricated modules. Their controls appear in Locations.' }
];

export default function createUiTour(tabs) {
  const start = document.querySelector('#tour-start');
  const card = document.createElement('aside');
  card.className = 'ui-tour';
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Terminal tour');
  card.innerHTML = `<p class="ui-tour-count"></p><h2 class="ui-tour-title"></h2><p class="ui-tour-text"></p>
    <div class="ui-tour-actions"><button type="button" data-tour="back">Back</button>
    <button type="button" data-tour="next">Next</button><button type="button" data-tour="close">Close</button></div>`;
  document.body.append(card);
  const count = card.querySelector('.ui-tour-count');
  const title = card.querySelector('.ui-tour-title');
  const body = card.querySelector('.ui-tour-text');
  const back = card.querySelector('[data-tour="back"]');
  const next = card.querySelector('[data-tour="next"]');
  const closeButton = card.querySelector('[data-tour="close"]');
  let index = -1, target = null, previousTab = null, previousFocus = null;

  function position() {
    if (index < 0 || !target) return;
    const bounds = target.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const margin = 12;
    card.style.left = `${Math.max(margin, Math.min(bounds.left, innerWidth - width - margin))}px`;
    const below = bounds.bottom + margin;
    const above = bounds.top - height - margin;
    card.style.top = `${below + height <= innerHeight - margin ? below : above >= margin ? above : Math.max(margin, innerHeight - height - margin)}px`;
  }

  function show(stepIndex) {
    target?.classList.remove('ui-tour-highlight');
    index = stepIndex;
    const step = STEPS[index];
    tabs.activateTab(step.tab);
    target = document.querySelector(step.target);
    if (!target) return end();
    target.classList.add('ui-tour-highlight');
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    count.textContent = `${index + 1} / ${STEPS.length}`;
    title.textContent = step.title;
    body.textContent = step.text;
    back.disabled = index === 0;
    next.textContent = index === STEPS.length - 1 ? 'Finish' : 'Next';
    card.hidden = false;
    requestAnimationFrame(position);
    next.focus({ preventScroll: true });
  }

  function end() {
    if (index < 0) return;
    target?.classList.remove('ui-tour-highlight');
    target = null;
    index = -1;
    card.hidden = true;
    tabs.activateTab(previousTab);
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  start.addEventListener('click', () => {
    if (index >= 0) return;
    previousTab = tabs.getActiveTabId();
    previousFocus = document.activeElement;
    show(0);
  });
  back.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => index === STEPS.length - 1 ? end() : show(index + 1));
  closeButton.addEventListener('click', end);
  document.addEventListener('keydown', event => {
    if (index >= 0 && event.key === 'Escape') { event.preventDefault(); end(); }
  });
  window.addEventListener('resize', position);
  document.addEventListener('scroll', position, true);
}
