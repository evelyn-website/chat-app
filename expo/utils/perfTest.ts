/**
 * Performance diagnostics for encryption operations
 */

import { DEBUG } from './debug';

export class PerfTimer {
  private start: number;
  private marks: Map<string, number> = new Map();

  constructor(private label: string) {
    this.start = performance.now();
  }

  mark(label: string) {
    this.marks.set(label, performance.now());
  }

  report() {
    if (!DEBUG.MESSAGE_FLOW && !DEBUG.RENDER_PERF) return;

    const total = performance.now() - this.start;
    const steps: Record<string, number> = {};

    let prev = this.start;
    this.marks.forEach((time, label) => {
      steps[label] = Math.round(time - prev);
      prev = time;
    });

    if (total > 100) {
      console.warn(`🐌 [PERF] ${this.label} took ${Math.round(total)}ms`, steps);
    } else if (DEBUG.MESSAGE_FLOW) {
      console.log(`⚡ [PERF] ${this.label} took ${Math.round(total)}ms`, steps);
    }
  }
}
