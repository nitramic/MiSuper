// OCR + PDF handling using globally-loaded Tesseract.js and pdf.js (CDN <script> tags).

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}

export async function fileToImageCanvases(file) {
  if (file.type === "application/pdf") {
    return await pdfToCanvases(file);
  }
  const canvas = await imageFileToCanvas(file);
  return [canvas];
}

function imageFileToCanvas(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function pdfToCanvases(file) {
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const canvases = [];
  const maxPages = Math.min(pdf.numPages, 5);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    canvases.push(canvas);
  }
  return canvases;
}

export async function runOCR(canvases, onProgress) {
  const worker = await window.Tesseract.createWorker("spa", 1, {
    logger: (msg) => {
      if (msg.status && typeof msg.progress === "number") {
        onProgress?.(msg.status, msg.progress);
      }
    },
  });

  let fullText = "";
  for (const canvas of canvases) {
    const { data } = await worker.recognize(canvas);
    fullText += data.text + "\n";
  }
  await worker.terminate();
  return fullText;
}
