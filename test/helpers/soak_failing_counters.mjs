// Fake soak_counters.mjs for soak.test.mjs: fails on the sampler's first tick. Call 1 is the check
// before connecting and call 2 the sample taken once connected.
let calls = 0;

export function fdCount() {
  calls++;
  if (calls === 3) throw new Error('fd counter failed on a sampler tick');
  return 1;
}

export const threadCount = () => 1;
