"""
Player Detection Module using YOLOv8
专门用于足球视频中的球员检测
"""

import cv2
import numpy as np
from ultralytics import YOLO
from typing import List, Dict, Tuple, Optional
import torch
import time
from dataclasses import dataclass
from pathlib import Path

@dataclass
class PlayerDetection:
    """球员检测结果"""
    bbox: List[float]  # [x1, y1, x2, y2]
    confidence: float
    class_id: int
    class_name: str
    team: Optional[str] = None  # 球队识别（需要额外训练）
    player_id: Optional[int] = None  # 球员ID（需要跟踪）
    
@dataclass
class FrameResult:
    """单帧检测结果"""
    frame_index: int
    timestamp: float
    detections: List[PlayerDetection]
    frame_size: Tuple[int, int]  # (width, height)

class PlayerDetector:
    """球员检测器"""
    
    def __init__(self, model_path: str = None, device: str = None):
        """
        初始化球员检测器
        
        Args:
            model_path: 模型路径，如果为None则使用预训练的YOLOv8
            device: 设备 ('cuda', 'cpu', 'mps')
        """
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"Using device: {self.device}")
        self.requested_model_path = model_path
        self.resolved_model_path = None
        
        # 加载模型
        if model_path and Path(model_path).exists():
            print(f"Loading custom model from: {model_path}")
            self.model = YOLO(model_path)
            self.resolved_model_path = str(Path(model_path).resolve())
        else:
            print("Loading YOLOv8n pretrained model...")
            self.model = YOLO('yolov8n.pt')
            self.resolved_model_path = 'yolov8n.pt'
            # 可以在这里微调模型以适应足球场景
        
        # 移动到指定设备
        self.model.to(self.device)
        
        # 足球相关类别（COCO数据集中的相关类别）
        self.sports_classes = {
            0: 'person',      # 人
            32: 'sports ball' # 运动球
        }
        
        # 检测参数
        self.conf_threshold = 0.25
        self.iou_threshold = 0.45
        
    def detect_frame(self, frame: np.ndarray) -> FrameResult:
        """
        检测单帧中的球员
        
        Args:
            frame: 输入图像帧 (BGR格式)
            
        Returns:
            FrameResult: 检测结果
        """
        height, width = frame.shape[:2]
        
        # 使用YOLOv8进行检测
        results = self.model(
            frame,
            conf=self.conf_threshold,
            iou=self.iou_threshold,
            classes=list(self.sports_classes.keys()),  # 只检测相关类别
            verbose=False
        )
        
        detections = []
        for result in results:
            if result.boxes is not None:
                boxes = result.boxes.xyxy.cpu().numpy()  # 边界框
                confidences = result.boxes.conf.cpu().numpy()  # 置信度
                class_ids = result.boxes.cls.cpu().numpy().astype(int)  # 类别ID
                
                for box, conf, cls_id in zip(boxes, confidences, class_ids):
                    if cls_id in self.sports_classes:
                        detection = PlayerDetection(
                            bbox=box.tolist(),
                            confidence=float(conf),
                            class_id=int(cls_id),
                            class_name=self.sports_classes[cls_id]
                        )
                        detections.append(detection)
        
        return FrameResult(
            frame_index=0,  # 需要外部提供
            timestamp=0.0,  # 需要外部提供
            detections=detections,
            frame_size=(width, height)
        )
    
    def detect_video(self, video_path: str, output_path: str = None, 
                    visualize: bool = True, max_frames: int = None) -> List[FrameResult]:
        """
        检测整个视频中的球员
        
        Args:
            video_path: 视频文件路径
            output_path: 输出视频路径（如果可视化）
            visualize: 是否生成可视化视频
            max_frames: 最大处理帧数
            
        Returns:
            List[FrameResult]: 所有帧的检测结果
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")
        
        # 获取视频信息
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        print(f"Video Info: {width}x{height}, {fps} FPS, {total_frames} frames")
        
        if max_frames:
            total_frames = min(total_frames, max_frames)
        
        # 准备输出视频（如果需要）
        out = None
        if visualize and output_path:
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
        
        all_results = []
        frame_count = 0
        
        print(f"Processing video: {video_path}")
        print(f"Total frames to process: {total_frames}")
        
        while True:
            ret, frame = cap.read()
            if not ret or (max_frames and frame_count >= max_frames):
                break
            
            # 计算时间戳
            timestamp = frame_count / fps
            
            # 检测当前帧
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = self.detect_frame(frame_rgb)
            result.frame_index = frame_count
            result.timestamp = timestamp
            
            all_results.append(result)
            
            # 可视化（如果需要）
            if visualize:
                visualized_frame = self._visualize_detections(frame.copy(), result)
                
                if out:
                    out.write(visualized_frame)
                
                # 显示进度
                if frame_count % 100 == 0:
                    print(f"Processed {frame_count}/{total_frames} frames")
            
            frame_count += 1
        
        # 释放资源
        cap.release()
        if out:
            out.release()
            print(f"Output video saved to: {output_path}")
        
        print(f"Detection completed. Processed {frame_count} frames.")
        return all_results
    
    def _visualize_detections(self, frame: np.ndarray, result: FrameResult) -> np.ndarray:
        """
        在帧上可视化检测结果
        
        Args:
            frame: 原始帧
            result: 检测结果
            
        Returns:
            可视化后的帧
        """
        for detection in result.detections:
            x1, y1, x2, y2 = map(int, detection.bbox)
            conf = detection.confidence
            class_name = detection.class_name
            
            # 绘制边界框
            color = (0, 255, 0) if class_name == 'person' else (0, 0, 255)  # 绿色为人，红色为球
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            
            # 绘制标签
            label = f"{class_name} {conf:.2f}"
            label_size, baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
            cv2.rectangle(frame, (x1, y1 - label_size[1] - 10), 
                         (x1 + label_size[0], y1), color, -1)
            cv2.putText(frame, label, (x1, y1 - 5), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
        
        # 显示帧编号和时间戳
        info_text = f"Frame: {result.frame_index} | Time: {result.timestamp:.2f}s | Players: {len([d for d in result.detections if d.class_name == 'person'])}"
        cv2.putText(frame, info_text, (10, 30), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        
        return frame
    
    def analyze_detection_statistics(self, results: List[FrameResult]) -> Dict:
        """
        分析检测结果的统计信息
        
        Args:
            results: 所有帧的检测结果
            
        Returns:
            统计信息字典
        """
        if not results:
            return {}
        
        total_frames = len(results)
        total_players = sum(len([d for d in r.detections if d.class_name == 'person']) for r in results)
        total_balls = sum(len([d for d in r.detections if d.class_name == 'sports ball']) for r in results)
        
        # 计算平均每帧的球员数
        avg_players_per_frame = total_players / total_frames if total_frames > 0 else 0
        
        # 检测置信度统计
        player_confidences = [d.confidence for r in results 
                             for d in r.detections if d.class_name == 'person']
        ball_confidences = [d.confidence for r in results 
                           for d in r.detections if d.class_name == 'sports ball']
        
        stats = {
            'total_frames': total_frames,
            'total_players_detected': total_players,
            'total_balls_detected': total_balls,
            'avg_players_per_frame': avg_players_per_frame,
            'avg_player_confidence': np.mean(player_confidences) if player_confidences else 0,
            'avg_ball_confidence': np.mean(ball_confidences) if ball_confidences else 0,
            'max_players_in_frame': max(len([d for d in r.detections if d.class_name == 'person']) for r in results),
            'min_players_in_frame': min(len([d for d in r.detections if d.class_name == 'person']) for r in results)
        }
        
        return stats

# 使用示例
if __name__ == "__main__":
    # 创建检测器
    detector = PlayerDetector()
    
    # 测试图片检测
    test_image_path = "test_football.jpg"  # 需要实际图片
    if Path(test_image_path).exists():
        frame = cv2.imread(test_image_path)
        if frame is not None:
            result = detector.detect_frame(frame)
            print(f"Detected {len(result.detections)} objects")
            
            # 可视化
            visualized = detector._visualize_detections(frame, result)
            cv2.imwrite("detection_result.jpg", visualized)
            print("Visualization saved to detection_result.jpg")
    
    print("Player detector initialized successfully.")
