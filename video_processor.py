import os
import moviepy.editor as mp
from pathlib import Path


def generate_video(audio_path: str, image_paths: list[str], output_video_path: str):
    """
    将音频和关键帧图片合成视频，保持音频原样，图片按音频时长均匀分布
    :param audio_path: 输入音频文件路径（支持mp3/wav等）
    :param image_paths: 关键帧图片路径列表（支持png/jpg等）
    :param output_video_path: 输出视频文件路径（支持mp4等）
    """
    # 读取音频获取时长
    audio_clip = mp.AudioFileClip(audio_path)
    audio_duration = audio_clip.duration
    
    # 计算每张图片的持续时间，均匀分配音频时长
    num_images = len(image_paths)
    if num_images == 0:
        raise ValueError("至少需要一张关键帧图片")
    frame_duration = audio_duration / num_images
    
    # 创建图片剪辑，每张图片持续frame_duration
    image_clips = []
    for img_path in image_paths:
        if not os.path.exists(img_path):
            raise FileNotFoundError(f"图片文件不存在: {img_path}")
        img_clip = mp.ImageClip(img_path).set_duration(frame_duration)
        image_clips.append(img_clip)
    
    # 拼接图片剪辑为一个视频
    video_clip = mp.concatenate_videoclips(image_clips, method="compose")
    
    # 绑定音频到视频
    final_clip = video_clip.set_audio(audio_clip)
    
    # 输出视频，设置帧率（这里设为1fps，可根据需要调整，或者根据图片数量调整）
    final_clip.write_videofile(output_video_path, fps=1, codec="libx264", audio_codec="aac")
    
    # 释放资源
    audio_clip.close()
    final_clip.close()
    video_clip.close()
    for clip in image_clips:
        clip.close()
    
    print(f"视频生成完成: {output_video_path}")


if __name__ == "__main__":
    # 示例使用
    audio_path = "example_audio.mp3"  # 用户替换为实际音频路径
    image_paths = ["frame1.png", "frame2.png", "frame3.png"]  # 用户替换为实际关键帧路径
    output_video = "output_video.mp4"
    
    try:
        generate_video(audio_path, image_paths, output_video)
    except Exception as e:
        print(f"生成失败: {str(e)}")
