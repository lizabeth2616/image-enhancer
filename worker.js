importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');

let model = null;
let isModelLoaded = false;

async function loadModel() {
  try {
    self.postMessage({ type: 'status', message: 'Загрузка модели...' });
    await tf.ready();
    model = await tf.loadLayersModel('model-tfjs/model.json');
    isModelLoaded = true;
    self.postMessage({ type: 'status', message: 'Модель загружена' });
  } catch (error) {
    self.postMessage({ type: 'error', message: 'Ошибка загрузки модели: ' + error.message });
  }
}

loadModel();

self.onmessage = async function(e) {
  const { type, taskId, imageData, width, height } = e.data;

  if (type === 'enhance') {
    try {
      if (!isModelLoaded) {
        self.postMessage({ type: 'error', taskId, message: 'Модель ещё не загружена' });
        return;
      }

      self.postMessage({ type: 'progress', taskId, status: 'analyzing', progress: 10 });
      
      const imgData = new ImageData(
        new Uint8ClampedArray(imageData),
        width,
        height
      );

      const offscreen = new OffscreenCanvas(224, 224);
      const ctx = offscreen.getContext('2d');
      
      const tempCanvas = new OffscreenCanvas(width, height);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(imgData, 0, 0);
      
      ctx.drawImage(tempCanvas.transferToImageBitmap(), 0, 0, 224, 224);
      
      self.postMessage({ type: 'progress', taskId, status: 'analyzing', progress: 30 });
      
      const tensor = tf.browser.fromPixels(offscreen)
        .expandDims(0)
        .toFloat()
        .div(127.5)
        .sub(1);

      const prediction = model.predict(tensor);
      const params = await prediction.data();
      
      tf.dispose([tensor, prediction]);

      const brightness = params[0] * 100;
      const contrast = params[1] * 100;
      const saturation = params[2] * 100;

      self.postMessage({ 
        type: 'progress', 
        taskId, 
        status: 'enhancing', 
        progress: 60,
        params: { brightness, contrast, saturation }
      });

      const fullCanvas = new OffscreenCanvas(width, height);
      const fullCtx = fullCanvas.getContext('2d');
      
      fullCtx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
      fullCtx.drawImage(tempCanvas.transferToImageBitmap(), 0, 0);

      self.postMessage({ type: 'progress', taskId, status: 'encoding', progress: 90 });
      
      const blob = await fullCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
      
      self.postMessage({
        type: 'complete',
        taskId,
        blob: blob,
        params: { brightness, contrast, saturation }
      }, [blob]);

    } catch (error) {
      self.postMessage({ type: 'error', taskId, message: error.message });
    }
  }
};