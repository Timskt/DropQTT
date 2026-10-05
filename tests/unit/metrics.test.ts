import { describe, expect, it } from 'vitest';
import { buildMetricLegend, buildScrapeConfig, metricsUrl } from '../../src/utils/metrics';

describe('metrics endpoint strings', () => {
  it('builds a YAML block promtool would accept', () => {
    const yaml = buildScrapeConfig(9464);
    expect(yaml).toContain('scrape_configs:');
    expect(yaml).toContain('  - job_name: dropqtt');
    expect(yaml).toContain('    metrics_path: /metrics');
    expect(yaml).toContain("      - targets: ['127.0.0.1:9464']");
    // Every line is either a comment or indented under the list; a stray top-level key
    // is how a pasted block breaks the rest of the file.
    for (const line of yaml.split('\n')) {
      if (!line) continue;
      expect(line).toMatch(/^(#|[a-z_]+:|\s{2,}\S)/);
    }
  });

  it('puts the live port in the target, not the default', () => {
    expect(buildScrapeConfig(19090)).toContain('127.0.0.1:19090');
    expect(buildScrapeConfig(19090)).not.toContain('9464');
  });

  it('never emits a routable address', () => {
    // The endpoint binds loopback; a config suggesting anything else would scrape a
    // address that does not exist and blame the app.
    expect(metricsUrl(9464)).toBe('http://127.0.0.1:9464/metrics');
    for (const port of [1024, 65535]) {
      expect(metricsUrl(port)).toMatch(/^http:\/\/127\.0\.0\.1:/);
    }
  });

  it('documents only series that mean something without a baseline', () => {
    const legend = buildMetricLegend();
    expect(legend).toContain('dropqtt_feed_lost_total');
    expect(legend).toContain('dropqtt_check_status{id}');
    expect(legend).toContain('dropqtt_mqtt_subscriptions_rejected');
  });
});
