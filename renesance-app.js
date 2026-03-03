/**
 * Renesance v2.0 -- Инструмент восстановления ассетов TTS
 *
 * Запуск: node renesance-app.js
 * Сборка EXE: npm run pack
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');

// Директория приложения (для pkg -- где лежит EXE, иначе __dirname)
const APP_DIR = typeof process.pkg !== 'undefined'
    ? path.dirname(process.execPath)
    : __dirname;

const CONFIG_PATH = path.join(APP_DIR, 'renesance_config.txt');
const BROKEN_URLS_PATH = path.join(APP_DIR, 'Broken_URLs.txt');
const PLAYER_LOG_PATH = path.join(process.env.USERPROFILE || '', 'AppData', 'LocalLow', 'Berserk Games', 'Tabletop Simulator', 'Player.log');
const DEFAULT_PORT = 39741;

// Стандартные подпапки Mods в TTS
const MODS_SUBDIRS = [
    'Assetbundles', 'Audio', 'Images', 'Images Raw',
    'Models', 'Models Raw', 'PDF', 'Text', 'Translations', 'Workshop'
];

// Расширения файлов -> подпапки Mods
const EXT_MAP = {
    '.obj': 'Models', '.mtl': 'Models', '.fbx': 'Models',
    '.png': 'Images', '.jpg': 'Images', '.jpeg': 'Images',
    '.bmp': 'Images', '.gif': 'Images', '.webp': 'Images', '.tga': 'Images',
    '.unity3d': 'Assetbundles', '.assetbundle': 'Assetbundles',
    '.mp3': 'Audio', '.wav': 'Audio', '.ogg': 'Audio', '.flac': 'Audio',
    '.pdf': 'PDF'
};

// Поля TTS JSON, содержащие URL ассетов
const URL_FIELDS = [
    'ImageURL', 'ImageSecondaryURL', 'MeshURL', 'ColliderURL',
    'DiffuseURL', 'NormalURL', 'AssetbundleURL', 'AssetbundleSecondaryURL',
    'PDFUrl', 'FrontURL', 'BackURL', 'CurrentAudioURL', 'SkyURL', 'TableURL'
];

// ═══════════════════════════════════════
// Конфигурация (текстовый формат)
// ═══════════════════════════════════════

const CONFIG_TEMPLATE = `# ═══════════════════════════════════════════════════════════
# Renesance v2.0 -- Настройки
# ═══════════════════════════════════════════════════════════
# Строки начинающиеся с # -- это комментарии (игнорируются)
# Просто вставляйте пути как есть, НЕ нужно экранировать \\
# ═══════════════════════════════════════════════════════════

# -----------------------------------------------------------
# ПАПКИ-ИСТОЧНИКИ
# Где искать кэшированные файлы TTS.
# Можно указать НЕСКОЛЬКО папок -- каждый путь на НОВОЙ строке.
# Программа будет искать файлы во ВСЕХ указанных папках.
#
# Примеры:
# %USERPROFILE%\\Documents\\My Games\\Tabletop Simulator\\Mods
# C:\\Program Files (x86)\\Steam\\steamapps\\common\\Tabletop Simulator\\Tabletop Simulator_Data\\Mods
# -----------------------------------------------------------
[sourceDirs]


# -----------------------------------------------------------
# ПАПКА НАЗНАЧЕНИЯ
# Куда копировать восстановленные файлы.
# Можно использовать переменную %APP_DIR% (папка программы)
# -----------------------------------------------------------
[outputDir]
%APP_DIR%\\Exported_Mods

# -----------------------------------------------------------
# SAVED OBJECTS
# Путь к папке Saved Objects в TTS.
# Туда будет сохранён куб Renesance.json
# -----------------------------------------------------------
[savedObjectsDir]
%USERPROFILE%\\Documents\\My Games\\Tabletop Simulator\\Saves\\Saved Objects

# -----------------------------------------------------------
# ПАПКА СОХРАНЕНИЙ
# Путь к папке Saves в TTS (где лежат сейвы карт).
# Если не указать -- программа попробует найти сама.
# -----------------------------------------------------------
[savesDir]
%USERPROFILE%\\Documents\\My Games\\Tabletop Simulator\\Saves

# -----------------------------------------------------------
# РОДИТЕЛЬСКАЯ ПАПКА ДЛЯ РЕЖИМА ДЕБАГА
# Путь к папке, ВНУТРИ которой находится папка Mods (например, для Steam-версии).
#
# Если оставить пустым -- режим дебага НЕ активируется.
# -----------------------------------------------------------
[originalModsDir]


# -----------------------------------------------------------
# HTTP ПОРТ
# Порт для связи с TTS (менять не обязательно)
# -----------------------------------------------------------
[httpPort]
39741
`;

function expandEnvVars(str) {
    if (!str) return str;
    return str.replace(/%([^%]+)%/g, (_, n) => {
        if (n === 'APP_DIR') return APP_DIR;
        return process.env[n] || '';
    });
}

function loadConfig() {
    const config = {
        sourceDirs: [],
        outputDir: '',
        savedObjectsDir: '',
        savesDir: '',
        originalModsDir: '',
        httpPort: DEFAULT_PORT
    };

    if (!fs.existsSync(CONFIG_PATH)) {
        fs.writeFileSync(CONFIG_PATH, CONFIG_TEMPLATE, 'utf8');
    }

    try {
        const text = fs.readFileSync(CONFIG_PATH, 'utf8');
        let currentSection = null;

        for (const rawLine of text.split('\n')) {
            const line = rawLine.trim().replace(/^["']|["']$/g, '');
            if (!line || line.startsWith('#')) continue;

            const sectionMatch = line.match(/^\[(\w+)\]$/);
            if (sectionMatch) {
                currentSection = sectionMatch[1];
                continue;
            }

            const expandedLine = expandEnvVars(line);

            if (currentSection === 'sourceDirs' && expandedLine) {
                config.sourceDirs.push(expandedLine);
            } else if (currentSection === 'outputDir' && !config.outputDir && expandedLine) {
                config.outputDir = expandedLine;
            } else if (currentSection === 'savedObjectsDir' && !config.savedObjectsDir && expandedLine) {
                config.savedObjectsDir = expandedLine;
            } else if (currentSection === 'savesDir' && !config.savesDir && expandedLine) {
                config.savesDir = expandedLine;
            } else if (currentSection === 'originalModsDir' && !config.originalModsDir && expandedLine) {
                config.originalModsDir = expandedLine;
            } else if (currentSection === 'httpPort') {
                const port = parseInt(expandedLine);
                if (port > 0 && port < 65536) config.httpPort = port;
            }
        }
    } catch (e) { /* игнорируем ошибки чтения */ }

    return config;
}

