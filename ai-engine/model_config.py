"""
AI Model Configuration
配置最佳性能的足球视频分析模型
"""

from dataclasses import dataclass
from typing import List, Dict, Optional
import os

@dataclass
class ModelConfig:
    """模型配置类"""
    name: str
    url: str
    local_path: str
    type: str  # detection, segmentation, tracking, classification
    framework: str  # pytorch, onnx, tensorrt
    input_size: tuple
    confidence_threshold: float
    device: str  # cuda, cpu, mps
    
@dataclass
class TrainingConfig:
    """训练配置类"""
    dataset_path: str
    epochs: int
    batch_size: int
    learning_rate: float
    augmentation: bool
    pretrained: bool
    output_dir: str

class FootballAIConfig:
    """足球AI模型配置管理器"""
    
    # 预训练模型配置
    PRETRAINED_MODELS = {
        # 球员检测模型
        "yolov8x_soccer": ModelConfig(
            name="YOLOv8x Soccer",
            url="https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8x.pt",
            local_path="models/yolov8x_soccer.pt",
            type="detection",
            framework="pytorch",
            input_size=(640, 640),
            confidence_threshold=0.5,
            device="cuda"
        ),
        
        # 语义分割模型 (Segment Anything)
        "sam_vit_h": ModelConfig(
            name="SAM ViT-H",
            url="https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth",
            local_path="models/sam_vit_h.pth",
            type="segmentation",
            framework="pytorch",
            input_size=(1024, 1024),
            confidence_threshold=0.0,
            device="cuda"
        ),
        
        # 姿态估计模型 (YOLOv8 Pose)
        "yolov8_pose": ModelConfig(
            name="YOLOv8 Pose",
            url="https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n-pose.pt",
            local_path="models/yolov8_pose.pt",
            type="pose",
            framework="pytorch",
            input_size=(640, 640),
            confidence_threshold=0.5,
            device="cuda"
        ),
        
        # 重识别模型 (用于球员跟踪)
        "reid_resnet50": ModelConfig(
            name="ReID ResNet50",
            url="https://download.pytorch.org/models/resnet50-19c8e357.pth",
            local_path="models/reid_resnet50.pth",
            type="reid",
            framework="pytorch",
            input_size=(256, 128),
            confidence_threshold=0.0,
            device="cuda"
        ),
        
        # 足球事件分类模型
        "soccer_event_classifier": ModelConfig(
            name="Soccer Event Classifier",
            url="https://huggingface.co/models/soccer-classifier",
            local_path="models/soccer_event.pt",
            type="classification",
            framework="pytorch",
            input_size=(224, 224),
            confidence_threshold=0.3,
            device="cuda"
        ),
        
        # 光流估计模型 (用于运动分析)
        "raft_optical_flow": ModelConfig(
            name="RAFT Optical Flow",
            url="https://github.com/princeton-vl/RAFT-models/releases/download/1.0/raft-things.pth",
            local_path="models/raft.pth",
            type="optical_flow",
            framework="pytorch",
            input_size=(512, 384),
            confidence_threshold=0.0,
            device="cuda"
        )
    }
    
    # 训练配置模板
    TRAINING_TEMPLATES = {
        "soccer_detection": TrainingConfig(
            dataset_path="datasets/soccer_detection",
            epochs=100,
            batch_size=16,
            learning_rate=0.001,
            augmentation=True,
            pretrained=True,
            output_dir="runs/detect/soccer"
        ),
        
        "player_segmentation": TrainingConfig(
            dataset_path="datasets/player_segmentation",
            epochs=50,
            batch_size=8,
            learning_rate=0.0001,
            augmentation=True,
            pretrained=True,
            output_dir="runs/segment/player"
        ),
        
        "event_classification": TrainingConfig(
            dataset_path="datasets/soccer_events",
            epochs=30,
            batch_size=32,
            learning_rate=0.0005,
            augmentation=True,
            pretrained=True,
            output_dir="runs/classify/events"
        )
    }
    
    # 数据集配置
    DATASET_SOURCES = {
        # 公开足球数据集
        "soccer_player_detection": {
            "name": "Soccer Player Detection Dataset",
            "url": "https://www.kaggle.com/datasets/hsankesara/soccer-player-detection",
            "description": "足球运动员检测数据集，包含边界框标注",
            "type": "detection",
            "size": "2GB",
            "classes": ["player", "referee", "ball", "goalkeeper"]
        },
        
        "soccer_event_dataset": {
            "name": "Soccer Event Dataset",
            "url": "https://github.com/SoccerNet/sn-grounding",
            "description": "足球事件数据集，包含进球、犯规等事件标注",
            "type": "classification",
            "size": "50GB",
            "classes": ["goal", "shot", "foul", "corner", "free_kick", "penalty"]
        },
        
        "soccer_segmentation": {
            "name": "Soccer Segmentation Dataset",
            "url": "https://github.com/naver-ai/global-tracker",
            "description": "足球场景分割数据集，包含球员、球场分割标注",
            "type": "segmentation",
            "size": "10GB",
            "classes": ["player", "field", "goal", "audience", "advertisement"]
        }
    }
    
    @classmethod
    def get_best_model(cls, task: str) -> ModelConfig:
        """
        获取特定任务的最佳模型
        
        Args:
            task: 任务类型 (detection, segmentation, tracking, classification, pose)
            
        Returns:
            最佳模型配置
        """
        model_mapping = {
            "detection": "yolov8x_soccer",
            "segmentation": "sam_vit_h",
            "pose": "yolov8_pose",
            "tracking": "yolov8x_soccer",  # 检测+跟踪组合
            "classification": "soccer_event_classifier",
            "optical_flow": "raft_optical_flow"
        }
        
        model_key = model_mapping.get(task)
        if model_key and model_key in cls.PRETRAINED_MODELS:
            return cls.PRETRAINED_MODELS[model_key]
        
        # 默认返回YOLOv8
        return cls.PRETRAINED_MODELS["yolov8x_soccer"]
    
    @classmethod
    def get_training_config(cls, task: str) -> TrainingConfig:
        """
        获取训练配置
        
        Args:
            task: 任务类型
            
        Returns:
            训练配置
        """
        return cls.TRAINING_TEMPLATES.get(task, cls.TRAINING_TEMPLATES["soccer_detection"])
    
    @classmethod
    def download_model(cls, model_key: str, force_download: bool = False) -> str:
        """
        下载模型文件
        
        Args:
            model_key: 模型键名
            force_download: 是否强制重新下载
            
        Returns:
            模型本地路径
        """
        if model_key not in cls.PRETRAINED_MODELS:
            raise ValueError(f"Unknown model: {model_key}")
        
        config = cls.PRETRAINED_MODELS[model_key]
        
        # 检查模型文件是否已存在
        if os.path.exists(config.local_path) and not force_download:
            print(f"Model already exists: {config.local_path}")
            return config.local_path
        
        # 创建目录
        os.makedirs(os.path.dirname(config.local_path), exist_ok=True)
        
        # 下载模型
        print(f"Downloading {config.name} from {config.url}")
        print(f"Saving to: {config.local_path}")
        
        # 这里可以添加实际的下载逻辑
        # 暂时返回路径，实际使用中需要实现下载功能
        return config.local_path
    
    @classmethod
    def get_available_datasets(cls) -> List[str]:
        """获取可用的数据集列表"""
        return list(cls.DATASET_SOURCES.keys())
    
    @classmethod
    def get_dataset_info(cls, dataset_key: str) -> Dict:
        """获取数据集信息"""
        return cls.DATASET_SOURCES.get(dataset_key, {})
    
    @classmethod
    def create_custom_model_config(cls, 
                                  name: str,
                                  task: str,
                                  model_path: str,
                                  input_size: tuple = (640, 640),
                                  confidence_threshold: float = 0.5) -> ModelConfig:
        """
        创建自定义模型配置
        
        Args:
            name: 模型名称
            task: 任务类型
            model_path: 模型文件路径
            input_size: 输入尺寸
            confidence_threshold: 置信度阈值
            
        Returns:
            模型配置
        """
        return ModelConfig(
            name=name,
            url="local",
            local_path=model_path,
            type=task,
            framework="pytorch",
            input_size=input_size,
            confidence_threshold=confidence_threshold,
            device="cuda"
        )

# 使用示例
if __name__ == "__main__":
    config = FootballAIConfig()
    
    # 获取最佳检测模型
    best_detector = config.get_best_model("detection")
    print(f"Best detection model: {best_detector.name}")
    print(f"Input size: {best_detector.input_size}")
    print(f"Confidence threshold: {best_detector.confidence_threshold}")
    
    # 获取训练配置
    train_config = config.get_training_config("soccer_detection")
    print(f"\nTraining config for soccer detection:")
    print(f"Epochs: {train_config.epochs}")
    print(f"Batch size: {train_config.batch_size}")
    print(f"Learning rate: {train_config.learning_rate}")
    
    # 显示可用数据集
    print(f"\nAvailable datasets:")
    for dataset in config.get_available_datasets():
        info = config.get_dataset_info(dataset)
        print(f"  - {dataset}: {info.get('description', 'No description')}")