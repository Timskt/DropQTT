/**
 * Front-end half of the Prometheus endpoint: the strings the panel shows and copies.
 *
 * Kept free of React and of `invoke` so the generated scrape config is verifiable
 * under vitest, which is the only way to prove the text a user pastes into
 * `prometheus.yml` is correct without a running Prometheus.
 */

export function metricsUrl(port: number): string {
  return `http://127.0.0.1:${port}/metrics`;
}

/**
 * A `scrape_configs` block for `prometheus.yml`.
 *
 * The job name is fixed rather than typed: a user-supplied string would need quoting
 * rules, and `dropqtt` is what any second instance would collide on anyway — which is
 * a port problem, not a naming one.
 */
export function buildScrapeConfig(port: number): string {
  return [
    '# DropQTT as an edge-side MQTT protocol probe.',
    '# Merge into the scrape_configs section of prometheus.yml, then:',
    '#   promtool check config prometheus.yml && systemctl reload prometheus',
    'scrape_configs:',
    '  - job_name: dropqtt',
    '    metrics_path: /metrics',
    '    scrape_interval: 15s',
    '    static_configs:',
    `      - targets: ['127.0.0.1:${port}']`,
    '',
  ].join('\n');
}

/**
 * The names worth alerting on, as a comment the user can paste next to the config.
 *
 * Only series that mean something *without* a baseline are listed: `feed_lost_total`
 * rising is a retention failure, while `subscriptions` is just a number.
 */
export function buildMetricLegend(): string {
  return [
    '# Alert-worthy series',
    '# dropqtt_mqtt_connected{endpoint}      0 while a profile is configured = the probe is blind',
    '# dropqtt_feed_lost_total               rising = history is incomplete, not just the display',
    '# dropqtt_mqtt_publish_rejected_total   rising = the broker is refusing publishes',
    '# dropqtt_mqtt_subscriptions_rejected   non-zero = a subscription that receives nothing',
    '# dropqtt_rpc_timeouts_total            rising = nobody answers the response topic',
    '# dropqtt_outbox_dead                   non-zero = a webhook endpoint is gone',
    '# dropqtt_check_status{id}              1 warn, 2 error — the ops panel verdict as a number',
    '',
  ].join('\n');
}
