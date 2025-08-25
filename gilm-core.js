/*!
 * GILM Core Module (UMD) - orchestratore GILM, prompt, parsing, display
 * AGPL-3.0-or-later
 */
(function (root, factory) {
  if (typeof define === "function" && define.amd) define([], factory);
  else if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GILMCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DisplayMode = Object.freeze({
    BBOX: "bbox",
    CELLS: "cells"
  });

  /**
   * buildPrompt({ objects, rows, cols, maxAreas, language })
   * Prompt scientifico e minimale, con JSON richiesto.
   */
  function buildPrompt(opts) {
    const config = {
      objects: "oggetti di interesse",
      rows: 12,
      cols: 12,
      maxAreas: 2,
      language: "it",
      ...opts
    };

    const colEnd = (typeof root !== 'undefined' && root.GILMGrid) ? 
      root.GILMGrid.numberToLetters(config.cols) : 
      numberToLetters(config.cols);

    // Prompt unificato con specificazione lingua dinamica
    const languageName = config.language === "en" ? "English" : "Italian";
    const languageCode = config.language.toLowerCase();
    
    return `You are an expert in visual analysis and object detection.
The image contains a grid with columns A..${colEnd} and rows 1..${config.rows} (cells like A1, B7, A10).
OBJECTIVE: Identify, if present, AREAS OF INTEREST containing in ${languageName} language "${config.objects}".
An area can include ONE OR MORE CONTIGUOUS CELLS. Evaluate ONLY sharp areas; if you see human markings (yellow), prioritize them.
You must be as precise as possible in indicating the interested cells.

IMPORTANT: Provide all labels and explanations in ${languageName.toUpperCase()}.

RETURN ONLY valid JSON:

{
  "areas": [
    {
      "cells": ["B3","B4","C4"],
      "label": "object-class-in-${languageCode}-language",
      "score": 0.0-1.0,
      "explanation": "Brief explanation in ${languageName} of the anomaly and why to check it, don't mention cells"
    }
  ],
  "no_detections": false
}

If you see no ${config.objects} or the photo is not evaluable:
{"areas": [], "no_detections": true, "reason": "synthetic reason in ${languageName}"}

Maximum ${config.maxAreas} areas.`;
  }

  // Helper per numberToLetters (fallback se GILMGrid non è disponibile)
  function numberToLetters(num) {
    let str = "";
    while (num > 0) {
      const rem = (num - 1) % 26;
      str = String.fromCharCode(65 + rem) + str;
      num = Math.floor((num - 1) / 26);
    }
    return str;
  }

  /**
   * parseModelJSON(raw) -> { areas, no_detections|no_anomalies, ... } | null
   * Tollerante a blocchi ```json e piccole impurità.
   */
  function parseModelJSON(raw) {
    try {
      // Rimuove eventuali blocchi ```json...```
      let cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      
      // Trova il primo oggetto JSON valido
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Normalizza i campi (supporta sia no_detections che no_anomalies)
        if (parsed.hasOwnProperty('no_anomalies') && !parsed.hasOwnProperty('no_detections')) {
          parsed.no_detections = parsed.no_anomalies;
        }
        
        // Assicura che areas sia un array
        if (!Array.isArray(parsed.areas)) {
          parsed.areas = [];
        }
        
        return parsed;
      }
      
      // Fallback: prova a parsare direttamente
      return JSON.parse(cleaned);
    } catch (e) {
      console.warn('[GILMCore] parseModelJSON failed:', e);
      return null;
    }
  }

  // Helper per convertire File/Blob in base64
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataURL = reader.result;
        const base64 = dataURL.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Helper per mappare celle a rettangolo
  function cellsToRect(cells, dims) {
    if (!cells || cells.length === 0) return null;
    
    const cellLabelToIndex = (typeof root !== 'undefined' && root.GILMGrid) ? 
      root.GILMGrid.cellLabelToIndex : 
      function(label, rows, cols) {
        const match = label.match(/^([A-Z]+)(\d+)$/i);
        if (!match) return null;
        
        const colStr = match[1].toUpperCase();
        const row = parseInt(match[2], 10) - 1;
        
        let col = 0;
        for (let i = 0; i < colStr.length; i++) {
          col = col * 26 + (colStr.charCodeAt(i) - 64);
        }
        col = col - 1;
        
        if (row < 0 || col < 0 || row >= rows || col >= cols) return null;
        return { r: row, c: col };
      };

    const indices = cells.map(cell => cellLabelToIndex(cell, dims.rows, dims.cols)).filter(Boolean);
    if (indices.length === 0) return null;

    // Calcola min/max
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    indices.forEach(({c, r}) => {
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    });

    // Conversione a pixel sull'immagine originale
    const cellW = dims.imgW / dims.cols;
    const cellH = dims.imgH / dims.rows;

    const x = minC * cellW;
    const y = minR * cellH;
    const w = (maxC - minC + 1) * cellW;
    const h = (maxR - minR + 1) * cellH;

    return { x, y, w, h };
  }

  // Helper per applicare padding
  function applyPadding(rect, ratio, maxW, maxH) {
    const padX = rect.w * ratio;
    const padY = rect.h * ratio;
    
    const x = Math.max(0, rect.x - padX);
    const y = Math.max(0, rect.y - padY);
    const w = Math.min(rect.w + 2 * padX, maxW - x);
    const h = Math.min(rect.h + 2 * padY, maxH - y);
    
    return { x, y, w, h };
  }

  /**
   * analyzeWithGrid(provider, {
   *   fileOrDataURL, rows, cols, maxAreas, padRatio,
   *   displayMode: DisplayMode.BBOX|CELLS,
   *   canvas, objects, language,
   *   gridPreview: boolean
   * }) -> { boxes?, cells?, raw, provider }
   *
   * Flusso:
   * 1) Genera immagine con griglia (GILMGrid.composeGrid) se serve mandar la griglia al provider
   * 2) Prompt = buildPrompt(...)
   * 3) Provider.generate([{text:prompt}, {image_base64:...}])
   * 4) parseModelJSON -> aree (celle contigue)
   * 5) Se BBOX: mappa celle->rettangolo su img originale + padding; disegna con GILMGrid.drawBoxes
   *    Se CELLS: evidenzia celle con GILMGrid.highlightCells
   */
  async function analyzeWithGrid(provider, options) {
    const config = {
      rows: 12,
      cols: 12,
      maxAreas: 2,
      padRatio: 0.02,
      displayMode: DisplayMode.BBOX,
      objects: "oggetti di interesse",
      language: "it",
      gridPreview: false,
      ...options
    };

    if (!provider || typeof provider.generate !== 'function') {
      throw new Error('[GILMCore] Provider valido richiesto');
    }

    if (!config.fileOrDataURL) {
      throw new Error('[GILMCore] File o dataURL richiesto');
    }

    // Verifica disponibilità di GILMGrid
    const GILMGrid = (typeof window !== 'undefined' && window.GILMGrid) || 
                     (typeof global !== 'undefined' && global.GILMGrid) ||
                     (typeof root !== 'undefined' && root.GILMGrid) ||
                     (typeof self !== 'undefined' && self.GILMGrid);
    
    if (!GILMGrid) {
      throw new Error('[GILMCore] GILMGrid module richiesto. Assicurati di aver caricato gilm-grid.js prima di gilm-core.js');
    }

    try {
      console.log('[GILMCore] Inizio analisi con configurazione:', config);
      
      // 1) Genera immagine con griglia
      console.log('[GILMCore] Generazione griglia...');
      const gridResult = await GILMGrid.composeGrid(config.fileOrDataURL, {
        rows: config.rows,
        cols: config.cols
      });
      console.log('[GILMCore] Griglia generata:', gridResult);

      // 2) Prepara base64 per il provider
      let base64Data;
      if (config.fileOrDataURL instanceof File || config.fileOrDataURL instanceof Blob) {
        console.log('[GILMCore] Conversione File/Blob a base64...');
        base64Data = await fileToBase64(config.fileOrDataURL);
      } else if (typeof config.fileOrDataURL === 'string') {
        if (config.fileOrDataURL.startsWith('data:')) {
          console.log('[GILMCore] Estrazione base64 da dataURL...');
          base64Data = config.fileOrDataURL.split(',')[1];
        } else {
          console.log('[GILMCore] URL immagine fornito...');
          base64Data = config.fileOrDataURL;
        }
      }

      // Usa l'immagine con griglia per l'analisi
      console.log('[GILMCore] Estrazione base64 da griglia...');
      const gridBase64 = gridResult.gridDataURL.split(',')[1];
      
      if (!gridBase64 || gridBase64.length < 100) {
        throw new Error('Dati base64 della griglia non validi');
      }
      console.log('[GILMCore] Base64 griglia estratto, lunghezza:', gridBase64.length);

      // 3) Costruisci prompt
      console.log('[GILMCore] Costruzione prompt...');
      const prompt = buildPrompt({
        objects: config.objects,
        rows: config.rows,
        cols: config.cols,
        maxAreas: config.maxAreas,
        language: config.language
      });
      console.log('[GILMCore] Prompt costruito, lunghezza:', prompt.length);

      // 4) Chiama il provider
      const parts = [
        { type: "text", text: prompt },
        { type: "image_base64", data: gridBase64, mime: "image/jpeg" }
      ];

      console.log('[GILMCore] Chiamata al provider...');
      const rawResponse = await provider.generate(parts);
      console.log('[GILMCore] Risposta ricevuta:', rawResponse);

      // 5) Parse della risposta
      const parsed = parseModelJSON(rawResponse);
      if (!parsed) {
        return {
          raw: rawResponse,
          provider: provider.name(),
          error: "Risposta non parsabile come JSON"
        };
      }

      // 6) Se no detections, ritorna subito
      if (parsed.no_detections) {
        return {
          raw: rawResponse,
          provider: provider.name(),
          noDetections: true,
          reason: parsed.reason || parsed.reason_it
        };
      }

      // 7) Processa le aree
      const areas = (parsed.areas || []).slice(0, config.maxAreas);
      const result = {
        raw: rawResponse,
        provider: provider.name(),
        areas: areas
      };

      // 8) Rendering basato su displayMode
      if (config.canvas) {
        if (config.displayMode === DisplayMode.CELLS) {
          // Modalità evidenziazione celle
          await GILMGrid.highlightCells(
            config.canvas,
            config.fileOrDataURL,
            areas.flatMap(a => a.cells || []),
            config.rows,
            config.cols
          );
          result.cells = areas.flatMap(a => a.cells || []);
        } else {
          // Modalità bounding box (default)
          const boxes = [];
          
          areas.forEach(area => {
            const cells = area.cells || [];
            if (cells.length === 0) return;
            
            const rect = cellsToRect(cells, gridResult);
            if (rect) {
              const paddedRect = applyPadding(rect, config.padRatio, gridResult.imgW, gridResult.imgH);
              boxes.push({
                ...paddedRect,
                label: area.label,
                score: area.score
              });
            }
          });

          if (boxes.length > 0) {
            await GILMGrid.drawBoxes(config.canvas, config.fileOrDataURL, boxes);
          }
          result.boxes = boxes;
        }
      }

      return result;

    } catch (error) {
      return {
        raw: error.message,
        provider: provider.name(),
        error: error.message
      };
    }
  }

  return {
    DisplayMode,
    buildPrompt,
    parseModelJSON,
    analyzeWithGrid
  };
});