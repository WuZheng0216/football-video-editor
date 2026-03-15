"""
Player Tracking Module
基于检测结果进行球员跟踪
"""

import numpy as np
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from collections import defaultdict
import cv2
from scipy.spatial import distance
from player_detector import PlayerDetection, FrameResult

@dataclass
class TrackedPlayer:
    """被跟踪的球员"""
    track_id: int
    team: Optional[str] = None
    jersey_number: Optional[int] = None
    positions: List[Tuple[float, float]] = None  # 历史位置 [(x_center, y_center), ...]
    bboxes: List[List[float]] = None  # 历史边界框
    appearances: List[int] = None  # 出现的帧索引
    last_seen: int = 0  # 最后出现的帧索引
    color: Tuple[int, int, int] = None  # 显示颜色
    
    def __post_init__(self):
        if self.positions is None:
            self.positions = []
        if self.bboxes is None:
            self.bboxes = []
        if self.appearances is None:
            self.appearances = []
        if self.color is None:
            # 生成随机但可区分的颜色
            np.random.seed(self.track_id)
            self.color = tuple(np.random.randint(0, 255, 3).tolist())

class PlayerTracker:
    """球员跟踪器"""
    
    def __init__(self, max_age: int = 30, min_hits: int = 3, iou_threshold: float = 0.3):
        """
        初始化跟踪器
        
        Args:
            max_age: 跟踪丢失的最大帧数
            min_hits: 最小连续出现次数
            iou_threshold: IOU匹配阈值
        """
        self.max_age = max_age
        self.min_hits = min_hits
        self.iou_threshold = iou_threshold
        
        self.tracks: Dict[int, TrackedPlayer] = {}
        self.next_id = 1
        self.frame_count = 0
        
    def update(self, frame_result: FrameResult) -> FrameResult:
        """
        更新跟踪状态
        
        Args:
            frame_result: 当前帧的检测结果
            
        Returns:
            更新后的帧结果（包含跟踪ID）
        """
        self.frame_count += 1
        
        # 获取当前帧的球员检测
        player_detections = [d for d in frame_result.detections if d.class_name == 'person']
        
        if not player_detections:
            # 没有检测到球员，更新所有跟踪状态
            self._update_missing_tracks()
            return frame_result
        
        # 计算检测框的中心点
        detections_with_centers = []
        for det in player_detections:
            x1, y1, x2, y2 = det.bbox
            center_x = (x1 + x2) / 2
            center_y = (y1 + y2) / 2
            detections_with_centers.append((det, (center_x, center_y)))
        
        # 匹配现有跟踪
        matched_pairs = self._match_detections_to_tracks(detections_with_centers)
        
        # 更新匹配的跟踪
        for track_id, (detection, center) in matched_pairs:
            track = self.tracks[track_id]
            
            # 更新跟踪信息
            track.positions.append(center)
            track.bboxes.append(detection.bbox)
            track.appearances.append(self.frame_count)
            track.last_seen = self.frame_count
            
            # 为检测添加跟踪ID
            detection.player_id = track_id
        
        # 为未匹配的检测创建新跟踪
        for detection, center in detections_with_centers:
            if detection.player_id is None:  # 未匹配
                new_track_id = self.next_id
                self.next_id += 1
                
                new_track = TrackedPlayer(
                    track_id=new_track_id,
                    positions=[center],
                    bboxes=[detection.bbox],
                    appearances=[self.frame_count],
                    last_seen=self.frame_count
                )
                
                self.tracks[new_track_id] = new_track
                detection.player_id = new_track_id
        
        # 清理丢失的跟踪
        self._cleanup_lost_tracks()
        
        return frame_result
    
    def _match_detections_to_tracks(self, detections_with_centers) -> List[Tuple[int, Tuple]]:
        """
        将检测匹配到现有跟踪
        
        Args:
            detections_with_centers: 检测列表，每个元素为(detection, center)
            
        Returns:
            匹配对列表 [(track_id, (detection, center)), ...]
        """
        if not self.tracks or not detections_with_centers:
            return []
        
        # 获取活跃的跟踪（最近出现过的）
        active_tracks = {
            track_id: track for track_id, track in self.tracks.items()
            if self.frame_count - track.last_seen <= self.max_age
        }
        
        if not active_tracks:
            return []
        
        # 计算距离矩阵（检测中心与跟踪预测位置的距离）
        distance_matrix = np.zeros((len(detections_with_centers), len(active_tracks)))
        
        track_ids = list(active_tracks.keys())
        for i, (_, det_center) in enumerate(detections_with_centers):
            for j, track_id in enumerate(track_ids):
                track = active_tracks[track_id]
                if track.positions:
                    # 使用最近的位置作为预测
                    last_pos = track.positions[-1]
                    dist = distance.euclidean(det_center, last_pos)
                    distance_matrix[i, j] = dist
        
        # 简单的匈牙利匹配（这里简化处理，实际可以使用更复杂的算法）
        matched_pairs = []
        used_detections = set()
        used_tracks = set()
        
        # 按距离排序
        matches = []
        for i in range(len(detections_with_centers)):
            for j in range(len(track_ids)):
                matches.append((distance_matrix[i, j], i, j))
        
        matches.sort(key=lambda x: x[0])
        
        for dist, i, j in matches:
            if i not in used_detections and j not in used_tracks:
                # 检查距离是否在阈值内
                if dist < 100:  # 距离阈值，可以根据视频分辨率调整
                    track_id = track_ids[j]
                    matched_pairs.append((track_id, detections_with_centers[i]))
                    used_detections.add(i)
                    used_tracks.add(j)
        
        return matched_pairs
    
    def _update_missing_tracks(self):
        """更新所有跟踪的丢失状态"""
        for track_id, track in list(self.tracks.items()):
            if self.frame_count - track.last_seen > self.max_age:
                # 跟踪丢失时间过长，可以删除或标记为丢失
                pass
    
    def _cleanup_lost_tracks(self):
        """清理长时间丢失的跟踪"""
        tracks_to_remove = []
        for track_id, track in self.tracks.items():
            if self.frame_count - track.last_seen > self.max_age * 2:
                tracks_to_remove.append(track_id)
        
        for track_id in tracks_to_remove:
            del self.tracks[track_id]
    
    def get_tracking_statistics(self) -> Dict:
        """获取跟踪统计信息"""
        active_tracks = [t for t in self.tracks.values() 
                        if self.frame_count - t.last_seen <= self.max_age]
        
        return {
            'total_tracks': len(self.tracks),
            'active_tracks': len(active_tracks),
            'next_track_id': self.next_id,
            'frame_count': self.frame_count
        }
    
    def visualize_tracking(self, frame: np.ndarray, frame_result: FrameResult) -> np.ndarray:
        """
        在帧上可视化跟踪结果
        
        Args:
            frame: 原始帧
            frame_result: 包含跟踪ID的帧结果
            
        Returns:
            可视化后的帧
        """
        # 绘制球员检测和跟踪ID
        for detection in frame_result.detections:
            if detection.class_name == 'person' and detection.player_id is not None:
                x1, y1, x2, y2 = map(int, detection.bbox)
                track_id = detection.player_id
                
                # 获取跟踪颜色
                track = self.tracks.get(track_id)
                color = track.color if track else (0, 255, 0)
                
                # 绘制边界框
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                
                # 绘制跟踪ID
                label = f"ID:{track_id}"
                label_size, baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
                cv2.rectangle(frame, (x1, y1 - label_size[1] - 10), 
                             (x1 + label_size[0], y1), color, -1)
                cv2.putText(frame, label, (x1, y1 - 5), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
        
        # 绘制跟踪轨迹
        for track_id, track in self.tracks.items():
            if len(track.positions) > 1:
                # 绘制轨迹线
                points = np.array([(int(x), int(y)) for x, y in track.positions[-20:]], np.int32)
                if len(points) >= 2:
                    cv2.polylines(frame, [points], False, track.color, 2)
        
        # 显示统计信息
        stats = self.get_tracking_statistics()
        info_text = f"Active Tracks: {stats['active_tracks']} | Total Tracks: {stats['total_tracks']}"
        cv2.putText(frame, info_text, (10, 60), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        
        return frame

# 使用示例
if __name__ == "__main__":
    # 创建跟踪器
    tracker = PlayerTracker()
    
    print("Player tracker initialized successfully.")
    print("This module should be used together with PlayerDetector for complete tracking pipeline.")