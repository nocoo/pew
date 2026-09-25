export function sumCounts(...counts: number[]): number {
  let total = 0;
  for (const count of counts) {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("Count exceeds supported integer range");
    total += count;
    if (!Number.isSafeInteger(total)) throw new RangeError("Count exceeds supported integer range");
  }
  return total;
}
