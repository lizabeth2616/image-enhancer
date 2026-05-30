import cv2
import numpy as np
import json
import os
from pathlib import Path
from tqdm import tqdm
import random

# Настройки
SOURCE_DIR = "Дадасет"                # папка с исходными качественными фото
OUTPUT_DIR = "dataset"                # папка для сгенерированного датасета
VARIANTS_PER_IMAGE = 5                # сколько ухудшенных версий на каждое фото
TRAIN_SPLIT = 0.8                     # 80% в обучение, 20% в валидацию

# Создаём выходные папки
for split in ['train', 'val']:
    Path(f"{OUTPUT_DIR}/{split}").mkdir(parents=True, exist_ok=True)


def load_image(path):
    """
    Загружает изображение, корректно обрабатывая кириллические пути.
    Возвращает BGR-изображение (numpy array) или None.
    """
    try:
        with open(str(path), 'rb') as f:
            data = np.frombuffer(f.read(), np.uint8)
        img = cv2.imdecode(data, cv2.IMREAD_COLOR)
        return img
    except:
        return None


def degrade_image(img, rng):
    """
    Принимает качественное BGR-изображение.
    Возвращает (ухудшенное_изображение, словарь_параметров_для_восстановления).
    """
    h, w = img.shape[:2]

    # Случайные параметры ухудшения
    brightness_factor = rng.uniform(0.4, 0.9)    # затемнение
    contrast_factor   = rng.uniform(0.4, 0.9)    # снижаем контраст
    saturation_factor = rng.uniform(0.3, 0.85)   # снижаем цветность

    # Применяем контраст и яркость (в float)
    degraded = img.astype(np.float32)
    degraded = (degraded - 128) * contrast_factor + 128
    degraded = np.clip(degraded, 0, 255)
    degraded = degraded * brightness_factor
    degraded = np.clip(degraded, 0, 255).astype(np.uint8)

    # Применяем снижение цветности через HSV
    hsv = cv2.cvtColor(degraded, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * saturation_factor, 0, 255)
    degraded = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    # Параметры для восстановления (цель модели)
    params = {
        "brightness": round((1.0 / brightness_factor) * 100, 1),
        "contrast":   round((1.0 / contrast_factor) * 100, 1),
        "saturation": round((1.0 / saturation_factor) * 100, 1)
    }

    return degraded, params


def is_valid_image(path):
    """Проверяет, что файл — читаемое изображение подходящего размера."""
    img = load_image(path)
    if img is None:
        return False
    h, w = img.shape[:2]
    if w < 400 or h < 400:
        return False
    if w * h > 25_000_000:  # > 25 Мп
        return False
    return True


def main():
    # Собираем список изображений
    source_path = Path(SOURCE_DIR)
    if not source_path.exists():
        print(f"Ошибка: папка '{SOURCE_DIR}' не найдена!")
        print(f"Текущая папка: {os.getcwd()}")
        return

    image_files = list(source_path.glob("*"))
    image_files = [f for f in image_files if f.suffix.lower() in ['.jpg', '.jpeg', '.png', '.bmp']]

    print(f"Найдено изображений: {len(image_files)}")

    # Фильтруем читаемые
    valid_files = [f for f in image_files if is_valid_image(f)]
    print(f"Из них читаемых: {len(valid_files)}")

    if len(valid_files) == 0:
        print("Нет подходящих изображений. Проверьте формат файлов и их целостность.")
        return

    random.seed(42)
    random.shuffle(valid_files)

    # Разделение на train/val
    split_idx = int(len(valid_files) * TRAIN_SPLIT)
    splits = {
        'train': valid_files[:split_idx],
        'val':   valid_files[split_idx:]
    }

    all_params = {'train': [], 'val': []}

    for split_name, files in splits.items():
        print(f"\nГенерирую {split_name}...")

        for file_path in tqdm(files):
            img = load_image(file_path)
            if img is None:
                continue

            base_name = file_path.stem

            for v in range(VARIANTS_PER_IMAGE):
                seed = hash(f"{file_path}_{v}") % (2**31)
                rng = np.random.RandomState(seed)

                degraded_img, params = degrade_image(img, rng)

                out_name = f"{base_name}_v{v}.jpg"
                out_path = f"{OUTPUT_DIR}/{split_name}/{out_name}"

                cv2.imwrite(out_path, degraded_img, [cv2.IMWRITE_JPEG_QUALITY, 92])

                all_params[split_name].append({
                    "image": out_name,
                    "brightness_target": params["brightness"],
                    "contrast_target":   params["contrast"],
                    "saturation_target": params["saturation"]
                })

    # Сохраняем файлы с параметрами
    for split_name in ['train', 'val']:
        params_path = f"{OUTPUT_DIR}/{split_name}_params.jsonl"
        with open(params_path, "w", encoding="utf-8") as f:
            for entry in all_params[split_name]:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    print("\n" + "=" * 50)
    print("Готово!")
    print(f"Train: {len(all_params['train'])} пар")
    print(f"Val:   {len(all_params['val'])} пар")
    print(f"Данные сохранены в папку: {OUTPUT_DIR}/")
    print("=" * 50)


if __name__ == "__main__":
    main()