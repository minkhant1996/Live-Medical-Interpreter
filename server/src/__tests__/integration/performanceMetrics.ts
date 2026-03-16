/**
 * Performance Metrics Collector
 * Records and reports LLM performance metrics during tests
 */

export interface LLMMetric {
  testName: string;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  ttfbMs?: number;  // Time to first byte (for streaming)
  costUsd: number;
  success: boolean;
  error?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface PerformanceSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  byOperation: Record<string, {
    count: number;
    avgLatencyMs: number;
    totalTokens: number;
    avgTokens: number;
    totalCostUsd: number;
  }>;
  byModel: Record<string, {
    count: number;
    avgLatencyMs: number;
    totalTokens: number;
    totalCostUsd: number;
  }>;
}

class PerformanceMetricsCollector {
  private metrics: LLMMetric[] = [];
  private startTime: Date | null = null;

  start(): void {
    this.startTime = new Date();
    this.metrics = [];
    console.log("\n" + "═".repeat(80));
    console.log("📊 Performance Test Run Started");
    console.log("═".repeat(80) + "\n");
  }

  record(metric: LLMMetric): void {
    this.metrics.push(metric);

    // Log individual test result
    const status = metric.success ? "✅" : "❌";
    console.log(`${status} ${metric.testName}`);
    console.log(`   Operation: ${metric.operation}`);
    console.log(`   Model: ${metric.model}`);
    console.log(`   Latency: ${metric.latencyMs.toFixed(0)}ms`);
    console.log(`   Tokens: ${metric.inputTokens} in / ${metric.outputTokens} out (${metric.totalTokens} total)`);
    console.log(`   Cost: $${metric.costUsd.toFixed(6)}`);
    if (metric.error) {
      console.log(`   Error: ${metric.error}`);
    }
    console.log("");
  }