function saveConfig(config) {
    let text = '# ═══════════════════════════════════════════════════════════\n';
    text += '# Renesance v2.0 -- Настройки\n';
    text += '# ═══════════════════════════════════════════════════════════\n';
    text += '# Строки начинающиеся с # -- это комментарии (игнорируются)\n';
    text += '# Просто вставляйте пути как есть, НЕ нужно экранировать \\\n';
    text += '# ═══════════════════════════════════════════════════════════\n\n';

    text += '# ПАПКИ-ИСТОЧНИКИ (каждый путь на новой строке)\n';
    text += '[sourceDirs]\n';
    for (const dir of config.sourceDirs) {
        text += dir + '\n';
    }
    text += '\n';

    text += '# ПАПКА НАЗНАЧЕНИЯ\n';
    text += '[outputDir]\n';
    if (config.outputDir) text += config.outputDir + '\n';
    text += '\n';

    text += '# SAVED OBJECTS\n';
    text += '[savedObjectsDir]\n';
    if (config.savedObjectsDir) text += config.savedObjectsDir + '\n';
    text += '\n';

    text += '# ПАПКА СОХРАНЕНИЙ\n';
    text += '[savesDir]\n';
    if (config.savesDir) text += config.savesDir + '\n';
    text += '\n';

    text += '# РОДИТЕЛЬСКАЯ ПАПКА ДЛЯ ДЕБАГ-РЕЖИМА (где лежит Mods)\n';
    text += '[originalModsDir]\n';
    if (config.originalModsDir) text += config.originalModsDir + '\n';
    text += '\n';

    text += '# HTTP ПОРТ\n';
    text += '[httpPort]\n';
    text += config.httpPort + '\n';

    fs.writeFileSync(CONFIG_PATH, text, 'utf8');
}

// ═══════════════════════════════════════
// Утилиты для работы с файлами
// ═══════════════════════════════════════

function urlToCacheName(url) {
    return url.replace(/[^a-zA-Z0-9]/g, '');
}

// Извлечение пути из URL (без протокола и домена) для сопоставления
// через разные CDN домены (cloud3.steamusercontent.com vs steamusercontent-a.akamaihd.net)
function urlToPathKey(url) {
    try {
        const u = new URL(url);
        return u.pathname.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    } catch (e) {
        return url.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    }
}

// Извлечение ключа пути из имени кэш-файла TTS
// TTS именует файлы как httpcloud3steamusercontentcomugcNUMBERHASH.ext
// Извлекаем часть после домена (начиная с ugc/workshop/и т.д.)
function fileNameToPathKey(fileName) {
    const nameNoExt = path.parse(fileName).name.toLowerCase();
    // Ищем маркеры пути в нормализованном имени
    const markers = ['ugc', 'workshop', 'economy'];
    for (const marker of markers) {
        const idx = nameNoExt.indexOf(marker);
        if (idx >= 0) {
            return nameNoExt.substring(idx);
        }
    }
    return null;
}

function getSubdirForExtension(ext) {
    return EXT_MAP[ext.toLowerCase()] || 'Images';
}

function getSubdirFromPath(filePath) {
    const parentDir = path.basename(path.dirname(filePath));
    if (MODS_SUBDIRS.includes(parentDir)) {
        return parentDir;
    }
    const ext = path.extname(filePath);
    return getSubdirForExtension(ext);
}

// Индекс файлов: { нормализованноеИмя -> полный путь }
let fileIndex = null;
// Индекс по пути (без домена): { путь -> полный путь к файлу }
let pathIndex = null;
let fileIndexDirs = null;

function normalizeFileName(filename) {
    return path.parse(filename).name.replace(/[^a-zA-Z0-9]/g, '');
}

function buildFileIndex(sourceDirs) {
    const dirKey = sourceDirs.join('|');
    if (fileIndex && fileIndexDirs === dirKey) return fileIndex;

    console.log('  Индексирую файлы в источниках...');
    fileIndex = new Map();
    pathIndex = new Map();
    fileIndexDirs = dirKey;

    // Расширяем список источников: если папка заканчивается на Mods,
    // автоматически добавляем переименованные варианты (1Mods, _Mods)
    // которые могут остаться от предыдущих сессий дебаг-режима
    const expandedDirs = new Set();
    for (const srcDir of sourceDirs) {
        expandedDirs.add(srcDir);
        const dirName = path.basename(srcDir);
        const parentDir = path.dirname(srcDir);
        if (dirName === 'Mods') {
            for (const variant of ['1Mods', '_Mods', '1mods']) {
                const altDir = path.join(parentDir, variant);
                if (fs.existsSync(altDir)) {
                    expandedDirs.add(altDir);
                    console.log(`  [+] Найдена папка ${variant}, добавлена в сканирование`);
                }
            }
        }
    }

    for (const srcDir of expandedDirs) {
        if (!fs.existsSync(srcDir)) continue;

        // Сканируем подпапки Mods
        for (const sub of MODS_SUBDIRS) {
            const subPath = path.join(srcDir, sub);
            if (!fs.existsSync(subPath)) continue;
            try {
                for (const file of fs.readdirSync(subPath)) {
                    const filePath = path.join(subPath, file);
                    // Основной индекс (полное нормализованное имя)
                    const key = normalizeFileName(file);
                    if (!fileIndex.has(key)) {
                        fileIndex.set(key, filePath);
                    }
                    // Индекс по пути (без домена CDN)
                    const pk = fileNameToPathKey(file);
                    if (pk && !pathIndex.has(pk)) {
                        pathIndex.set(pk, filePath);
                    }
                }
            } catch (e) { /* пропускаем */ }
        }

        // Сканируем корень
        try {
            for (const file of fs.readdirSync(srcDir)) {
                const fullPath = path.join(srcDir, file);
                try {
                    if (fs.statSync(fullPath).isFile()) {
                        const key = normalizeFileName(file);
                        if (!fileIndex.has(key)) {
                            fileIndex.set(key, fullPath);
                        }
                        const pk = fileNameToPathKey(file);
                        if (pk && !pathIndex.has(pk)) {
                            pathIndex.set(pk, fullPath);
                        }
                    }
                } catch (e) { /* пропускаем */ }
            }
        } catch (e) { /* пропускаем */ }
    }

    console.log(`  Проиндексировано: ${fileIndex.size} файлов\n`);
    return fileIndex;
}

function findFileInIndex(cacheName, url) {
    if (!fileIndex) return null;
    // Стратегия 1: точное совпадение по полному нормализованному имени
    const exact = fileIndex.get(cacheName);
    if (exact) return exact;
    // Стратегия 2: совпадение по пути URL (без домена CDN)
    if (pathIndex && url) {
        const pk = urlToPathKey(url);
        const byPath = pathIndex.get(pk);
        if (byPath) return byPath;
    }
    return null;
}

function createOutputMods(outputDir) {
    const outputMods = path.join(outputDir, 'Mods');
    if (!fs.existsSync(outputMods)) {
        fs.mkdirSync(outputMods, { recursive: true });
    }
    for (const sub of MODS_SUBDIRS) {
        const subPath = path.join(outputMods, sub);
        if (!fs.existsSync(subPath)) {
            fs.mkdirSync(subPath, { recursive: true });
        }
    }
    return outputMods;
}

function clearOutputMods(outputDir) {
    if (!fs.existsSync(outputDir)) {
        console.log(`  [!] Папка не найдена: ${outputDir}`);
        return;
    }
    const outputMods = path.join(outputDir, 'Mods');
    if (!fs.existsSync(outputMods)) {
        console.log(`  [!] Папка Mods не найдена: ${outputMods}`);
        return;
    }
    console.log(`  Очистка папки ${outputMods}...`);
    for (const sub of MODS_SUBDIRS) {
        const subPath = path.join(outputMods, sub);
        if (fs.existsSync(subPath)) {
            fs.rmSync(subPath, { recursive: true, force: true });
        }
        fs.mkdirSync(subPath, { recursive: true });
    }
    console.log('  [OK] Структура сохранена, файлы удалены.');
}

// ═══════════════════════════════════════
// HTTP Сервер (принимает данные из TTS Lua куба)
// ═══════════════════════════════════════

let httpServer = null;

