#!/usr/bin/env python3
"""
足球专用模型训练脚本
支持自定义数据集训练和模型微调
"""

import os
import sys
import argparse
import yaml
from pathlib import Path
import torch
from ultralytics import YOLO
import torchvision.transforms as transforms
from torch.utils.data import DataLoader, Dataset
from PIL import Image
import cv2
import numpy as np
from tqdm import tqdm
import wandb  # 可选：用于实验跟踪

from model_config import FootballAIConfig

class SoccerDataset(Dataset):
    """足球数据集类"""
    
    def __init__(self, dataset_path, transform=None, task="detection"):
        """
        初始化数据集
        
        Args:
            dataset_path: 数据集路径
            transform: 数据增强
            task: 任务类型 (detection, segmentation, classification)
        """
        self.dataset_path = Path(dataset_path)
        self.transform = transform
        self.task = task
        
        # 加载数据标注
        self.samples = self._load_samples()
        
        print(f"Loaded {len(self.samples)} samples from {dataset_path}")
        
    def _load_samples(self):
        """加载数据集样本"""
        samples = []
        
        # 支持多种格式
        annotation_files = list(self.dataset_path.rglob("*.txt")) + \
                          list(self.dataset_path.rglob("*.json")) + \
                          list(self.dataset_path.rglob("*.xml"))
        
        for ann_file in annotation_files:
            # 根据标注格式解析
            if ann_file.suffix == ".txt":
                # YOLO格式
                image_file = ann_file.with_suffix(".jpg")
                if image_file.exists():
                    samples.append({
                        "image": str(image_file),
                        "annotation": str(ann_file),
                        "format": "yolo"
                    })
            elif ann_file.suffix == ".json":
                # COCO格式
                samples.append({
                    "image": str(ann_file),
                    "annotation": str(ann_file),
                    "format": "coco"
                })
            elif ann_file.suffix == ".xml":
                # Pascal VOC格式
                image_file = ann_file.with_suffix(".jpg")
                if image_file.exists():
                    samples.append({
                        "image": str(image_file),
                        "annotation": str(ann_file),
                        "format": "voc"
                    })
        
        return samples
    
    def __len__(self):
        return len(self.samples)
    
    def __getitem__(self, idx):
        sample = self.samples[idx]
        
        # 加载图像
        image = Image.open(sample["image"]).convert("RGB")
        
        # 加载标注
        if self.task == "detection":
            labels = self._load_detection_labels(sample)
        elif self.task == "classification":
            labels = self._load_classification_labels(sample)
        else:
            labels = None
        
        # 数据增强
        if self.transform:
            image = self.transform(image)
        
        return image, labels
    
    def _load_detection_labels(self, sample):
        """加载检测标签"""
        if sample["format"] == "yolo":
            return self._load_yolo_labels(sample["annotation"])
        # 其他格式可以在这里扩展
        return None
    
    def _load_yolo_labels(self, ann_path):
        """加载YOLO格式标签"""
        labels = []
        with open(ann_path, 'r') as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) >= 5:
                    class_id = int(parts[0])
                    x_center = float(parts[1])
                    y_center = float(parts[2])
                    width = float(parts[3])
                    height = float(parts[4])
                    labels.append([class_id, x_center, y_center, width, height])
        return np.array(labels) if labels else np.zeros((0, 5))
    
    def _load_classification_labels(self, sample):
        """加载分类标签"""
        # 从文件名或标注文件解析分类标签
        # 这里需要根据实际数据集格式实现
        return 0  # 临时返回值

def train_yolo_model(config, train_config):
    """
    训练YOLO模型
    
    Args:
        config: 模型配置
        train_config: 训练配置
    """
    print(f"Training YOLO model: {config.name}")
    print(f"Training config: {train_config}")
    
    # 创建输出目录
    os.makedirs(train_config.output_dir, exist_ok=True)
    
    # 加载预训练模型
    model = YOLO(config.local_path if os.path.exists(config.local_path) else config.name)
    
    # 训练参数
    train_args = {
        "data": self._create_dataset_config(train_config),
        "epochs": train_config.epochs,
        "batch": train_config.batch_size,
        "imgsz": config.input_size[0],
        "device": config.device,
        "workers": 4,
        "patience": 50,
        "save": True,
        "save_period": 10,
        "cache": True,
        "project": train_config.output_dir,
        "name": "train",
        "exist_ok": True,
        "pretrained": train_config.pretrained,
        "optimizer": "AdamW",
        "lr0": train_config.learning_rate,
        "lrf": 0.01,
        "momentum": 0.937,
        "weight_decay": 0.0005,
        "warmup_epochs": 3,
        "warmup_momentum": 0.8,
        "box": 7.5,
        "cls": 0.5,
        "dfl": 1.5,
        "fliplr": 0.5 if train_config.augmentation else 0.0,
        "mosaic": 1.0 if train_config.augmentation else 0.0,
        "mixup": 0.0,
        "copy_paste": 0.0,
        "degrees": 0.0 if train_config.augmentation else 0.0,
        "translate": 0.1 if train_config.augmentation else 0.0,
        "scale": 0.5 if train_config.augmentation else 0.0,
        "shear": 0.0,
        "perspective": 0.0,
        "hsv_h": 0.015 if train_config.augmentation else 0.0,
        "hsv_s": 0.7 if train_config.augmentation else 0.0,
        "hsv_v": 0.4 if train_config.augmentation else 0.0,
    }
    
    # 开始训练
    print("Starting training...")
    results = model.train(**train_args)
    
    # 保存最佳模型
    best_model_path = os.path.join(train_config.output_dir, "train", "weights", "best.pt")
    if os.path.exists(best_model_path):
        print(f"Best model saved to: {best_model_path}")
    
    return results

