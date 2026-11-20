export interface Config {
    origin: string;
    allowedDomain: string;
    googleClientId: string;
    secretParameter: string;
    dataTable: string;
    sessionsTable: string;
    secureCookies: boolean;
    adminEmails: string[];
    sessionSeconds: number;
}
export function configuration(env = process.env): Config {
    const required = (name: string) => { const value = env[name]?.trim(); if (!value) throw Error(`Missing ${name}`); return value; };
    const origin = required('APP_ORIGIN'), url = new URL(origin);
    const local = env.APP_ENV === 'local';
    if (url.origin !== origin || url.username || url.password || (!local && url.protocol !== 'https:') || (local && !['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('Invalid APP_ORIGIN');
    const allowedDomain = required('ALLOWED_DOMAIN');
    if (allowedDomain !== 'stmarobotics.org') throw Error('Only stmarobotics.org is authorized for this deployment');
    const adminEmails = (env.ADMIN_EMAILS ?? '').split(',').map(email=>email.trim().toLowerCase()).filter(Boolean);
    if (adminEmails.some(email=>email.length>320 || email.split('@').length!==2 || email.split('@')[1]!==allowedDomain)) throw Error('ADMIN_EMAILS must contain only stmarobotics.org addresses');
    return { origin, allowedDomain, googleClientId: required('GOOGLE_CLIENT_ID'), secretParameter: required('GOOGLE_SECRET_PARAMETER'), dataTable: required('DATA_TABLE'), sessionsTable: required('SESSIONS_TABLE'), secureCookies: !local, adminEmails: [...new Set(adminEmails)], sessionSeconds: 8 * 60 * 60 };
}
