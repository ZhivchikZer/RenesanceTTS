-- ============================================================
-- Renesance v2.0
-- Единый куб для сканирования и восстановления ассетов TTS
-- ============================================================
-- Инструкция:
--   1. Запустите Renesance.exe на компьютере
--   2. Objects → Saved Objects → перетащите "Renesance" в сцену
--   3. ПКМ → "Сканировать Сцену"
--   4. ПКМ → "Проверить URL"
--   5. Нажмите кнопку СОХРАНИТЬ на кубе
-- ============================================================

local SERVER_PORT = {{PORT}}
local SERVER_URL = "http://localhost:" .. SERVER_PORT

local urlToObjects = {}
local brokenUrls = {}
local totalSteamUrls = 0
local scanDone = false
local checkDone = false
local isChecking = false

-- ═══ Жизненный цикл TTS ═══

function onLoad(saved_data)
    if saved_data and saved_data ~= "" then
        local ok, data = pcall(function() return JSON.decode(saved_data) end)
        if ok and data then
            brokenUrls = data.brokenUrls or {}
            urlToObjects = data.urlToObjects or {}
            totalSteamUrls = data.totalSteamUrls or 0
            scanDone = data.scanDone or false
            checkDone = data.checkDone or false
        end
    end
    self.setName("Renesance")
    refreshUI()
end

function onSave()
    return JSON.encode({
        brokenUrls = brokenUrls,
        urlToObjects = urlToObjects,
        totalSteamUrls = totalSteamUrls,
        scanDone = scanDone,
        checkDone = checkDone
    })
end

-- ═══ Интерфейс ═══

function refreshUI()
    updateDescription()

    self.clearContextMenu()
    self.addContextMenuItem("🔍 Сканировать Сцену", doScan)
    self.addContextMenuItem("🌐 Проверить URL", doCheck)
    self.addContextMenuItem("📊 Отчёт", doReport)
    self.addContextMenuItem("🧹 Сбросить", doReset)

    self.clearButtons()

    local btnColor
    if checkDone and #brokenUrls > 0 then
        btnColor = {0.15, 0.75, 0.3, 1}
    else
        btnColor = {0.35, 0.35, 0.35, 1}
    end

    self.createButton({
        click_function = "doSendToExe",
        function_owner = self,
        label          = "СОХРАНИТЬ",
        position       = {0, 0.3, 0},
        rotation       = {0, 180, 0},
        width          = 1800,
        height         = 500,
        font_size      = 280,
        color          = btnColor,
        font_color     = {1, 1, 1, 1},
        tooltip        = "Отправить сломанные URL в Renesance.exe"
    })
end

