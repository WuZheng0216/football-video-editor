"""
视频处理核心模块
提供基础的视频处理功能
"""

import subprocess
import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import tempfile
import shutil

class VideoProcessor:
    """视频处理器"""
    
    def __init__(self, ffmpeg_path: str = None):
        """
        初始化视频处理器
        
        Args:
            ffmpeg_path: FFmpeg可执行文件路径，如果为None则自动查找
        """
        self.ffmpeg_path = ffmpeg_path or self._find_ffmpeg()
        if not self.ffmpeg_path:
            raise RuntimeError("FFmpeg not found. Please install FFmpeg and add it to PATH.")
        
        print(f"Using FFmpeg at: {self.ffmpeg_path}")
    
    def _find_ffmpeg(self) -> Optional[str]:
        """查找系统上的FFmpeg"""
        # 尝试常见路径
        common_paths = [
            'ffmpeg',
            '/usr/bin/ffmpeg',
            '/usr/local/bin/ffmpeg',
            'C:\\ffmpeg\\bin\\ffmpeg.exe',
            os.path.join(os.path.dirname(__file__), 'ffmpeg')
        ]
        
        for path in common_paths:
            try:
                result = subprocess.run([path, '-version'], 
                                      capture_output=True, 
                                      text=True)
                if result.returncode == 0:
                    return path
            except (FileNotFoundError, PermissionError):
                continue
        
        return None
    
    def get_video_info(self, video_path: str) -> Dict:
        """
        获取视频文件信息
        
        Args:
            video_path: 视频文件路径
            
        Returns:
            视频信息字典
        """
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")
        
        cmd = [
            self.ffmpeg_path,
            '-i', video_path,
            '-hide_banner',
            '-print_format', 'json',
            '-show_entries', 'format=duration,size,bit_rate:stream=width,height,codec_name,r_frame_rate',
            '-select_streams', 'v:0',
            '-v', 'quiet'
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                # 尝试另一种方式
                cmd = [self.ffmpeg_path, '-i', video_path]
                result = subprocess.run(cmd, capture_output=True, text=True, stderr=subprocess.STDOUT)
                
                # 从输出中解析信息
                info = self._parse_ffmpeg_output(result.stdout)
                return info
            
            data = json.loads(result.stdout)
            format_info = data.get('format', {})
            streams = data.get('streams', [])
            
            video_stream = next((s for s in streams if s.get('codec_type') == 'video'), {})
            
            # 解析帧率
            frame_rate = video_stream.get('r_frame_rate', '30/1')
            if '/' in frame_rate:
                num, den = map(int, frame_rate.split('/'))
                fps = num / den
            else:
                fps = float(frame_rate)
            
            info = {
                'duration': float(format_info.get('duration', 0)),
                'size': int(format_info.get('size', 0)),
                'bitrate': int(format_info.get('bit_rate', 0)),
                'width': video_stream.get('width', 0),
                'height': video_stream.get('height', 0),
                'codec': video_stream.get('codec_name', 'unknown'),
                'fps': fps,
                'format': format_info.get('format_name', 'unknown'),
                'path': video_path,
                'filename': os.path.basename(video_path)
            }
            
            return info
            
        except Exception as e:
            print(f"Error getting video info: {e}")
            return {
                'path': video_path,
                'filename': os.path.basename(video_path),
                'error': str(e)
            }
    
    def _parse_ffmpeg_output(self, output: str) -> Dict:
        """从FFmpeg输出中解析信息"""
        info = {}
        
        # 解析时长
        duration_match = None
        for line in output.split('\n'):
            if 'Duration:' in line:
                duration_str = line.split('Duration:')[1].split(',')[0].strip()
                # 转换 HH:MM:SS.mmm 为秒
                try:
                    h, m, s = duration_str.split(':')
                    s, ms = s.split('.')
                    total_seconds = int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000
                    info['duration'] = total_seconds
                except:
                    info['duration'] = 0
                break
        
        # 解析分辨率
        for line in output.split('\n'):
            if 'Video:' in line:
                # 查找分辨率
                import re
                resolution_match = re.search(r'(\d+)x(\d+)', line)
                if resolution_match:
                    info['width'] = int(resolution_match.group(1))
                    info['height'] = int(resolution_match.group(2))
                
                # 查找帧率
                fps_match = re.search(r'(\d+(\.\d+)?)\s*fps', line)
                if fps_match:
                    info['fps'] = float(fps_match.group(1))
                break
        
        return info
    
    def cut_video(self, input_path: str, output_path: str, 
                 start_time: float, end_time: float) -> bool:
        """
        剪切视频片段
        
        Args:
            input_path: 输入视频路径
            output_path: 输出视频路径
            start_time: 开始时间（秒）
            end_time: 结束时间（秒）
            
        Returns:
            是否成功
        """
        duration = end_time - start_time
        
        cmd = [
            self.ffmpeg_path,
            '-i', input_path,
            '-ss', str(start_time),
            '-t', str(duration),
            '-c', 'copy',  # 使用流复制，快速但不精确
            '-avoid_negative_ts', 'make_zero',
            '-y',  # 覆盖输出文件
            output_path
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
            return result.returncode == 0
        except Exception as e:
            print(f"Error cutting video: {e}")
            return False
    
    def merge_videos(self, video_paths: List[str], output_path: str) -> bool:
        """
        合并多个视频
        
        Args:
            video_paths: 视频文件路径列表
            output_path: 输出视频路径
            
        Returns:
            是否成功
        """
        if len(video_paths) < 2:
            raise ValueError("At least 2 videos are required for merging")
        
        # 创建文件列表
        list_file = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
        for video_path in video_paths:
            list_file.write(f"file '{os.path.abspath(video_path)}'\n")
        list_file.close()
        
        cmd = [
            self.ffmpeg_path,
            '-f', 'concat',
            '-safe', '0',
            '-i', list_file.name,
            '-c', 'copy',
            '-y',
            output_path
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
            os.unlink(list_file.name)
            return result.returncode == 0
        except Exception as e:
            print(f"Error merging videos: {e}")
            if os.path.exists(list_file.name):
                os.unlink(list_file.name)
            return False
    
    def extract_frames(self, video_path: str, output_dir: str, 
                      fps: float = 1.0, quality: int = 2) -> List[str]:
        """
        从视频中提取帧
        
        Args:
            video_path: 视频文件路径
            output_dir: 输出目录
            fps: 提取帧率（每秒多少帧）
            quality: 图像质量（2-31，2为最高质量）
            
        Returns:
            提取的帧文件路径列表
        """
        os.makedirs(output_dir, exist_ok=True)
        
        output_pattern = os.path.join(output_dir, 'frame_%04d.jpg')
        
        cmd = [
            self.ffmpeg_path,
            '-i', video_path,
            '-vf', f'fps={fps}',
            '-q:v', str(quality),
            '-y',
            output_pattern
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                # 获取生成的文件列表
                frame_files = sorted([os.path.join(output_dir, f) 
                                    for f in os.listdir(output_dir) 
                                    if f.startswith('frame_') and f.endswith('.jpg')])
                return frame_files
            return []
        except Exception as e:
            print(f"Error extracting frames: {e}")
            return []
    
    def add_overlay(self, input_path: str, output_path: str, 
                   overlay_path: str, position: Tuple[int, int] = (10, 10),
                   size: Tuple[int, int] = None) -> bool:
        """
        添加覆盖层（水印、Logo等）
        
        Args:
            input_path: 输入视频路径
            output_path: 输出视频路径
            overlay_path: 覆盖图像路径
            position: 位置 (x, y)
            size: 大小 (width, height)，如果为None则保持原大小
            
        Returns:
            是否成功
        """
        if not os.path.exists(overlay_path):
            raise FileNotFoundError(f"Overlay image not found: {overlay_path}")
        
        # 构建滤镜参数
        filter_complex = f"[1:v]scale={size[0]}:{size[1]}[overlay];[0:v][overlay]overlay={position[0]}:{position[1]}"
        if size is None:
            filter_complex = f"[0:v][1:v]overlay={position[0]}:{position[1]}"
        
        cmd = [
            self.ffmpeg_path,
            '-i', input_path,
            '-i', overlay_path,
            '-filter_complex', filter_complex,
            '-codec:a', 'copy',
            '-y',
            output_path
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
            return result.returncode == 0
        except Exception as e:
            print(f"Error adding overlay: {e}")
            return False
    
    def convert_format(self, input_path: str, output_path: str, 
                      output_format: str = 'mp4', 
                      video_codec: str = 'libx264',
                      audio_codec: str = 'aac',
                      bitrate: str = '2000k') -> bool:
        """
        转换视频格式
        
        Args:
            input_path: 输入视频路径
            output_path: 输出视频路径
            output_format: 输出格式
            video_codec: 视频编码器
            audio_codec: 音频编码器
            bitrate: 视频比特率
            
        Returns:
            是否成功
        """
        cmd = [
            self.ffmpeg_path,
            '-i', input_path,
            '-c:v', video_codec,
            '-b:v', bitrate,
            '-c:a', audio_codec,
            '-y',
            output_path
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
            return result.returncode == 0
        except Exception as e:
            print(f"Error converting format: {e}")
            return False
    
    def create_thumbnail(self, video_path: str, output_path: str, 
                        time: float = 0.0, width: int = 320) -> bool:
        """
        创建视频缩略图
        
        Args:
            video_path: 视频文件路径
            output_path: 输出图片路径
            time: 截图时间（秒）
            width: 缩略图宽度
            
        Returns:
            是否成功
        """
        cmd = [
            self.ffmpeg_path,
            '-ss', str(time),
            '-i', video_path,
            '-vframes', '1',
            '-vf', f'scale={width}:-1',
            '-y',
            output_path
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
            return result.returncode == 0
        except Exception as e:
            print(f"Error creating thumbnail: {e}")
            return False

# 使用示例
if __name__ == "__main__":
    # 创建视频处理器
    try:
        processor = VideoProcessor()
        print("Video processor initialized successfully.")
        
        # 测试功能
        test_video = "test.mp4"  # 需要实际视频文件
        if os.path.exists(test_video):
            info = processor.get_video_info(test_video)
            print("Video Info:")
            for key, value in info.items():
                print(f"  {key}: {value}")
            
            # 创建缩略图
            thumbnail_path = "thumbnail.jpg"
            if processor.create_thumbnail(test_video, thumbnail_path, time=10):
                print(f"Thumbnail created: {thumbnail_path}")
                
    except Exception as e:
        print(f"Error: {e}")