function startHttpServer(port) {
    return new Promise((resolve, reject) => {
        httpServer = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            if (req.method === 'PUT' && req.url === '/broken-urls') {
                let body = '';
                req.on('data', chunk => { body += chunk.toString(); });
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        writeBrokenUrlsFile(data);
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        res.end('OK');
                        console.log('\n\n  [OK] Получены данные из TTS! Файл Broken_URLs.txt создан.');
                        console.log(`  Сломанных URL: ${data.brokenCount || 0}`);
                        console.log('\n  Нажмите Enter чтобы вернуться в меню...');
                    } catch (e) {
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end('ERROR: ' + e.message);
                    }
                });
            } else {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Renesance Server OK');
            }
        });

        httpServer.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                reject(new Error(`Порт ${port} занят. Измените порт в настройках.`));
            } else {
                reject(err);
            }
        });

        httpServer.listen(port, '127.0.0.1', () => resolve());
    });
}

function stopHttpServer() {
    return new Promise((resolve) => {
        if (httpServer) {
            httpServer.close(() => resolve());
        } else {
            resolve();
        }
    });
}

// ═══════════════════════════════════════
// Запись Broken_URLs.txt
// ═══════════════════════════════════════

function writeBrokenUrlsFile(data) {
    let content = '# Renesance -- Сломанные URL\n';
    content += `# Дата: ${data.timestamp || new Date().toISOString()}\n`;
    content += `# Всего проверено: ${data.totalScanned || 0}\n`;
    content += `# Сломанных: ${data.brokenCount || 0}\n`;
    content += '#\n';

    if (data.entries && Array.isArray(data.entries)) {
        for (const entry of data.entries) {
            content += entry.url + '\n';
        }
    }

    fs.writeFileSync(BROKEN_URLS_PATH, content, 'utf8');
}

// ═══════════════════════════════════════
// Извлечение URL из TTS сейв-файла
// ═══════════════════════════════════════

function extractUrlsFromSave(obj) {
    const results = [];
    if (!obj || typeof obj !== 'object') return results;

    const objName = obj.Nickname || obj.GUID || 'unknown';

    for (const field of URL_FIELDS) {
        if (obj[field] && typeof obj[field] === 'string' && obj[field].startsWith('http')) {
            results.push({ url: obj[field].trim(), field, objectName: objName });
        }
    }

    for (const section of ['CustomImage', 'CustomMesh', 'CustomAssetbundle', 'CustomPDF']) {
        if (obj[section]) {
            for (const key of Object.keys(obj[section])) {
                const val = obj[section][key];
                if (typeof val === 'string' && val.startsWith('http')) {
                    results.push({ url: val.trim(), field: `${section}.${key}`, objectName: objName });
                }
            }
        }
    }

    if (obj.CustomDeck) {
        for (const deckId of Object.keys(obj.CustomDeck)) {
            const deck = obj.CustomDeck[deckId];
            if (deck) {
                for (const key of Object.keys(deck)) {
                    const val = deck[key];
                    if (typeof val === 'string' && val.startsWith('http')) {
                        results.push({ url: val.trim(), field: `CustomDeck.${deckId}.${key}`, objectName: objName });
                    }
                }
            }
        }
    }

    if (obj.States) {
        for (const stateId of Object.keys(obj.States)) {
            results.push(...extractUrlsFromSave(obj.States[stateId]));
        }
    }

    if (obj.ContainedObjects && Array.isArray(obj.ContainedObjects)) {
        for (const child of obj.ContainedObjects) {
            results.push(...extractUrlsFromSave(child));
        }
    }

    return results;
}

function parseSaveFile(savePath) {
    const saveText = fs.readFileSync(savePath, 'utf8');
    const saveData = JSON.parse(saveText);
    const allEntries = [];

    // Структурированный парсинг стандартных полей TTS
    if (saveData.ObjectStates && Array.isArray(saveData.ObjectStates)) {
        for (const obj of saveData.ObjectStates) {
            allEntries.push(...extractUrlsFromSave(obj));
        }
    }

    // Глобальный поиск через Regex для тех ссылок, которые спрятаны внутри script_state и т.д.
    const knownUrls = new Set(allEntries.map(e => e.url));
    const regex = /https?:\/\/[^\s"'\\]+/g;
    const matches = saveText.match(regex) || [];
    const uniqueMatches = [...new Set(matches)];

    let hiddenCount = 0;
    for (const url of uniqueMatches) {
        if (!knownUrls.has(url)) {
            allEntries.push({
                url: url,
                field: 'Embedded/ScriptState',
                objectName: 'Hidden Object'
            });
            knownUrls.add(url);
            hiddenCount++;
        }
    }

    if (hiddenCount > 0) {
        console.log(`  [+] Найдено ${hiddenCount} скрытых URL внутри скриптов/текста`);
    }

    return allEntries;
}

function getUniqueUrls(entries) {
    const map = new Map();
    for (const entry of entries) {
        if (!map.has(entry.url)) {
            map.set(entry.url, []);
        }
        map.get(entry.url).push(entry);
    }
    return map;
}

// ═══════════════════════════════════════
// Восстановление файлов (только сломанные)
// ═══════════════════════════════════════

async function recoverFiles(rl, config) {
    console.log('\n  === ВОССТАНОВЛЕНИЕ (УМНЫЙ ЭКСПОРТ) ===');
    console.log('  Проверяет все ссылки из сейва.');
    console.log('  Копирует ТОЛЬКО те файлы, которых НЕТ в облаке (битые ссылки).');
    console.log('  Готовую папку можно передать другому игроку.\n');

    const savePath = await askForSaveFile(rl, config);
    if (!savePath || !fs.existsSync(savePath)) {
        if (savePath) console.log('  [!] Файл не найден: ' + savePath);
        return;
    }

    if (config.sourceDirs.length === 0) {
        console.log('  [!] Не указаны папки-источники! Настройте в конфиге.');
        return;
    }

    if (!config.outputDir) {
        console.log('  [!] Не указана папка назначения! Настройте в конфиге.');
        return;
    }

    console.log('\n  Загружаю сейв...');
    let allEntries;
    try {
        allEntries = parseSaveFile(savePath);
    } catch (e) {
        console.log('  [!] Ошибка чтения: ' + e.message);
        return;
    }

    const uniqueUrls = getUniqueUrls(allEntries);

    console.log(`  Всего URL: ${allEntries.length}`);
    console.log(`  Уникальных: ${uniqueUrls.size}\n`);

    const index = buildFileIndex(config.sourceDirs);
    const outputMods = createOutputMods(config.outputDir);

    let found = 0;
    let notFound = 0;
    let alive = 0;
    let dead = 0;
    let totalBytes = 0;
    const reportLines = [];
    const total = uniqueUrls.size;

    console.log('  Пингую ссылки и ищу файлы в кэше...\n');

    const checkUrlAlive = async (url) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            let res = await fetch(url, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) return true;
            if (res.status === 405 || res.status === 501) {
                const ctrl2 = new AbortController();
                const tid2 = setTimeout(() => ctrl2.abort(), 8000);
                const res2 = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: ctrl2.signal });
                clearTimeout(tid2);
                return res2.ok || res2.status === 206;
            }
            return false;
        } catch (e) {
            return false;
        }
    };

    let progress = 0;
    const concurrency = 20;
    const queue = Array.from(uniqueUrls.entries());

    const worker = async () => {
        while (queue.length > 0) {
            const [url, entries] = queue.shift();

            const isAlive = await checkUrlAlive(url);
            if (isAlive) {
                alive++;
            } else {
                dead++;
                const cacheName = urlToCacheName(url);
                const sourceFile = findFileInIndex(cacheName, url);

                if (sourceFile) {
                    const subdir = getSubdirFromPath(sourceFile);
                    const destFile = path.join(outputMods, subdir, path.basename(sourceFile));
                    try {
                        if (!fs.existsSync(destFile)) {
                            fs.copyFileSync(sourceFile, destFile);
                        }
                        const size = fs.existsSync(destFile) ? fs.statSync(destFile).size : 0;
                        totalBytes += size;
                        found++;
                        reportLines.push(`[ВОССТАНОВЛЕН] ${path.basename(sourceFile)} (${subdir}) <- ${url}`);
                    } catch (err) {
                        notFound++;
                        reportLines.push(`[ОШИБКА КОПИРОВАНИЯ] ${url} : ${err.message}`);
                    }
                } else {
                    notFound++;
                    reportLines.push(`[ПОТЕРЯН НАВСЕГДА] ${url}`);
                }
            }
            progress++;
            process.stdout.write(`\r  Проверено: ${progress}/${total} | Живых: ${alive} | Битых: ${dead} | Найдено локально: ${found}      `);
        }
    };

    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    console.log('\n'); // clear line
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    console.log('  =====================');
    console.log(`  Живых ссылок (в облаке):  ${alive}`);
    console.log(`  Битых ссылок (нет в обл): ${dead}`);
    console.log(`  Восстановлено из кэша:    ${found} файлов (${totalMB} MB)`);
    console.log(`  Не найдено в кэше:        ${notFound}`);
    console.log(`  Результат:                ${outputMods}`);

    const reportPath = path.join(config.outputDir, 'smart_recovery_report.txt');
    let report = 'Renesance -- Умное восстановление битых ссылок\n';
    report += `Сейв: ${savePath}\n`;
    report += `Дата: ${new Date().toISOString()}\n`;
    report += `Живых: ${alive} | Мёртвых: ${dead}\n`;
    report += `Восстановлено: ${found} (${totalMB} MB) | Потеряно: ${notFound}\n\n`;
    report += reportLines.join('\n') + '\n';
    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(`  Отчёт:                    ${reportPath}`);
}

