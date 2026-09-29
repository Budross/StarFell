const SAVE_KEY = "habitat-07-barebones-save";

export function loadGame() {
  const saved = localStorage.getItem(SAVE_KEY);
  return saved ? JSON.parse(saved) : null;
}

export function saveGame(state) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

export function clearGame() {
  localStorage.removeItem(SAVE_KEY);
}
