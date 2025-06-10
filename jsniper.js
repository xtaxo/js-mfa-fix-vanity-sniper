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
    threadCount: 200, // Increased for speed, adjust if rate-limited
    requestInterval: 20, // Reduced for faster requests
    maxRetries: 3 // Retry on 429 errors
};

let mfaToken = '';
let claimed = false;
let reqCount = 0;
let startTime = performance.now();
let webhookSent = false;

// Precompiled JSON stringifiers for payloads
const vanityPayloadStringify = fastJson({
    type: 'object',
    properties: { code: { type: 'string' } }
});

const mfaPayloadStringify = fastJson({
    type: 'object',
    properties: {
        ticket: { type: 'string' },
        mfa_type: { type: 'string' },
        data: { type: 'string' }
    }
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
                }
            }
        }
    }
});

// HTTP client with connection pooling
const httpClient = new Client('https://discord.com', {
    keepAliveTimeout: 30000,
    keepAliveMaxTimeout: 60000,
    pipelining: 10
});

const baseHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 sniper-ultra',
    'Authorization': config.selfToken
};

async function claimVanity(retryCount = 0) {
    const url = `/api/v10/guilds/${config.guildId}/vanity-url`;
    const payload = vanityPayloadStringify({ code: config.vanityCode });
    const headers = mfaToken ? { ...baseHeaders, 'X-Discord-MFA-Authorization': mfaToken } : baseHeaders;

    try {
        const start = performance.now();
        const { statusCode, body } = await httpClient.request({
            method: 'PATCH',
            path: url,
            headers,
            body: payload
        });
        const elapsed = performance.now() - start;
        reqCount++;

        const bodyData = await body.json();

        if (statusCode === 200) {
            if (!claimed) {
                claimed = true;
                const totalTime = performance.now() - startTime;
                const message = `✅ Claimed \`${config.vanityCode}\`\n🔁 Attempts: ${reqCount}\n⏱️ Total: ${Math.round(totalTime)}ms\n🚀 Last ping: ${Math.round(elapsed)}ms`;
                await sendWebhook('💥 Claimed!', message, 0x00FF00);
                console.log(message);
            }
        } else if (statusCode === 401) {
            await handleMFA(bodyData);
        } else if (statusCode === 429 && retryCount < config.maxRetries) {
            const retryAfter = bodyData.retry_after ? bodyData.retry_after * 1000 : 100;
            await new Promise(resolve => setTimeout(resolve, retryAfter));
            return claimVanity(retryCount + 1);
        }
    } catch (error) {
        reqCount++;
        console.log('[!] Request error:', error.message);
    }
}

async function handleMFA(respBody) {
    const ticket = respBody?.mfa?.ticket;
    if (!ticket) return;
    await submitMFA(ticket);
}

async function submitMFA(ticket) {
    const url = '/api/v9/mfa/finish';
    const payload = mfaPayloadStringify({
        ticket,
        mfa_type: 'password',
        data: config.mfaPassword
    });

    try {
        const { statusCode, body } = await httpClient.request({
            method: 'POST',
            path: url,
            headers: baseHeaders,
            body: payload
        });
        if (statusCode === 200) {
            const data = await body.json();
            mfaToken = data.token;
        }
    } catch (error) {
        console.log('[!] MFA submission error:', error.message);
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
        await httpClient.request({
            method: 'POST',
            path: config.webhookUrl.replace('https://discord.com', ''),
            headers: baseHeaders,
            body: payload
        });
    } catch (error) {
        console.log('[!] Webhook error:', error.message);
    }
}

async function startSniper() {
    console.log('[*] Ultra-optimized sniper running...');

    const queue = async.queue(async () => {
        if (claimed) return;
        await claimVanity();
    }, config.threadCount);

    queue.error((err) => console.log('[!] Queue error:', err));

    const run = () => {
        if (claimed) return;
        queue.push({}, () => setTimeout(run, config.requestInterval));
    };

    for (let i = 0; i < config.threadCount; i++) run();

    await new Promise(resolve => queue.drain(resolve));
}

startSniper().catch(console.error);
