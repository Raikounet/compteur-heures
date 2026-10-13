// ==UserScript==
// @name         Auto-Export ADP vers Compteur
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  Synchro automatique via le bouton du compteur, passif en manuel, avec coupe-circuit distant
// @match        https://mon.adp.com/*
// @match        https://static.mon.adp.com/*
// @match        https://*.adp.com/*
// @match        https://raikounet.github.io/compteur-heures/*
// @match        https://railounet.github.io/compteur-heures/*
// @match        *://*/*compteur-heures*
// @connect      raw.githubusercontent.com
// @allFrames    true
// @grant        GM_closeTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-body
// ==/UserScript==

(function() {
    'use strict';

    const GITHUB_REPO_URL = 'https://raw.githubusercontent.com/Raikounet/compteur-heures/main/status.json?t=' + Date.now();

    // 1. Coupe-circuit distant (kill switch)
    function verifierStatutDistant(callback) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            callback(true);
            return;
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: GITHUB_REPO_URL,
            timeout: 2500,
            onload: function(response) {
                try {
                    const conf = JSON.parse(response.responseText);
                    callback(conf.active !== false);
                } catch (e) {
                    callback(true); // Actif par défaut si parse impossible
                }
            },
            ontimeout: function() { callback(true); },
            onerror: function() { callback(true); }
        });
    }

    verifierStatutDistant(function(estActif) {
        if (!estActif) {
            console.warn('[Compteur ADP v3.2] Script désactivé à distance via status.json.');
            return;
        }
        demarrerApplication();
    });

    function demarrerApplication() {
        const isSiteCompteur = window.location.href.includes('compteur-heures');

        // =========================================================================
        // A. SITE COMPTEUR D'HEURES
        // =========================================================================
        if (isSiteCompteur) {
            console.log('[Compteur ADP v3.2] Connecté au site du Compteur.');

            document.addEventListener('click', function(e) {
                const btn = e.target && e.target.closest('.btn-sync');
                if (btn) {
                    console.log('[Compteur ADP] Clic synchro détecté. Signal armé (30s).');
                    GM_setValue('SYNC_ADP_TIMESTAMP', Date.now());
                }
            });

            function appliquerDonnees(raw) {
                if (!raw) return;
                try {
                    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (typeof unsafeWindow.importDirectData === 'function') {
                        unsafeWindow.importDirectData(data);
                    } else {
                        window.postMessage({ type: 'ADP_DIRECT_IMPORT', data: data }, '*');
                    }
                    console.log('[Compteur ADP] Données appliquées au tableau de bord.');
                } catch (err) {
                    console.error('[Compteur ADP] Erreur traitement données :', err);
                }
            }

            GM_addValueChangeListener('ADP_DATA_PAYLOAD', function(name, oldVal, newVal) {
                if (newVal) {
                    GM_setValue('ADP_DATA_PAYLOAD', null);
                    appliquerDonnees(newVal