// ═══════════════════════════════════════
// Выбор сейв-файла (интерактивный)
// ═══════════════════════════════════════

function detectSavesDir(config) {
    if (config.savesDir && fs.existsSync(config.savesDir)) return config.savesDir;
    if (config.savedObjectsDir) {
        const parent = path.dirname(config.savedObjectsDir);
        if (fs.existsSync(parent)) return parent;
    }
    const autoPath = path.join(
        process.env.USERPROFILE || '', 'Documents', 'My Games',
        'Tabletop Simulator', 'Saves'
    );
    if (fs.existsSync(autoPath)) return autoPath;
    return null;
}

function getSaveNameFromFile(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
        fs.closeSync(fd);

        const chunk = buffer.toString('utf8', 0, bytesRead);
        const match = chunk.match(/"SaveName"\s*:\s*"([^"]+)"/);
        return match ? match[1] : '';
    } catch (e) {
        return '';
    }
}

async function askForSaveFile(rl, config) {
    const savesDir = detectSavesDir(config);

    if (savesDir) {
        try {
            const files = fs.readdirSync(savesDir)
                .filter(f => f.endsWith('.json') && f.startsWith('TS_Save'))
                .sort();

            if (files.length > 0) {
                console.log(`  Папка сохранений: ${savesDir}`);
                console.log(`  Найдено сейвов: ${files.length}\n`);

                // Показываем последние 15 (самые свежие)
                const show = files.slice(-15);
                const offset = files.length - show.length;
                for (let i = 0; i < show.length; i++) {
                    const fp = path.join(savesDir, show[i]);
                    const stat = fs.statSync(fp);
                    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
                    const date = stat.mtime.toLocaleDateString('ru-RU');
                    const saveName = getSaveNameFromFile(fp);
                    const nameStr = saveName ? ` - "${saveName}"` : '';
                    console.log(`  ${i + 1}.  ${show[i]}${nameStr}  (${sizeMB} MB, ${date})`);
                }
                console.log('');
                console.log('  0.  Ввести путь вручную');
                console.log('');

                const choice = await ask(rl, '  Номер сейва: ');

                if (choice === '0') {
                    return await ask(rl, '  Путь к .json файлу:\n  > ');
                }

                const idx = parseInt(choice) - 1;
                if (idx >= 0 && idx < show.length) {
                    return path.join(savesDir, show[idx]);
                }

                console.log('  [!] Неверный номер');
                return null;
            }
        } catch (e) { /* fallback к ручному вводу */ }
    }

    console.log('  Папка сохранений не найдена.');
    console.log('  Укажите savesDir в конфиге или введите путь вручную.\n');
    return await ask(rl, '  Путь к .json файлу:\n  > ');
}

// ═══════════════════════════════════════
// Анализ сейв-файла (найти сломанные URL)
// ═══════════════════════════════════════

async function analyzeSaveFile(rl, config) {
    console.log('\n  === АНАЛИЗ СЕЙВ-ФАЙЛА ===');
    console.log('  Находит Steam URL, которых нет в локальном кэше.');
    console.log('  Результат сохраняется в Broken_URLs.txt\n');

    const savePath = await askForSaveFile(rl, config);
    if (!savePath || !fs.existsSync(savePath)) {
        if (savePath) console.log('  [!] Файл не найден: ' + savePath);
        return;
    }

    if (config.sourceDirs.length === 0) {
        console.log('  [!] Не указаны папки-источники! Настройте в конфиге.');
        return;
    }

    console.log('\n  Загружаю сейв...');
    let allEntries;
    try {
        allEntries = parseSaveFile(savePath);
    } catch (e) {
        console.log('  [!] Ошибка чтения: ' + e.message);
        return;
    }

    const uniqueUrls = getUniqueUrls(allEntries);

    console.log(`  Всего URL: ${allEntries.length}`);
    console.log(`  Уникальных URL: ${uniqueUrls.size}\n`);

    const index = buildFileIndex(config.sourceDirs);

    let foundCount = 0;
    let missingCount = 0;
    const missingUrls = [];

    for (const [url, entries] of uniqueUrls) {
        const cacheName = urlToCacheName(url);
        if (findFileInIndex(cacheName, url)) {
            foundCount++;
        } else {
            missingCount++;
            missingUrls.push({ url, entries });
            const objNames = entries.map(e => e.objectName).filter((v, i, a) => a.indexOf(v) === i);
            console.log(`  [--] ${url.substring(0, 70)}...`);
            console.log(`       Объекты: ${objNames.join(', ')}`);
        }
    }

    console.log('\n  =====================');
    console.log(`  В кэше:  ${foundCount}`);
    console.log(`  Нет:     ${missingCount}`);
    console.log(`  Всего:   ${uniqueUrls.size}`);

    if (missingCount > 0) {
        let content = '# Renesance -- Сломанные URL (анализ сейва)\n';
        content += `# Сейв: ${savePath}\n`;
        content += `# Дата: ${new Date().toISOString()}\n`;
        content += `# Сломанных: ${missingCount}\n#\n`;
        for (const m of missingUrls) {
            content += m.url + '\n';
        }
        fs.writeFileSync(BROKEN_URLS_PATH, content, 'utf8');
        console.log(`\n  Broken_URLs.txt создан (${missingCount} URL)`);
        console.log('  Используйте пункт 3 для восстановления.');
    } else {
        console.log('\n  Все файлы на месте!');
    }
}

