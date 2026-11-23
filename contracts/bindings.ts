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
    return key.length === 1 || names.has(key) || /^f([1-9]|1[0-2])$/.test(key) || /^gamepad:button:([0-9]|[12][0-9]|3[01])$/.test(key) || /^gamepad:axis:([0-9]|1[0-5]):[+-]$/.test(key) ? key : undefined;
}
export function bindingLabel(value: string): string {
    const key = normalizeBinding(value) ?? value;
    if(key.startsWith('gamepad:button:')){
        const index=Number(key.split(':')[2]),buttons=['A / Cross','B / Circle','X / Square','Y / Triangle','LB / L1','RB / R1','LT / L2','RT / R2','Back / Share','Start / Options','Left stick click','Right stick click','D-pad ↑','D-pad ↓','D-pad ←','D-pad →','Home'];
        return `Pad ${buttons[index]??'Button '+(index+1)}`;
    }
    if(key.startsWith('gamepad:axis:')){const [, ,axis,direction]=key.split(':');return `Pad ${Number(axis)<4?['Left stick','Left stick','Right stick','Right stick'][Number(axis)]:'Axis '+axis} ${Number(axis)%2===0?(direction==='+'?'→':'←'):(direction==='+'?'↓':'↑')}`;}
    const labels: Record<string, string> = { space: 'Space', shift: 'Shift', enter: 'Enter', control: 'Ctrl', alt: 'Alt', meta: 'Meta', tab: 'Tab', escape: 'Esc', backspace: 'Backspace', delete: 'Delete', insert: 'Insert', home: 'Home', end: 'End', pageup: 'Page Up', pagedown: 'Page Down', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', capslock: 'Caps Lock' };
    return labels[key] ?? key.toUpperCase();
}
