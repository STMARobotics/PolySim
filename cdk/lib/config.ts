// Public deployment coordinates, verified against STMARobotics/fmea-app.
// OAuth secret is retrieved by the auth Lambda from SSM; it is never embedded.
export const production = {
    account: '738044534240', region: 'us-east-2',
    domainName: '7028robotics.com', hostname: 'polysim.7028robotics.com',
    hostedZoneId: 'Z014656337LGZWAE9JKJP',
    googleClientId: '574028865613-kh9gccmi9ccfqsv7s89rdttf7cc1ohj4.apps.googleusercontent.com',
    googleSecretParameter: '/fmea/google-client-secret', allowedDomain: 'stmarobotics.org',
};