// ═══════════════════════════════════════
// Авто-Патч из лога TTS
// ═══════════════════════════════════════

function extractFailedUrlsFromLog() {
    if (!fs.existsSync(PLAYER_LOG_PATH)) return [];
    const logText = fs.readFileSync(PLAYER_LOG_PATH, 'utf8');
    const failedUrls = new Set();

    const modelRegex = /Failed to load Model.+?:\s*(https?:\/\/[^\s]+)/g;
    let match;
    while ((match = modelRegex.exec(logText)) !== null) {
        failedUrls.add(match[1].trim());
    }

    const atRegex = /at\s+\[(https?:\/\/[^\]]+)\]/g;
    while ((match = atRegex.exec(logText)) !== null) {
        failedUrls.add(match[1].trim());
    }

    const pureAtRegex = /WWW Error:.+?at\s+(https?:\/\/[^\s]+)/g;
    while ((match = pureAtRegex.exec(logText)) !== null) {
        let u = match[1].trim();
        if (u.endsWith(']')) u = u.slice(0, -1);
        failedUrls.add(u);
    }

    return Array.from(failedUrls);
}

async function patchSaveFile(rl, config) {
    console.log('\n  \x1b[1m\x1b[32m=== АВТО-ПАТЧ СОХРАНЕНИЯ (ИЗ ЛОГА) ===\x1b[0m');
    console.log('  Читает Player.log игры, находит мертвые ссылки,');
    console.log('  ищет их у вас локально и прописывает в сейв file:/// пути.\n');

    if (!fs.existsSync(PLAYER_LOG_PATH)) {
        console.log(`  \x1b[31m[!] Лог игры не найден:\x1b[0m ${PLAYER_LOG_PATH}`);
        console.log('  Возможно вы еще не запускали TTS или путь к AppData другой.');
        return;
    }

    if (config.sourceDirs.length === 0) {
        console.log('  \x1b[31m[!]\x1b[0m Не указаны папки-источники в конфиге!');
        return;
    }

    const failedUrls = extractFailedUrlsFromLog();
    if (failedUrls.length === 0) {
        console.log('  \x1b[33m[!]\x1b[0m В Player.log не найдено ошибок загрузки ссылок.');
        console.log('  Инструкция:');
        console.log('  1. Запустите игру и Режим дебага.');
        console.log('  2. Загрузите проблемную карту.');
        console.log('  3. Дождитесь загрузки ВСЕХ элементов и лога красных ошибок в чате.');
        console.log('  4. Закройте игру и сразу вернитесь сюда.');
        return;
    }

    console.log(`  Найдено \x1b[33m${failedUrls.length}\x1b[0m сломанных URL в логе игры.`);

    const savePath = await askForSaveFile(rl, config);
    if (!savePath || !fs.existsSync(savePath)) return;

    console.log('\n  Загружаю сейв и локальный кэш (БЕЗ изменения изначальных файлов)...');
    let saveText;
    try {
        saveText = fs.readFileSync(savePath, 'utf8');
    } catch (e) {
        console.log('  \x1b[31m[!]\x1b[0m Ошибка чтения сейва: ' + e.message);
        return;
    }

    const index = buildFileIndex(config.sourceDirs);

    let patchedCount = 0;
    let notFoundLocalCount = 0;

    for (const url of failedUrls) {
        const cacheName = urlToCacheName(url);
        const localPath = findFileInIndex(cacheName, url);

        if (localPath) {
            let fileUri = 'file:///' + localPath.replace(/\\/g, '/');
            const before = saveText;
            saveText = saveText.split(url).join(fileUri);

            if (before !== saveText) {
                patchedCount++;
                console.log(`  \x1b[32m[OK]\x1b[0m Пропатчен: ${url.substring(0, 50)}...`);
            }
        } else {
            notFoundLocalCount++;
            console.log(`  \x1b[31m[MISS]\x1b[0m Нет локально: ${url.substring(0, 50)}...`);
        }
    }

    console.log('\n  =====================');
    console.log(`  Успешно заменено: \x1b[32m${patchedCount}\x1b[0m ссылок`);
    console.log(`  Нет в кэше вообще: \x1b[31m${notFoundLocalCount}\x1b[0m`);

    if (patchedCount > 0) {
        const parsedPath = path.parse(savePath);
        const newSavePath = path.join(parsedPath.dir, parsedPath.name + '_PATCHED' + parsedPath.ext);

        fs.writeFileSync(newSavePath, saveText, 'utf8');
        console.log(`\n  \x1b[1m\x1b[32m[УСПЕХ]\x1b[0m Новый сейв сохранён как:\n  \x1b[36m${newSavePath}\x1b[0m`);
        console.log('\n  Инструкция дальше:');
        console.log('  1. Загрузите этот _PATCHED сейв в игре.');
        console.log('  2. Обновите мод или нажмите "Cloud Manager -> Upload All".');
        console.log('  3. TTS сам заменит локальные файлы на свежие вечные Cloud ссылки!');
    } else {
        console.log('\n  \x1b[33mИзменений не внесено.\x1b[0m');
    }
}

// ═══════════════════════════════════════
// Полный экспорт всех ассетов из сейва
// ═══════════════════════════════════════

async function fullExport(rl, config) {
    console.log('\n  === ПОЛНЫЙ ЭКСПОРТ АССЕТОВ ===');
    console.log('  Копирует ВСЕ файлы из сейва в одну папку.');
    console.log('  Готовую папку можно передать другому игроку.\n');

    const savePath = await askForSaveFile(rl, config);
    if (!savePath || !fs.existsSync(savePath)) {
        if (savePath) console.log('  [!] Файл не найден: ' + savePath);
        return;
    }

    if (config.sourceDirs.length === 0) {
        console.log('  [!] Не указаны папки-источники! Настройте в конфиге.');
        return;
    }

    if (!config.outputDir) {
        console.log('  [!] Не указана папка назначения! Настройте в конфиге.');
        return;
    }

    console.log('\n  Загружаю сейв...');
    let allEntries;
    try {
        allEntries = parseSaveFile(savePath);
    } catch (e) {
        console.log('  [!] Ошибка чтения: ' + e.message);
        return;
    }

    // Все уникальные URL (не только Steam)
    const uniqueUrls = getUniqueUrls(allEntries);

    console.log(`  Всего URL: ${allEntries.length}`);
    console.log(`  Уникальных: ${uniqueUrls.size}\n`);

    const index = buildFileIndex(config.sourceDirs);
    const outputMods = createOutputMods(config.outputDir);

    let found = 0;
    let notFound = 0;
    let totalBytes = 0;
    const reportLines = [];
    let counter = 0;
    const total = uniqueUrls.size;

    for (const [url, entries] of uniqueUrls) {
        counter++;
        const cacheName = urlToCacheName(url);
        const sourceFile = findFileInIndex(cacheName, url);

        if (sourceFile) {
            const subdir = getSubdirFromPath(sourceFile);
            const destFile = path.join(outputMods, subdir, path.basename(sourceFile));

            try {
                if (!fs.existsSync(destFile)) {
                    fs.copyFileSync(sourceFile, destFile);
                }
                const size = fs.existsSync(destFile) ? fs.statSync(destFile).size : 0;
                totalBytes += size;
                found++;

                if (counter % 10 === 0 || counter === total) {
                    const mb = (totalBytes / (1024 * 1024)).toFixed(1);
                    console.log(`  [${counter}/${total}] Найдено: ${found} | ${mb} MB`);
                }
                reportLines.push(`[OK] ${path.basename(sourceFile)} (${subdir}) <- ${url}`);
            } catch (err) {
                notFound++;
                reportLines.push(`[ERROR COPY] ${url} : ${err.message}`);
            }
        } else {
            notFound++;
            reportLines.push(`[MISS] ${url}`);
        }
    }

    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    console.log('\n  =====================');
    console.log(`  Скопировано:  ${found} файлов (${totalMB} MB)`);
    console.log(`  Не найдено:   ${notFound}`);
    console.log(`  Результат:    ${outputMods}`);

    const reportPath = path.join(config.outputDir, 'full_export_report.txt');
    let report = 'Renesance -- Полный экспорт\n';
    report += `Сейв: ${savePath}\n`;
    report += `Дата: ${new Date().toISOString()}\n`;
    report += `Скопировано: ${found} (${totalMB} MB) | Не найдено: ${notFound}\n\n`;
    report += reportLines.join('\n') + '\n';
    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(`  Отчёт:        ${reportPath}`);

    if (notFound > 0) {
        console.log(`\n  [!] ${notFound} файлов не найдено в источниках.`);
        console.log('  Добавьте больше папок-источников в конфиг.');
    }
}

