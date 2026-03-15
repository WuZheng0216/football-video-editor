#!/usr/bin/env python3
"""
测试球员检测功能
如果没有真实视频，可以生成测试视频进行测试
"""

import cv2
import numpy as np
import os
from pathlib import Path
from player_detector import PlayerDetector
import tempfile

def generate_test_video(output_path: str = "test_football.mp4", duration: int = 10):
    """
    生成测试用的足球视频
    
    Args:
        output_path: 输出视频路径
        duration: 视频时长（秒）
    """
    print(f"Generating test video: {output_path}")
    
    # 视频参数
    fps = 30
    width, height = 640, 480
    total_frames = duration * fps
    
    # 创建视频写入器
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
    
    # 生成足球场背景
    field_color = (60, 180, 75)  # 绿色
    line_color = (255, 255, 255)  # 白色
    
    for frame_idx in range(total_frames):
        # 创建足球场背景
        frame = np.full((height, width, 3), field_color, dtype=np.uint8)
        
        # 绘制中线
        cv2.line(frame, (width//2, 0), (width//2, height), line_color, 2)
        
        # 绘制中圈
        cv2.circle(frame, (width//2, height//2), 50, line_color, 2)
        
        # 绘制球员（模拟）
        player_size = 20
        
        # 球队A（红色）
        for i in range(5):
            x = np.random.randint(100, 300)
            y = np.random.randint(100, 400)
            cv2.circle(frame, (x, y), player_size, (0, 0, 255), -1)  # 红色球员
        
        # 球队B（蓝色）
        for i in range(5):
            x = np.random.randint(340, 540)
            y = np.random.randint(100, 400)
            cv2.circle(frame, (x, y), player_size, (255, 0, 0), -1)  # 蓝色球员
        
        # 足球（白色）
        ball_x = width//2 + np.random.randint(-50, 50)
        ball_y = height//2 + np.random.randint(-50, 50)
        cv2.circle(frame, (ball_x, ball_y), 10, (255, 255, 255), -1)
        
        # 添加一些运动效果
        if frame_idx > 0:
            # 简单运动模糊
            alpha = 0.9
            frame = cv2.addWeighted(frame, alpha, frame, 1-alpha, 0)
        
        # 写入帧
        out.write(frame)
    
    # 释放视频写入器
    out.release()
    print(f"Test video generated: {output_path}")
    return output_path

def test_player_detection():
    """
    测试球员检测功能
    """
    print("=" * 60)
    print("Testing Player Detection")
    print("=" * 60)
    
    # 创建检测器
    try:
        detector = PlayerDetector()
        print("✅ Player detector initialized successfully")
    except Exception as e:
        print(f"❌ Failed to initialize player detector: {e}")
        return
    
    # 生成测试视频
    test_video_path = None
    if os.path.exists("test_football.mp4"):
        test_video_path = "test_football.mp4"
        print("📁 Using existing test video")
    else:
        try:
            test_video_path = generate_test_video()
            print("✅ Test video generated successfully")
        except Exception as e:
            print(f"❌ Failed to generate test video: {e}")
            # 尝试使用静态图片测试
            print("🔄 Falling back to image detection test...")
            test_image_path = "test_image.jpg"
            if not os.path.exists(test_image_path):
                # 创建测试图片
                img = np.zeros((480, 640, 3), dtype=np.uint8)
                img[:,:] = (60, 180, 75)  # 绿色背景
                cv2.circle(img, (320, 240), 20, (0, 0, 255), -1)  # 红色球员
                cv2.circle(img, (400, 200), 10, (255, 255, 255), -1)  # 白色足球
                cv2.imwrite(test_image_path, img)
                print(f"📸 Generated test image: {test_image_path}")
            
            # 测试图片检测
            img = cv2.imread(test_image_path)
            if img is not None:
                result = detector.detect_frame(img)
                print(f"📊 Detected {len(result.detections)} objects")
                
                # 可视化
                visualized = detector._visualize_detections(img.copy(), result)
                cv2.imwrite("detection_result.jpg", visualized)
                print("🖼️ Visualization saved to detection_result.jpg")
                
                # 显示检测结果详情
                for i, det in enumerate(result.detections):
                    print(f"  Object {i+1}: {det.class_name} (conf: {det.confidence:.2f})")
            
            return
    
    # 使用测试视频进行检测
    if test_video_path and os.path.exists(test_video_path):
        print(f"🎬 Processing test video: {test_video_path}")
        
        try:
            # 只处理前5秒以节省时间
            results = detector.detect_video(
                test_video_path,
                output_path="detection_output.mp4",
                visualize=True,
                max_frames=150  # 5秒 * 30fps
            )
            
            print(f"✅ Video processing complete")
            print(f"📈 Processed {len(results)} frames")
            
            # 分析统计信息
            stats = detector.analyze_detection_statistics(results)
            if stats:
                print("\n📊 Detection Statistics:")
                print(f"  Total frames: {stats['total_frames']}")
                print(f"  Total players detected: {stats['total_players_detected']}")
                print(f"  Total balls detected: {stats['total_balls_detected']}")
                print(f"  Average players per frame: {stats['avg_players_per_frame']:.2f}")
                print(f"  Max players in frame: {stats['max_players_in_frame']}")
                print(f"  Min players in frame: {stats['min_players_in_frame']}")
            
            # 显示输出文件信息
            if os.path.exists("detection_output.mp4"):
                output_size = os.path.getsize("detection_output.mp4") / (1024 * 1024)
                print(f"\n📁 Output video: detection_output.mp4 ({output_size:.2f} MB)")
                print("🎬 Open detection_output.mp4 to see detection results")
        
        except Exception as e:
            print(f"❌ Error during video processing: {e}")
            import traceback
            traceback.print_exc()
    else:
        print("❌ Test video not found")

def test_environment():
    """
    测试环境依赖
    """
    print("\n" + "=" * 60)
    print("Environment Test")
    print("=" * 60)
    
    # 检查OpenCV
    try:
        cv2_version = cv2.__version__
        print(f"✅ OpenCV version: {cv2_version}")
    except Exception as e:
        print(f"❌ OpenCV not found: {e}")
    
    # 检查CUDA（如果有）
    try:
        import torch
        if torch.cuda.is_available():
            print(f"✅ CUDA available: {torch.cuda.get_device_name(0)}")
        else:
            print("ℹ️ CUDA not available, using CPU")
    except ImportError:
        print("ℹ️ PyTorch not installed")

def main():
    """
    主函数
    """
    print("⚽ Football Video Editor - AI Engine Test")
    print("-" * 60)
    
    # 测试环境
    test_environment()
    
    # 测试球员检测
    test_player_detection()
    
    print("\n" + "=" * 60)
    print("Test Complete")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Install missing dependencies if any")
    print("2. Try with real football videos")
    print("3. Train custom models for better accuracy")
    print("4. Integrate with the Electron application")

if __name__ == "__main__":
    main()