import { useEffect, useMemo, useRef } from 'react';
import { WebhookSink } from '../types';
import { dropSecret } from '../utils/secrets';
import { headerReferences, releasedReferences } from '../utils/webhookHeaders';

/**
 * Remove a stored header value from the keychain once no rule points at it.
 *
 * Diffing the whole set, rather than hooking delete, covers every way a reference can
 * stop being used: a deleted rule, an overwritten value, an import that replaced the
 * list. A reference shared by two rules stays until both are gone. Each hook only
 * diffs its own rules, which is safe because references are minted per sink and never
 * copied between bridge and silence rules.
 */
export function useReleasedHeaderSecrets(
  rules: readonly { webhook?: Partial<WebhookSink>; targets?: Partial<WebhookSink>[] }[],
): void {
  const current = useMemo(() => headerReferences(rules), [rules]);
  // Seeded with what the first render already holds, so mounting releases nothing.
  const previous = useRef<Set<string> | null>(null);
  if (previous.current === null) previous.current = current;

  useEffect(() => {
    const released = releasedReferences(previous.current ?? current, current);
    previous.current = current;
    // A failed delete leaves an orphan only this app could ever have read; failing
    // the user's rule edit over it would be the worse outcome.
    for (const reference of released) void dropSecret(reference, 'webhook');
  }, [current]);
}