// ═══════════════════════════════════════
// Сборка TTS объекта (куба)
// ═══════════════════════════════════════

function buildTTSObject(config) {
    if (!config.savedObjectsDir) {
        console.log('  [!] Не указана папка Saved Objects. Настройте в конфиге.');
        return;
    }

    const luaTemplatePath = typeof process.pkg !== 'undefined'
        ? path.join(__dirname, 'renesance_cube.lua')
        : path.join(APP_DIR, 'renesance_cube.lua');

    let luaScript;
    try {
        luaScript = fs.readFileSync(luaTemplatePath, 'utf8');
    } catch (e) {
        console.log('  [!] Не найден файл renesance_cube.lua');
        return;
    }

    luaScript = luaScript.replace('{{PORT}}', String(config.httpPort || DEFAULT_PORT));

    const chars = '0123456789abcdef';
    let guid = '';
    for (let i = 0; i < 6; i++) guid += chars[Math.floor(Math.random() * 16)];

    const savedObject = {
        SaveName: "",
        Date: "",
        VersionNumber: "",
        GameMode: "",
        GameType: "",
        GameComplexity: "",
        Tags: [],
        Gravity: 0.5,
        PlayArea: 0.5,
        Table: "",
        Sky: "",
        Note: "",
        TabStates: {},
        LuaScript: "",
        LuaScriptState: "",
        XmlUI: "",
        ObjectStates: [{
            GUID: guid,
            Name: "BlockSquare",
            Transform: {
                posX: 0, posY: 2, posZ: 0,
                rotX: 0, rotY: 0, rotZ: 0,
                scaleX: 1.5, scaleY: 1.5, scaleZ: 1.5
            },
            Nickname: "Renesance",
            Description: "=== Renesance v2.0 ===\nГотов к работе.\nПКМ -> Сканировать Сцену",
            GMNotes: "",
            ColorDiffuse: { r: 0.9, g: 0.6, b: 0.1 },
            LayoutGroupSortIndex: 0,
            Value: 0,
            Locked: false,
            Grid: true,
            Snap: true,
            IgnoreFoW: false,
            MeasureMovement: false,
            DragSelectable: true,
            Autoraise: true,
            Sticky: true,
            Tooltip: true,
            GridProjection: false,
            HideWhenFaceDown: false,
            Hands: false,
            LuaScript: luaScript,
            LuaScriptState: "",
            XmlUI: ""
        }]
    };

    if (!fs.existsSync(config.savedObjectsDir)) {
        fs.mkdirSync(config.savedObjectsDir, { recursive: true });
    }

    const outputPath = path.join(config.savedObjectsDir, 'Renesance.json');
    fs.writeFileSync(outputPath, JSON.stringify(savedObject, null, 2), 'utf8');
    console.log(`  [OK] Куб собран: ${outputPath}`);
    console.log('  В TTS: Objects -> Saved Objects -> "Renesance"');
}

// ═══════════════════════════════════════
// Режим дебага -- подмена папки Mods
// ═══════════════════════════════════════

// Флаг: активен ли сейчас дебаг-режим (для корректного отката)
let debugModeActive = false;
// Сохраняем конфиг для cleanup
let debugConfig = null;

/**
 * Активирует дебаг-режим:
 * 1. Переименовывает оригинальную Mods -> _Mods (бэкап)
 * 2. Создаёт НОВУЮ пустую папку Mods с такой же структурой подпапок
 */
function activateDebugMods(config) {
    if (!config.originalModsDir) {
        console.log('  [!] Не указана папка originalModsDir в конфиге.');
        console.log('  Укажите путь к родительской папке (где лежит Mods).');
        return false;
    }

    const parentDir = config.originalModsDir;
    const modsDir = path.join(parentDir, 'Mods');
    const backupDir = path.join(parentDir, '_Mods');

    // Если _Mods уже существует — значит дебаг-режим уже был активирован ранее
    if (fs.existsSync(backupDir)) {
        console.log('  [!] Папка _Mods уже существует: ' + backupDir);
        console.log('  Возможно дебаг-режим уже активен или предыдущий запуск завершился некорректно.');
        console.log('  Переименуйте _Mods обратно в Mods вручную, если нужно.');
        return false;
    }

    if (!fs.existsSync(modsDir)) {
        console.log('  [!] Папка Mods не найдена в: ' + parentDir);
        return false;
    }

    try {
        // Считываем список подпапок из оригинальной Mods ПЕРЕД переименованием
        const subdirs = fs.readdirSync(modsDir).filter(name => {
            try {
                return fs.statSync(path.join(modsDir, name)).isDirectory();
            } catch (e) { return false; }
        });
        console.log(`  Найдено ${subdirs.length} подпапок в Mods: ${subdirs.join(', ')}`);

        // 1. Переименовываем Mods -> _Mods
        console.log('  Переименовываю Mods -> _Mods...');
        fs.renameSync(modsDir, backupDir);

        // 2. Создаём новую пустую папку Mods с такой же структурой подпапок
        console.log('  Создаю новую пустую папку Mods...');
        fs.mkdirSync(modsDir, { recursive: true });
        for (const sub of subdirs) {
            fs.mkdirSync(path.join(modsDir, sub), { recursive: true });
        }

        debugModeActive = true;
        debugConfig = config;
        console.log('  [OK] Дебаг-режим АКТИВИРОВАН!');
        console.log('  Оригинальная Mods сохранена как: ' + backupDir);
        console.log('  Новая пустая Mods создана: ' + modsDir);
        return true;
    } catch (e) {
        console.log('  [!] Ошибка при активации дебаг-режима: ' + e.message);
        // Пытаемся откатить если что-то пошло не так
        try {
            if (!fs.existsSync(modsDir) && fs.existsSync(backupDir)) {
                fs.renameSync(backupDir, modsDir);
                console.log('  Откат выполнен: _Mods -> Mods');
            }
        } catch (rollbackErr) {
            console.log('  [!] Ошибка отката: ' + rollbackErr.message);
        }
        return false;
    }
}

