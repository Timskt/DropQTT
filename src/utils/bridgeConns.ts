import type { BridgeRule } from '../types';

/**
 * The bridge's connection list.
 *
 * The backend has always keyed connections by an arbitrary id (`bridge_connect(id, …)`),
 * so "two connections" was never a server limit — it was the panel drawing exactly two
 * cards and two-option dropdowns that pushed each other around when one changed. This is
 * the shape that lets a user have four brokers, several of them sources, several targets,
 * and one that is both.
 *
 * The id is generated and never edited; the label is free text. That split is deliberate:
 * rules reference the id, so a rename must not have to chase them, and a typed label in
 * any script would have to be squashed into the backend's lowercase-12-char rule to become
 * an id — which is how two differently-named connections end up sharing one.
 */
export interface BridgeConnection {
  id: string;
  label: string;
}

/**
 * The two the bridge shipped with. Existing rules name `src` and `dst`, so these stay the
 * default and keep their ids; an empty label means "call it what the translation calls it".
 */
export const DEFAULT_CONNECTIONS: BridgeConnection[] = [
  { id: 'src', label: '' },
  { id: 'dst', label: '' },
];

/** The id the backend accepts: non-empty, at most this long, and lowercase. */
export const CONN_ID_MAX = 12;

/** `c3`, `c4`, … the first number not already taken. */
export const nextConnId = (existing: readonly string[]): string => {
  let n = 1;
  while (existing.includes(`c${n}`)) n += 1;
  return `c${n}`;
};

/**
 * Rules that would be left pointing at nothing.
 *
 * Removing a connection is otherwise silent damage: the rule stays enabled, keeps its
 * filter subscribed on a source that no longer exists, and forwards nothing.
 */
export const rulesUsing = (rules: readonly BridgeRule[], id: string): BridgeRule[] =>
  rules.filter((r) => r.sourceConn === id || (r.targetKind === 'mqtt' && r.targetConn === id));

/**
 * Which connections sit inside a forwarding cycle.
 *
 * A cycle is not a bug — `A→B→C→A` is a real topology and the hop cap bounds it — but the
 * cap travels in an MQTT5 user property, and a v3.1.1 link cannot carry one
 * (`mqttbytes::v4::Publish` has no properties at all). So this exists to name the loops
 * that are *not* protected, rather than to forbid them.
 */
export const connsInCycles = (rules: readonly BridgeRule[]): string[] => {
  const edges = new Map<string, Set<string>>();
  for (const r of rules) {
    // A rule that forwards a connection back onto itself is excluded here: the backend
    // drops the identical-topic echo at route time, and the hop cap covers the rest.
    if (!r.enabled || r.targetKind !== 'mqtt' || r.sourceConn === r.targetConn) continue;
    const set = edges.get(r.sourceConn) ?? new Set<string>();
    set.add(r.targetConn);
    edges.set(r.sourceConn, set);
  }
  const inCycle = new Set<string>();
  // 0 = unvisited, 1 = on the current path, 2 = finished
  const state = new Map<string, number>();
  const dfs = (node: string, path: string[]) => {
    state.set(node, 1);
    path.push(node);
    for (const next of edges.get(node) ?? []) {
      const seen = state.get(next) ?? 0;
      if (seen === 1) {
        // A back edge: everything from `next` to here is one cycle.
        for (const member of path.slice(path.indexOf(next))) inCycle.add(member);
      } else if (seen === 0) {
        dfs(next, path);
      }
    }
    path.pop();
    state.set(node, 2);
  };
  for (const node of edges.keys()) if ((state.get(node) ?? 0) === 0) dfs(node, []);
  return [...inCycle].sort();
};
