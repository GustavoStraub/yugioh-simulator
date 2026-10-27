export function newBotDiagnostics() {
    return { decisions: 0, fallbacks: 0, rejected: 0, replans: 0, budgetExhaustions: 0, timings: [] };
}
export function timingPercentiles(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const p = (n) => sorted[Math.max(0, Math.ceil(sorted.length * n) - 1)] ?? 0;
    return { median: p(0.5), p95: p(0.95), p99: p(0.99) };
}