/**
 * Деактивирует дебаг-режим:
 * 1. Удаляет пустую папку Mods
 * 2. Переименовывает _Mods -> Mods (восстанавливает оригинал)
 */
function deactivateDebugMods(config) {
    if (!config || !config.originalModsDir) return false;

    const parentDir = config.originalModsDir;
    const modsDir = path.join(parentDir, 'Mods');
    const backupDir = path.join(parentDir, '_Mods');

    if (!fs.existsSync(backupDir)) {
        debugModeActive = false;
        return false;
    }

    try {
        // 1. Удаляем пустую папку Mods (созданную в дебаг-режиме)
        if (fs.existsSync(modsDir)) {
            console.log('  Удаляю дебаг-папку Mods...');
            fs.rmSync(modsDir, { recursive: true, force: true });
        }

        // 2. Переименовываем _Mods -> Mods (восстанавливаем оригинал)
        console.log('  Восстанавливаю _Mods -> Mods...');
        fs.renameSync(backupDir, modsDir);

        debugModeActive = false;
        console.log('  [OK] Дебаг-режим ДЕАКТИВИРОВАН. Оригинальная Mods восстановлена.');
        return true;
    } catch (e) {
        console.log('  [!] Ошибка при деактивации дебаг-режима: ' + e.message);
        return false;
    }
}

async function debugMenu(rl, config) {
    console.clear();
    console.log('\n  \x1b[1m\x1b[35m=== РЕЖИМ ДЕБАГА TTS ===\x1b[0m');
    const success = activateDebugMods(config);
    if (!success) {
        console.log('\n  [!] Ошибка при запуске дебаг-режима.');
        await ask(rl, '  Нажмите Enter для выхода...');
        return;
    }
    console.log('\n  [ВНИМАНИЕ] Оригинальная папка Mods переименована в _Mods!');
    console.log('  Создана пустая папка Mods.');
    console.log('\n  Теперь запустите Tabletop Simulator и загрузите ваше сохранение.');
    console.log('  Так как кэш пуст, игра попытается скачать всё заново.');
    console.log('  Недостающие (проблемные) файлы будут выдавать ошибки в чат TTS.');
    console.log('\n  \x1b[1m=== ВОССТАНОВЛЕНИЕ ===\x1b[0m');
    console.log('  Когда закончите тестирование, НАЖМИТЕ ENTER, чтобы вернуть');
    console.log('  оригинальную папку Mods на место и выйти из программы.');

    await ask(rl, '\n  > Нажмите Enter для возврата оригинального кэша и выхода <');

    deactivateDebugMods(config);
}

// ═══════════════════════════════════════
// Интерактивное меню
// ═══════════════════════════════════════

function createRL() {
    return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question) {
    return new Promise(resolve => rl.question(question, answer => {
        let val = answer.trim();
        // Убираем кавычки вокруг пути (Windows добавляет при копировании)
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        resolve(val);
    }));
}

async function settingsMenu(rl, config) {
    while (true) {
        console.log('\n  \x1b[1m\x1b[36m=== НАСТРОЙКИ ===\x1b[0m');
        console.log(`  1. Папки-источники: ${config.sourceDirs.length > 0 ? '' : '[!] не заданы'}`);
        for (let i = 0; i < config.sourceDirs.length; i++) {
            console.log(`     [${i + 1}] ${config.sourceDirs[i]}`);
        }
        console.log(`  2. Папка назначения: ${config.outputDir || '[!] не задана'}`);
        console.log(`  3. Saved Objects:    ${config.savedObjectsDir || '[!] не задана'}`);
        console.log(`  4. Папка сохранений: ${config.savesDir || detectSavesDir(config) || '[!] не задана'}`);
        console.log(`  5. HTTP порт: ${config.httpPort}`);
        console.log(`  6. Папка Mods (дебаг): ${config.originalModsDir || '[не задана]'}`);
        console.log('  7. >> Открыть конфиг в Блокноте <<');
        console.log('  0. <- Назад');

        const choice = await ask(rl, '\n  Выберите: ');

        if (choice === '1') {
            console.log('\n  Текущие источники:');
            if (config.sourceDirs.length === 0) {
                console.log('    (пусто)');
            } else {
                config.sourceDirs.forEach((d, i) => console.log(`    [${i + 1}] ${d}`));
            }
            console.log('\n  A -- Добавить путь');
            console.log('  D -- Удалить путь');
            console.log('  0 -- Назад');
            const sub = await ask(rl, '  > ');

            if (sub.toLowerCase() === 'a') {
                const p = await ask(rl, '  Путь к папке: ');
                if (p && fs.existsSync(p)) {
                    config.sourceDirs.push(p);
                    saveConfig(config);
                    fileIndex = null;
                    console.log('  [OK] Добавлен: ' + p);
                } else {
                    console.log('  [!] Папка не найдена: ' + p);
                }
            } else if (sub.toLowerCase() === 'd') {
                const idx = await ask(rl, '  Номер для удаления: ');
                const i = parseInt(idx) - 1;
                if (i >= 0 && i < config.sourceDirs.length) {
                    const removed = config.sourceDirs.splice(i, 1);
                    saveConfig(config);
                    fileIndex = null;
                    console.log('  [OK] Удалён: ' + removed[0]);
                }
            }
        } else if (choice === '2') {
            const p = await ask(rl, '  Путь к папке назначения: ');
            if (p) { config.outputDir = p; saveConfig(config); console.log('  [OK] Сохранено'); }
        } else if (choice === '3') {
            const p = await ask(rl, '  Путь к Saved Objects: ');
            if (p) { config.savedObjectsDir = p; saveConfig(config); console.log('  [OK] Сохранено'); }
        } else if (choice === '4') {
            const p = await ask(rl, '  Путь к Saves (где лежат сейвы карт): ');
            if (p) { config.savesDir = p; saveConfig(config); console.log('  [OK] Сохранено'); }
        } else if (choice === '5') {
            const p = await ask(rl, '  HTTP порт (по умолчанию 39741): ');
            const port = parseInt(p);
            if (port > 0 && port < 65536) {
                config.httpPort = port;
                saveConfig(config);
                console.log('  [OK] Порт: ' + port + ' (перезапустите программу)');
            }
        } else if (choice === '6') {
            console.log('\n  Путь к родительской папке, ВНУТРИ которой лежит Mods.');
            console.log('  Пример: D:\\SteamLibrary\\steamapps\\common\\Tabletop Simulator\\Tabletop Simulator_Data');
            const p = await ask(rl, '  Путь: ');
            if (p) { config.originalModsDir = p; saveConfig(config); console.log('  [OK] Сохранено'); }
        } else if (choice === '7') {
            if (!fs.existsSync(CONFIG_PATH)) saveConfig(config);
            console.log('\n  Открываю конфиг в Блокноте...');
            console.log('  Вставьте пути через Ctrl+V, сохраните (Ctrl+S) и закройте.');
            console.log('  Каждый путь-источник на отдельной строке под [sourceDirs]');
            require('child_process').exec(`notepad "${CONFIG_PATH}"`);
            await ask(rl, '\n  После сохранения нажмите Enter...');
            const reloaded = loadConfig();
            Object.assign(config, reloaded);
            fileIndex = null;
            console.log('  [OK] Настройки перезагружены!');
        } else if (choice === '0') {
            return;
        }
    }
}

// Проверяем аргумент --debug
const IS_DEBUG_MODE = process.argv.includes('--debug');

