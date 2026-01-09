// ==UserScript==
// @name         Ozon Seller: Лист подбора (v4.0)
// @namespace    https://github.com/dskarasev/ozon-seller-scripts
// @version      4.0
// @description  Виджет для формирования листа подбора и скачивания этикеток на seller.ozon.ru
// @author       Auto-generated
// @match        https://seller.ozon.ru/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    // Чистка
    const oldWidget = document.getElementById('ozon-tools-widget');
    if (oldWidget) oldWidget.remove();

    console.log("🚀 Виджет v4.0 (Split Single/Multi) запущен.");

    // --- UI ---
    const widget = document.createElement('div');
    widget.id = 'ozon-tools-widget';
    widget.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 9999;
        background: white; padding: 20px; border-radius: 8px;
        box-shadow: 0 4px 25px rgba(0,0,0,0.4); border: 1px solid #ccc;
        font-family: 'Segoe UI', sans-serif; min-width: 250px;
    `;

    widget.innerHTML = `
        <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #333; font-weight:800;">📦 Склад v4.0</h3>
        <div id="status-text" style="font-size: 13px; color: #333; margin-bottom: 15px; padding: 8px; background: #f0f2f5; border-radius: 4px; border-left: 4px solid #005bff;">
            Готов к работе
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
            <button id="btn-print-list" style="padding: 12px; background: #005bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                🖨️ Лист подбора
            </button>
            <button id="btn-dl-labels" style="padding: 12px; background: #10c44c; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                📥 Скачать Этикетки
            </button>
            <button id="btn-close" style="padding: 8px; background: transparent; color: #777; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 12px; margin-top: 5px;">
                Закрыть
            </button>
        </div>
    `;
    document.body.appendChild(widget);

    // --- Helpers ---
    const setStatus = (html, type) => {
        const el = document.getElementById('status-text');
        el.innerHTML = html;
        if (type === 'error') { el.style.borderLeftColor = 'red'; el.style.background = '#fff0f0'; }
        else if (type === 'success') { el.style.borderLeftColor = 'green'; el.style.background = '#f0fff4'; }
    };

    const getCookie = (name) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    };

    // Ваша функция для короткого номера
    function formatShortNum(num) {
        const parts = num.split('-');
        const mainPart = parts[0];
        if (mainPart.length > 4) {
            const highlight = mainPart.slice(-4);
            return `${highlight}`;
        }
        return num;
    }

    // --- Logic ---
    async function prepareData() {
        const companyId = getCookie('sc_company_id') || getCookie('x-o3-company-id');
        if (!companyId) throw new Error("Не найден Company ID");

        const headers = { "Content-Type": "application/json", "x-o3-company-id": companyId, "x-o3-app-name": "seller-ui", "x-o3-language": "ru" };

        const today = new Date();
        const future = new Date(today); future.setDate(today.getDate() + 60);
        const past = new Date(today); past.setFullYear(today.getFullYear() - 1);

        setStatus("⏳ Загрузка заказов...");

        const response = await fetch("https://seller.ozon.ru/api/posting-service/seller-ui/fbs/posting/unfulfilled/list", {
            method: "POST", headers, body: JSON.stringify({
                "filter": { "company_id": parseInt(companyId), "status_alias": ["awaiting_deliver"], "cutoff_from": past.toISOString(), "cutoff_to": future.toISOString() },
                "limit": 1000, "with": { "analytics_data": true }
            })
        });

        if (!response.ok) throw new Error("Ошибка API");
        const data = await response.json();
        const postings = data.result.postings || [];
        if (postings.length === 0) throw new Error("Нет заказов");

        setStatus("⚙️ Сортировка и разделение...");

        // 1. Разделяем на Одиночные (Single SKU) и Сборные (Multi SKU)
        let singleGroups = {};
        let multiOrders = [];
        let totalQty = 0;

        postings.forEach(p => {
            // Считаем общее кол-во товаров
            p.products.forEach(pr => totalQty += pr.quantity);

            // Проверяем, сколько УНИКАЛЬНЫХ артикулов в заказе
            const distinctSkus = new Set(p.products.map(pr => pr.product_offer_id));

            if (distinctSkus.size > 1) {
                // Это СБОРНЫЙ заказ (разные товары)
                multiOrders.push(p);
            } else {
                // Это ОДИНОЧНЫЙ заказ (один вид товара)
                const product = p.products[0];
                const sku = product.product_offer_id;
                const qtyInOrder = product.quantity; // Сколько коробок заказал клиент

                // Парсим коэффициент набора (например, из "SKU/4" достаем 4. Если "/" нет, то 1)
                const skuParts = sku.split('/');
                const ratio = (skuParts.length > 1 && !isNaN(skuParts[1])) ? parseInt(skuParts[1]) : 1;
                const isSet = ratio > 1;

                if (!singleGroups[sku]) {
                    singleGroups[sku] = {
                        sku: sku,
                        name: product.product_name,
                        img: product.picture_url,
                        orders: [],
                        totalOrders: 0,
                        totalItemsToPick: 0, // Сколько штук товара взять с полки
                        ratio: ratio,
                        isSet: isSet
                    };
                }
                
                singleGroups[sku].orders.push({
                    postingNumber: p.posting_number,
                    quantity: qtyInOrder
                });
                
                singleGroups[sku].totalOrders += 1;
                // Считаем: (Кол-во заказов * кол-во в заказе * коэффициент набора)
                singleGroups[sku].totalItemsToPick += (qtyInOrder * ratio);
            }
        });

        // 2. Сортируем ОДИНОЧНЫЕ группы по Артикулу
        const sortedSingleGroups = Object.values(singleGroups).sort((a, b) => 
            a.sku.localeCompare(b.sku, undefined, {numeric: true, sensitivity: 'base'})
        );

        // 3. Сортируем заказы ВНУТРИ групп (по возрастанию кол-ва)
        sortedSingleGroups.forEach(g => {
          g.orders.sort((a, b) => a.quantity - b.quantity);
        });

        // 4. Сортируем СБОРНЫЕ заказы (по Артикулу первого товара)
        multiOrders.sort((a, b) => {
            const skuA = a.products[0].product_offer_id;
            const skuB = b.products[0].product_offer_id;
            return skuA.localeCompare(skuB, undefined, {numeric: true, sensitivity: 'base'});
        });

        // 5. Формируем единый список ID для этикеток
        // Сначала все одиночные (по группам), потом все сборные
        let labelIds = [];

        sortedSingleGroups.forEach(g => {
            g.orders.forEach(o => labelIds.push(o.postingNumber));
        });

        multiOrders.forEach(m => labelIds.push(m.posting_number));

        return { 
            sortedSingleGroups, 
            multiOrders, 
            labelIds, 
            companyId, 
            headers, 
            totalQty,
            totalOrders: postings.length
        };
    }

    // --- Печать ---
    document.getElementById('btn-print-list').onclick = async () => {
        try {
            const { sortedSingleGroups, multiOrders, totalQty, totalOrders } = await prepareData();
            setStatus(`✅ Готово.<br>Заказов: <b>${totalOrders}</b> | Товаров: <b>${totalQty}</b>`, "success");

            const win = window.open('', '_blank');
            
            // Вспомогательная функция для парсинга наборов прямо в шаблоне
            const getRatio = (sku) => {
                const parts = sku.split('/');
                return (parts.length > 1 && !isNaN(parts[1])) ? parseInt(parts[1]) : 1;
            };

            const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Лист подбора</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; padding: 20px; font-size: 14px; color: #000; }
                    h2 { margin: 0; }
                    .stats { margin-bottom: 20px; color: #555; }
                    
                    /* Одиночные */
                    .group-header {
                        display: flex; align-items: center; gap: 10px;
                        background: #eee; padding: 5px; border: 2px solid #000;
                        margin-top: 15px; page-break-inside: avoid;
                    }
                    .group-img img { width: 50px; height: 50px; object-fit: contain; background: white; border: 1px solid #ccc; }
                    .group-title { font-weight: bold; font-size: 13px; flex-grow: 1; line-height: 1.2; }
                    .group-sku { font-family: monospace; font-weight: bold; font-size: 15px; white-space: nowrap; margin-left: 10px; background: #fff; padding: 2px 5px; }

                    table.single-table { width: 100%; border-collapse: collapse; border: 2px solid #000; border-top: none; margin-bottom: 5px; }
                    table.single-table td { border: 1px solid #999; padding: 4px 6px; vertical-align: middle; }
                    .qty-cell { font-size: 18px; font-weight: 900; text-align: center; width: 80px; background: #ffffcc !important; border-left: 2px solid #000; border-right: 2px solid #000; }
                    .pst-cell2 { font-family: monospace; font-size: 22px; font-weight: 800; text-align: center; width: 100px; }

                    /* Сборные */
                    .multi-section { margin-top: 40px; border-top: 4px dashed #000; padding-top: 20px; }
                    .multi-header { background: #000; color: #fff; padding: 10px; font-weight: bold; font-size: 18px; margin-bottom: 15px; }
                    .multi-card { border: 3px solid #000; margin-bottom: 20px; page-break-inside: avoid; }
                    .multi-item-row { border-bottom: 1px solid #ccc; display: flex; align-items: center; }
                    .multi-item-row:last-child { border-bottom: none; }

                    @media print {
                        .group-header { background: #eee !important; -webkit-print-color-adjust: exact; }
                        .qty-cell { background: #ffffcc !important; -webkit-print-color-adjust: exact; }
                        .set-badge { background: #ff0000 !important; color: #fff !important; -webkit-print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body>
                <h2>Лист подбора (Склад)</h2>
                <div class="stats">Заказов: <b>${totalOrders}</b> | Товаров: <b>${totalQty}</b></div>

                ${sortedSingleGroups.map(g => {
                    const ratio = getRatio(g.sku);
                    const isSet = ratio > 1;
                    const totalPhysicalItems = g.orders.reduce((sum, o) => sum + (o.quantity * ratio), 0);
                    const totalPackages = g.orders.reduce((sum, o) => sum + o.quantity, 0);

                    return `
                    <div class="group-header" style="${isSet ? 'border: 3px solid #ff0000; background: #fff5f5;' : ''}">
                        <div class="group-img">${g.img ? `<img src="${g.img}">` : ''}</div>
                        <div class="group-title">
                            ${isSet ? `<span class="set-badge" style="background:red; color:white; padding:1px 4px; border-radius:3px;">НАБОР Х${ratio}</span><br>` : ''}
                            ${g.name}
                        </div>

                        <div style="display: flex; gap: 5px;">
                            <div style="border: 2px solid #000; background: #ffffcc; padding: 2px 8px; text-align: center; min-width: 70px;">
                                <div style="font-size: 9px; font-weight: bold;">ШТУК:</div>
                                <div style="font-size: 18px; font-weight: 900;">${totalPhysicalItems}</div>
                            </div>
                            <div style="border: 1px solid #000; background: #fff; padding: 2px 8px; text-align: center;">
                                <div style="font-size: 9px;">НАБОРОВ:</div>
                                <div style="font-size: 18px; font-weight: bold;">${totalPackages}</div>
                            </div>
                        </div>

                        <div class="group-sku">${g.sku}</div>
                    </div>
                    <table class="single-table">
                        ${g.orders.map(ord => `
                            <tr>
                                <td style="width: 40%; font-family: monospace;">${ord.postingNumber}</td>
                                <td class="qty-cell">
                                    <div style="font-size: 10px; font-weight: normal;">${isSet ? 'комплект' : 'кол-во'}</div>
                                    ${ord.quantity} шт
                                </td>
                                <td class="pst-cell2">${formatShortNum(ord.postingNumber)}</td>
                                <td style="width: 40px; border-left: 1px solid #000;"></td>
                            </tr>
                        `).join('')}
                    </table>
                    `;
                }).join('')}

                ${multiOrders.length > 0 ? `
                    <div class="multi-section">
                        <div class="multi-header">⚠️ СБОРНЫЕ ЗАКАЗЫ (${multiOrders.length})</div>
                        ${multiOrders.map(m => `
                            <div class="multi-card">
                                <div style="display: flex; justify-content: space-between; padding: 8px; background: #f0f0f0; border-bottom: 2px solid #000;">
                                    <b style="font-family: monospace;">${m.posting_number}</b>
                                    <b style="font-size: 20px;">${formatShortNum(m.posting_number)}</b>
                                </div>
                                <div>
                                    ${m.products.map(p => {
                                        const r = getRatio(p.product_offer_id);
                                        return `
                                        <div class="multi-item-row">
                                            <div style="width: 50px; padding: 5px;">
                                                <img src="${p.picture_url}" style="width: 40px; height: 40px; object-fit: contain;">
                                            </div>
                                            <div style="flex-grow: 1; padding: 5px; font-size: 12px;">
                                                <div>${p.product_name}</div>
                                                <div style="font-family: monospace; font-weight: bold;">
                                                    ${p.product_offer_id} 
                                                    ${r > 1 ? `<span style="color:red; margin-left:10px;">(В наборе ${r} шт!)</span>` : ''}
                                                </div>
                                            </div>
                                            <div style="width: 80px; text-align: center; border-left: 2px solid #000; background: #ffffcc; font-size: 18px; font-weight: 900; height: 50px; display: flex; align-items: center; justify-content: center;">
                                                ${p.quantity} шт
                                            </div>
                                            <div style="width: 40px; border-left: 1px solid #000; height: 50px;"></div>
                                        </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                <script>window.onload = function() { window.print(); }</script>
            </body>
            </html>`;

            win.document.write(html);
            win.document.close();

        } catch (e) {
            console.error(e);
            setStatus("❌ " + e.message, "error");
        }
    };

    // --- Скачать Этикетки ---
    document.getElementById('btn-dl-labels').onclick = async () => {
        try {
            const { labelIds, companyId, headers } = await prepareData();

            setStatus("⏳ 1/3 Создание задачи...");
            const createResp = await fetch("https://seller.ozon.ru/api/carriage-service/seller-ui/v2/task/label/batch/create", {
                method: "POST", headers, body: JSON.stringify({ "company_id": companyId, "posting_number": labelIds })
            });
            const createData = await createResp.json();
            if (!createData.result?.tasks?.[0]) throw new Error("Ошибка создания задачи");
            const taskId = createData.result.tasks[0].task_id;

            setStatus("⏳ 2/3 Генерация (ждите)...");
            let isReady = false, attempts = 0;
            while (!isReady && attempts < 60) {
                await new Promise(r => setTimeout(r, 1000));
                attempts++;
                const checkResp = await fetch("https://seller.ozon.ru/api/carriage-service/seller-ui/task/label/batch/status", {
                    method: "POST", headers, body: JSON.stringify({ "task_id": taskId, "company_id": companyId })
                });
                const checkData = await checkResp.json();
                if(checkData.result.status === 'completed') isReady = true;
                if(checkData.result.status === 'error') throw new Error("Ozon вернул ошибку");
            }

            if (!isReady) throw new Error("Таймаут");

            setStatus("⏳ 3/3 Загрузка...");
            const getResp = await fetch("https://seller.ozon.ru/api/carriage-service/seller-ui/task/label/batch/get", {
                method: "POST", headers, body: JSON.stringify({ "task_id": taskId, "company_id": companyId })
            });
            const getData = await getResp.json();
            if(!getData.result.file_content) throw new Error("Файл пуст");

            const link = document.createElement('a');
            link.href = "data:application/pdf;base64," + getData.result.file_content;
            link.download = getData.result.file_name || `Labels.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setStatus("✅ PDF скачан!", "success");

        } catch (e) {
            console.error(e);
            setStatus("❌ " + e.message, "error");
            alert(e.message);
        }
    };

    document.getElementById('btn-close').onclick = () => widget.remove();

})();
