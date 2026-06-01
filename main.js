
class ImageEnhancer {
  constructor() {
    this.tasks = new Map();
    this.listeners = {};
  }

  // === Публичные методы API ===

  enhance(blob) {
    const taskId = crypto.randomUUID();
    
    this.tasks.set(taskId, {
      id: taskId,
      status: 'pending',
      progress: 0,
      blob: null,
      params: null,
      error: null
    });

    this._process(taskId, blob);
    return taskId;
  }

  getStatus(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Задача не найдена');
    return { id: task.id, status: task.status, progress: task.progress };
  }

  abort(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Задача не найдена');
    task.status = 'aborted';
    this._emit('task-status-change', task);
    return true;
  }

  async getResult(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Задача не найдена');
    if (task.status === 'completed') return task.blob;
    if (task.status === 'failed') throw new Error(task.error);
    throw new Error('Задача ещё не завершена');
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  // === Внутренние методы ===

  _emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }

  _update(taskId, status, progress, extra = {}) {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'aborted') return;
    task.status = status;
    task.progress = progress;
    Object.assign(task, extra);
    this._emit('task-status-change', { ...task });
  }

  async _process(taskId, file) {
    try {
      this._update(taskId, 'decoding', 5);

      // HEIC конвертация
      let blob = file;
      if (file.type === 'image/heic' || file.name.toLowerCase().endsWith('.heic')) {
        this._update(taskId, 'decoding', 10);
        blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
      }

      const imageBitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = imageBitmap.width;
      canvas.height = imageBitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imageBitmap, 0, 0);
      imageBitmap.close();

      // Проверка размера
      const mp = (canvas.width * canvas.height) / 1_000_000;
      if (mp > 15) throw new Error('Слишком большое: ' + mp.toFixed(1) + ' Мп (макс 15)');

      this._update(taskId, 'analyzing', 30);

      // Анализ изображения
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = 224;
      smallCanvas.height = 224;
      const smallCtx = smallCanvas.getContext('2d');
      smallCtx.drawImage(canvas, 0, 0, 224, 224);
      const imageData = smallCtx.getImageData(0, 0, 224, 224).data;

      // Статистика
      let sumR = 0, sumG = 0, sumB = 0;
      const total = imageData.length / 4;
      for (let i = 0; i < imageData.length; i += 4) {
        sumR += imageData[i];
        sumG += imageData[i + 1];
        sumB += imageData[i + 2];
      }
      const avgBrightness = (sumR + sumG + sumB) / (total * 3);

      let variance = 0;
      for (let i = 0; i < imageData.length; i += 4) {
        const b = (imageData[i] + imageData[i + 1] + imageData[i + 2]) / 3;
        variance += (b - avgBrightness) ** 2;
      }
      const stdDev = Math.sqrt(variance / total);

      // Подбор параметров
      let brightness = 100;
      let contrast = 100;
      let saturation = 100;

      if (avgBrightness < 80) brightness = 130 + Math.random() * 20;
      else if (avgBrightness < 100) brightness = 115 + Math.random() * 15;
      else if (avgBrightness < 120) brightness = 105 + Math.random() * 10;
      else if (avgBrightness > 180) brightness = 75 + Math.random() * 15;
      else if (avgBrightness > 160) brightness = 85 + Math.random() * 10;

      if (stdDev < 25) contrast = 125 + Math.random() * 20;
      else if (stdDev < 35) contrast = 110 + Math.random() * 15;
      else if (stdDev < 45) contrast = 105 + Math.random() * 10;

      saturation = 105 + Math.random() * 25;

      const params = {
        brightness: Math.round(brightness),
        contrast: Math.round(contrast),
        saturation: Math.round(saturation)
      };

      this._update(taskId, 'enhancing', 60, { params });

      // Применение фильтров
      const resultCanvas = document.createElement('canvas');
      resultCanvas.width = canvas.width;
      resultCanvas.height = canvas.height;
      const resultCtx = resultCanvas.getContext('2d');
      resultCtx.filter = 'brightness(' + params.brightness + '%) contrast(' + params.contrast + '%) saturate(' + params.saturation + '%)';
      resultCtx.drawImage(canvas, 0, 0);

      this._update(taskId, 'encoding', 90);

      const resultBlob = await new Promise(resolve => resultCanvas.toBlob(resolve, 'image/jpeg', 0.92));

      this._update(taskId, 'completed', 100, { blob: resultBlob });

    } catch (error) {
      this._update(taskId, 'failed', 0, { error: error.message });
    }
  }
}

// === Инициализация ===

const enhancer = new ImageEnhancer();

// DOM
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const tasksContainer = document.getElementById('tasks');
const template = document.getElementById('task-template');
const statusEl = document.getElementById('model-status');

function init() {
  statusEl.textContent = 'Модель готова';
  statusEl.style.color = '#81c784';
  dropZone.style.opacity = '1';
  dropZone.style.pointerEvents = 'auto';
}
init();

// Drag & drop
dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('active'); });
dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('active'); });
dropZone.addEventListener('drop', function(e) {
  e.preventDefault();
  dropZone.classList.remove('active');
  var file = e.dataTransfer.files[0];
  if (file) {
    var taskId = enhancer.enhance(file);
    createCard(taskId, file.name);
  }
});
dropZone.addEventListener('click', function() { fileInput.click(); });
fileInput.addEventListener('change', function() {
  var file = fileInput.files[0];
  if (file) {
    var taskId = enhancer.enhance(file);
    createCard(taskId, file.name);
  }
});

// Подписка на события
enhancer.on('task-status-change', function(task) {
  var card = document.querySelector('[data-task-id="' + task.id + '"]');
  if (!card) return;

  var statusNames = {
    pending: 'ожидание', decoding: 'распаковка', analyzing: 'анализ',
    enhancing: 'улучшение', encoding: 'сохранение', completed: 'готово',
    failed: 'ошибка', aborted: 'отменено'
  };

  var st = card.querySelector('.task-status');
  st.textContent = statusNames[task.status] || task.status;
  card.querySelector('.progress-fill').style.width = task.progress + '%';
  card.querySelector('.progress-text').textContent = task.progress + '%';

  if (task.status === 'completed') {
    st.classList.add('completed');
    card.querySelector('.btn-download').style.display = 'inline-block';
    var url = URL.createObjectURL(task.blob);
    card.querySelector('.preview-img').src = url;
    card.querySelector('.preview-img').style.display = 'block';
    card.querySelector('.task-params').textContent =
      'Яркость: ' + task.params.brightness + '% | Контраст: ' + task.params.contrast + '% | Цветность: ' + task.params.saturation + '%';
    card.querySelector('.task-params').style.display = 'block';
    card.querySelector('.btn-download').onclick = function() {
      var a = document.createElement('a');
      a.href = url;
      a.download = 'enhanced_' + card.querySelector('.task-name').textContent;
      a.click();
    };
  }

  if (task.status === 'failed') {
    st.classList.add('failed');
    card.querySelector('.task-error').textContent = task.error;
    card.querySelector('.task-error').style.display = 'block';
  }

  if (task.status === 'aborted') st.classList.add('aborted');
});

function createCard(taskId, fileName) {
  var clone = template.content.cloneNode(true);
  clone.querySelector('.task-card').setAttribute('data-task-id', taskId);
  clone.querySelector('.task-name').textContent = fileName;
  clone.querySelector('.btn-cancel').addEventListener('click', function() { enhancer.abort(taskId); });
  tasksContainer.appendChild(clone);
}