  getSummary(): PerformanceSummary {
    const latencies = this.metrics
      .filter(m => m.success)
      .map(m => m.latencyMs)
      .sort((a, b) => a - b);

    const percentile = (arr: number[], p: number): number => {
      if (arr.length === 0) return 0;
      const idx = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, idx)];
    };

    const byOperation: Record<string, { count: number; totalLatency: number; totalTokens: number; totalCost: number }> = {};
    const byModel: Record<string, { count: number; totalLatency: number; totalTokens: number; totalCost: number }> = {};

    for (const m of this.metrics) {
      // By operation
      if (!byOperation[m.operation]) {
        byOperation[m.operation] = { count: 0, totalLatency: 0, totalTokens: 0, totalCost: 0 };
      }
      byOperation[m.operation].count++;
      byOperation[m.operation].totalLatency += m.latencyMs;
      byOperation[m.operation].totalTokens += m.totalTokens;
      byOperation[m.operation].totalCost += m.costUsd;

      // By model
      if (!byModel[m.model]) {
        byModel[m.model] = { count: 0, totalLatency: 0, totalTokens: 0, totalCost: 0 };
      }
      byModel[m.model].count++;
      byModel[m.model].totalLatency += m.latencyMs;
      byModel[m.model].totalTokens += m.totalTokens;
      byModel[m.model].totalCost += m.costUsd;
    }

    return {
      totalTests: this.metrics.length,
      passedTests: this.metrics.filter(m => m.success).length,
      failedTests: this.metrics.filter(m => !m.success).length,
      totalLatencyMs: latencies.reduce((a, b) => a + b, 0),
      avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      minLatencyMs: latencies.length > 0 ? latencies[0] : 0,
      maxLatencyMs: latencies.length > 0 ? latencies[latencies.length - 1] : 0,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      p99LatencyMs: percentile(latencies, 99),
      totalInputTokens: this.metrics.reduce((a, m) => a + m.inputTokens, 0),
      totalOutputTokens: this.metrics.reduce((a, m) => a + m.outputTokens, 0),
      totalTokens: this.metrics.reduce((a, m) => a + m.totalTokens, 0),
      totalCostUsd: this.metrics.reduce((a, m) => a + m.costUsd, 0),
      byOperation: Object.fromEntries(
        Object.entries(byOperation).map(([op, data]) => [op, {
          count: data.count,
          avgLatencyMs: data.totalLatency / data.count,
          totalTokens: data.totalTokens,
          avgTokens: data.totalTokens / data.count,
          totalCostUsd: data.totalCost,
        }])
      ),
      byModel: Object.fromEntries(
        Object.entries(byModel).map(([model, data]) => [model, {
          count: data.count,
          avgLatencyMs: data.totalLatency / data.count,
          totalTokens: data.totalTokens,
          totalCostUsd: data.totalCost,
        }])
      ),
    };
  }

  printReport(): void {
    const summary = this.getSummary();
    const endTime = new Date();
    const totalRunTime = this.startTime
      ? (endTime.getTime() - this.startTime.getTime()) / 1000
      : 0;

    console.log("\n" + "═".repeat(80));
    console.log("📊 PERFORMANCE TEST REPORT");
    console.log("═".repeat(80));

    console.log("\n📈 SUMMARY");
    console.log("─".repeat(40));
    console.log(`Total Tests:     ${summary.totalTests}`);
    console.log(`Passed:          ${summary.passedTests} ✅`);
    console.log(`Failed:          ${summary.failedTests} ❌`);
    console.log(`Total Run Time:  ${totalRunTime.toFixed(2)}s`);

    console.log("\n⏱️  LATENCY METRICS");
    console.log("─".repeat(40));
    console.log(`Average:   ${summary.avgLatencyMs.toFixed(0)}ms`);
    console.log(`Min:       ${summary.minLatencyMs.toFixed(0)}ms`);
    console.log(`Max:       ${summary.maxLatencyMs.toFixed(0)}ms`);
    console.log(`P50:       ${summary.p50LatencyMs.toFixed(0)}ms`);
    console.log(`P95:       ${summary.p95LatencyMs.toFixed(0)}ms`);
    console.log(`P99:       ${summary.p99LatencyMs.toFixed(0)}ms`);

    console.log("\n🔢 TOKEN USAGE");
    console.log("─".repeat(40));
    console.log(`Input Tokens:    ${summary.totalInputTokens.toLocaleString()}`);
    console.log(`Output Tokens:   ${summary.totalOutputTokens.toLocaleString()}`);
    console.log(`Total Tokens:    ${summary.totalTokens.toLocaleString()}`);

    console.log("\n💰 COST");
    console.log("─".repeat(40));
    console.log(`Total Cost:      $${summary.totalCostUsd.toFixed(6)}`);

    console.log("\n📊 BY OPERATION");
    console.log("─".repeat(40));
    for (const [op, data] of Object.entries(summary.byOperation)) {
      console.log(`${op}:`);
      console.log(`  Count:       ${data.count}`);
      console.log(`  Avg Latency: ${data.avgLatencyMs.toFixed(0)}ms`);
      console.log(`  Avg Tokens:  ${data.avgTokens.toFixed(0)}`);
      console.log(`  Total Cost:  $${data.totalCostUsd.toFixed(6)}`);
    }

    console.log("\n🤖 BY MODEL");
    console.log("─".repeat(40));
    for (const [model, data] of Object.entries(summary.byModel)) {
      console.log(`${model}:`);
      console.log(`  Count:       ${data.count}`);
      console.log(`  Avg Latency: ${data.avgLatencyMs.toFixed(0)}ms`);
      console.log(`  Total Cost:  $${data.totalCostUsd.toFixed(6)}`);
    }

    console.log("\n" + "═".repeat(80));
    console.log("📊 End of Performance Report");
    console.log("═".repeat(80) + "\n");
  }

  getMetrics(): LLMMetric[] {
    return [...this.metrics];
  }

  exportJson(): string {
    return JSON.stringify({
      summary: this.getSummary(),
      metrics: this.metrics,
      timestamp: new Date().toISOString(),
    }, null, 2);
  }
}

// Singleton instance
export const perfMetrics = new PerformanceMetricsCollector();
