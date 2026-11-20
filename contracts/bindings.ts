const names = new Set(['space', 'shift', 'enter', 'control', 'alt', 'meta', 'tab', 'escape', 'backspace', 'delete', 'insert', 'home', 'end', 'pageup', 'pagedown', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'capslock']);
export function normalizeBinding(value: string): string | undefined {
    if (value === ' ')
        return 'space';
    let key = value.trim().toLowerCase();
    const aliases: Record<string, string> = { spacebar: 'space', return: 'enter', esc: 'escape', ctrl: 'control', option: 'alt', command: 'meta', del: 'delete', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' };
    key = aliases[key] ?? key;
    if (/^key[a-z]$/.test(key))
        key = key.slice(3);
    if (/^digit[0-9]$/.test(key))
        key = key.slice(5);
    if (/^(shift|control|alt|meta)(left|right)$/.test(key))
        key = key.replace(/(left|right)$/, '');
    if (key === 'numpadenter')
        key = 'enter';
    return key.length === 1 || names.has(key) || /^f([1-9]|1[0-2])$/.test(key) ? key : undefined;
}
export function bindingLabel(value: string): string {
    const key = normalizeBinding(value) ?? value;
    const labels: Record<string, string> = { space: 'Space', shift: 'Shift', enter: 'Enter', control: 'Ctrl', alt: 'Alt', meta: 'Meta', tab: 'Tab', escape: 'Esc', backspace: 'Backspace', delete: 'Delete', insert: 'Insert', home: 'Home', end: 'End', pageup: 'Page Up', pagedown: 'Page Down', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', capslock: 'Caps Lock' };
    return labels[key] ?? key.toUpperCase();
}
