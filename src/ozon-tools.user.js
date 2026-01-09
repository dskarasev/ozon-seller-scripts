// ==UserScript==
// @name         Ozon Seller: Лист подбора (v5.1)
// @namespace    https://github.com/dskarasev/ozon-orders-picker-like-wildberries/
// @version      5.1
// @match        https://seller.ozon.ru/app/postings/fbs*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    const oldWidget = document.getElementById('ozon-tools-widget');
    if (oldWidget) oldWidget.remove();

    const pluralize = (num, titles) => {
        const n1 = Math.abs(num) % 100;
        const n2 = n1 % 10;
        if (n1 > 10 && n1 < 20) return titles[2];
        if (n2 > 1 && n2 < 5) return titles[1];
        if (n2 === 1) return titles[0];
        return titles[2];
    };

    const getCookie = (name) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    };

    const getRatio = (sku) => {
        if (!sku) return 1;
        const parts = sku.split('/');
        return (parts.length > 1 && !isNaN(parts[parts.length - 1])) ? parseInt(parts[parts.length - 1]) : 1;
    };

    function formatShortNum(num) {
        const mainPart = num.split('-')[0];
        return mainPart.length > 4 ? mainPart.slice(-4) : num;
    }

    // --- UI ---
    const widget = document.createElement('div');
    widget.id = 'ozon-tools-widget';
    widget.style.cssText = `position: fixed; bottom: 20px; right: 20px; z-index: 9999; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 25px rgba(0,0,0,0.4); border: 1px solid #ccc; font-family: 'Segoe UI', sans-serif; min-width: 250px;`;
    widget.innerHTML = `
        <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #333; font-weight:800;">📦 Склад v5.1</h3>
        <div id="status-text" style="font-size: 13px; color: #333; margin-bottom: 15px; padding: 8px; background: #f0f2f5; border-radius: 4px; border-left: 4px solid #005bff;">Готов</div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
            <button id="btn-print-list" style="padding: 12px; background: #005bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">🖨️ Лист подбора</button>
            <button id="btn-dl-labels" style="padding: 12px; background: #10c44c; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">📥 Этикетки</button>
            <button id="btn-close" style="padding: 8px; background: transparent; color: #777; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 12px;">Закрыть</button>
        </div>`;
    document.body.appendChild(widget);

    const setStatus = (html, type) => {
        const el = document.getElementById('status-text');
        el.innerHTML = html;
        el.style.borderLeftColor = type === 'error' ? 'red' : (type === 'success' ? 'green' : '#005bff');
    };

    async function prepareData() {
        const companyId = getCookie('sc_company_id') || getCookie('x-o3-company-id');
        const headers = { "Content-Type": "application/json", "x-o3-company-id": companyId, "x-o3-app-name": "seller-ui", "x-o3-language": "ru" };
        const resp = await fetch("https://seller.ozon.ru/api/posting-service/seller-ui/fbs/posting/unfulfilled/list", {
            method: "POST", headers, body: JSON.stringify({
                "filter": { "company_id": parseInt(companyId), "status_alias": ["awaiting_deliver"], "cutoff_from": new Date(Date.now() - 31536000000).toISOString(), "cutoff_to": new Date(Date.now() + 5184000000).toISOString() },
                "limit": 1000, "with": { "analytics_data": true }
            })
        });
        const data = await resp.json();
        const postings = data.result.postings || [];
        let singleGroups = {}, multiOrders = [], totalItemsPhysical = 0;

        postings.forEach(p => {
            const distinctSkus = new Set(p.products.map(pr => pr.product_offer_id));
            if (distinctSkus.size > 1) {
                multiOrders.push(p);
                p.products.forEach(pr => totalItemsPhysical += (pr.quantity * getRatio(pr.product_offer_id)));
            } else {
                const pr = p.products[0];
                const ratio = getRatio(pr.product_offer_id);
                if (!singleGroups[pr.product_offer_id]) {
                    singleGroups[pr.product_offer_id] = { sku: pr.product_offer_id, name: pr.product_name.toUpperCase(), img: pr.picture_url, orders: [], ratio, isSet: ratio > 1 };
                }
                singleGroups[pr.product_offer_id].orders.push({ posting: p.posting_number, qty: pr.quantity });
                totalItemsPhysical += (pr.quantity * ratio);
            }
        });

        const sortedSingles = Object.values(singleGroups).sort((a,b) => a.sku.localeCompare(b.sku, undefined, {numeric:true}));
        sortedSingles.forEach(group => { group.orders.sort((a, b) => a.qty - b.qty); });

        const orderedLabelIds = [];
        sortedSingles.forEach(g => g.orders.forEach(o => orderedLabelIds.push(o.posting)));
        multiOrders.forEach(m => orderedLabelIds.push(m.posting_number));

        return { sortedSingles, multiOrders, totalItemsPhysical, totalPostings: postings.length, orderedLabelIds, companyId, headers };
    }

    document.getElementById('btn-print-list').onclick = async () => {
        const { sortedSingles, multiOrders, totalItemsPhysical, totalPostings } = await prepareData();
        const win = window.open('', '_blank');
        let globalCounter = 0;

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: sans-serif; padding: 10px; line-height: 1.2; }
                .top-info { margin-bottom: 20px; padding: 10px; border-bottom: 2px solid #eee; font-size: 16px; }
                .header-box { display: flex; align-items: center; gap: 15px; background: #eee; padding: 10px; border: 3px solid #000; margin-top: 20px; page-break-inside: avoid; }
                .badge-container { display: flex; gap: 10px; margin-left: auto; align-items: center; }
                
                .counter-box { border: 3px solid #000; padding: 6px 12px; text-align: center; min-width: 120px; }
                .qty-box { background: #ffffcc; }
                .pkg-box { background: #fff; }
                .val-26 { font-size: 26px; font-weight: 900; line-height: 1; }
                
                .set-label { color: red; font-size: 26px; font-weight: 900; white-space: nowrap; margin-right: 10px; }
                
                table { width: 100%; border-collapse: collapse; border: 3px solid #000; border-top: none; }
                td { border: 1px solid #777; padding: 8px; }
                .idx-cell { width: 35px; text-align: center; font-weight: bold; background: #f0f0f0; font-size: 14px; color: #000; }
                .short-num { font-size: 28px; font-weight: 900; text-align: center; font-family: monospace; }
                .check-cell { width: 50px; border-left: 3px solid #000; }
                .multi-qty { background: #ff9800 !important; color: white; -webkit-print-color-adjust: exact; }
                
                .multi-card { border: 4px solid #000; margin-top: 20px; page-break-inside: avoid; }
                @media print { .qty-box { background: #ffffcc !important; -webkit-print-color-adjust: exact; } .multi-qty { background: #ff9800 !important; color: white !important; } }
            </style>
        </head>
        <body>
            <div class="top-info">
                <h2 style="margin:0">ЛИСТ ПОДБОРА</h2>
                <b>${totalPostings} ${pluralize(totalPostings, ['ЭТИКЕТКА', 'ЭТИКЕТКИ', 'ЭТИКЕТОК'])}</b> | 
                ВЗЯТЬ СО СКЛАДА: <b>${totalItemsPhysical} ${pluralize(totalItemsPhysical, ['ШТУКА', 'ШТУКИ', 'ШТУК'])}</b>
            </div>
            ${sortedSingles.map(g => {
                const groupSum = g.orders.reduce((s,o)=>s+(o.qty*g.ratio),0);
                const groupLabels = g.orders.length;
                return `
                <div class="header-box" style="${g.isSet ? 'border-color:red;' : ''}">
                    <img src="${g.img}" style="width:70px; height:70px; object-fit:contain; background:#fff; border:1px solid #ccc;">
                    <div style="flex-grow:1; font-size:16px; font-weight: 800; text-transform: uppercase;">
                        <span style="font-size:12px; color:#555;">${g.sku}</span><br>${g.name}
                    </div>
                    <div class="badge-container">
                        ${g.isSet ? `<div class="set-label">НАБОР (X${g.ratio})</div>` : ''}
                        <div class="counter-box qty-box">
                            <div class="val-26">${groupSum}</div>
                            <div style="font-size:10px; font-weight:bold;">${pluralize(groupSum, ['ШТУКА', 'ШТУКИ', 'ШТУК'])}</div>
                        </div>
                        <div class="counter-box pkg-box">
                            <div class="val-26">${groupLabels}</div>
                            <div style="font-size:10px; font-weight:bold; text-transform:uppercase;">${g.isSet ? pluralize(groupLabels, ['НАБОР', 'НАБОРА', 'НАБОРОВ']) : pluralize(groupLabels, ['ЗАКАЗ', 'ЗАКАЗА', 'ЗАКАЗОВ'])}</div>
                        </div>
                    </div>
                </div>
                <table>
                    ${g.orders.map(o => {
                        globalCounter++;
                        return `<tr>
                            <td class="idx-cell">${globalCounter}</td>
                            <td style="font-family:monospace; width:30%; font-size:12px;">${o.posting}</td>
                            <td style="text-align:center; font-weight:bold; width:90px; font-size:18px;" class="${o.qty > 1 ? 'multi-qty' : ''}">
                                ${o.qty} шт.
                            </td>
                            <td class="short-num">${formatShortNum(o.posting)}</td>
                            <td class="check-cell"></td>
                        </tr>`}).join('')}
                </table>`;
            }).join('')}

            ${multiOrders.length > 0 ? `<h3 style="background:#000; color:#fff; padding:10px; margin-top:30px; text-align:center; font-size:20px;">СБОРНЫЕ ЗАКАЗЫ (НЕСКОЛЬКО ТОВАРОВ)</h3>` : ''}
            ${multiOrders.map(m => {
                globalCounter++;
                return `
                <div class="multi-card">
                    <div style="display:flex; justify-content:space-between; padding:10px; background:#ddd; border-bottom:3px solid #000;">
                        <span style="font-size:14px; font-weight:bold;">№${globalCounter} — ${m.posting_number}</span> 
                        <b style="font-size:30px;">${formatShortNum(m.posting_number)}</b>
                    </div>
                    ${m.products.map(p => `
                        <div style="display:flex; align-items:stretch; border-top:1px solid #777; padding:0;">
                            <div style="display:flex; align-items:center; flex-grow:1; padding:8px;">
                                <img src="${p.picture_url}" style="width:60px; height:60px; object-fit:contain; margin-right:15px; border:1px solid #999;">
                                <div style="font-size:16px; font-weight:bold; text-transform: uppercase;">
                                    ${p.product_name.toUpperCase()}<br><span style="font-size:12px;">${p.product_offer_id}</span>
                                </div>
                            </div>
                            <div style="width:100px; display:flex; align-items:center; justify-content:center; font-size:26px; font-weight:900; border-left:1px solid #777;" class="${p.quantity > 1 ? 'multi-qty' : 'qty-box'}">
                                ${p.quantity} ШТ.
                            </div>
                            <div style="width:50px; border-left:3px solid #000;"></div>
                        </div>`).join('')}
                </div>`}).join('')}
            <script>window.onload = function() { window.print(); }</script>
        </body>
        </html>`;
        win.document.write(html); win.document.close();
    };

    document.getElementById('btn-dl-labels').onclick = async () => {
        try {
            const { orderedLabelIds, companyId, headers } = await prepareData();
            setStatus("⏳ ГЕНЕРИРУЮ СИНХРОННЫЙ PDF...", "success");
            const cResp = await fetch("https://seller.ozon.ru/api/carriage-service/seller-ui/v2/task/label/batch/create", { method: "POST", headers, body: JSON.stringify({ "company_id": companyId, "posting_number": orderedLabelIds }) });
            const cData = await cResp.json();
            const taskId = cData.result.tasks[0].task_id;
            let ready = false;
            while(!ready) {
                await new Promise(r => setTimeout(r, 1500));
                const sResp = await fetch("https://seller.ozon.ru/api/carriage-service/seller-ui/task/label/batch/status", { method: "POST", headers, body: JSON.stringify({ "task_id": taskId, "company_id": companyId }) });
                const sData = await sResp.json();
                if(sData.result.status === 'completed') ready = true;
            }
            const gResp = await fetch("https://seller.ozon.ru/api/carriage-service/seller-ui/task/label/batch/get", { method: "POST", headers, body: JSON.stringify({ "task_id": taskId, "company_id": companyId }) });
            const gData = await gResp.json();
            const link = document.createElement('a');
            link.href = "data:application/pdf;base64," + gData.result.file_content;
            link.download = `Labels_Sorted_v5.1.pdf`;
            link.click();
            setStatus("✅ PDF СКАЧАН", "success");
        } catch (e) { setStatus("❌ ОШИБКА", "error"); }
    };

    document.getElementById('btn-close').onclick = () => widget.remove();
})();
