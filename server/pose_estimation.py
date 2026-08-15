import sys
import json
import base64
import cv2
import numpy as np
from ultralytics import YOLO

try:
    model = YOLO('yolov8n-pose.pt')
except Exception as e:
    print(f"Model load error: {e}", file=sys.stderr)
    sys.exit(1)

for line in sys.stdin:
    try:
        if "," in line:
            header, encoded = line.strip().split(",", 1)
        else:
            encoded = line.strip()
            
        img_bytes = base64.b64decode(encoded)
        img_arr = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(img_arr, flags=cv2.IMREAD_COLOR)

        if img is None:
            continue

        # YOLOv8で推論 (conf=0.15に変更して複数人を検出しやすくする)
        # imgsz=480: 既定(640)より小さい入力サイズで推論することで、
        # 1フレームあたりの推論時間を短縮している(=検出データの反映の遅れを
        # 軽減)。検出精度はわずかに下がるが、Node.js側で追加したバック
        # プレッシャー制御(常に最新フレームのみ処理する仕組み)と合わせて、
        # 体感の遅延を抑えることを優先したトレードオフ。精度を優先したい
        # 場合は imgsz=640 に戻す(その場合は処理時間が伸びる点に注意)。
        results = model(img, conf=0.15, imgsz=480, verbose=False)
        
        output = {"keypoints": []}
        if results and len(results) > 0 and results[0].keypoints is not None:
            # 映っている全員分の骨格データをループですべて取得する
            for kpts_tensor in results[0].keypoints.data:
                output["keypoints"].append(kpts_tensor.tolist())
        
        # 結果をJSONとして出力
        print(json.dumps(output))
        sys.stdout.flush()
        
    except Exception as e:
        print(f"Processing error: {e}", file=sys.stderr)