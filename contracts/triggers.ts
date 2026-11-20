import {normalizeBinding} from './bindings';

export const TRIGGERS = ['hold', 'press', 'not-pressed'] as const;
export type Trigger = typeof TRIGGERS[number];
export const TRIGGER_OPTIONS: [Trigger, string][] = [['hold', 'Hold'], ['press', 'Press'], ['not-pressed', 'Not Pressed']];

// Not Pressed is continuously eligible while released, including at startup.
export function triggerActive(trigger: Trigger, binding: string, held: ReadonlySet<string>, pressed: ReadonlySet<string>): boolean {
    const key = normalizeBinding(binding);
    if (!key) return false;
    switch (trigger) {
        case 'hold': return held.has(key);
        case 'press': return pressed.has(key);
        case 'not-pressed': return !held.has(key);
        default: return false;
    }
}
