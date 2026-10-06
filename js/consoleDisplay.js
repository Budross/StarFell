// consoleDisplay.js

const MESSAGE_PRESENTATIONS = Object.freeze({
  narrative: {
    className: "narrative-entry",
    label: null,
    paragraphs: true,
    showAuthor: false
  },
  system: {
    className: null,
    label: "SYSTEM LOG",
    paragraphs: false,
    showAuthor: false
  },
  command: {
    className: "command-entry",
    label: "DIRECTIVE",
    paragraphs: false,
    showAuthor: false
  },
  error: {
    className: "error",
    label: "SYSTEM / NOTICE",
    paragraphs: false,
    showAuthor: false
  }
});

const DEFAULT_PRESENTATION = Object.freeze({
  className: null,
  label: "EVENT",
  paragraphs: false,
  showAuthor: true
});

export default function consoleDisplay(eventBus, selector = "#narrative-stream", describeGathering = null) {
  const stream = document.querySelector(selector);

  if (!stream) {
    throw new Error(`Console display target not found: ${selector}`);
  }

  const viewport = document.createElement('div');
  viewport.className = 'stream-viewport';
  stream.before(viewport);
  viewport.append(stream);
  const activityStream = document.createElement('div');
  activityStream.id = 'crafting-stream';
  activityStream.className = 'narrative-stream crafting-stream';
  activityStream.setAttribute('role', 'log');
  activityStream.setAttribute('aria-label', 'Crafting and gathering log');
  activityStream.tabIndex = 0;
  activityStream.hidden = true;
  viewport.append(activityStream);
  const empty = document.createElement('p');
  empty.className = 'activity-log-empty';
  empty.textContent = 'No crafting or gathering activity this session.';
  activityStream.append(empty);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'activity-log-toggle';
  toggle.setAttribute('aria-controls', activityStream.id);
  stream.closest('.stream-zone').querySelector('.stream-footer').prepend(toggle);
  let visible = true;
  const logs = [stream, activityStream].map(element => ({
    element, position: { followTail: true, anchors: [] }
  }));
  let selected = logs[0];
  let lastGathering = null;
  toggle.addEventListener('click', () => selectLog(selected === logs[0] ? logs[1] : logs[0]));
  activityStream.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    selectLog(logs[0]);
  });
  updateVisibility();
  eventBus.subscribe({}, displayMessage);

  function destination(message) {
    return message.gathering || ['crafting', 'gathering'].includes(message.activity) ? logs[1] : logs[0];
  }

  function updateVisibility() {
    for (const log of logs) {
      log.element.hidden = log !== selected;
      log.element.setAttribute('aria-live', visible && log === selected ? 'polite' : 'off');
    }
    toggle.textContent = selected === logs[1] ? 'Return to Narrative' : 'Crafting & Gathering Log';
    toggle.setAttribute('aria-expanded', String(selected === logs[1]));
  }

  function selectLog(next) {
    if (next === selected) return;
    if (visible) selected.position = capturePosition(selected.element);
    const moveFocus = selected.element.contains(document.activeElement);
    selected = next;
    updateVisibility();
    if (visible) restorePosition(selected);
    if (moveFocus) toggle.focus({ preventScroll: true });
  }

  function capturePosition(stream) {
    const top = stream.getBoundingClientRect().top;
    return {
      followTail: stream.scrollHeight - stream.scrollTop - stream.clientHeight < 40,
      anchors: [...stream.children]
        .filter(entry => entry.classList.contains('log-entry') && entry.getBoundingClientRect().bottom > top)
        .map(entry => ({ entry, offset: entry.getBoundingClientRect().top - top }))
    };
  }

  function restorePosition({ element: stream, position }) {
    if (position.followTail) {
      stream.scrollTop = stream.scrollHeight;
      return;
    }
    const anchor = position.anchors.find(({ entry }) => entry.parentElement === stream);
    if (anchor) {
      stream.scrollTop += anchor.entry.getBoundingClientRect().top - stream.getBoundingClientRect().top - anchor.offset;
    } else {
      stream.scrollTop = 0;
    }
  }

  return {
    breakGathering() {
      lastGathering = null;
    },
    isMessageVisible(message) {
      return visible && destination(message) === selected;
    },
    onDeactivate() {
      if (visible) selected.position = capturePosition(selected.element);
      visible = false;
      updateVisibility();
    },
    onActivate() {
      visible = true;
      updateVisibility();
      restorePosition(selected);
    },
    revealLatest() {
      selectLog(logs[0]);
      const latest=stream.querySelector('.log-entry:last-of-type');
      if (!latest) return;
      // Deliberate observation reveals its receipt from the start. Long receipts
      // keep that reading position; background publication still preserves it.
      stream.scrollTop+=latest.getBoundingClientRect().top-stream.getBoundingClientRect().top;
      selected.position=capturePosition(stream);
    }
  };

  function displayMessage(message) {
    const log = destination(message);
    const stream = log.element;
    const isVisible = visible && selected === log;
    if (isVisible) log.position = capturePosition(stream);

    const gathering = message.gathering;
    const latest = stream.lastElementChild;
    if (gathering && lastGathering?.entry === latest &&
        lastGathering.actionId === gathering.actionId &&
        lastGathering.locationId === gathering.locationId && describeGathering) {
      lastGathering.amount += gathering.amount;
      latest.querySelector('p').textContent = `Recovered ${describeGathering(gathering.itemId, lastGathering.amount)}.`;
      if (isVisible) restorePosition(log);
      return;
    }
    lastGathering = null;

    const entry = document.createElement("div");
    entry.classList.add("log-entry");

    const type = String(message.type || "").toLowerCase();
    const presentation = MESSAGE_PRESENTATIONS[type] ?? DEFAULT_PRESENTATION;

    if (presentation.className) {
      entry.classList.add(presentation.className);
    }

    const metaText = [
      message.cycle,
      presentation.showAuthor ? message.author : null,
      presentation.label
    ]
      .filter(Boolean)
      .map(value => String(value).toUpperCase())
      .join(" / ");

    if (metaText) {
      const meta = document.createElement("span");
      meta.className = "log-meta";
      meta.textContent = metaText;
      entry.append(meta);
    }

    const text = String(message.text ?? "");
    const paragraphs = presentation.paragraphs
      ? text.split(/\r?\n(?:[ \t]*\r?\n)+/).filter(paragraph => paragraph.trim())
      : [text];

    for (const paragraph of paragraphs.length ? paragraphs : [""]) {
      const body = document.createElement("p");
      body.textContent = paragraph;
      entry.append(body);
    }

    stream.append(entry);
    if (log === logs[1]) empty.remove();
    if (gathering) lastGathering = { entry, actionId: gathering.actionId,
      locationId: gathering.locationId, amount: gathering.amount };

    while (stream.querySelectorAll('.log-entry').length > (log === logs[0] ? 250 : 50)) {
      stream.querySelector('.log-entry').remove();
    }

    if (isVisible) restorePosition(log);
  }
}
