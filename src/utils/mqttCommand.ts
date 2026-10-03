import type { MqttGenericMessage } from '../types';

export interface CommandBroker {
  host: string;
  port: number;
  tls: boolean;
}

/** POSIX single quotes: the paste target is a shell, and one apostrophe in a
 * device payload would otherwise rewrite the rest of the line. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Text a shell argument can carry verbatim. Tab, newline and CR survive inside
 * single quotes; the rest of the control range has no safe rendering there, and
 * a DEL in the middle of a payload would silently change the message.
 */
const isShellText = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 127) return false;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return false;
  }
  return true;
};

/**
 * The text form is only the payload when re-encoding it gives back the byte count
 * that was recorded. A row whose payload arrived as `""` with `payloadLen: 3` is a
 * decode failure, and copying `-m ''` for it would hand out a command that
 * publishes an empty message where a binary one arrived.
 */
const isFaithfulText = (value: string, byteLen: number): boolean =>
  isShellText(value) && new TextEncoder().encode(value).length === byteLen;

export interface GeneratedCommand {
  command: string;
  /** What the command cannot carry, stated rather than left to discovery. */
  notes: string[];
}

/**
 * The equivalent `mosquitto_pub` for one received row.
 *
 * mosquitto 2.x can set v5 properties with `-D publish <name> <value>`, so a
 * response topic, a content type and text correlation data do survive the
 * translation. What does not: arbitrary bytes in a shell argument, and a payload
 * this app never fully kept. Those become notes instead of a command that looks
 * complete.
 *
 * Credentials are never emitted: a copied line gets pasted into issues and chat,
 * and the broker password is not yours to propagate.
 */
export function mosquittoCommand(msg: MqttGenericMessage, broker: CommandBroker): GeneratedCommand {
  const notes: string[] = [];
  const args = ['-V mqttv5'];
  args.push(`-h ${shellQuote(broker.host)}`, `-p ${String(broker.port)}`);
  if (broker.tls) args.push('--cafile <path>');
  args.push(`-t ${shellQuote(msg.topic)}`, `-q ${String(msg.qos)}`);
  if (msg.retain) args.push('-r');

  if (isFaithfulText(msg.payload, msg.payloadLen)) {
    args.push(`-m ${shellQuote(msg.payload)}`);
  } else {
    // `-f` keeps the bytes exact; the base64 is given so the file can be rebuilt.
    args.push('-f payload.bin');
    notes.push(msg.truncated
      ? `payload was truncated in the feed (${msg.payloadLen} B recorded); write the full bytes to payload.bin first`
      : `payload is not shell-safe text; decode this into payload.bin first: ${msg.payloadBase64}`);
  }

  if (msg.contentType && isShellText(msg.contentType)) {
    args.push(`-D publish content-type ${shellQuote(msg.contentType)}`);
  }
  if (msg.responseTopic && isShellText(msg.responseTopic)) {
    args.push(`-D publish response-topic ${shellQuote(msg.responseTopic)}`);
  }
  if (msg.correlationData && isShellText(msg.correlationData)) {
    args.push(`-D publish correlation-data ${shellQuote(msg.correlationData)}`);
  } else if (msg.correlationHex) {
    notes.push(`correlation data is ${msg.correlationHex.length / 2} raw bytes (${msg.correlationHex}), which -D cannot express as text`);
  }
  for (const [k, v] of msg.userProperties ?? []) {
    if (isShellText(k) && isShellText(v)) {
      args.push(`-D publish user-property ${shellQuote(k)} ${shellQuote(v)}`);
    } else {
      notes.push(`user property ${k} carries bytes a shell argument cannot hold`);
    }
  }

  // A line continuation keeps the command valid when pasted into any POSIX shell
  // while staying readable in a narrow panel.
  return { command: `mosquitto_pub ${args.join(' \\\n  ')}`, notes };
}

/** A single-line form for the clipboard: the notes become trailing comments. */
export function mosquittoCommandText(result: GeneratedCommand): string {
  if (result.notes.length === 0) return result.command;
  return `${result.command}\n${result.notes.map((n) => `# ${n}`).join('\n')}`;
}
