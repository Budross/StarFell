// Author/UI amounts are m³; gameplay bulk quantities are integer cubic centimetres.
export const VOLUME_SCALE = 1_000_000;
const maximum = BigInt(Number.MAX_SAFE_INTEGER);
export const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
export function safeInteger(value, label = "quantity") {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}: expected a nonnegative safe integer.`);
  return value;
}
export function fromBigInt(value, label = "quantity") {
  if (value < 0n || value > maximum) throw new Error(`Invalid ${label}: arithmetic overflow.`);
  return Number(value);
}
export const checkedAdd = (a, b) => fromBigInt(BigInt(safeInteger(a)) + BigInt(safeInteger(b)));
export const checkedMultiply = (a, b) => fromBigInt(BigInt(safeInteger(a)) * BigInt(safeInteger(b)));
export function decimalRatio(value, authored = false) {
  if (authored && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("Invalid authored decimal amount.");
  if (!authored && typeof value !== "string") throw new Error("Enter a decimal amount.");
  const raw = String(value).trim();
  const text = raw.startsWith(".") ? `0${raw}` : raw;
  const match = text.length <= 400 && text.match(authored
    ? /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i : /^(\d+)(?:\.(\d*))?$/);
  if (!match) throw new Error("Enter a nonnegative decimal amount using a decimal point.");
  const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  let numerator = BigInt(match[1] + (match[2] ?? "")), denominator = 1n;
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
  else denominator = 10n ** BigInt(-exponent);
  return { numerator, denominator };
}
export function volumeUnits(value, authored = true) {
  const { numerator, denominator } = decimalRatio(value, authored);
  const scaled = numerator * BigInt(VOLUME_SCALE);
  if (scaled % denominator) throw new Error("Volume must be a multiple of 0.000001 m³.");
  return fromBigInt(scaled / denominator, "volume");
}
export function quantityKind(id, content) {
  if (!Object.hasOwn(content.resources, id)) throw new Error(`Unknown resource: ${id}`);
  return content.utilities.includes(id) ? "utility" : content.items[id]?.category === "resource" ? "bulk" : "count";
}
export function validateQuantity(amount, id, content) {
  if (quantityKind(id, content) !== "utility") return safeInteger(amount, `${id} quantity`);
  if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER) throw new Error(`Invalid ${id} quantity.`);
  return amount;
}
export function compileQuantity(amount, id, content) {
  return quantityKind(id, content) === "bulk" ? volumeUnits(amount) : validateQuantity(amount, id, content);
}
export function compileAmounts(amounts, content) {
  if (!record(amounts)) throw new Error("Invalid quantity map.");
  return Object.fromEntries(Object.entries(amounts).map(([id, amount]) => [id, compileQuantity(amount, id, content)]));
}
export function parseQuantity(text, id, content) {
  const kind = quantityKind(id, content);
  if (kind === "bulk") return volumeUnits(text, false);
  if (kind === "utility") {
    if (typeof text !== "string" || !text.trim()) throw new Error("Enter an amount.");
    return validateQuantity(Number(text), id, content);
  }
  const { numerator, denominator } = decimalRatio(text);
  if (numerator % denominator) throw new Error("Items require whole counts.");
  return fromBigInt(numerator / denominator);
}
export function formatVolume(units) {
  safeInteger(units, "volume");
  const n = BigInt(units), fraction = String(n % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return `${n / 1_000_000n}${fraction ? `.${fraction}` : ""} m³`;
}
export function formatQuantity(amount, id, content) {
  validateQuantity(amount, id, content);
  return quantityKind(id, content) === "bulk" ? formatVolume(amount) : String(amount);
}
export function sampleQuantity(id, content) {
  return quantityKind(id, content) === "bulk" ? content.items[id].researchSampleVolumeUnits : 1;
}
export function roleQuantity(demand, approval, bulk) {
  const numerator = BigInt(safeInteger(demand)) * (bulk ? 1_000_000n * BigInt(approval.contributionDenominator) : 1n);
  const denominator = BigInt(bulk ? approval.contributionNumerator : approval.units);
  return fromBigInt((numerator + denominator - 1n) / denominator);
}
