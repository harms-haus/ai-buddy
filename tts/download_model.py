"""Pre-download Kokoro model files."""
import os

try:
    from kokoro import KPipeline
    print("Using kokoro package (KPipeline)...")
    pipeline = KPipeline(lang_code='a')
    _ = list(pipeline("test", voice='af_heart', speed=1.0))
    print("Kokoro KPipeline model downloaded!")
except ImportError:
    print("kokoro package not found, trying kokoro-onnx...")
    from kokoro_onnx import Kokoro
    import requests
    
    for url, filename in [
        ("https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx", "kokoro-v1.0.onnx"),
        ("https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin", "voices-v1.0.bin"),
    ]:
        if os.path.exists(filename):
            print(f"{filename} already exists, skipping")
            continue
        print(f"Downloading {filename}...")
        r = requests.get(url)
        with open(filename, 'wb') as f:
            f.write(r.content)
        print(f"{filename} downloaded!")
