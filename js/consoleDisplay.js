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

export default function consoleDisplay(eventBus, selector = "#narrative-stream") {
  const stream = document.querySelector(selector);

  if (!stream) {
    throw new Error(`Console display target not found: ${selector}`);
  }

  eventBus.subscribe({}, displayMessage);

  let visible = true;
  let position = { followTail: true, anchors: [] };

  function capturePosition() {
    const top = stream.getBoundingClientRect().top;
    return {
      followTail: stream.scrollHeight - stream.scrollTop - stream.clientHeight < 40,
      anchors: [...stream.children]
        .filter(entry => entry.getBoundingClientRect().bottom > top)
        .map(entry => ({ entry, offset: entry.getBoundingClientRect().top - top }))
    };
  }

  function restorePosition() {
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
    onDeactivate() {
      position = capturePosition();
      visible = false;
    },
    onActivate() {
      visible = true;
      restorePosition();
    },
    revealLatest() {
      const latest=stream.querySelector('.log-entry:last-of-type');
      if (!latest) return;
      // Deliberate observation reveals its receipt from the start. Long receipts
      // keep that reading position; background publication still preserves it.
      stream.scrollTop+=latest.getBoundingClientRect().top-stream.getBoundingClientRect().top;
      position=capturePosition();
    }
  };

  function displayMessage(message) {
    if (visible) position = capturePosition();

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

    while (stream.querySelectorAll('.log-entry').length > 100) {
      stream.querySelector('.log-entry').remove();
    }

    if (visible) restorePosition();
  }
}