def _create_dataset_config(self, train_config):
    """
    创建数据集配置文件
    
    Args:
        train_config: 训练配置
        
    Returns:
        数据集配置字典或YAML文件路径
    """
    # 创建YOLO格式的数据集配置
    dataset_config = {
        "path": train_config.dataset_path,
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "names": {
            0: "player",
            1: "referee",
            2: "ball",
            3: "goalkeeper"
        }
    }
    
    # 保存为YAML文件
    config_path = os.path.join(train_config.output_dir, "dataset.yaml")
    with open(config_path, 'w') as f:
        yaml.dump(dataset_config, f)
    
    return config_path

def fine_tune_model(base_model_path, custom_dataset_path, output_dir, epochs=30):
    """
    微调现有模型
    
    Args:
        base_model_path: 基础模型路径
        custom_dataset_path: 自定义数据集路径
        output_dir: 输出目录
        epochs: 训练轮数
    """
    print(f"Fine-tuning model: {base_model_path}")
    print(f"Using custom dataset: {custom_dataset_path}")
    
    # 加载模型
    model = YOLO(base_model_path)
    
    # 微调参数
    train_args = {
        "data": os.path.join(custom_dataset_path, "dataset.yaml"),
        "epochs": epochs,
        "imgsz": 640,
        "batch": 8,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "workers": 4,
        "project": output_dir,
        "name": "fine_tune",
        "save": True,
        "save_period": 5,
        "pretrained": True,
        "freeze": 10,  # 冻结前10层
        "lr0": 0.0001,  # 较小的学习率
        "cos_lr": True,  # 余弦学习率调度
        "label_smoothing": 0.1,
        "patience": 20
    }
    
    # 开始微调
    results = model.train(**train_args)
    return results

def export_model(model_path, output_path, format="onnx"):
    """
    导出模型为其他格式
    
    Args:
        model_path: 模型路径
        output_path: 输出路径
        format: 导出格式 (onnx, torchscript, tflite)
    """
    print(f"Exporting model: {model_path}")
    print(f"Format: {format}")
    
    model = YOLO(model_path)
    
    if format == "onnx":
        success = model.export(format="onnx", dynamic=True, simplify=True)
    elif format == "torchscript":
        success = model.export(format="torchscript")
    elif format == "tflite":
        success = model.export(format="tflite")
    else:
        raise ValueError(f"Unsupported format: {format}")
    
    if success:
        print(f"Model exported successfully to: {output_path}")
    else:
        print("Model export failed")
    
    return success

def evaluate_model(model_path, dataset_path):
    """
    评估模型性能
    
    Args:
        model_path: 模型路径
        dataset_path: 数据集路径
    """
    print(f"Evaluating model: {model_path}")
    
    model = YOLO(model_path)
    
    # 评估参数
    metrics = model.val(
        data=os.path.join(dataset_path, "dataset.yaml"),
        split="val",
        device="cuda" if torch.cuda.is_available() else "cpu",
        imgsz=640,
        batch=16,
        conf=0.001,
        iou=0.6,
        max_det=300,
        half=True,
        plots=True
    )
    
    print("\nEvaluation Results:")
    print(f"mAP@0.5: {metrics.box.map50:.4f}")
    print(f"mAP@0.5:0.95: {metrics.box.map:.4f}")
    print(f"Precision: {metrics.box.p:.4f}")
    print(f"Recall: {metrics.box.r:.4f}")
    
    return metrics

def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="Train soccer-specific AI models")
    parser.add_argument("--task", type=str, default="detection", 
                       choices=["detection", "segmentation", "classification"],
                       help="Task type")
    parser.add_argument("--dataset", type=str, required=True,
                       help="Path to dataset")
    parser.add_argument("--epochs", type=int, default=100,
                       help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=16,
                       help="Batch size")
    parser.add_argument("--output", type=str, default="runs",
                       help="Output directory")
    parser.add_argument("--resume", action="store_true",
                       help="Resume training from checkpoint")
    parser.add_argument("--fine-tune", type=str,
                       help="Path to base model for fine-tuning")
    parser.add_argument("--export", action="store_true",
                       help="Export model after training")
    
    args = parser.parse_args()
    
    # 初始化配置
    config_manager = FootballAIConfig()
    
    # 获取最佳模型配置
    model_config = config_manager.get_best_model(args.task)
    
    # 创建训练配置
    train_config = config_manager.get_training_config(args.task)
    train_config.dataset_path = args.dataset
    train_config.epochs = args.epochs
    train_config.batch_size = args.batch_size
    train_config.output_dir = args.output
    
    # 微调模式
    if args.fine_tune:
        print(f"Fine-tuning mode: {args.fine_tune}")
        results = fine_tune_model(
            args.fine_tune,
            args.dataset,
            args.output,
            args.epochs
        )
    else:
        # 正常训练模式
        results = train_yolo_model(model_config, train_config)
    
    # 评估模型
    if os.path.exists(args.dataset):
        evaluate_model(
            os.path.join(args.output, "train", "weights", "best.pt"),
            args.dataset
        )
    
    # 导出模型
    if args.export:
        export_model(
            os.path.join(args.output, "train", "weights", "best.pt"),
            os.path.join(args.output, "exported_model.onnx"),
            format="onnx"
        )
    
    print("\nTraining completed successfully!")
    print(f"Results saved to: {args.output}")

if __name__ == "__main__":
    main()