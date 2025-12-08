export const ensureHexPrefix = (value: string) =>
  value.startsWith("0x") ? value : `0x${value}`;

export const hexToBytes = (hex: string): number[] => {
  const normalized = ensureHexPrefix(hex).slice(2);
  if (normalized.length % 2 !== 0) {
    throw new Error("Hex string must have even length.");
  }

  const bytes: number[] = [];
  for (let i = 0; i < normalized.length; i += 2) {
    bytes.push(Number.parseInt(normalized.slice(i, i + 2), 16));
  }
  return bytes;
};

export const assertBytesLength = (bytes: number[], expected: number) => {
  if (bytes.length !== expected)
    throw new Error(`Expected ${expected} bytes, got ${bytes.length}.`);
  return bytes;
};