async function mainMenu() {
    let config = loadConfig();
    const rl = createRL();

    try {
        await startHttpServer(config.httpPort || DEFAULT_PORT);
    } catch (e) {
        console.log('  [!] HTTP сервер: ' + e.message);
    }

    // Если запущено с --debug, автоматически активируем специальный дебаг-режим
    if (IS_DEBUG_MODE) {
        await debugMenu(rl, config);
        process.exit(0);
    }

    const cleanup = () => {
        // При завершении откатываем дебаг-режим если он был активирован
        if (debugModeActive && debugConfig) {
            console.log('\n  Деактивация дебаг-режима перед выходом...');
            deactivateDebugMods(debugConfig);
        }
        stopHttpServer();
        process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    while (true) {
        config = loadConfig();
        console.clear();
        console.log('');
        console.log('\x1b[36m  +==========================================+\x1b[0m');
        console.log('\x1b[36m  |\x1b[32m        Renesance v2.0                    \x1b[36m|\x1b[0m');
        console.log('\x1b[36m  |\x1b[37m   Восстановление ассетов TTS            \x1b[36m|\x1b[0m');
        console.log('\x1b[36m  +==========================================+\x1b[0m');
        console.log('');
        console.log('\x1b[90m  [HTTP]\x1b[0m  Сервер: порт \x1b[33m' + (config.httpPort || DEFAULT_PORT) + '\x1b[0m');
        console.log('\x1b[90m  [ФАЙЛ]\x1b[0m  Broken_URLs.txt: ' + (fs.existsSync(BROKEN_URLS_PATH) ? '\x1b[32mЕСТЬ\x1b[0m' : '\x1b[31mнет\x1b[0m'));
        console.log('\x1b[90m  [DEBUG]\x1b[0m Дебаг-режим: ' + (debugModeActive ? '\x1b[31mАКТИВЕН\x1b[0m' : '\x1b[90mвыключен\x1b[0m'));
        console.log('');
        console.log('\x1b[1m  === МЕНЮ ===\x1b[0m');
        console.log('  \x1b[36m1.\x1b[0m  Настройки');
        console.log('  \x1b[36m2.\x1b[0m  Собрать TTS куб');
        console.log('  \x1b[36m3.\x1b[0m  \x1b[32mУмное восстановление (только битые ссылки)\x1b[0m');
        console.log('  \x1b[36m4.\x1b[0m  Анализ сейв-файла (найти сломанные)');
        console.log('  \x1b[36m5.\x1b[0m  \x1b[32mПолный экспорт (ВСЕ ассеты из сейва)\x1b[0m');
        console.log('  \x1b[36m6.\x1b[0m  Показать статус');
        console.log('  \x1b[36m7.\x1b[0m  \x1b[33mОчистить папку экспорта (сохранив структуру)\x1b[0m');
        console.log('  \x1b[36m8.\x1b[0m  \x1b[35mРежим дебага (подмена Mods)\x1b[0m');
        console.log('  \x1b[36m9.\x1b[0m  \x1b[32mАвто-Патч сохранения (через Player.log TTS)\x1b[0m');
        console.log('  \x1b[36m0.\x1b[0m  \x1b[90mВыход\x1b[0m');
        console.log('');

        const choice = await ask(rl, '  Выберите пункт: ');

        if (choice === '1') {
            await settingsMenu(rl, config);
        } else if (choice === '2') {
            console.log('');
            buildTTSObject(config);
            await ask(rl, '\n  Нажмите Enter...');
        } else if (choice === '3') {
            await recoverFiles(rl, config);
            await ask(rl, '\n  Нажмите Enter...');
        } else if (choice === '4') {
            await analyzeSaveFile(rl, config);
            await ask(rl, '\n  Нажмите Enter...');
        } else if (choice === '5') {
            await fullExport(rl, config);
            await ask(rl, '\n  Нажмите Enter...');
        } else if (choice === '6') {
            console.log('\n  \x1b[1m=== СТАТУС ===\x1b[0m');
            console.log(`  Источники:     ${config.sourceDirs.length > 0 ? config.sourceDirs.join('; ') : 'не заданы'}`);
            console.log(`  Назначение:    ${config.outputDir || 'не задано'}`);
            console.log(`  Saved Objects: ${config.savedObjectsDir || 'не задано'}`);
            console.log(`  HTTP порт:     ${config.httpPort}`);
            console.log(`  Папка Mods:    ${config.originalModsDir || 'не задана'}`);
            console.log(`  Дебаг-режим:   ${debugModeActive ? '\x1b[31mАКТИВЕН\x1b[0m' : 'выключен'}`);

            if (fs.existsSync(BROKEN_URLS_PATH)) {
                const lines = fs.readFileSync(BROKEN_URLS_PATH, 'utf8')
                    .split('\n').filter(l => l.trim() && !l.startsWith('#'));
                console.log(`  Broken URLs:   ${lines.length} шт.`);
            }
            await ask(rl, '\n  Нажмите Enter...');
        } else if (choice === '7') {
            if (!config.outputDir) {
                console.log('\n  [!] Папка назначения не задана. Откройте Настройки (1).');
            } else {
                console.log('\n  \x1b[1m\x1b[33m=== ОЧИСТКА ПАПКИ ЭКСПОРТА ===\x1b[0m');
                console.log(`  \x1b[31mВнимание!\x1b[0m Все файлы из подпапок внутри \x1b[33m${config.outputDir}\\Mods\x1b[0m будут удалены (структура сохранится).`);
                const confirm = await ask(rl, '  Вы уверены? (y/n): ');
                if (confirm.toLowerCase() === 'y') {
                    clearOutputMods(config.outputDir);
                }
            }
            await ask(rl, '\n  Нажмите Enter...');
        } else if (choice === '8') {
            console.log('\n  \x1b[1m\x1b[35m=== РЕЖИМ ДЕБАГА ===\x1b[0m');
            if (debugModeActive) {
                console.log('  Дебаг-режим сейчас АКТИВЕН.');
                const confirm = await ask(rl, '  Деактивировать? (y/n): ');
                if (confirm.toLowerCase() === 'y') {
                    deactivateDebugMods(config);
                }
            } else {
                console.log(`  Папка Mods:  ${config.originalModsDir || '[!] не задана'}`);
                console.log('');
                if (config.originalModsDir) {
                    console.log('  При активации:');
                    console.log('    Mods -> _Mods (бэкап оригинала)');
                    console.log('    Создаётся новая пустая Mods с теми же подпапками');
                    console.log('');
                    const confirm = await ask(rl, '  Активировать дебаг-режим? (y/n): ');
                    if (confirm.toLowerCase() === 'y') {
                        activateDebugMods(config);
                    }
                } else {
                    console.log('  Для работы дебаг-режима укажите originalModsDir в настройках.');
                    console.log('  Это родительская папка, внутри которой лежит Mods.');
                }
            }
            await ask(rl, '\n  Нажмите Enter...');
        } else if (choice === '9') {
            await patchSaveFile(rl, config);
            await ask(rl, '\n  Нажмите Enter...');
        } else if (choice === '0') {
            // При выходе деактивируем дебаг-режим
            if (debugModeActive) {
                console.log('\n  Деактивация дебаг-режима перед выходом...');
                deactivateDebugMods(config);
            }
            await stopHttpServer();
            rl.close();
            console.log('\n  До свидания!\n');
            process.exit(0);
        }
    }
}

// ═══════════════════════════════════════
// Запуск
// ═══════════════════════════════════════

mainMenu().catch(err => {
    console.error('Ошибка:', err.message);
    process.exit(1);
});
