/*!
 * GILM Grid Module (UMD) - gestione griglia e rendering
 * AGPL-3.0-or-later
 */
(function (root, factory) {
  if (typeof define === "function" && define.amd) define([], factory);
  else if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GILMGrid = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Utils */
  function numberToLetters(num) {
    let str = "";
    while (num > 0) {
      const rem = (num - 1) % 26;
      str = String.fromCharCode(65 + rem) + str;
      num = Math.floor((num - 1) / 26);
    }
    return str;
  }

  function cellLabelToIndex(label, rows, cols) {
    const match = label.match(/^([A-Z]+)(\d+)$/i);
    if (!match) return null;
    
    const colStr = match[1].toUpperCase();
    const row = parseInt(match[2], 10) - 1; // zero-based
    
    let col = 0;
    for (let i = 0; i < colStr.length; i++) {
      col = col * 26 + (colStr.charCodeAt(i) - 64);
    }
    col = col - 1; // zero-based
    
    if (row < 0 || col < 0) return null;
    if (row >= rows || col >= cols) return null;
    
    return { r: row, c: col };
  }

  // Helper per caricare un'immagine
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      if (typeof src === 'string') {
        img.src = src;
      } else if (src instanceof HTMLImageElement) {
        resolve(src);
      }
    });
  }

  // Helper per convertire File/Blob in dataURL
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Helper per convertire dataURL in File
  function dataURLtoFile(dataurl, filename) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
  }

  /**
   * composeGrid(input, cfg) -> { gridDataURL, imgW, imgH }
   * input: File | Blob | HTMLImageElement | dataURL | URL
   * cfg: { rows, cols, margin, maxSide, gridColor, labelFont, labelFill, labelStroke }
   */
  async function composeGrid(input, cfg) {
    const config = {
      rows: 12,
      cols: 12,
      margin: 48,
      maxSide: 1400,
      gridColor: "rgba(0,0,0,0.35)",
      labelFont: "bold 12px Arial",
      labelFill: "rgba(255,255,255,0.97)",
      labelStroke: "rgba(0,0,0,0.9)",
      ...cfg
    };

    let dataURL;
    if (input instanceof File || input instanceof Blob) {
      dataURL = await fileToDataURL(input);
    } else if (typeof input === 'string') {
      dataURL = input;
    } else if (input instanceof HTMLImageElement) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = input.width;
      canvas.height = input.height;
      ctx.drawImage(input, 0, 0);
      dataURL = canvas.toDataURL();
    } else {
      throw new Error('Input type not supported');
    }

    const img = await loadImage(dataURL);

    // Ridimensionamento se necessario
    let w = img.width;
    let h = img.height;
    if (Math.max(w, h) > config.maxSide) {
      const scale = config.maxSide / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    // Canvas con margini
    const outW = w + config.margin * 2;
    const outH = h + config.margin * 2;
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');

    // Sfondo bianco
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outW, outH);

    // Disegna immagine centrata
    const offX = config.margin;
    const offY = config.margin;
    ctx.drawImage(img, offX, offY, w, h);

    // Disegna griglia
    ctx.strokeStyle = config.gridColor;
    ctx.lineWidth = 1;
    const cellW = w / config.cols;
    const cellH = h / config.rows;

    // Linee verticali
    for (let c = 0; c <= config.cols; c++) {
      const x = offX + c * cellW;
      ctx.beginPath();
      ctx.moveTo(x, offY);
      ctx.lineTo(x, offY + h);
      ctx.stroke();
    }

    // Linee orizzontali
    for (let r = 0; r <= config.rows; r++) {
      const y = offY + r * cellH;
      ctx.beginPath();
      ctx.moveTo(offX, y);
      ctx.lineTo(offX + w, y);
      ctx.stroke();
    }

    // Labels delle celle
    ctx.font = config.labelFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let r = 0; r < config.rows; r++) {
      for (let c = 0; c < config.cols; c++) {
        const cx = offX + c * cellW + cellW / 2;
        const cy = offY + r * cellH + cellH / 2;
        const label = numberToLetters(c + 1) + String(r + 1);

        // Contorno
        ctx.lineWidth = 3;
        ctx.strokeStyle = config.labelStroke;
        ctx.strokeText(label, cx, cy);

        // Riempimento
        ctx.fillStyle = config.labelFill;
        ctx.fillText(label, cx, cy);
      }
    }

    const gridDataURL = canvas.toDataURL('image/jpeg', 0.92);

    return {
      gridDataURL,
      imgW: w,
      imgH: h,
      originalW: img.width,
      originalH: img.height,
      margin: config.margin,
      rows: config.rows,
      cols: config.cols,
      cellW,
      cellH
    };
  }

  /**
   * drawBoxes(canvas, image, boxes, style?)
   * boxes: [{x,y,w,h,label?,score?}]
   */
  async function drawBoxes(canvas, image, boxes, style) {
    const config = {
      colors: ["#1E88E5", "#E53935", "#43A047", "#FF9800", "#9C27B0"],
      lineWidth: 3,
      fontSize: 16,
      fontFamily: "Arial",
      ...style
    };

    const ctx = canvas.getContext('2d');
    
    // Carica e disegna l'immagine se necessario
    if (image) {
      let img;
      try {
        if (typeof image === 'string') {
          img = await loadImage(image);
        } else if (image instanceof HTMLImageElement) {
          img = image;
        } else if (image instanceof File || image instanceof Blob) {
          const dataURL = await fileToDataURL(image);
          img = await loadImage(dataURL);
        } else {
          throw new Error('Image type not supported: ' + typeof image);
        }
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      } catch (error) {
        console.error('[GILMGrid] Error loading image:', error);
        throw new Error(`Errore caricamento immagine: ${error.message}`);
      }
    }

    // Disegna i box
    boxes.forEach((box, i) => {
      const color = config.colors[i % config.colors.length];
      const { x, y, w, h, label, score } = box;

      ctx.save();

      // Rettangolo
      ctx.lineWidth = config.lineWidth;
      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, w, h);

      // Badge numerico
      const badgeSize = 28;
      ctx.fillStyle = color;
      ctx.fillRect(x, y - badgeSize, badgeSize, badgeSize);
      
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${config.fontSize}px ${config.fontFamily}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), x + badgeSize / 2, y - badgeSize / 2);

      // Label opzionale
      if (label) {
        const labelY = y + h + 20;
        ctx.fillStyle = color;
        ctx.font = `${config.fontSize}px ${config.fontFamily}`;
        ctx.textAlign = 'left';
        ctx.fillText(label + (score ? ` (${Math.round(score * 100)}%)` : ''), x, labelY);
      }

      ctx.restore();
    });
  }

  /**
   * highlightCells(canvas, image, cells, rows, cols, style?)
   * cells: ["B3","B4","C4", ...]
   */
  async function highlightCells(canvas, image, cells, rows, cols, style) {
    const config = {
      highlightColor: "rgba(255, 0, 0, 0.3)",
      borderColor: "#FF0000",
      borderWidth: 2,
      ...style
    };

    const ctx = canvas.getContext('2d');
    
    // Carica e disegna l'immagine
    if (image) {
      let img;
      try {
        if (typeof image === 'string') {
          img = await loadImage(image);
        } else if (image instanceof HTMLImageElement) {
          img = image;
        } else if (image instanceof File || image instanceof Blob) {
          const dataURL = await fileToDataURL(image);
          img = await loadImage(dataURL);
        } else {
          throw new Error('Image type not supported: ' + typeof image);
        }
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      } catch (error) {
        console.error('[GILMGrid] Error loading image:', error);
        throw new Error(`Errore caricamento immagine: ${error.message}`);
      }
    }

    const cellW = canvas.width / cols;
    const cellH = canvas.height / rows;

    // Evidenzia le celle
    cells.forEach(cellLabel => {
      const index = cellLabelToIndex(cellLabel, rows, cols);
      if (!index) return;

      const x = index.c * cellW;
      const y = index.r * cellH;

      ctx.save();

      // Riempimento
      ctx.fillStyle = config.highlightColor;
      ctx.fillRect(x, y, cellW, cellH);

      // Bordo
      ctx.strokeStyle = config.borderColor;
      ctx.lineWidth = config.borderWidth;
      ctx.strokeRect(x, y, cellW, cellH);

      // Label della cella
      ctx.fillStyle = config.borderColor;
      ctx.font = "bold 14px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(cellLabel, x + cellW / 2, y + cellH / 2);

      ctx.restore();
    });
  }

  return {
    // API
    composeGrid,
    drawBoxes,
    highlightCells,
    // Utils
    numberToLetters,
    cellLabelToIndex
  };
});