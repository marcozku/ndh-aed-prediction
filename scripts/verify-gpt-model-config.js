const fs = require('fs');

function read(file) {
    return fs.readFileSync(file, 'utf8');
}

function assertIncludes(file, needle) {
    const text = read(file);
    if (!text.includes(needle)) {
        throw new Error(`${file} missing expected text: ${needle}`);
    }
}

function assertNotIncludes(file, needle) {
    const text = read(file);
    if (text.includes(needle)) {
        throw new Error(`${file} still contains forbidden text: ${needle}`);
    }
}

assertIncludes('ai-service.js', "const PRIMARY_MODEL = process.env.AI_MODEL || 'gpt-5.5';");
assertIncludes('ai-service.js', "const PRIMARY_FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL || 'gpt-5.4';");

assertIncludes('server.js', "gpt_5_4: 'GPT-5.5'");
assertIncludes('server.js', "gpt_5_5: 'gpt_5_4'");
assertIncludes('server.js', "const GPT55_PROMPT_VERSION = 'gpt55-arm-v1';");
assertIncludes('server.js', "async function generateGpt55PredictionArm");
assertIncludes('server.js', "aiService.callAI(prompt, 'gpt-5.5', 0)");
assertIncludes('server.js', "modelName: 'gpt_5_4'");
assertIncludes('server.js', "modelVersion: 'gpt-5.5'");
assertIncludes('server.js', "arm: 'gpt55_direct'");
assertIncludes('server.js', 'model_name: canonicalizeModelComparisonName(row.model_name)');
assertIncludes('server.js', 'function selectPreferredModelComparisonRow');
assertIncludes('server.js', 'const dedupedRowsByDateAndModel = new Map();');
assertIncludes('server.js', "const key = `${row.date}:${row.model_name}`;");
assertIncludes('sw.js', "const SW_VERSION = '5.2.03';");
assertIncludes('sw.js', "const CACHE_NAME = 'ndh-aed-v5.2.03';");
assertIncludes('index.html', 'prediction.js?v=24');
assertIncludes('index.html', 'app.js?v=11');
assertIncludes('app.js', "modules/ui-enhancements.js?v=6");

for (const file of [
    'server.js',
    'prediction.js',
    'index.html',
    'modules/ui-enhancements.js'
]) {
    assertIncludes(file, 'GPT-5.5');
}

for (const file of [
    'server.js',
    'prediction.js',
    'modules/ui-enhancements.js'
]) {
    assertIncludes(file, 'gpt_5_4');
}

assertNotIncludes('server.js', 'generateGpt54PredictionArm');
assertNotIncludes('server.js', 'GPT54_PROMPT_VERSION');
assertNotIncludes('server.js', 'gpt54_direct');
assertNotIncludes('index.html', 'GPT-5.4');
assertNotIncludes('prediction.js', 'GPT-5.4');
assertNotIncludes('modules/ui-enhancements.js', 'GPT-5.4');
assertNotIncludes('sw.js', 'GPT-5.4');
assertNotIncludes('prediction.js', 'gpt_5_5');
assertNotIncludes('modules/ui-enhancements.js', 'gpt_5_5');

console.log('GPT model config verified: primary gpt-5.5, fallback gpt-5.4, canonical comparison key gpt_5_4.');
