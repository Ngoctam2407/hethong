const webpush = require('web-push');

const vapidPublicKey = process.env.WEB_PUSH_PUBLIC_KEY || 'BE5jfyzQTrb0w7VViu_7aoQWe3cnEDaMKCG4hOrZkGaATfc4eEC5CSQL6AjccfKJDpJs3RxpDjDjI7h9C4yvPBY';
const vapidPrivateKey = process.env.WEB_PUSH_PRIVATE_KEY || 'rCck0qtpFhvxUsa6EnNwhdRt-wd543caOyp3X_98M3M';
const vapidContact = process.env.WEB_PUSH_CONTACT || 'mailto:admin@kt.edu.vn';

webpush.setVapidDetails(vapidContact, vapidPublicKey, vapidPrivateKey);

function getPublicKey() {
    return vapidPublicKey;
}

function normalizeSubscription(subscription) {
    if (!subscription || typeof subscription !== 'object') return null;
    if (!subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
        return null;
    }

    return {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime || null,
        keys: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth
        }
    };
}

function serializePayload(payload) {
    return JSON.stringify({
        title: payload.title || 'Thong bao moi',
        body: payload.body || 'Ban co mot thong bao moi tu he thong.',
        url: payload.url || '/',
        icon: payload.icon || '/images/logo-kt.png',
        badge: payload.badge || '/images/logo-kt.png'
    });
}

async function sendNotification(subscription, payload) {
    return webpush.sendNotification(subscription, serializePayload(payload));
}

module.exports = {
    getPublicKey,
    normalizeSubscription,
    sendNotification
};
