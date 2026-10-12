// ==UserScript==
// @name         Auto-Export ADP vers Compteur
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  Bascule automatiquement sur Fiche de présence, extrait et ferme ADP
// @match        *://mon.adp.com/*
// @match        *://static.mon.adp.com/*
// @match        *://*.adp.com/*
// @allFrames    true
// @grant        GM_closeTab
// @grant        window.close
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log('[Compteur ADP v2.5] Script actif sur :', window.location.href);

    let clickedOnce = false;
    const tabInterval = setInterval(function() {
        const els = Array.from(document.querySelectorAll('*'));
        const hasDates = els.some(function(e) {
            return e.children.length === 0 && e.innerText && /^\d{2}\/\d{2}$/.test(e.innerText.trim());
        });

        if (hasDates) {
            clearInterval(tabInterval);
            return;
        }

        const tab = document.getElementById('sdf-tab-time-timecard');
        if (tab && !clickedOnce) {
            console.log('[Compteur ADP] Onglet #sdf-tab-time-timecard détecté. Clic en cours...');
            tab.click();
            clickedOnce = true;
            setTimeout(function() { clickedOnce = false; }, 2000);
        }
    }, 600);

    let executed = false;
    const checkInterval = setInterval(function() {
        if (executed) return;

        const els = Array.from(document.querySelectorAll('*'));
        const foundDates = [];

        els.forEach(function(e) {
            if (e.children.length === 0 && e.innerText) {
                const m = e.innerText.trim().match(/^(\d{2}\/\d{2})$/);
                if (m && !foundDates.includes(m[1])) foundDates.push(m[1]);
            }
        });

        if (foundDates.length > 0) {
            console.log('[Compteur ADP] Tableau de pointage chargé. Dates :', foundDates);
            executed = true;
            clearInterval(checkInterval);
            clearInterval(tabInterval);
            extraireEtRediriger();
        }
    }, 600);

    function fermerOngletActuel() {
        try {
            if (typeof GM_closeTab === 'function') {
                GM_closeTab();
            } else {
                window.close();
            }
        } catch (e) {
            window.close();
        }
    }

    async function extraireEtRediriger() {
        try {
            const d = {
                source: 'adp',
                extractedAt: new Date().toISOString(),
                carrySign: '+',
                carryH: 0,
                carryM: 0,
                days: {
                    Lundi: { times: [], isConge: false, absenceStr: '' },
                    Mardi: { times: [], isConge: false, absenceStr: '' },
                    Mercredi: { times: [], isConge: false, absenceStr: '' },
                    Jeudi: { times: [], isConge: false, absenceStr: '' },
                    Vendredi: { times: [], isConge: false, absenceStr: '' }
                }
            };

            const daysKeys = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
            const els = Array.from(document.querySelectorAll('*'));
            const foundDates = [];

            els.forEach(function(e) {
                if (e.children.length === 0 && e.innerText) {
                    const m = e.innerText.trim().match(/^(\d{2}\/\d{2})$/);
                    if (m && !foundDates.includes(m[1])) foundDates.push(m[1]);
                }
            });

            const map = [];
            for (let i = 0; i < Math.min(5, foundDates.length); i++) {
                map.push({ n: daysKeys[i], d: foundDates[i] });
            }

            const dt = new Date();
            const todayStr = String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0');
            d.isCurrentWeek = map.some(function(m) { return m.d === todayStr; });

            map.forEach(function(m) {
                const el = els.find(function(e) { return e.children.length === 0 && e.innerText && e.innerText.trim() === m.d; });
                if (!el) return;
                let c = el;
                while (c.parentElement && c.parentElement !== document.body) {
                    const p = c.parentElement;
                    if (map.some(function(o) { return o.d !== m.d && (p.innerText || '').includes(o.d); })) break;
                    c = p;
                }
                const t = c.innerText || '';
                if (/Congé|RTT|Chômé|Férié|Activité\s+partielle/i.test(t)) d.days[m.n].isConge = true;

                let absIntervals = [];
                const lines = t.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
                for (let i = 0; i < lines.length; i++) {
                    if (/Débit|Crédit/i.test(lines[i])) {
                        let timeStr = "";
                        if (/\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/.test(lines[i])) timeStr = lines[i];
                        else if (i + 1 < lines.length && /\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/.test(lines[i + 1])) timeStr = lines[i + 1];
                        let match = timeStr.match(/([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)/);
                        if (match) absIntervals.push(match[1].padStart(2, '0') + ':' + match[2] + ' - ' + match[3].padStart(2, '0') + ':' + match[4]);
                    }
                }

                if (absIntervals.length > 0) d.days[m.n].absenceStr = absIntervals.join(', ');
                else if (/Débit|Crédit/i.test(t)) d.days[m.n].absenceStr = 'Oui';

                let pts = [];
                for (let i = 0; i < lines.length; i++) {
                    if (/Pointage/i.test(lines[i])) {
                        let timeStr = "";
                        if (/\d{2}:\d{2}/.test(lines[i])) timeStr = lines[i];
                        else if (i + 1 < lines.length && /\d{2}:\d{2}/.test(lines[i + 1])) timeStr = lines[i + 1];
                        let match = timeStr.match(/([01]?\d|2[0-3]):([0-5]\d)/);
                        if (match) pts.push(match[1].padStart(2, '0') + ':' + match[2]);
                    }
                }

                if (pts.length > 0) {
                    d.days[m.n].times = Array.from(new Set(pts));
                } else {
                    const rawTimes = Array.from(t.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)).map(function(x) { return x[1].padStart(2, '0') + ':' + x[2]; }).filter(function(h) { return !['09:00', '12:00', '13:00', '17:00', '17:24', '00:00', '03:00'].includes(h); });
                    let absToRemove = [];
                    absIntervals.forEach(function(interval) {
                        const parts = interval.split(' - ');
                        absToRemove.push(parts[0], parts[1]);
                    });
                    d.days[m.n].times = Array.from(new Set(rawTimes)).filter(function(h) { return !absToRemove.includes(h); });
                }
            });

            try {
                // Détection automatique du matricule de la personne actuellement connectée
                const entries = performance.getEntriesByType('resource').map(r => r.name);
                const m = entries.find(u => u.includes('/workers/') || u.includes('/associates/'));
                let workerId = '';
                if (m) {
                    const match = m.match(/(?:workers|associates)\/([a-zA-Z0-9\-_]+)/);
                    if (match) workerId = match[1];
                }

                // Appel dynamique avec le matricule détecté uniquement
                if (workerId) {
                    const targetUrl = 'https://mon.adp.com/time/v3/workers/' + workerId + '/time-off-balances';
                    const res = await fetch(targetUrl, { credentials: 'same-origin' });
                    const str = await res.text();
                    const rm = str.match(/MOBHV2[\s\S]*?"timeValue"\s*:\s*"([+-]?)(\d{1,2}):(\d{2})"/i) || str.match(/Débit\/Crédit[\s\S]*?"timeValue"\s*:\s*"([+-]?)(\d{1,2}):(\d{2})"/i);
                    if (rm) {
                        d.carrySign = rm[1] === '-' ? '-' : '+';
                        d.carryH = parseInt(rm[2], 10);
                        d.carryM = parseInt(rm[3], 10);
                    }
                }
            } catch (e) {
                console.warn('[Compteur ADP] Impossible de récupérer le compteur Débit/Crédit :', e);
            }

            const out = JSON.stringify(d);
            const targetUrl = "https://raikounet.github.io/compteur-heures/?data=" + encodeURIComponent(out);

            window.open(targetUrl, 'compteur_main_window');
            setTimeout(function() {
                fermerOngletActuel();
            }, 300);

        } catch (err) {
            console.error('[Compteur ADP] Erreur d\'extraction :', err);
        }
    }
})();
