const { Client } = require('undici');
const async = require('async');
const { performance } = require('perf_hooks');
const fastJson = require('fast-json-stringify');

const config = {
    selfToken: 'YOUR_ACCOUNT_TOKEN', // hesap tokeninin
    guildId: 'YOUR_GUILD_ID', // url çekeceğiniz sunucu
    vanityCode: 'YOUR_VANITY', // istediğiniz url 
    mfaPassword: 'YOUR_PASSWORD', // hesap şifresi
    webhookUrl: 'YOUR_WEBHOOK_URL', // webhook url
    threadCount: 1000, // Yüksek hız için dokunma
    requestInterval: 5, // Milisaniye cinsinden minimum aralık
    maxRetries: 10 // Rate limit sonrası tekrar sayısı
};

let mfaToken = '';
let claimed = false;
let reqCount = 0;
let startTime = performance.now();
let webhookSent = false;

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

        if (statusCode === 200 && !claimed) {
            claimed = true;
            const totalTime = performance.now() - startTime;
            const msg = `✅ Claimed \`${config.vanityCode}\`\n🔁 Attempts: ${reqCount}\n⏱️ Total: ${Math.round(totalTime)}ms\n🚀 Last ping: ${Math.round(elapsed)}ms`;
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
        // Yalnızca hata oluşursa göster
        if (!claimed) console.log('[!] Request error:', err.message);
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
        console.log('[!] MFA error:', error.message);
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
    console.log('[*] Turbo Sniper başlatıldı...');

    const queue = async.queue(async (_, done) => {
        if (!claimed) await claimVanity();
        done();
    }, config.threadCount);

    queue.error((err) => console.log('[!] Kuyruk hatası:', err));

    setInterval(() => {
        if (!claimed) {
            for (let i = 0; i < config.threadCount; i++) {
                queue.push({});
            }
        }
    }, config.requestInterval);
}

startSniper().catch(console.error);
