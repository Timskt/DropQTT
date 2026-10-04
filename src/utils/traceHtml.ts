import type { TraceResult } from '../types';

/**
 * A trace as one shareable HTML file.
 *
 * The point of the trace view is that it ends a conversation like
 * "the device answered, but something between us did not" — so the artifact has
 * to survive leaving this machine. Everything is inline: no fonts, no scripts, no
 * network references, nothing that renders differently once the person on the
 * other end is offline.
 *
 * It is also deliberately partial. The broker's address is removed by default,
 * because a host you paste into a ticket is a host someone else now knows about.
 * Payloads stay (they are the evidence) and the file says so at the top, so the
 * choice is made by someone looking at it rather than by a default nobody read.
 */

export interface TraceHtmlInput {
  token: string;
  windowLabel: string;
  sinceMs: number;
  untilMs: number;
  generatedAt: string;
  result: TraceResult;
  /** Removed from the output; kept out of the file rather than redacted after. */
  brokerLabel?: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtClock = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').replace('Z', ' UTC');

/** The text form is the payload only when it re-encodes to the recorded length. */
const faithfulText = (payload: string, byteLen: number): boolean =>
  new TextEncoder().encode(payload).length === byteLen;

const MATCH_LABEL: Record<string, string> = {
  correlation: 'same message',
  topic: 'topic match',
  payload: 'payload match',
};

const CSS = [
  ':root{color-scheme:light dark}',
  'body{margin:0;padding:24px;background:#ffffff;color:#1c1c1f;',
  "font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
  '@media (prefers-color-scheme:dark){body{background:#16171a;color:#e6e6e9}}',
  'h1{font-size:16px;margin:0 0 4px}',
  '.sub{font-size:12px;opacity:.7;margin-bottom:16px}',
  '.warn{border-left:3px solid #d97706;padding:8px 12px;font-size:12px;margin-bottom:16px}',
  'table{border-collapse:collapse;width:100%}',
  'th,td{text-align:left;padding:6px 8px;border-bottom:1px solid rgba(128,128,128,.25);vertical-align:top}',
  'th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;opacity:.7}',
  '.badge{display:inline-block;padding:1px 6px;border-radius:8px;font-size:11px;border:1px solid currentColor}',
  '.corr{color:#2563eb}.other{color:#8a8a92}',
  '.dir-out{color:#2563eb}.dir-in{color:#0f9d58}',
  'pre{margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:9rem;overflow:auto}',
  '.meta{font-size:11px;opacity:.65}',
].join('');

export function buildTraceHtml(input: TraceHtmlInput): string {
  const { token, windowLabel, sinceMs, untilMs, generatedAt, result, brokerLabel } = input;
  const { summary } = result;
  const rows = result.hits
    .map((hit) => {
      const body = faithfulText(hit.payload, hit.payloadLen)
        ? escapeHtml(hit.payload)
        : `<span class="meta">not valid UTF-8 · base64:</span> ${escapeHtml(hit.payloadBase64)}`;
      const props: string[] = [];
      if (hit.properties?.responseTopic) props.push(`response-topic ${escapeHtml(hit.properties.responseTopic)}`);
      if (hit.properties?.correlationData) props.push(`correlation ${escapeHtml(hit.properties.correlationData)}`);
      if (hit.properties?.correlationHex) props.push(`correlation(hex) ${escapeHtml(hit.properties.correlationHex)}`);
      for (const [k, v] of hit.properties?.userProperties ?? []) props.push(`${escapeHtml(k)}: ${escapeHtml(v)}`);
      const matchClass = hit.matchedBy === 'correlation' ? 'corr' : 'other';
      return [
        '<tr>',
        `<td class="meta">${escapeHtml(fmtClock(hit.ts))}</td>`,
        `<td class="dir-${hit.direction === 'out' ? 'out' : 'in'}">${hit.direction === 'out' ? '&rarr;' : '&larr;'}</td>`,
        `<td><span class="badge ${matchClass}">${escapeHtml(MATCH_LABEL[hit.matchedBy] ?? hit.matchedBy)}</span></td>`,
        `<td>${escapeHtml(hit.topic)}<div class="meta">QoS ${hit.qos}${hit.retain ? ' · retained' : ''}${
          hit.truncated ? ' · <b>payload truncated in history</b>' : ''
        }</div>${props.length ? `<div class="meta">${props.join(' · ')}</div>` : ''}</td>`,
        `<td><pre>${body}</pre></td>`,
        '</tr>',
      ].join('');
    })
    .join('\n');

  const redactions = brokerLabel
    ? '<div class="meta">Removed before saving: the broker address, wherever it appeared, is shown as &lt;broker&gt;.</div>'
    : '';
  const multi = summary.correlations.length > 1
    ? `<div class="warn">${summary.correlations.length} different correlation keys are in this window: the token covers several requests, not one conversation.</div>`
    : '';

  const doc = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>DropQTT trace ${escapeHtml(token)}</title>`,
    `<style>${CSS}</style></head><body>`,
    `<h1>Message trace: ${escapeHtml(token)}</h1>`,
    `<div class="sub">${summary.count} hops · ${summary.topics.length} topics · ${summary.inbound} in / ${summary.outbound} out`
      + ` · ${escapeHtml(fmtClock(sinceMs))} &rarr; ${escapeHtml(fmtClock(untilMs))} (window: ${escapeHtml(windowLabel)})`
      + ` · exported ${escapeHtml(generatedAt)}</div>`,
    '<div class="warn"><b>This file contains message payloads.</b> Check it before posting it anywhere public.',
    ` ${redactions}</div>`,
    multi,
    summary.truncated ? '<div class="meta">The trace was capped; older or later hops may exist.</div>' : '',
    '<table><thead><tr><th>When</th><th>Dir</th><th>Why here</th><th>Topic</th><th>Payload</th></tr></thead>',
    `<tbody>\n${rows}\n</tbody></table>`,
    '<p class="meta">Correlation matching means the same exchange; topic and payload matches only mention '
      + 'the token. Bridge forwards and webhook deliveries are not included.</p>',
    '</body></html>',
    '',
  ].join('\n');

  // Scrub last, over the finished document: the address can show up inside a
  // payload, a topic or a user property, and a device's own telemetry is exactly
  // where an operator tends to have pasted the endpoint they were testing.
  if (!brokerLabel) return doc;
  const scrub = (haystack: string): string =>
    haystack.split(brokerLabel).join('&lt;broker&gt;').split(escapeHtml(brokerLabel)).join('&lt;broker&gt;');
  return scrub(doc);
}
