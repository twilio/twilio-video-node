/**
 * Leak and media rules for a finished soak, testable without a live Room.
 *
 * Thresholds are deliberately loose: this flags a trend worth investigating,
 * it does not certify the absence of a leak.
 *
 * @param {object} summary The summary soak.mjs writes.
 * @param {{ rssAdvisory?: boolean }} [options] `rssAdvisory` moves the RSS rules to `advisories`.
 * @returns {{ problems: string[], advisories: string[] }} Problems fail the run.
 */
export function soakFindings(summary, { rssAdvisory = false } = {}) {
  const problems = [];
  const advisories = [];
  const rss = rssAdvisory ? advisories : problems;
  const publishing = summary.mode !== 'idle';
  // A long-lived server is the target, so the slope is the meaningful check;
  // the half-over-half figure is kept as a sanity cross-check.
  if (summary.trendIsMeaningful && summary.rssSlopeMBPerHour > 20) {
    rss.push(`RSS trending +${summary.rssSlopeMBPerHour.toFixed(1)} MB/hour after warm-up`);
  }
  if (summary.trendIsMeaningful && summary.rssGrowthPct > 15) {
    rss.push(
      `RSS grew ${summary.rssGrowthPct.toFixed(1)}% between halves of the steady-state window`,
    );
  }
  if (summary.fdEnd > summary.fdStart * 1.5 && summary.fdEnd - summary.fdStart > 20) {
    problems.push(`fd count rose ${summary.fdStart} -> ${summary.fdEnd}`);
  }
  if (summary.threadEnd > summary.threadStart + 10) {
    problems.push(`thread count rose ${summary.threadStart} -> ${summary.threadEnd}`);
  }
  if (summary.mode === 'full' && summary.videoDelivered === 0) {
    problems.push('no video frames were received');
  }
  if (summary.mode === 'full' && summary.audioDelivered === 0) {
    problems.push('no audio frames were received');
  }
  if (publishing && summary.videoWritten === 0) problems.push('no video frames were written');
  return { problems, advisories };
}
