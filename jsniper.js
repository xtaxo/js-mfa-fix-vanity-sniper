const { Client } = require('undici');
const async = require('async');
const { performance } = require('perf_hooks');
const fastJson = require('fast-json-stringify');

const config = {
    selfToken: 'YOUR_ACCOUNT_TOKEN',
    guildId: 'YOUR_GUILD_ID',
    vanityCode: 'YOUR_VANITY',
    mfaPassword: 'YOUR_PASSWORD',
    webhookUrl: 'YOUR_WEBHOOK_URL',
    threadCount: 1000,
    requestInterval: 5,
    maxRetries: 10
};

let mfaToken = '';
let claimed = false;
let reqCount = 0;
let startTime = performance.now();
let webhookSent = false;

const vanityPayloadStringify = fastJson({
    type: 'object',
    properties: {
        code: { type: 'string' }
    },
    required: ['code']
});

const mfaPayloadStringify = fastJson({
    type: 'object',
    properties: {
        ticket: { type: 'string' },
        mfa_type: { type: 'string' },
        data: { type: 'string' }
    },
    required: ['ticket', 'mfa_type', 'data']
});

const webhookPayloadStringify = fastJson({
    type: 'object',
    properties: {
        content: { type: 'string' },
        embeds: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    color: { type: 'integer' }
                },
                required: ['title', 'description', 'color']
            }
        }
    },
    required: ['content', 'embeds']
});

const httpClient = new Client('https://discord.com', {
    keepAliveTimeout: 30000,
    keepAliveMaxTimeout: 60000,
    pipelining: 10
});

const baseHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'DiscordSniper/1.0',
    'Authorization': config.selfToken
};

async function claimVanity(retryCount = 0) {
    if (claimed) return;

    const path = `/api/v10/guilds/${config.guildId}/vanity-url`;
    const payload = vanityPayloadStringify({ code: config.vanityCode });
    const headers = mfaToken
        ? { ...baseHeaders, 'X-Discord-MFA-Authorization': mfaToken }
        : baseHeaders;

    try {
        const start = performance.now();
        const { statusCode, body } = await httpClient.request({
            method: 'PATCH',
            path,
            headers,
            body: payload
        });

        const elapsed = performance.now() - start;
        reqCount++;
        const bodyData = await body.json();

        if (statusCode === 200 && !claimed) {
            claimed = true;
            const total = Math.round(performance.now() - startTime);
            const msg = `✅ Claimed \`${config.vanityCode}\`\n🔁 Attempts: ${reqCount}\n⏱️ Total: ${total}ms\n🚀 Last ping: ${Math.round(elapsed)}ms`;
            await sendWebhook('💥 Claimed!', msg, 0x00FF00);
            console.log(msg);
        } else if (statusCode === 401) {
            await handleMFA(bodyData);
        } else if (statusCode === 429 && retryCount < config.maxRetries) {
            const retryAfter = bodyData.retry_after ? bodyData.retry_after * 1000 : 100;
            await new Promise(r => setTimeout(r, retryAfter));
            return claimVanity(retryCount + 1);
        }
    } catch (err) {
        reqCount++;
        if (!claimed) console.warn('[!] Request error:', err.message);
    }
}

async function handleMFA(data) {
    const ticket = data?.mfa?.ticket;
    if (ticket) await submitMFA(ticket);
}

async function submitMFA(ticket) {
    const payload = mfaPayloadStringify({
        ticket,
        mfa_type: 'password',
        data: config.mfaPassword
    });

    try {
        const { statusCode, body } = await httpClient.request({
            method: 'POST',
            path: '/api/v9/mfa/finish',
            headers: baseHeaders,
            body: payload
        });

        if (statusCode === 200) {
            const res = await body.json();
            mfaToken = res.token;
        }
    } catch (err) {
        console.warn('[!] MFA error:', err.message);
    }
}

async function sendWebhook(title, description, color) {
    if (webhookSent) return;
    webhookSent = true;

    const payload = webhookPayloadStringify({
        content: '@everyone',
        embeds: [{ title, description, color }]
    });

    try {
        const path = config.webhookUrl.replace('https://discord.com', '');
        await httpClient.request({
            method: 'POST',
            path,
            headers: baseHeaders,
            body: payload
        });
    } catch (err) {
        console.warn('[!] Webhook error:', err.message);
    }
}

async function startSniper() {
    console.log('🚀 Sniper Başlatıldı');

    const queue = async.queue(async () => {
        if (!claimed) await claimVanity();
    }, config.threadCount);

    queue.error(err => console.warn('[!] Kuyruk hatası:', err.message));

    setInterval(() => {
        if (!claimed) {
            for (let i = 0; i < config.threadCount; i++) {
                queue.push({});
            }
        }
    }, config.requestInterval);
}

startSniper().catch(console.error);