function updateDescription()
    local lines = {"═══ Renesance v2.0 ═══"}

    if not scanDone then
        table.insert(lines, "")
        table.insert(lines, "Готов к работе.")
        table.insert(lines, "ПКМ → Сканировать Сцену")
    elseif not checkDone then
        table.insert(lines, "")
        table.insert(lines, "Steam URL: " .. totalSteamUrls)
        table.insert(lines, "Уникальных: " .. countKeys(urlToObjects))
        table.insert(lines, "")
        table.insert(lines, "ПКМ → Проверить URL")
    else
        table.insert(lines, "")
        table.insert(lines, "Steam URL: " .. totalSteamUrls)
        table.insert(lines, "Сломанных: " .. #brokenUrls)
        table.insert(lines, "")
        if #brokenUrls > 0 then
            table.insert(lines, "→ Нажмите СОХРАНИТЬ")
        else
            table.insert(lines, "✅ Все URL работают!")
        end
    end

    self.setDescription(table.concat(lines, "\n"))
end

-- ═══ Сканирование сцены ═══

function doScan(player_color)
    urlToObjects = {}
    brokenUrls = {}
    totalSteamUrls = 0
    scanDone = false
    checkDone = false

    local objects = getAllObjects()
    local objectCount = 0

    for _, obj in ipairs(objects) do
        if obj ~= self then
            local urls = extractUrls(obj)
            if #urls > 0 then
                objectCount = objectCount + 1
                for _, info in ipairs(urls) do
                    if isSteamUrl(info.url) then
                        totalSteamUrls = totalSteamUrls + 1
                        if not urlToObjects[info.url] then
                            urlToObjects[info.url] = {}
                        end
                        table.insert(urlToObjects[info.url], {
                            guid = obj.getGUID(),
                            name = (obj.getName() ~= "") and obj.getName() or obj.getGUID(),
                            field = info.field
                        })
                    end
                end
            end
        end
    end

    scanDone = true
    local uniqueCount = countKeys(urlToObjects)

    broadcastToAll("═══ Renesance ═══", {0.2, 0.8, 0.4})
    broadcastToAll("Сканирование завершено!", {0.2, 0.8, 0.4})
    broadcastToAll("Объектов: " .. objectCount .. " | Steam URL: " .. totalSteamUrls .. " | Уникальных: " .. uniqueCount, {0.7, 0.7, 0.7})
    broadcastToAll("→ ПКМ → Проверить URL", {0.5, 0.5, 1})

    refreshUI()
end

function extractUrls(obj)
    local urls = {}
    local ok, data = pcall(function() return obj.getCustomObject() end)
    if ok and data then
        for key, val in pairs(data) do
            if type(val) == "string" and val ~= "" and val:find("http") then
                table.insert(urls, {url = val, field = key})
            end
        end
    end
    return urls
end

function isSteamUrl(url)
    return url:find("steamusercontent") ~= nil
        or url:find("steamcommunity") ~= nil
end

-- ═══ Проверка URL ═══

function doCheck(player_color)
    if not scanDone or countKeys(urlToObjects) == 0 then
        broadcastToAll("Renesance: Сначала сканируйте сцену!", {1, 0.3, 0.3})
        return
    end

    if isChecking then
        broadcastToAll("Renesance: Проверка уже идёт...", {1, 0.8, 0.2})
        return
    end

    brokenUrls = {}
    checkDone = false
    isChecking = true
    local checked = 0
    local total = countKeys(urlToObjects)

    broadcastToAll("═══ Renesance: Проверяю " .. total .. " URL ═══", {0.5, 0.5, 1})

    for url, _ in pairs(urlToObjects) do
        WebRequest.get(url, function(req)
            checked = checked + 1

            local isBroken = req.is_error
                or req.response_code == 0
                or req.response_code == 403
                or req.response_code == 404
                or req.response_code >= 500

            if isBroken then
                table.insert(brokenUrls, url)
                broadcastToAll("[✗] " .. (req.response_code or "ERR") .. " | " .. url:sub(1, 70) .. "...", {1, 0.4, 0.4})
            end

            if checked % 10 == 0 or checked >= total then
                broadcastToAll("Проверено: " .. checked .. " / " .. total, {0.6, 0.6, 0.6})
            end

            if checked >= total then
                checkDone = true
                isChecking = false
                broadcastToAll("═══ Проверка завершена ═══", {0.2, 0.8, 0.4})
                broadcastToAll("Сломанных: " .. #brokenUrls .. " из " .. total, {1, 0.8, 0.2})

                if #brokenUrls > 0 then
                    broadcastToAll("→ Нажмите кнопку СОХРАНИТЬ на кубе!", {0.5, 1, 0.5})
                else
                    broadcastToAll("Все URL работают!", {0.2, 1, 0.4})
                end

                refreshUI()
            end
        end)
    end
end

-- ═══ Отправка данных в EXE ═══

function doSendToExe(obj, player_color, alt_click)
    if not checkDone then
        broadcastToAll("Renesance: Сначала сканируйте и проверьте!", {1, 0.3, 0.3})
        return
    end

    if #brokenUrls == 0 then
        broadcastToAll("Renesance: Сломанных URL нет.", {0.5, 0.5, 1})
        return
    end

    local data = {
        timestamp = os.date("%Y-%m-%d %H:%M:%S"),
        totalScanned = countKeys(urlToObjects),
        brokenCount = #brokenUrls,
        entries = {}
    }

    for _, url in ipairs(brokenUrls) do
        local objs = urlToObjects[url] or {}
        local objNames = {}
        for _, info in ipairs(objs) do
            table.insert(objNames, info.name .. "[" .. info.field .. "]")
        end
        table.insert(data.entries, {
            url = url,
            cacheName = url:gsub("[^%w]", ""),
            objects = table.concat(objNames, ", ")
        })
    end

    broadcastToAll("Renesance: Отправляю данные...", {0.5, 0.5, 1})

    WebRequest.put(SERVER_URL .. "/broken-urls", JSON.encode(data), function(req)
        if req.is_error or (req.response_code ~= 200 and req.response_code ~= 201) then
            broadcastToAll("❌ Ошибка отправки!", {1, 0.3, 0.3})
            broadcastToAll("Убедитесь что Renesance.exe запущен!", {1, 0.6, 0.3})
        else
            broadcastToAll("✅ Broken_URLs.txt создан!", {0.2, 0.8, 0.4})
            broadcastToAll("Вернитесь в EXE → Восстановить файлы", {0.5, 0.5, 1})
        end
    end)
end

-- ═══ Отчёт ═══

function doReport(player_color)
    if not scanDone then
        broadcastToAll("Renesance: Сначала сканируйте сцену.", {0.5, 0.5, 1})
        return
    end

    broadcastToAll("═══ ОТЧЁТ Renesance ═══", {0.8, 0.8, 0.2})
    broadcastToAll("Steam URL: " .. totalSteamUrls .. " | Уникальных: " .. countKeys(urlToObjects), {0.7, 0.7, 0.7})
    broadcastToAll("Сломанных: " .. #brokenUrls, {1, 0.5, 0.5})

    for i, url in ipairs(brokenUrls) do
        local objects = urlToObjects[url]
        local names = {}
        if objects then
            for _, info in ipairs(objects) do
                table.insert(names, info.name .. "[" .. info.field .. "]")
            end
        end
        broadcastToAll(i .. ". " .. url:sub(1, 80), {1, 0.6, 0.6})
        if #names > 0 then
            broadcastToAll("   → " .. table.concat(names, ", "), {0.7, 0.7, 0.7})
        end
    end
    broadcastToAll("══════════════════", {0.8, 0.8, 0.2})
end

-- ═══ Сброс ═══

function doReset(player_color)
    urlToObjects = {}
    brokenUrls = {}
    totalSteamUrls = 0
    scanDone = false
    checkDone = false
    isChecking = false

    broadcastToAll("Renesance: Данные сброшены.", {0.5, 0.5, 1})
    refreshUI()
end

-- ═══ Утилиты ═══

function countKeys(t)
    if t == nil then return 0 end
    local c = 0
    for _ in pairs(t) do c = c + 1 end
    return c
end
